/**
 * 央视频直播 → HLS 清单 Worker（v261122）
 *
 * ── 这是什么 ───────────────────────────────────────────────
 * 把央视频 App 的 bkliveinfo 接口搬到 Cloudflare Workers：本地用一套移植过来的
 * 设备协议生成签名（cKey），向央视接口要一个播放地址，再把返回的 m3u8 重拼成
 * 一份「长窗口」清单吐给播放器。清单里的分片是 CDN 绝对地址，播放器直接向央视
 * CDN 拉流，**Cloudflare 一个字节的视频都不中转**，只承担每几秒一次的几百字节
 * 清单请求。所以流量和计费都与码率无关，也不触碰「视频不得经 CDN 分发」的条款。
 *
 * ── 为什么必须有 Durable Object ────────────────────────────
 * 上游清单只给 3 个分片（约 15 秒）。播放器某次刷新一慢就会掉出窗口，之后它要
 * 的分片不在清单里，只能跳到窗口头 —— 表现就是「播一会卡住」。这里把 3 片滚成
 * 6 片（约 30 秒），并保证只前进不后退。这份窗口必须「每个频道唯一一份」，所以
 * 放在每频道一个的 Durable Object 里；放在 isolate 内存或 Cache API 里，各机房
 * 各存一份，冷的那份更短更靠后，照样会卡。绑定缺失时直接报 500，不做降级。
 *
 * ── 路由 ──────────────────────────────────────────────────
 *   GET /                 说明页
 *   GET /health           健康检查（版本 / 频道数 / 窗口长度）
 *   GET /list.m3u         订阅源，59 个非体育频道，可直接导入 APTV / TiviMate
 *   GET /<slug>.m3u8      单频道清单；slug 见下方 CHANNEL_ROWS，如 cctv1 / hnws
 * 响应头 X-YSP-Cache / State-Age / Segments / Write 是排障时的第一手信息。
 *
 * ── 网页端部署（Cloudflare Dashboard）────
 *   1. 打开 dash.cloudflare.com，左侧「Workers 和 Pages」→ 创建 → Worker，
 *      起个名字（如 ysp-live），创建完会进入在线编辑器。
 *   2. 把本文件全部内容覆盖粘贴进去，点右上角「部署」。
 *      贴的是完整模块（含 export、含 Durable Object 类），不要只贴其中一段。
 *   3. 回到这个 Worker →「设置」→「绑定」（Settings → Bindings）→ 添加 →
 *      选 Durable Object：
 *          变量名必须填 CHANNEL_STATE     ← 代码里按这个名字取
 *          命名空间选「新建」，类名填 ChannelState
 *      保存后重新部署一次。Dashboard 新建命名空间会自动完成迁移，不需要手动
 *      执行 migrations。
 *   4. 「设置」→「域和路由」→ 添加 → 自定义域，填自己的域名（如 live.example.com），
 *      DNS 记录和证书由 Cloudflare 自动创建。
 *   5. 打开 https://你的域名/health，看到 version 和 channels: 59 就成功了；
 *      再用播放器导入 https://你的域名/list.m3u 即可播放。
 *
 * ── 频道范围 ──────────────────────────────────────────────
 * 只保留实测放行的非体育频道。CCTV-5 / 5+ / 16 / 16-4K 在境外出口一律返回
 * iretcode=5（地区版权），已从表中移除，不做任何回退。
 */

const VERSION = 'v261122';
const BK_URL = 'https://bkliveinfo.ysp.cctv.cn/';

/**
 * 频道地址池（playurl）复用时间（秒），避免每次都多打一次 bkliveinfo。
 * 取 300 是跟上游源码的 DEVICE_RETURN_WINDOW 对齐：它自己认为一条 playurl
 * 在 300 秒内可复用。超过后上游可能返回 403，而 fetchUpstream 的第二次
 * 尝试会强制换新 cKey 重解析，属于自愈路径，不需要在这里提前失效。
 */
const RESOLVE_TTL = 300;

const CK_PLATFORM = 4330403;
const CK_APPVER = 'V8.22.1035.3031';
const CK_TEA = HEX('59b2f7cf725ef43c34fdd7c123411ed3');
const CK_GTEA = HEX('110dbec10c23e7d2e56a1cad6914ef1b');
const CK_XOR = Uint8Array.from([132, 46, 237, 8, 240, 102, 230, 234, 72, 180, 202, 169, 145, 237, 111, 243]);
const CK_GXOR = Uint8Array.from([179, 201, 83, 160, 105, 19, 173, 77]);
const SPVCODE = b64(stdEncode('H(30:1080,60:1080|30:1080,60:1080)'));

/* ---------- 频道表（name / cnlid / livepid / defn / group） ---------- */

const CHANNEL_ROWS = [
  ['cctv1', 'CCTV-1 综合', '2024078201', '600001859', 'fhd', '央视'],
  ['cctv2', 'CCTV-2 财经', '2024075401', '600001800', 'fhd', '央视'],
  ['cctv3', 'CCTV-3 综艺', '2024068501', '600001801', 'fhd', '央视'],
  ['cctv4', 'CCTV-4 中文国际', '2029797101', '600001814', 'fhd', '央视'],
  ['cctv6', 'CCTV-6 电影', '2013693901', '600108442', 'fhd', '央视'],
  ['cctv7', 'CCTV-7 国防军事', '2024072001', '600004092', 'fhd', '央视'],
  ['cctv8', 'CCTV-8 电视剧', '2029793001', '600001803', 'fhd', '央视'],
  ['cctv9', 'CCTV-9 纪录', '2024078601', '600004078', 'fhd', '央视'],
  ['cctv10', 'CCTV-10 科教', '2024078701', '600001805', 'fhd', '央视'],
  ['cctv11', 'CCTV-11 戏曲', '2027248701', '600001806', 'fhd', '央视'],
  ['cctv12', 'CCTV-12 社会与法', '2027248801', '600001807', 'fhd', '央视'],
  ['cctv13', 'CCTV-13 新闻', '2029797201', '600001811', 'fhd', '央视'],
  ['cctv14', 'CCTV-14 少儿', '2027248901', '600001809', 'fhd', '央视'],
  ['cctv15', 'CCTV-15 音乐', '2027249001', '600001815', 'fhd', '央视'],
  ['cctv17', 'CCTV-17 农业农村', '2027249401', '600001810', 'fhd', '央视'],
  ['cctv4k', 'CCTV-4K 超高清', '2029810301', '600002264', 'fhd', '央视'],
  ['cctv8k', 'CCTV-8K 超高清', '2026774101', '600156816', 'fhd', '央视'],
  ['cctvfyjc', 'CCTV 风云剧场', '2025637102', '600099658', 'shd', '央视剧场'],
  ['cctvdyjc', 'CCTV 第一剧场', '2026874202', '600099655', 'shd', '央视剧场'],
  ['cctvhjjc', 'CCTV 怀旧剧场', '2026874302', '600099620', 'shd', '央视剧场'],
  ['cgtn', 'CGTN', '2024181701', '600014550', 'fhd', 'CGTN'],
  ['cgtnfr', 'CGTN 法语', '2024181801', '600084704', 'fhd', 'CGTN'],
  ['cgtnru', 'CGTN 俄语', '2024181901', '600084758', 'fhd', 'CGTN'],
  ['cgtnar', 'CGTN 阿拉伯语', '2024182001', '600084782', 'fhd', 'CGTN'],
  ['cgtnes', 'CGTN 西班牙语', '2024182101', '600084744', 'fhd', 'CGTN'],
  ['cgtndoc', 'CGTN 纪录', '2024182301', '600084781', 'fhd', 'CGTN'],
  ['bjws', '北京卫视', '2024052703', '600002309', 'fhd', '卫视'],
  ['tjws', '天津卫视', '2019927003', '600152137', 'fhd', '卫视'],
  ['hebws', '河北卫视', '2024171503', '600002493', 'fhd', '卫视'],
  ['shanxiws', '山西卫视', '2025560803', '600190407', 'fhd', '卫视'],
  ['nmgws', '内蒙古卫视', '2025561203', '600190401', 'fhd', '卫视'],
  ['lnws', '辽宁卫视', '2024171303', '600002505', 'fhd', '卫视'],
  ['jlws', '吉林卫视', '2025561503', '600190405', 'fhd', '卫视'],
  ['hljws', '黑龙江卫视', '2029797003', '600002498', 'fhd', '卫视'],
  ['dfws', '东方卫视', '2024054503', '600002483', 'fhd', '卫视'],
  ['jsws', '江苏卫视', '2024171103', '600002521', 'fhd', '卫视'],
  ['zjws', '浙江卫视', '2024054703', '600002520', 'fhd', '卫视'],
  ['ahws', '安徽卫视', '2024171403', '600002532', 'fhd', '卫视'],
  ['dnws', '东南卫视', '2024061503', '600002484', 'fhd', '卫视'],
  ['jxws', '江西卫视', '2024061703', '600002503', 'fhd', '卫视'],
  ['sdws', '山东卫视', '2029787903', '600002513', 'fhd', '卫视'],
  ['henanws', '河南卫视', '2029797303', '600002525', 'fhd', '卫视'],
  ['hbws', '湖北卫视', '2024171203', '600002508', 'fhd', '卫视'],
  ['hnws', '湖南卫视', '2024054803', '600002475', 'fhd', '卫视'],
  ['gdws', '广东卫视', '2024060903', '600002485', 'fhd', '卫视'],
  ['szws', '深圳卫视', '2024061303', '600002481', 'fhd', '卫视'],
  ['gxws', '广西卫视', '2024060703', '600002509', 'fhd', '卫视'],
  ['hainanws', '海南卫视', '2024055603', '600002506', 'fhd', '卫视'],
  ['cqws', '重庆卫视', '2024061103', '600002531', 'fhd', '卫视'],
  ['scws', '四川卫视', '2024061403', '600002516', 'fhd', '卫视'],
  ['gzws', '贵州卫视', '2024061603', '600002490', 'fhd', '卫视'],
  ['ynws', '云南卫视', '2025561303', '600190402', 'fhd', '卫视'],
  ['xizangws', '西藏卫视', '2025558003', '600190403', 'fhd', '卫视'],
  ['saxws', '陕西卫视', '2029795103', '600190400', 'fhd', '卫视'],
  ['gsws', '甘肃卫视', '2025561703', '600190408', 'fhd', '卫视'],
  ['qhws', '青海卫视', '2025559103', '600190406', 'fhd', '卫视'],
  ['nxws', '宁夏卫视', '2025608503', '600190737', 'fhd', '卫视'],
  ['xjws', '新疆卫视', '2050898603', '600152138', 'fhd', '卫视'],
  ['guoxue', '国学频道', '2029360403', '600213139', 'fhd', '其他']
];

export const CHANNELS = {};
for (const [slug, name, cnlid, livepid, defn, group] of CHANNEL_ROWS) {
  CHANNELS[slug] = { slug, name, cnlid, livepid, defn, group };
}
const ORDER = CHANNEL_ROWS.map((r) => r[0]);

/* ---------- 基础工具 ---------- */

function HEX(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function cat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function u32be(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0);
  return b;
}
function hexLower(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
function hexUpper(bytes) {
  return hexLower(bytes).toUpperCase();
}
function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '_').replace(/\//g, '-').replace(/=+$/, '');
}
function stdEncode(str) {
  return new TextEncoder().encode(str);
}
/** 2 字节大端长度前缀 + 内容（对应 Python 的 _lp） */
function lp(value) {
  const d = typeof value === 'string' ? stdEncode(value) : value;
  const out = new Uint8Array(2 + d.length);
  out[0] = (d.length >>> 8) & 0xff;
  out[1] = d.length & 0xff;
  out.set(d, 2);
  return out;
}

/* ---------- TEA 与校验和 ---------- */

/** 对应 _tea_blk：16 轮，delta 0x9E3779B9 */
function teaBlock(block, key) {
  const bv = new DataView(block.buffer, block.byteOffset, 8);
  const kv = new DataView(key.buffer, key.byteOffset, 16);
  let y = bv.getUint32(0);
  let z = bv.getUint32(4);
  const k0 = kv.getUint32(0), k1 = kv.getUint32(4), k2 = kv.getUint32(8), k3 = kv.getUint32(12);
  let s = 0;
  for (let i = 0; i < 16; i++) {
    s = (s + 2654435769) >>> 0;
    y = (y + (((((z << 4) >>> 0) + k0) >>> 0) ^ ((z + s) >>> 0) ^ (((z >>> 5) + k1) >>> 0))) >>> 0;
    z = (z + (((((y << 4) >>> 0) + k2) >>> 0) ^ ((y + s) >>> 0) ^ (((y >>> 5) + k3) >>> 0))) >>> 0;
  }
  const out = new Uint8Array(8);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, y);
  ov.setUint32(4, z);
  return out;
}

/** 对应 _cksum：v = (131*v + b) & 0x7FFFFFFF */
function cksum(buf) {
  let v = 0;
  for (const b of buf) v = (131 * v + b) % 2147483648;
  return v;
}

/** 对应 _tea_pkt：CBC 变体，块前异或上一块密文、块后叠加上一块明文 */
function teaPkt(data, key, rand) {
  const pad = (8 - ((data.length + 10) % 8)) % 8;
  const plain = new Uint8Array(1 + pad + 2 + data.length + 7);
  plain[0] = (rand(1)[0] & 0xf8) | pad;
  let off = 1;
  plain.set(rand(pad), off); off += pad;
  plain.set(rand(2), off); off += 2;
  plain.set(data, off);

  let pp = new Uint8Array(8);
  let pc = new Uint8Array(8);
  const out = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 8) {
    const mixed = new Uint8Array(8);
    for (let j = 0; j < 8; j++) mixed[j] = plain[i + j] ^ pc[j];
    const enc = teaBlock(mixed, key);
    const cipher = new Uint8Array(8);
    for (let j = 0; j < 8; j++) cipher[j] = enc[j] ^ pp[j];
    out.set(cipher, i);
    pp = mixed;
    pc = cipher;
  }
  return out;
}

/* ---------- cKey ---------- */

/** 对应 _ck_guard：独立小包，绑 ts + guid 后 5 位 */
export function ckGuard(ts, guid, rand) {
  const tail = (v) => {
    const t = String(v);
    return t.length >= 5 ? t.slice(-5) : '';
  };
  const body = cat(u32be(ts), lp(tail(guid)), lp(tail('null')), lp(tail('null')), lp('-1'));
  const plain = lp(body);
  const enc = cat(teaPkt(plain, CK_GTEA, rand), u32be(cksum(plain)));
  const mixed = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) mixed[i] = enc[i] ^ CK_GXOR[i & 7];
  return hexUpper(mixed);
}

/**
 * 对应 _ckey。
 * rand(n) 必须按调用顺序返回 n 个随机字节；ts 为秒级时间戳。
 */
export function makeCKey(cnlid, rand, ts) {
  const guid = hexLower(rand(16));
  const guard = ckGuard(ts, guid, rand);
  const uid = hexUpper(rand(4));

  const body = cat(
    HEX('0000004200000004000004d2'),
    u32be(CK_PLATFORM),
    u32be(0),
    u32be(ts),
    lp('dcgh'),
    lp('_zj1A5Gh6QYcxWjIUGos2w=='),
    lp(CK_APPVER),
    lp(String(cnlid)),
    lp(guid),
    u32be(1),
    u32be(1),
    lp(uid),
    lp('nil'),
    lp('57eab0c4-2c58-44c6-8ae9-dd2757525dc5'),
    lp('nil'),
    lp('v0.1.000'),
    lp('com.cctv.yangshipin.app.iphone'),
    lp(String(CK_PLATFORM)),
    lp('ex_json_bus'),
    lp('ex_json_vs'),
    lp(guard)
  );

  const pkt = new Uint8Array(2 + body.length);
  pkt[0] = (body.length >>> 8) & 0xff;
  pkt[1] = body.length & 0xff;
  pkt.set(body, 2);

  const headSum = cksum(pkt);
  pkt[18] = (headSum >>> 24) & 0xff;
  pkt[19] = (headSum >>> 16) & 0xff;
  pkt[20] = (headSum >>> 8) & 0xff;
  pkt[21] = headSum & 0xff;

  const enc = cat(teaPkt(pkt, CK_TEA, rand), u32be(cksum(pkt)));
  const mixed = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) mixed[i] = enc[i] ^ CK_XOR[i & 15];

  const flowId = hexUpper(rand(16)) + '_' + CK_PLATFORM;
  return { cKey: '--01' + b64(mixed), guid, uid, ts, flowId };
}

/* ---------- 上游请求 ---------- */

function buildQuery({ cnlid, livepid, defn, ckey, guid, ts, flowId }) {
  const p = {
    atime: '120', livepid, cnlid, appVer: CK_APPVER, app_version: '300090', caplv: '1', cmd: '2',
    defn, device: 'iPhone', encryptVer: '4.2', getpreviewinfo: '0', hevclv: '0', lang: 'zh-Hans_CN',
    livequeue: '0', logintype: '1', nettype: '1', newnettype: '1', newplatform: String(CK_PLATFORM),
    platform: String(CK_PLATFORM), sdtfrom: 'v3021', spacode: '23', spaudio: '1', spdemuxer: '6',
    spdrm: '2', spdynamicrange: '1', spflv: '1', spflvaudio: '1', sphdrfps: '60', sphttps: '1',
    spvcode: SPVCODE, spvideo: '4', stream: '1', system: '1', sysver: 'ios18.2.1', uhd_flag: '0',
    cKey: ckey, guid, fntick: String(ts), flowid: flowId, playbacktime: '0'
  };
  return new URLSearchParams(p).toString();
}

function collectUrls(payload) {
  const urls = [];
  if (payload && typeof payload.playurl === 'string' && payload.playurl) urls.push(payload.playurl);
  const bu = payload && (payload.backurl_list || payload.backurlList || payload.backurl);
  if (Array.isArray(bu)) {
    for (const item of bu) {
      if (typeof item === 'string') urls.push(item);
      else if (item && typeof item === 'object') urls.push(item.url || item.playurl || '');
    }
  } else if (typeof bu === 'string') {
    for (const part of bu.split(/[;,]\s*(?=https?:\/\/)/)) urls.push(part.trim());
  }
  return [...new Set(urls.filter((u) => u && u.includes('.cctv.')))];
}

/**
 * 频道地址池缓存，RESOLVE_TTL 秒。
 *
 * DO 时代它不再是「状态」，只是一层纯缓存：命不命中都不影响正确性 ——
 * 没命中最多多打一次 bkliveinfo，窗口不会因此塌陷。命中的收益很实在：
 * 窗口 2.5 秒续期一次，没有它就要跟着打 120 次/5 分钟的签名接口。
 * 失效（实例驱逐）只是退化成再解析一次，属于可接受代价。
 */
const resolveCache = new Map();

async function resolveChannel(meta, force = false) {
  const hit = resolveCache.get(meta.slug);
  const now = Date.now();
  if (!force && hit && now - hit.at < RESOLVE_TTL * 1000) return hit;
  if (force) resolveCache.delete(meta.slug);

  const ts = Math.floor(now / 1000);
  const key = makeCKey(meta.cnlid, (n) => crypto.getRandomValues(new Uint8Array(n)), ts);
  const qs = buildQuery({
    cnlid: meta.cnlid, livepid: meta.livepid, defn: meta.defn,
    ckey: key.cKey, guid: key.guid, ts: key.ts, flowId: key.flowId
  });

  const res = await fetch(BK_URL + '?' + qs, {
    headers: { 'User-Agent': 'qqlive', Accept: 'application/json' }
  });
  const body = await res.text();
  let payload = null;
  try { payload = JSON.parse(body); } catch { /* 不是 JSON，保持 null */ }

  const iretcode = payload && payload.iretcode !== undefined ? Number(payload.iretcode) : null;
  if (res.status !== 200) throw new GatewayError(`上游接口 HTTP ${res.status}`, 502);
  if (iretcode !== 0) {
    const info = String((payload && (payload.errinfo || payload.msg)) || '').slice(0, 120);
    // 5 = 所在地区版权限制；12 = 应版权方要求暂停供源。两者都不是重试能解决的，
    // 统一按「不对该频道重试、回 404」处理，但原文照传，不替上游解释。
    const blocked = iretcode === 5 || iretcode === 12 || /地区|版权/.test(info);
    throw new GatewayError(`iretcode=${iretcode} ${info}`, blocked ? 404 : 502, blocked);
  }

  const urls = collectUrls(payload);
  if (!urls.length) throw new GatewayError('接口成功但未返回播放地址', 502);

  const rec = { urls, at: now };
  resolveCache.set(meta.slug, rec);
  return rec;
}

class GatewayError extends Error {
  constructor(message, status = 502, blocked = false) {
    super(message);
    this.status = status;
    this.blocked = blocked;
  }
}

/** 拉取单个地址的清单；若是 master，跟随码率最高的变体，最多跟 3 层 */
async function fetchOnePlaylist(start) {
  let current = start;
  for (let depth = 0; depth < 3; depth++) {
    const res = await fetch(current, {
      headers: {
        'User-Agent': 'qqlive',
        Referer: 'https://live.cctv.cn/',
        Accept: 'application/vnd.apple.mpegurl,application/json,*/*'
      },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (res.status !== 200) throw new GatewayError(`清单 HTTP ${res.status}`, 502);
    const body = await res.text();
    if (!body.trimStart().startsWith('#EXTM3U')) throw new GatewayError('上游返回的不是 m3u8', 502);
    const variant = pickVariant(body, current);
    if (!variant) return { text: body, base: current };
    current = variant;
  }
  throw new GatewayError('master 清单层级过深', 502);
}

/**
 * 取上游清单。403 说明这一条地址（或其对应的会话）已失效，
 * 必须换地址；整池都失败则强制换新 cKey 重新解析一次。
 * 这与「上游被限流」是两回事，所以不在这里做退避。
 */
async function fetchUpstream(meta) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let pool;
    try {
      pool = await resolveChannel(meta, attempt > 0);
    } catch (err) {
      if (err.blocked) throw err;
      lastErr = err;
      continue;
    }
    for (const start of pool.urls.slice(0, 4)) {
      try {
        const { text, base } = await fetchOnePlaylist(start);
        const parsed = parseMediaPlaylist(text, base);
        if (parsed.segs.length) return parsed;
        lastErr = new GatewayError('清单里没有分片', 502);
      } catch (err) {
        if (err.blocked) throw err;
        lastErr = err;
      }
    }
  }
  throw lastErr || new GatewayError('取清单失败', 502);
}

/** 从 master 清单里挑码率最高的变体；不是 master 时返回 null */
function pickVariant(text, base) {
  if (!text.includes('#EXT-X-STREAM-INF')) return null;
  const lines = text.split('\n').map((s) => s.trim());
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const bw = Number((/#BANDWIDTH=(\d+)/.exec(lines[i]) || [])[1] || 0);
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j] || lines[j].startsWith('#')) continue;
      if (!best || bw > best.bw) best = { bw, uri: lines[j] };
      break;
    }
  }
  if (!best) return null;
  try { return new URL(best.uri, base).toString(); } catch { return null; }
}

/**
 * 解析媒体清单为结构化分片。
 *
 * 分片序号优先取文件名尾部那个数字（上游命名为 `<channel>-<n>.ts`，实测每片
 * 递增 1，不是时间戳），它跨会话稳定，同一个分片在两次拉取里能对上号，合并
 * 窗口靠的就是它；取不到才退回 MEDIA-SEQUENCE 递增。
 */
export function parseMediaPlaylist(text, base) {
  const lines = text.split('\n');
  let seq = 0;
  let target = 5;
  let dur = null;
  let key = null;
  let pdt = null;
  const segs = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.slice(22)) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = Number(line.slice(22)) || 5;
    else if (line.startsWith('#EXT-X-KEY:')) key = line;
    else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) pdt = line.slice(25);
    else if (line.startsWith('#EXTINF:')) dur = Number(line.slice(8).split(',')[0]) || 0;
    else if (!line.startsWith('#')) {
      const m = /-(\d+)\.ts(?:\?|$)/.exec(line);
      segs.push({
        n: m ? Number(m[1]) : seq + segs.length,
        d: dur || target,
        u: absolute(line, base),
        k: key,
        p: pdt
      });
      dur = null;
      pdt = null;
    }
  }
  return { seq, target, segs };
}

function absolute(u, base) {
  if (/^[a-z]+:\/\//i.test(u)) return u;
  try { return new URL(u, base).toString(); } catch { return u; }
}

/* ---------- 分片窗口状态 ---------- */

/**
 * 上游只给 3 个分片（约 15 秒）。任何一次刷新变慢/失败，播放器就会掉出窗口，
 * 之后它要的分片不在清单里，只能跳到窗口头 —— 这就是「播一会卡住」的机制。
 *
 * 解法是把上游的 3 片滚成一个更长的窗口（6 片 ≈ 30 秒）并保证它**只前进不倒退**。
 * 关键点：这个窗口必须是「每个频道唯一一份」。如果每个 isolate 各存一份，
 * 冷的那份会返回更短、更靠后的窗口，播放器照样卡死 —— 所以窗口放在
 * 每个频道一个 Durable Object 里，由它统一续期。
 */
export const WINDOW_SEGMENTS = 6; // 窗口长度（片），约 30 秒；上游自己只给 3 片
const REFRESH_AFTER_MS = 2500;
const SERVE_MAX_AGE_MS = 9000;
const STALE_MAX_MS = 45000;

/**
 * 持久化去重的兜底心跳。
 * 正常情况下窗口每前移一片就写一次（约 4–6 秒一次）；上游卡住时签名不变，
 * 此时不写。但也不能永远不写 —— 否则 DO 被驱逐后恢复出来的窗口 `at` 太旧，
 * 冷启动要同步刷新，且里面的分片地址 token 也可能是几分钟前的。
 */
const WRITE_HEARTBEAT_MS = 20000;

/**
 * 窗口签名：只看分片序号序列。
 *
 * 为什么不能带上分片地址：同一片号每次拉取 CDN 都会换一段新的 token 路径
 * （实测两次请求 `2024078203-1786735875.ts` 的 hash 段完全不同），
 * 把地址算进签名等于每次都「变了」，去重就失效了。
 * 序号序列变化 ⟺ 窗口真的前移，这才是值得落盘的时刻。
 */
export function windowSig(state) {
  if (!state || !state.segs || !state.segs.length) return '';
  return state.segs.map((s) => s.n).join(',');
}

/** 是否值得写一次 storage（纯函数，便于单测） */
export function shouldPersist(sig, prevSig, lastPersist, now) {
  if (sig !== prevSig) return true;
  return now - lastPersist >= WRITE_HEARTBEAT_MS;
}

/** 把新拿到的清单并进滚动窗口；只追加/替换，绝不整体后退 */
export function mergeWindow(prev, fresh, now) {
  const next = fresh.segs.slice(-WINDOW_SEGMENTS).map((s) => ({ ...s }));
  if (!prev || !prev.segs || !prev.segs.length) return { segs: next, at: now };

  const prevLast = prev.segs[prev.segs.length - 1].n;
  const freshFirst = fresh.segs[0].n;
  // 上游跑得太远（长时间没人看）→ 旧窗口已经没有意义，直接换新。
  // 阈值取半窗口（3 片）：留 1~2 片的缺口还能靠 DISCONTINUITY 桥接，
  // 再大就说明中间真的丢了一段，硬合并只会让播放器停在空洞上。
  if (freshFirst > prevLast + 3) return { segs: next, at: now };

  const merged = prev.segs.slice();
  const index = new Map(merged.map((s, i) => [s.n, i]));
  for (const s of fresh.segs) {
    const i = index.get(s.n);
    if (i === undefined) {
      if (!merged.length || s.n > merged[merged.length - 1].n) {
        merged.push({ ...s });
        index.set(s.n, merged.length - 1);
      }
    } else {
      merged[i] = { ...s }; // 同号分片：换用新会话的地址
    }
  }
  merged.sort((a, b) => a.n - b.n);
  return { segs: merged.slice(-WINDOW_SEGMENTS), at: now };
}

/** 由窗口状态渲染清单 */
export function renderPlaylist(state) {
  const segs = state.segs;
  const target = Math.max(1, Math.ceil(Math.max(...segs.map((s) => s.d))));

  const out = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    `#EXT-X-MEDIA-SEQUENCE:${segs[0].n}`,
    '#EXT-X-ALLOW-CACHE:NO'
  ];
  let prevKey = null;
  let prevN = null;
  for (const s of segs) {
    if (s.k && s.k !== prevKey) out.push(s.k);
    else if (!s.k && prevKey) out.push('#EXT-X-KEY:METHOD=NONE');
    prevKey = s.k || null;
    // 上游分片序号是逐片 +1 的（已核对全部在播频道，输出的 DISCONTINUITY 均为 0），
    // 所以缺口能用 +1 判出来。若哪天上游改了命名步长，这里会把正常序列误判成断档，
    // 届时改成按 PROGRAM-DATE-TIME 的时间间隔判断更稳。
    if (prevN !== null && s.n !== prevN + 1) out.push('#EXT-X-DISCONTINUITY');
    if (s.p) out.push(`#EXT-X-PROGRAM-DATE-TIME:${s.p}`);
    out.push(`#EXTINF:${s.d.toFixed(3)},`);
    out.push(s.u);
    prevN = s.n;
  }
  return out.join('\n') + '\n';
}

/** 取一次上游并并入窗口 */
async function pullWindow(meta, prev) {
  const fresh = await fetchUpstream(meta);
  return mergeWindow(prev, fresh, Date.now());
}

/* ---------- 每频道一个 Durable Object ---------- */

/**
 * 状态机：
 *   窗口年龄 < 2.5s        → 直接返回（HIT）
 *   2.5s ~ 9s             → 直接返回 + 后台续期（HIT-STALE），不阻塞播放器
 *   > 9s 或冷启动          → 同步刷新（MISS）；撞上别人的在途刷新则等它（HIT-WAIT）
 *   刷新失败且窗口 < 45s    → 发 STALE，宁可给旧清单也不给错误码
 * startRefresh 保证同一时刻只有一个上游请求在跑，既省调用也避免触发风控。
 *
 * 写入策略见 shouldPersist：窗口没前移就不落盘，只在心跳超时时补一次。
 */
export class ChannelState {
  constructor(ctx) {
    this.ctx = ctx;
    this.window = null;
    this.sig = '';
    this.refreshing = null;
    this.lastPersist = 0;
    this.ctx.blockConcurrencyWhile(async () => {
      this.window = (await this.ctx.storage.get('window')) || null;
      this.sig = windowSig(this.window);
      this.lastPersist = this.window ? this.window.at : 0;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug') || 'cctv1';
    const meta = CHANNELS[slug];
    if (!meta) return json({ ok: false, error: '未知频道' }, 400);

    const age = this.window ? Date.now() - this.window.at : Infinity;

    if (this.window && age <= SERVE_MAX_AGE_MS) {
      if (age > REFRESH_AFTER_MS) this.startRefresh(meta);
      return this.respond(age > REFRESH_AFTER_MS ? 'HIT-STALE' : 'HIT');
    }

    // 同步刷新也走同一个 in-flight 槽位：冷启动时若同时来了几个请求，
    // 只有第一个真正打上游，其余等它的结果，不会各自解析一遍。
    const started = !this.refreshing;
    const job = this.startRefresh(meta);
    try {
      await job;
    } catch (err) {
      if (this.window && Date.now() - this.window.at < STALE_MAX_MS) {
        return this.respond('STALE');
      }
      return json({ ok: false, error: err.message, blocked: !!err.blocked }, err.blocked ? 404 : 502);
    }
    return this.respond(started ? 'MISS' : 'HIT-WAIT');
  }

  /** 同一时刻只允许一次上游刷新；返回在途/新建的那个 promise */
  startRefresh(meta) {
    if (this.refreshing) return this.refreshing;
    const job = this.refreshNow(meta);
    this.refreshing = job;
    this.ctx.waitUntil(
      job.catch(() => {}).finally(() => {
        if (this.refreshing === job) this.refreshing = null;
      })
    );
    return job;
  }

  async refreshNow(meta) {
    const merged = await pullWindow(meta, this.window);
    this.window = merged;
    // 写入结果挂在窗口对象上，而不是挂实例 —— 否则响应头永远是上一次的值，
    // 和实际返回的这份清单对不上（后台续期是异步的，天然慢一拍）。
    // 注意要在 persist 之后赋值，这样落盘的那份不带这个字段。
    merged.write = await this.persist(merged);
    return merged;
  }

  /** 窗口签名没变且没到心跳点 → 跳过写入，返回 'SKIP'；否则落盘返回 'PUT' */
  async persist(state) {
    const sig = windowSig(state);
    const now = Date.now();
    if (!shouldPersist(sig, this.sig, this.lastPersist, now)) return 'SKIP';
    this.sig = sig;
    await this.ctx.storage.put('window', state);
    this.lastPersist = now;
    return 'PUT';
  }

  respond(cache) {
    const age = this.window ? Date.now() - this.window.at : 0;
    const body = renderPlaylist(this.window);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'X-YSP-Cache': cache,
        'X-YSP-State-Age': String(Math.round(age)),
        'X-YSP-Segments': String(this.window.segs.length),
        'X-YSP-Write': this.window.write || 'NONE'
      }
    });
  }
}

/* ---------- 响应 ---------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function m3u8(body, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
      ...extra
    }
  });
}

function plainText(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });
}

/** 订阅源：按分组输出全部频道（只用标准 #EXTINF，不插入注释行，兼容性最好） */
function buildList(origin) {
  const lines = ['#EXTM3U'];
  for (const slug of ORDER) {
    const c = CHANNELS[slug];
    lines.push(`#EXTINF:-1 tvg-id="${slug}" tvg-name="${c.name}" group-title="${c.group}",${c.name}`);
    lines.push(`${origin}/${slug}.m3u8`);
  }
  return lines.join('\n') + '\n';
}

/* ---------- 路由 ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/health') {
      return json({
        ok: true,
        version: VERSION,
        channels: ORDER.length,
        windowSegments: WINDOW_SEGMENTS
      });
    }

    if (path === '/list.m3u' || path === '/all.m3u' || path === '/ysp.m3u') {
      return m3u8(buildList(url.origin));
    }

    if (path === '/') {
      return plainText([
        `ysp 清单 Worker ${VERSION}`,
        '',
        '订阅源：' + url.origin + '/list.m3u',
        '单频道：' + url.origin + '/cctv1.m3u8',
        `滚动窗口：${WINDOW_SEGMENTS} 片（约 ${WINDOW_SEGMENTS * 5} 秒，起播比直播慢约这么多）`,
        `频道数：${ORDER.length}（不含体育频道）`
      ].join('\n') + '\n');
    }

    // /<slug>.m3u8 或 /<slug>
    const m = /^\/(?:live\/)?([a-z0-9_]+?)(?:\.m3u8)?$/.exec(path);
    const slug = m && m[1].toLowerCase();
    const meta = slug && CHANNELS[slug];
    if (!meta) {
      return plainText(`未知频道：${slug || path}\n频道列表见 ${url.origin}/list.m3u\n`, 404);
    }

    // DO 是唯一的状态载体。没有绑定说明部署配置错了，
    // 这里直接报错，而不是退到「每个 isolate 各存一份」的老路上去。
    const ns = env && env.CHANNEL_STATE;
    if (!ns) return plainText('未绑定 CHANNEL_STATE（Durable Object），无法提供清单\n', 500);

    const stub = ns.get(ns.idFromName(slug));

    try {
      const res = await stub.fetch(`https://channel.internal/playlist?slug=${slug}`);
      const body = await res.text();
      if (res.ok) {
        return m3u8(body, {
          'X-YSP-Channel': slug,
          'X-YSP-Cache': res.headers.get('X-YSP-Cache') || '',
          'X-YSP-State-Age': res.headers.get('X-YSP-State-Age') || '',
          'X-YSP-Segments': res.headers.get('X-YSP-Segments') || '',
          'X-YSP-Write': res.headers.get('X-YSP-Write') || ''
        });
      }
      // 只输出上游原文，不追加解释：iretcode=5 是「所在地区版权限制」，
      // iretcode=12 是「应版权方要求暂停供源」，两者文案不同，
      // 统一追加一句反而会说错（12 与出口地区无关）。
      let message = body;
      try {
        const j = JSON.parse(body);
        message = j.error || body;
      } catch { /* 非 JSON，按原文输出 */ }
      return plainText(`频道 ${slug} 取流失败：${message}\n`, res.status);
    } catch (err) {
      const status = err instanceof GatewayError ? err.status : 502;
      return plainText(`频道 ${slug} 取流失败：${err.message}\n`, status);
    }
  }
};
