// Cloudflare Worker — Douyin webRid → FLV/HLS direct stream URLs
// Usage: GET /<webRid>         → JSON (API)
//        GET /<webRid>.flv     → 302 跳最高画质 FLV 直链
//   e.g. GET /443096978344(.flv)
// Responses: JSON or a 302 redirect; does NOT proxy video streams.
// Run on Cloudflare Workers (ES modules syntax).

// ─── User‑Agent & Cookie (from simple_live_core) ─────────────────────────
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400";

const DEFAULT_COOKIE =
  "ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511";

// ─── a_bogus signing (port of simple_live_core douyin_sign.dart kABogus) ─
function rc4_encrypt(plaintext, key) {
  const s = [];
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    const temp = s[i];
    s[i] = s[j];
    s[j] = temp;
  }
  let i = 0;
  j = 0;
  const cipher = [];
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    const temp = s[i];
    s[i] = s[j];
    s[j] = temp;
    const t = (s[i] + s[j]) % 256;
    cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)));
  }
  return cipher.join("");
}

function le(e, r) { return (e << (r %= 32) | e >>> 32 - r) >>> 0; }

function de(e) {
  return 0 <= e && e < 16 ? 2043430169 : 16 <= e && e < 64 ? 2055708042 : (console.error("invalid j for constant Tj"), 0);
}

function pe(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | r & n | t & n) >>> 0 : (console.error("invalid j for bool function FF"), 0);
}

function he(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | ~r & n) >>> 0 : (console.error("invalid j for bool function GG"), 0);
}

function reset() {
  this.reg[0] = 1937774191;
  this.reg[1] = 1226093241;
  this.reg[2] = 388252375;
  this.reg[3] = 3666478592;
  this.reg[4] = 2842636476;
  this.reg[5] = 372324522;
  this.reg[6] = 3817729613;
  this.reg[7] = 2969243214;
  this.chunk = [];
  this.size = 0;
}

function write(e) {
  const a = typeof e === "string"
    ? (function(e) {
        const n = encodeURIComponent(e).replace(/%([0-9A-F]{2})/g, function(e, r) { return String.fromCharCode("0x" + r); });
        const a = new Array(n.length);
        Array.prototype.forEach.call(n, function(e, r) { a[r] = e.charCodeAt(0); });
        return a;
      })(e)
    : e;
  this.size += a.length;
  let f = 64 - this.chunk.length;
  if (a.length < f) {
    this.chunk = this.chunk.concat(a);
  } else {
    this.chunk = this.chunk.concat(a.slice(0, f));
    while (this.chunk.length >= 64) {
      this._compress(this.chunk);
      f < a.length ? this.chunk = a.slice(f, Math.min(f + 64, a.length)) : this.chunk = [];
      f += 64;
    }
  }
}

function sum(e, t) {
  e && (this.reset(), this.write(e));
  this._fill();
  for (let f = 0; f < this.chunk.length; f += 64)
    this._compress(this.chunk.slice(f, f + 64));
  if (t == "hex") {
    let i = "";
    for (let f = 0; f < 8; f++)
      i += ((this.reg[f] >>> 0).toString(16)).padStart(8, "0");
    this.reset();
    return i;
  }
  const i = new Array(32);
  for (let f = 0; f < 8; f++) {
    let c = this.reg[f];
    i[4 * f + 3] = (255 & c) >>> 0;
    c >>>= 8;
    i[4 * f + 2] = (255 & c) >>> 0;
    c >>>= 8;
    i[4 * f + 1] = (255 & c) >>> 0;
    c >>>= 8;
    i[4 * f] = (255 & c) >>> 0;
  }
  this.reset();
  return i;
}

function _compress(t) {
  if (t.length < 64) { console.error("compress error: not enough data"); return; }
  const f = (function(e) {
    const r = new Array(132);
    for (let t = 0; t < 16; t++) {
      r[t] = e[4 * t] << 24;
      r[t] |= e[4 * t + 1] << 16;
      r[t] |= e[4 * t + 2] << 8;
      r[t] |= e[4 * t + 3];
      r[t] >>>= 0;
    }
    for (let n = 16; n < 68; n++) {
      let a = r[n - 16] ^ r[n - 9] ^ le(r[n - 3], 15);
      a = a ^ le(a, 15) ^ le(a, 23);
      r[n] = (a ^ le(r[n - 13], 7) ^ r[n - 6]) >>> 0;
    }
    for (let n = 0; n < 64; n++) r[n + 68] = (r[n] ^ r[n + 4]) >>> 0;
    return r;
  })(t);
  const i = this.reg.slice(0);
  for (let c = 0; c < 64; c++) {
    let o = le(i[0], 12) + i[4] + le(de(c), c);
    const s = ((o = le(o = (4294967295 & o) >>> 0, 7)) ^ le(i[0], 12)) >>> 0;
    let u = pe(c, i[0], i[1], i[2]);
    u = (4294967295 & (u = u + i[3] + s + f[c + 68])) >>> 0;
    let b = he(c, i[4], i[5], i[6]);
    b = (4294967295 & (b = b + i[7] + o + f[c])) >>> 0;
    i[3] = i[2];
    i[2] = le(i[1], 9);
    i[1] = i[0];
    i[0] = u;
    i[7] = i[6];
    i[6] = le(i[5], 19);
    i[5] = i[4];
    i[4] = (b ^ le(b, 9) ^ le(b, 17)) >>> 0;
  }
  for (let l = 0; l < 8; l++)
    this.reg[l] = (this.reg[l] ^ i[l]) >>> 0;
}

function _fill() {
  const a = 8 * this.size;
  let f = this.chunk.push(128) % 64;
  for (64 - f < 8 && (f -= 64); f < 56; f++) this.chunk.push(0);
  for (let i = 0; i < 4; i++) {
    const c = Math.floor(a / 4294967296);
    this.chunk.push(c >>> 8 * (3 - i) & 255);
  }
  for (let i = 0; i < 4; i++) this.chunk.push(a >>> 8 * (3 - i) & 255);
}

function SM3() {
  this.reg = [];
  this.chunk = [];
  this.size = 0;
  this.reset();
}
SM3.prototype.reset = reset;
SM3.prototype.write = write;
SM3.prototype.sum = sum;
SM3.prototype._compress = _compress;
SM3.prototype._fill = _fill;

function result_encrypt(long_str, num) {
  if (num === undefined) num = null;
  const s_obj = {
    "s0": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    "s1": "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
    "s2": "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
    "s3": "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
    "s4": "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"
  };
  const constant = { "0": 16515072, "1": 258048, "2": 4032, "str": s_obj[num] };
  let result = "", lound = 0, long_int = get_long_int(lound, long_str);
  for (let i = 0; i < long_str.length / 3 * 4; i++) {
    if (Math.floor(i / 4) !== lound) { lound += 1; long_int = get_long_int(lound, long_str); }
    const key = i % 4;
    switch (key) {
      case 0: const temp_int0 = (long_int & constant["0"]) >> 18; result += constant["str"].charAt(temp_int0); break;
      case 1: const temp_int1 = (long_int & constant["1"]) >> 12; result += constant["str"].charAt(temp_int1); break;
      case 2: const temp_int2 = (long_int & constant["2"]) >> 6; result += constant["str"].charAt(temp_int2); break;
      case 3: const temp_int3 = long_int & 63; result += constant["str"].charAt(temp_int3); break;
    }
  }
  return result;
}

function get_long_int(round, long_str) {
  round = round * 3;
  return (long_str.charCodeAt(round) << 16) | (long_str.charCodeAt(round + 1) << 8) | (long_str.charCodeAt(round + 2));
}

function gener_random(random, option) {
  return [
    (random & 255 & 170) | option[0] & 85,
    (random & 255 & 85) | option[0] & 170,
    (random >> 8 & 255 & 170) | option[1] & 85,
    (random >> 8 & 255 & 85) | option[1] & 170,
  ];
}

function generate_rc4_bb_str(url_search_params, user_agent, window_env_str, suffix, Arguments) {
  if (suffix === undefined) suffix = "cus";
  if (Arguments === undefined) Arguments = [0, 1, 14];

  const sm3 = new SM3();
  const start_time = Date.now();

  const url_search_params_list = sm3.sum(sm3.sum(url_search_params + suffix));
  const cus = sm3.sum(sm3.sum(suffix));
  const ua = sm3.sum(result_encrypt(rc4_encrypt(user_agent, String.fromCharCode.apply(null, [0.00390625, 1, 14])), "s3"));
  const end_time = Date.now();

  const b = {};
  b[8] = 3;
  b[10] = end_time;
  b[15] = { "aid": 6383, "pageId": 6241, "boe": false, "ddrt": 7,
    "paths": { "include": [{},{},{},{},{},{},{}], "exclude": [] },
    "track": { "mode": 0, "delay": 300, "paths": [] }, "dump": true, "rpU": "" };
  b[16] = start_time;
  b[18] = 44;
  b[19] = [1, 0, 1, 5];

  b[20] = (b[16] >> 24) & 255;
  b[21] = (b[16] >> 16) & 255;
  b[22] = (b[16] >> 8) & 255;
  b[23] = b[16] & 255;
  b[24] = (b[16] / 256 / 256 / 256 / 256) >> 0;
  b[25] = (b[16] / 256 / 256 / 256 / 256 / 256) >> 0;

  b[26] = (Arguments[0] >> 24) & 255;
  b[27] = (Arguments[0] >> 16) & 255;
  b[28] = (Arguments[0] >> 8) & 255;
  b[29] = Arguments[0] & 255;
  b[30] = (Arguments[1] / 256) & 255;
  b[31] = (Arguments[1] % 256) & 255;
  b[32] = (Arguments[1] >> 24) & 255;
  b[33] = (Arguments[1] >> 16) & 255;
  b[34] = (Arguments[2] >> 24) & 255;
  b[35] = (Arguments[2] >> 16) & 255;
  b[36] = (Arguments[2] >> 8) & 255;
  b[37] = Arguments[2] & 255;

  b[38] = url_search_params_list[21];
  b[39] = url_search_params_list[22];
  b[40] = cus[21];
  b[41] = cus[22];
  b[42] = ua[23];
  b[43] = ua[24];

  b[44] = (b[10] >> 24) & 255;
  b[45] = (b[10] >> 16) & 255;
  b[46] = (b[10] >> 8) & 255;
  b[47] = b[10] & 255;
  b[48] = b[8];
  b[49] = (b[10] / 256 / 256 / 256 / 256) >> 0;
  b[50] = (b[10] / 256 / 256 / 256 / 256 / 256) >> 0;

  b[51] = b[15].pageId;
  b[52] = (b[15].pageId >> 24) & 255;
  b[53] = (b[15].pageId >> 16) & 255;
  b[54] = (b[15].pageId >> 8) & 255;
  b[55] = b[15].pageId & 255;
  b[56] = b[15].aid;
  b[57] = b[15].aid & 255;
  b[58] = (b[15].aid >> 8) & 255;
  b[59] = (b[15].aid >> 16) & 255;
  b[60] = (b[15].aid >> 24) & 255;

  const window_env_list = [];
  for (let index = 0; index < window_env_str.length; index++) {
    window_env_list.push(window_env_str.charCodeAt(index));
  }
  b[64] = window_env_list.length;
  b[65] = b[64] & 255;
  b[66] = (b[64] >> 8) & 255;
  b[69] = [].length;
  b[70] = b[69] & 255;
  b[71] = (b[69] >> 8) & 255;

  b[72] = b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42]
       ^ b[21] ^ b[27] ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43]
       ^ b[22] ^ b[28] ^ b[32] ^ b[36] ^ b[23] ^ b[29] ^ b[33]
       ^ b[37] ^ b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48] ^ b[49]
       ^ b[50] ^ b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55]
       ^ b[57] ^ b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71];

  let bb = [
    b[18], b[20], b[52], b[26], b[30], b[34], b[58], b[38],
    b[40], b[53], b[42], b[21], b[27], b[54], b[55], b[31],
    b[35], b[57], b[39], b[41], b[43], b[22], b[28], b[32],
    b[60], b[36], b[23], b[29], b[33], b[37], b[44], b[45],
    b[59], b[46], b[47], b[48], b[49], b[50], b[24], b[25],
    b[65], b[66], b[70], b[71]
  ];
  bb = bb.concat(window_env_list).concat(b[72]);
  return rc4_encrypt(
    String.fromCharCode.apply(null, bb),
    String.fromCharCode.apply(null, [121])
  );
}

function generate_random_str() {
  const list = [];
  list.push(...gener_random(Math.random() * 10000, [3, 45]));
  list.push(...gener_random(Math.random() * 10000, [1, 0]));
  list.push(...gener_random(Math.random() * 10000, [1, 5]));
  return String.fromCharCode.apply(null, list);
}

function generate_a_bogus(url_search_params, user_agent, window_env_str) {
  if (window_env_str === undefined) window_env_str = "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32";
  const result_str = generate_random_str()
    + generate_rc4_bb_str(url_search_params, user_agent, window_env_str);
  return result_encrypt(result_str, "s4") + "=";
}

// ─── Worker entry ────────────────────────────────────────────────────────
export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const pathParts = reqUrl.pathname.split("/").filter(Boolean);

    // URL 格式:/<webRid> → JSON;/<webRid>.flv → 302 跳 FLV 直链
    const rawId = pathParts.length > 0 ? pathParts[0] : null;

    if (!rawId) {
      return json({ error: "缺少 webRid", usage: "GET https://host/859811134275[.flv]" }, 400);
    }

    // /<webRid>.flv → 302 重定向到 FLV 直链;/<webRid> → JSON
    const flvReq = /\.flv$/i.test(rawId);
    const id = flvReq ? rawId.replace(/\.flv$/i, "") : rawId;

    try {
      const result = await resolveByWebRid(id.trim());
      if (flvReq) {
        return flvRedirect(result, id);
      }
      return json(result);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },
};

async function resolveByWebRid(webRid) {
  // 1. Get dynamic cookie
  const cookie = await getDouyinCookie(webRid);

  // 2. Build API URL
  const apiUrl = new URL("https://live.douyin.com/webcast/room/web/enter/");
  apiUrl.searchParams.set("aid", "6383");
  apiUrl.searchParams.set("app_name", "douyin_web");
  apiUrl.searchParams.set("live_id", "1");
  apiUrl.searchParams.set("device_platform", "web");
  apiUrl.searchParams.set("language", "zh-CN");
  apiUrl.searchParams.set("browser_language", "zh-CN");
  apiUrl.searchParams.set("browser_platform", "Win32");
  apiUrl.searchParams.set("browser_name", "Chrome");
  apiUrl.searchParams.set("browser_version", "125.0.0.0");
  apiUrl.searchParams.set("web_rid", webRid);
  apiUrl.searchParams.set("msToken", ""); // will be replaced

  // 3. Sign with a_bogus
  const signedUrl = signDouyinUrl(apiUrl.toString());

  // 4. Fetch room data
  const data = await fetchJson(signedUrl, {
    "Authority": "live.douyin.com",
    "User-Agent": USER_AGENT,
    "Referer": `https://live.douyin.com/${webRid}`,
    "Cookie": cookie || DEFAULT_COOKIE,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  });

  const room = data?.data?.data?.[0];
  const user = data?.data?.user;

  if (!room) throw new Error("room not found — Douyin API format may have changed");

  const isLive = Number(room.status ?? 0) === 2;
  const streamUrl = isLive ? room.stream_url : null;
  const qualities = streamUrl ? parseQualities(streamUrl) : [];
  const best = qualities.length > 0 ? qualities[0] : null;

  return {
    live: isLive,
    webRid: webRid,
    roomId: room.id_str?.toString() ?? "",
    title: room.title?.toString() ?? "",
    userName: room.owner?.nickname?.toString() ?? user?.nickname?.toString() ?? "",
    cover: (isLive && room.cover?.url_list?.[0]) ? room.cover.url_list[0].toString() : "",
    qualities,
    flvUrls: qualities.filter(q => q.flv).map(q => q.flv),
    hlsUrls: qualities.filter(q => q.hls).map(q => q.hls),
    best,
  };
}

// ─── FLV redirect ────────────────────────────────────────────────────────
function flvRedirect(result, webRid) {
  const flv = result.flvUrls[0]; // qualities 按 level 降序,首个即最高画质
  if (!flv) {
    const reason = !result.live
      ? `直播间 ${webRid} 未在直播`
      : "该直播间没有 FLV 源,请用 JSON 接口的 hlsUrls 字段";
    return new Response(reason, {
      status: 404,
      headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }
  return new Response(null, {
    status: 302,
    headers: corsHeaders({ "Location": flv }),
  });
}

// ─── Parse stream qualities ──────────────────────────────────────────────
function parseQualities(streamUrl) {
  const liveCore = streamUrl?.live_core_sdk_data;
  const pullData = liveCore?.pull_data;
  const options = pullData?.options;
  const qualityList = options?.qualities ?? [];
  const streamDataRaw = pullData?.stream_data?.toString() ?? "";
  const result = [];

  if (streamDataRaw && streamDataRaw.startsWith("{")) {
    // structured stream_data (JSON)
    let qualityData;
    try { qualityData = JSON.parse(streamDataRaw).data ?? {}; } catch (_) { qualityData = {}; }

    for (const q of qualityList) {
      const main = qualityData[q.sdk_key]?.main;
      const flv = main?.flv?.toString() ?? "";
      const hls = main?.hls?.toString() ?? "";
      if (flv || hls) {
        result.push({
          name: q.name?.toString() ?? "",
          level: Number(q.level ?? 0),
          sdkKey: q.sdk_key?.toString() ?? "",
          flv, hls,
          urls: [flv, hls].filter(Boolean),
        });
      }
    }
  } else {
    // flat flv_pull_url / hls_pull_url_map
    const flvMap = streamUrl?.flv_pull_url ?? {};
    const hlsMap = streamUrl?.hls_pull_url_map ?? {};
    const flvList = Object.values(flvMap).map(String);
    const hlsList = Object.values(hlsMap).map(String);

    for (const q of qualityList) {
      const level = Number(q.level ?? 0);
      const flvIdx = flvList.length - level;
      const hlsIdx = hlsList.length - level;
      const flv = (flvIdx >= 0 && flvIdx < flvList.length) ? flvList[flvIdx] : "";
      const hls = (hlsIdx >= 0 && hlsIdx < hlsList.length) ? hlsList[hlsIdx] : "";
      if (flv || hls) {
        result.push({
          name: q.name?.toString() ?? "",
          level,
          sdkKey: q.sdk_key?.toString() ?? "",
          flv, hls,
          urls: [flv, hls].filter(Boolean),
        });
      }
    }
  }

  result.sort((a, b) => b.level - a.level);
  return result;
}

// ─── a_bogus signing helper ──────────────────────────────────────────────
function signDouyinUrl(rawUrl) {
  const url = new URL(rawUrl);
  const msToken = generateMsToken(107);
  url.searchParams.set("msToken", msToken);

  const query = url.searchParams.toString();
  const aBogus = generate_a_bogus(query, USER_AGENT);
  url.searchParams.set("a_bogus", aBogus);

  return url.toString();
}

function generateMsToken(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < length; i++)
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

// ─── Cookie helper (get ttwid from set‑cookie) ───────────────────────────
// ttwid changes very rarely, so cache it in module-level state instead of
// issuing a HEAD request on every resolve.
const COOKIE_TTL_MS = 30 * 60 * 1000;
let cachedCookie = null;
let cachedCookieAt = 0;

async function getDouyinCookie(webRid) {
  const now = Date.now();
  if (cachedCookie && now - cachedCookieAt < COOKIE_TTL_MS) return cachedCookie;

  try {
    const resp = await fetch(`https://live.douyin.com/${webRid}`, {
      method: "HEAD",
      headers: {
        "Authority": "live.douyin.com",
        "Referer": "https://live.douyin.com",
        "User-Agent": USER_AGENT,
      },
    });
    // getAll("set-cookie") keeps each Set-Cookie header intact in Workers;
    // a plain get() joins them with ", " — which also splits inside
    // "Expires=Wed, 21 Oct ..." — so the stop-set must forbid both ";" and ","
    // (instead of only ";" as before), and the comma-anchored boundary
    // (?:^|,\s*) still handles a joined string as the getAll fallback.
    const headersList = resp.headers.getAll?.("set-cookie") ?? [];
    const lines = headersList.length > 0
      ? headersList
      : [resp.headers.get("set-cookie")].filter(Boolean);
    const parts = [];
    for (const name of ["ttwid", "__ac_nonce", "msToken"]) {
      for (const line of lines) {
        const m = line.match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]*)`));
        if (m) { parts.push(m[1]); break; }
      }
    }
    // Only dynamic cookies that actually contain a ttwid are worth replacing
    // the DEFAULT_COOKIE with; anything else would just lose the fallback.
    if (parts.some(p => p.startsWith("ttwid="))) {
      cachedCookie = parts.join("; ");
      cachedCookieAt = now;
      return cachedCookie;
    }
    return DEFAULT_COOKIE; // no usable ttwid — don't cache the fallback
  } catch (_) {
    return DEFAULT_COOKIE;
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────
async function fetchJson(url, headers) {
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch (_) { throw new Error(`Response not JSON: ${text.slice(0, 300)}`); }
}

// ─── Response helpers ────────────────────────────────────────────────────
function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status ?? 200,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function corsHeaders(extra) {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  if (extra) Object.assign(h, extra);
  return h;
}
