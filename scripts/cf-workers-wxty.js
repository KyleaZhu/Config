/**
 * wxty.php → Cloudflare Worker 移植版
 * 出处（PHP 原版）: https://t.me/iptvorganization
 * 差异说明：
 *  - 缓存层用 Cache API（单数据中心内持久，不占 KV 配额，无需绑定任何资源）
 *  - 供体扫描的 detail 调用加了上限防 Workers 子请求超限
 *  - 其余逻辑（签名 / RSA / 三级地址回退 / m3u8 拍平 / 参数）与 PHP 版一一对应
 *
 * 已绑定自定义域: wxty.xdu.qzz.io —— 各台直播链接（?id= 取值来自 CHANNEL_MAP）:
 *  - 东方卫视          https://wxty.xdu.qzz.io/?id=dfws
 *  - 上海新闻综合      https://wxty.xdu.qzz.io/?id=shxwzh
 *  - 上海都市          https://wxty.xdu.qzz.io/?id=shds
 *  - 第一财经          https://wxty.xdu.qzz.io/?id=dycj
 *  - 哈哈炫动          https://wxty.xdu.qzz.io/?id=hhxd
 *  - 五星体育(默认)    https://wxty.xdu.qzz.io/?id=wxty   或 https://wxty.xdu.qzz.io/
 *  - 11频道            https://wxty.xdu.qzz.io/?id=mdy
 *  - 纪实人文          https://wxty.xdu.qzz.io/?id=jsrw
 */

const KANKAN_API_BASE = 'https://kapi.kankanews.com';
const KANKAN_API_VERSION = '2.42.23';
const KANKAN_API_SECRET = '28c8edde3d61a0411511d3b1866f0636';
const KANKAN_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 SE 2.X MetaSr 1.0';

const FALLBACK_LIVE_URL = 'https://cdn.jsdelivr.net/gh/jkwu5472/first/media.m3u8';

const LIVE_URL_CACHE_TTL = 600; // 秒
const LIVE_URL_MIN_LEFT  = 90;  // 地址自身剩余有效期下限
const DONOR_SCAN_DAYS    = 7;
const DONOR_MAX_DETAIL   = 20;  // 子请求上限保护

const CHANNEL_MAP = {
    dfws: 1, shxwzh: 2, shds: 4, dycj: 5,
    hhxd: 9, wxty: 10, mdy: 11, jsrw: 12,
};

/* ---------------- MD5（Web Crypto 无 MD5，内置纯 JS 实现，等价 PHP md5()） ---------------- */

function md5(str) {
    const msg = new TextEncoder().encode(str);
    const len = msg.length;
    const total = (((len + 8) >> 6) + 1) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    const bitLen = len * 8;
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

    for (let off = 0; off < total; off += 64) {
        const M = new Uint32Array(16);
        for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
        const A = a, B = b, C = c, D = d;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16)      { F = (b & c) | (~b & d); g = i; }
            else if (i < 32) { F = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = b ^ c ^ d;          g = (3 * i + 5) % 16; }
            else             { F = c ^ (b | ~d);       g = (7 * i) % 16; }
            F = (F + a + K[i] + M[g]) >>> 0;
            const s = S[i];
            const tmp = d;
            d = c;
            c = b;
            b = (b + ((F << s) | (F >>> (32 - s)))) >>> 0;
            a = tmp;
        }
        a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0;
    }
    const out = new DataView(new ArrayBuffer(16));
    out.setUint32(0, a, true); out.setUint32(4, b, true);
    out.setUint32(8, c, true); out.setUint32(12, d, true);
    return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------------- RSA 公钥还原（对应 PHP rsaDecrypt 系列） ---------------- */

const KANKAN_PEM = "-----BEGIN PUBLIC KEY-----\n"
    + "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDP5hzPUW5RFeE2xBT1ERB3hHZI\n"
    + "Votn/qatWhgc1eZof09qKjElFN6Nma461ZAwGpX4aezKP8Adh4WJj4u2O54xCXDt\n"
    + "wzKRqZO2oNZkuNmF2Va8kLgiEQAAcxYc8JgTN+uQQNpsep4n/o1sArTJooZIF17E\n"
    + "tSqSgXDcJ7yDj5rc7wIDAQAB\n"
    + "-----END PUBLIC KEY-----";

function pemToDer(pem) {
    const b64 = pem.replace(/-----[^-]+-----|\s+/g, '');
    return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
}

function bytesToHex(u8) {
    let s = '';
    for (const x of u8) s += x.toString(16).padStart(2, '0');
    return s;
}

// 简化版 DER 整数扫描器（与 PHP rsaAsn1Integers 相同，只认 INTEGER 标签）
function rsaAsn1Integers(der) {
    const ints = [];
    const len = der.length;
    let i = 0;
    while (i + 2 < len) {
        if (der[i] !== 0x02) { i++; continue; }
        let l = der[i + 1];
        let start = i + 2;
        if (l & 0x80) {
            const n = l & 0x7f;
            l = 0;
            for (let j = 0; j < n; j++) l = l * 256 + der[start + j];
            start += n;
        }
        if (start + l <= len) {
            ints.push(BigInt('0x' + bytesToHex(der.slice(start, start + l))));
            i = start + l;
        } else {
            i++;
        }
    }
    return ints;
}

function modPow(base, exp, mod) {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
        if (exp & 1n) result = (result * base) % mod;
        base = (base * base) % mod;
        exp >>= 1n;
    }
    return result;
}

let RSA_KEY = null;
function rsaKey() {
    if (RSA_KEY) return RSA_KEY;
    const ints = rsaAsn1Integers(pemToDer(KANKAN_PEM));
    if (ints.length < 2) throw new Error('kankan public key parse failed');
    RSA_KEY = { n: ints[0], e: ints[1] };
    return RSA_KEY;
}

// 128 字节一块，剥 PKCS#1 v1.5（00 01 FF..FF 00）填充
function rsaPublicDecryptChunk(chunk, n, e) {
    let cHex = bytesToHex(chunk);
    const m = modPow(BigInt('0x' + cHex), e, n);
    const mHex = m.toString(16).padStart(256, '0');
    if (mHex.length !== 256) return '';
    const block = new Uint8Array(128);
    for (let k = 0; k < 128; k++) block[k] = parseInt(mHex.substr(k * 2, 2), 16);
    if (block[0] !== 0x00 || block[1] !== 0x01) return '';
    let j = 2;
    while (j < 128 && block[j] === 0xff) j++;
    if (j >= 128 || block[j] !== 0x00) return '';
    let out = '';
    for (let k = j + 1; k < 128; k++) out += String.fromCharCode(block[k]);
    return out;
}

function rsaDecrypt(str) {
    if (typeof str !== 'string' || str === '') return null;
    let enc;
    try {
        enc = Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
    } catch (e) { return null; }
    if (enc.length < 128) return null;
    const { n, e } = rsaKey();
    let result = '';
    for (let i = 0; i + 128 <= enc.length; i += 128) {
        result += rsaPublicDecryptChunk(enc.slice(i, i + 128), n, e);
    }
    return result !== '' ? result : null;
}

/* ---------------- 杂项工具（对应 PHP getnonce/getuuid/stableUuid） ---------------- */

function getNonce(len = 8) {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const b = new Uint8Array(len);
    crypto.getRandomValues(b);
    let s = '';
    for (const x of b) s += alphabet[x % alphabet.length];
    return s;
}

function getUuid(len = 21) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    let bin = '';
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').slice(0, len);
}

const CACHE = caches.default;
const UUID_CACHE_KEY = 'https://kk-wxty.internal/cache/uuid';

function liveUrlCacheKey(channelId) {
    return 'https://kk-wxty.internal/cache/live-url/channel-' + channelId + '.json';
}

// stableUuid：文件缓存 → Cache API（同数据中心内持久）
async function getStableUuid() {
    const hit = await CACHE.match(UUID_CACHE_KEY);
    let cur = hit ? (await hit.text()).trim() : '';
    if (cur === '' || /^[A-Za-z0-9_-]{16,32}$/.test(cur) === false) {
        cur = getUuid(21);
        try {
            await CACHE.put(UUID_CACHE_KEY, new Response(cur, {
                headers: { 'Cache-Control': 'max-age=31536000' },
            }));
        } catch (e) { /* 存不下就用临时值 */ }
    }
    return cur;
}

function clientIpOf(request) {
    // 与 PHP 相同：优先信任 XFF，其次 Client-IP，兜底 cf-connecting-ip
    const xff = request.headers.get('X-Forwarded-For');
    if (xff) return xff.split(',')[0].trim();
    const cip = request.headers.get('Client-IP');
    if (cip) return cip;
    return request.headers.get('CF-Connecting-IP') || '';
}

/* ---------------- 沪 API 封装（对应 PHP kankanApiGet） ---------------- */

async function kankanApiGet(path, params = {}, ip = '') {
    const t = Math.floor(Date.now() / 1000);
    const nonce = getNonce(8);
    const uuid = await getStableUuid();

    const all = Object.assign({}, params, {
        'Api-Version': 'v1',
        nonce: nonce,
        platform: 'pc',
        timestamp: t,
        version: KANKAN_API_VERSION,
    });
    const keys = Object.keys(all).sort(); // ASCII 键位下与 PHP ksort 等价
    let signStr = '';
    for (const k of keys) {
        let v = all[k];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) v = JSON.stringify(v).replace(/\//g, '\\/');
        signStr += k + '=' + v + '&';
    }
    const sign = md5(md5(signStr + KANKAN_API_SECRET));

    const headers = {
        'Api-Version': 'v1',
        'Nonce': nonce,
        'M-Uuid': uuid,
        'Platform': 'pc',
        'Version': KANKAN_API_VERSION,
        'Timestamp': String(t),
        'Sign': sign,
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://live.kankanews.com',
        'Referer': 'https://live.kankanews.com/',
        'User-Agent': KANKAN_UA,
    };
    if (ip !== '') {
        headers['X-Forwarded-For'] = ip;
        headers['Client-Ip'] = ip;
    }

    const url = KANKAN_API_BASE + path + '?' + new URLSearchParams(params).toString();
    let resp;
    try {
        resp = await fetch(url, { headers, cf: { cacheTtl: 0 } });
    } catch (e) {
        return null;
    }
    const text = await resp.text();
    try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' ? data : null;
    } catch (e) {
        return null;
    }
}

/* ---------------- 直播地址三级策略（对应 PHP fetchPlayAddress 等） ---------------- */

function shanghaiDate(d) {
    // 等价 PHP：date('Y-m-d', ts) with Asia/Shanghai
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
}

function shanghaiDaysAgo(off) {
    return shanghaiDate(new Date(Date.now() - off * 86400000));
}

function pickProgramAddress(programDetail) {
    const ci = programDetail?.result?.channel_info ?? {};
    const live = String(ci?.live_address ?? '');
    const shift = String(ci?.shift_address ?? '');
    if (live !== '') return { addr: live, kind: 'live' };
    if (shift !== '') return { addr: shift, kind: 'shift' };
    return null;
}

async function fetchPrograms(channelId, date, ip) {
    const res = await kankanApiGet('/content/pc/tv/programs', { channel_id: channelId, date: date }, ip);
    return res?.result?.programs ?? [];
}

async function fetchProgramDetail(programId, ip) {
    return kankanApiGet('/content/pc/tv/program/detail', { channel_program_id: programId }, ip);
}

async function fetchPlayAddress(channelId, ip) {
    const detail = await kankanApiGet('/content/pc/tv/channel/detail', { channel_id: channelId }, ip);
    const chanLive = String(detail?.result?.live_address ?? '');
    if (chanLive !== '') {
        return { addr: chanLive, kind: 'live', source: 'channel' };
    }

    const today = shanghaiDate(new Date());
    const list = await fetchPrograms(channelId, today, ip);
    const now = Math.floor(Date.now() / 1000);
    let current = null;
    for (const p of list) {
        const s = Number(p?.start_time ?? 0);
        const e = Number(p?.end_time ?? 0);
        if (s <= now && now < e) { current = p; break; }
    }
    if (current) {
        const pd = await fetchProgramDetail(current.id, ip);
        const pick = pickProgramAddress(pd);
        if (pick) {
            return { addr: pick.addr, kind: pick.kind, source: 'current-program', program: current };
        }
    }

    let fallbackShift; // 供体兜底（等价 PHP $fallbackShift）
    let detailCount = 0;
    for (let off = 0; off < DONOR_SCAN_DAYS; off++) {
        const date = shanghaiDaysAgo(off);
        let dayList;
        if (off === 0 && list.length) {
            dayList = list;
        } else {
            dayList = await fetchPrograms(channelId, date, ip);
        }
        if (!dayList.length) continue;

        const candidates = [];
        for (const p of dayList) {
            const reviewable = Number(p?.can_review ?? 0) === 1 || Number(p?.is_review ?? 0) === 1;
            if (reviewable) candidates.push(p);
        }

        // 节目名含「体育」优先（等价 PHP usort）
        candidates.sort((a, b) => {
            const sa = String(a?.name ?? '').includes('体育') ? 0 : 1;
            const sb = String(b?.name ?? '').includes('体育') ? 0 : 1;
            return sa - sb;
        });

        for (const p of candidates) {
            if (detailCount >= DONOR_MAX_DETAIL) break; // 子请求保护（移植新增）
            detailCount++;
            const pd = await fetchProgramDetail(p.id, ip);
            const pick = pickProgramAddress(pd);
            if (pick && pick.kind === 'shift') {
                return { addr: pick.addr, kind: 'shift', source: 'donor', program: p };
            }
            if (pick && fallbackShift === undefined) {
                fallbackShift = { addr: pick.addr, kind: pick.kind, source: 'donor', program: p };
            }
        }
        if (detailCount >= DONOR_MAX_DETAIL) break;
    }
    if (fallbackShift !== undefined) return fallbackShift;

    return null;
}

/* ---------------- URL 时效与规整（对应 PHP urlExpiry / normalizeLiveUrl） ---------------- */

function b64UrlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    const bin = atob(s);
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

function urlExpiry(url) {
    if (typeof url !== 'string' || url === '') return 0;
    let u;
    try { u = new URL(url); } catch (e) { return 0; }
    if (u.search === '' || u.search === '?') return 0;

    const cands = [];
    for (const k of ['volcTime', 'txTime', 'wsTime']) {
        const v = u.searchParams.get(k);
        if (!v) continue;
        if (/^[0-9a-fA-f]+$/.test(v) && !/^[0-9]+$/.test(v)) cands.push(parseInt(v, 16));
        else cands.push(parseInt(v, 10));
    }
    const token = u.searchParams.get('token');
    if (token) {
        const parts = token.split('.');
        if (parts.length >= 2) {
            try {
                const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1])));
                if (payload && payload.exp) cands.push(Number(payload.exp));
            } catch (e) { /* 非.exp 结构忽略 */ }
        }
    }
    const valid = cands.filter(v => v > 1600000000);
    return valid.length ? Math.min(...valid) : 0;
}

function normalizeLiveUrl(url) {
    if (typeof url !== 'string' || url === '') return url;
    let u;
    try { u = new URL(url); } catch (e) { return url; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return u.href;

    const raw = u.search.startsWith('?') ? u.search.slice(1) : u.search;
    let search = '';
    if (raw !== '') {
        const keep = [];
        for (const kv of raw.split('&')) {
            if (kv === '') continue;
            const key = kv.split('=', 1)[0];
            if (['start', 'end', 'starttime', 'endtime'].includes(key.toLowerCase())) continue;
            keep.push(kv);
        }
        search = keep.join('&');
    }
    let out = u.protocol + '//' + u.host + u.pathname;
    if (search !== '') out += '?' + search;
    return out;
}

/* ---------------- 直播地址缓存（对应 PHP readCachedLiveUrl 等，改用 Cache API） ---------------- */

async function readCachedLiveUrl(channelId) {
    let raw = '';
    try {
        const hit = await CACHE.match(liveUrlCacheKey(channelId));
        if (!hit) return null;
        raw = (await hit.text()).trim();
    } catch (e) { return null; }
    if (raw === '') return null;
    let url = raw, exp = 0;
    if (raw[0] === '{') {
        let meta;
        try { meta = JSON.parse(raw); } catch (e) { return null; }
        if (typeof meta !== 'object' || meta === null) return null;
        url = String(meta.url ?? '');
        exp = Number(meta.exp ?? 0);
    }
    if (!/^https:\/\//i.test(url)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (exp > 0 && exp - now < LIVE_URL_MIN_LEFT) return null;
    return url;
}

async function writeCachedLiveUrl(channelId, url) {
    const now = Math.floor(Date.now() / 1000);
    let exp = urlExpiry(url);
    if (exp <= 0) exp = now + 300;
    const payload = JSON.stringify({ url: url, exp: exp });
    try {
        // Cache API 的 TTL 由 Cache-Control 控制；TTL 600 对应 PHP 的 LIVE_URL_CACHE_TTL
        await CACHE.put(liveUrlCacheKey(channelId), new Response(payload, {
            headers: { 'Cache-Control': 'max-age=' + LIVE_URL_CACHE_TTL },
        }));
    } catch (e) { /* 写失败则每次直取上游 */ }
}

async function clearCachedLiveUrl(channelId) {
    try { await CACHE.delete(liveUrlCacheKey(channelId)); } catch (e) { /* ignore */ }
}

async function getLiveUrl(channelId, forceRefresh = false, ip = '') {
    const meta = { source: 'cache' };
    let cacheHit = false;
    if (!forceRefresh) {
        const cached = await readCachedLiveUrl(channelId);
        if (cached !== null) {
            cacheHit = true;
            return { url: cached, cacheHit: cacheHit, meta: meta };
        }
    }
    const found = await fetchPlayAddress(channelId, ip);
    if (!found) {
        kkFail('address-failed: 未取到可用播放地址(is_shield 屏蔽且无供体)');
        return { url: null, cacheHit: false, meta: meta };
    }
    const plain = rsaDecrypt(found.addr);
    if (plain === null) {
        kkFail('decrypt-failed: RSA 解密失败 (source=' + found.source + ')');
        return { url: null, cacheHit: false, meta: meta };
    }
    const liveUrl = normalizeLiveUrl(plain);
    if (!liveUrl) {
        kkFail('bad-url: 解密结果不是合法 URL');
        return { url: null, cacheHit: false, meta: meta };
    }
    meta.source = found.source;
    meta.kind = found.kind;
    meta.program = found.program?.name ?? null;
    meta.program_id = found.program?.id ?? null;
    meta.shift_url = plain;
    await writeCachedLiveUrl(channelId, liveUrl);
    return { url: liveUrl, cacheHit: false, meta: meta };
}

function kkFail(reason) {
    console.log('[wxty] ' + reason);
}

function redirectToFallback(reason = '', extraHeaders = {}) {
    if (reason === '') reason = 'unknown';
    console.log('[wxty] fallback -> ' + FALLBACK_LIVE_URL + ' (reason: ' + reason + ')');
    const h = new Headers(extraHeaders);
    h.set('X-Fallback-Reason', reason.replace(/[^A-Za-z0-9_\-]/g, ''));
    h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    h.set('Location', FALLBACK_LIVE_URL);
    return new Response(null, { status: 302, headers: h });
}

/* ---------------- m3u8 拍平（对应 PHP fetchContent / toAbsoluteUrl / getFlatM3u8） ---------------- */

const KANKAN_FETCH_HEADERS = {
    'User-Agent': KANKAN_UA,
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Origin': 'https://live.kankanews.com',
    'Referer': 'https://live.kankanews.com/',
};

async function fetchContent(url, timeoutMs = 15000) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await fetch(url, { headers: KANKAN_FETCH_HEADERS, cf: { cacheTtl: 0 } });
            if (resp.status === 200) {
                const data = await resp.text();
                if (data !== '') return data;
            }
        } catch (e) { /* 出错重试一次 */ }
    }
    return null;
}

function toAbsoluteUrl(base, relative) {
    relative = String(relative);
    if (relative === '') return base;
    if (/^https?:\/\//i.test(relative)) return relative;
    try {
        return new URL(relative, base).href;
    } catch (e) {
        return base;
    }
}

function rewritePlaylistTagUris(line, base) {
    return line.replace(/URI="([^"]+)"/gi, (m0, uri) => 'URI="' + toAbsoluteUrl(base, uri) + '"');
}

async function getFlatM3u8(url, depth = 0) {
    if (depth > 5) return '';
    const content = await fetchContent(url);
    if (content === null) return '';
    const lines = content.split(/\r\n|\n|\r/);
    const output = [];
    let i = 0;
    const count = lines.length;
    while (i < count) {
        const line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
            i++;
            if (i >= count) break;
            const subUrl = lines[i].trim();
            if (subUrl === '' || subUrl[0] === '#') { i++; continue; }
            const subContent = await getFlatM3u8(toAbsoluteUrl(url, subUrl), depth + 1);
            if (subContent) return subContent;
        } else if (line.indexOf('#EXTINF:') === 0) {
            output.push(line);
            i++;
            if (i >= count) break;
            const tsUrl = lines[i].trim();
            if (tsUrl !== '' && tsUrl[0] !== '#') {
                output.push(toAbsoluteUrl(url, tsUrl));
            } else {
                output.push(tsUrl);
            }
        } else if (line !== '') {
            output.push(rewritePlaylistTagUris(line, url));
        }
        i++;
    }
    const joined = output.join('\n');
    return joined.indexOf('#EXTINF') !== -1 ? joined : '';
}

/* ---------------- 主处理入口（对应 PHP 底部主流程） ---------------- */

export default {
    async fetch(request) {
        const u = new URL(request.url);
        const id = u.searchParams.get('id') ?? 'wxty';

        // 频道校验
        const channelId = CHANNEL_MAP[id];
        if (channelId === undefined) {
            return new Response('无效频道ID', { status: 400 });
        }

        // ?ts_url 分支：分片中转（PHP 版同款，无鉴权、直连透传）
        const tsUrlParam = u.searchParams.get('ts_url');
        if (tsUrlParam !== null) {
            const tsUrl = tsUrlParam; // searchParams 已解码（等价 PHP urldecode 后的效果）
            if (!/^https?:\/\//i.test(tsUrl)) {
                return new Response('Invalid url', { status: 400 });
            }
            let pathname = '';
            try { pathname = new URL(tsUrl).pathname; } catch (e) { pathname = ''; }
            const filename = pathname.split('/').pop() ?? '';
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(ts|m4s|mp4|aac|key|vtt)$/.test(filename)
                || filename.indexOf('..') !== -1) {
                return new Response('Invalid filename', { status: 400 });
            }
            // PHP 版落到本地 ts_cache 再回放；Workers 用 Cache API 缓存分片本体
            const cacheKey = new Request('https://kk-wxty.internal/ts/' + encodeURIComponent(tsUrl));
            const cached = await CACHE.match(cacheKey);
            if (cached) {
                return new Response(cached.body, {
                    headers: {
                        'Content-Type': 'video/MP2T',
                        'Cache-Control': 'max-age=86400',
                    },
                });
            }
            let resp;
            try {
                resp = await fetch(tsUrl, {
                    headers: Object.assign({}, KANKAN_FETCH_HEADERS, { 'Connection': 'keep-alive' }),
                    cf: { cacheTtl: 0 },
                });
            } catch (e) {
                resp = null;
            }
            if (!resp || resp.status !== 200) {
                if (resp && resp.body && resp.body.cancel) { try { resp.body.cancel(); } catch (e) {} }
                return new Response('无法获取 TS 分片', { status: 502 });
            }
            // 流式透传 + 写入 Cache API 方便复用（等价 PHP 的 ts_cache 落盘）
            const body = resp.body;
            const h = new Headers({
                'Content-Type': 'video/MP2T',
                'Cache-Control': 'max-age=86400',
            });
            const out = new Response(body, { headers: h });
            if (out.body) {
                const [a, b] = out.body.tee();
                try {
                    await CACHE.put(cacheKey, new Response(a, { headers: h }));
                } catch (e) { /* 忽略缓存写失败 */ }
                return new Response(b, { headers: h });
            }
            return out;
        }

        // 直播地址
        const forceRefresh = u.searchParams.has('refresh') && u.searchParams.get('refresh') !== '0';
        const ip = clientIpOf(request);
        let cacheHit = false;
        let meta = null;
        let liveUrlEl = await getLiveUrl(channelId, forceRefresh, ip);
        let liveUrl = liveUrlEl.url;
        cacheHit = liveUrlEl.cacheHit;
        meta = liveUrlEl.meta;
        if (!liveUrl) {
            return redirectToFallback();
        }

        let finalM3u8 = await getFlatM3u8(liveUrl);
        if (finalM3u8 === '' && cacheHit) {
            await clearCachedLiveUrl(channelId);
            liveUrlEl = await getLiveUrl(channelId, true, ip);
            liveUrl = liveUrlEl.url;
            cacheHit = liveUrlEl.cacheHit;
            meta = liveUrlEl.meta;
            if (liveUrl) finalM3u8 = await getFlatM3u8(liveUrl);
        }
        if (finalM3u8 === '') {
            return redirectToFallback('playlist-fetch-failed: 拉取播放列表失败');
        }

        // ?info 调试接口
        if (u.searchParams.has('info')) {
            const now = Math.floor(Date.now() / 1000);
            const info = {
                id: id,
                channel_id: channelId,
                source: meta?.source ?? null,
                kind: meta?.kind ?? null,
                program: meta?.program ?? null,
                program_id: meta?.program_id ?? null,
                live_url: liveUrl,
                cache: cacheHit ? 'HIT' : 'MISS',
                expires_in: Math.max(0, urlExpiry(liveUrl) - now),
                segment_count: (finalM3u8.match(/#EXTINF/g) ?? []).length,
                fallback_url: FALLBACK_LIVE_URL,
            };
            return new Response(JSON.stringify(info, null, 4), {
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
        }

        return new Response(finalM3u8, {
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Live-Url-Cache': cacheHit ? 'HIT' : 'MISS',
                'X-Live-Url-Source': meta?.source ?? '-',
            },
        });
    },
};
