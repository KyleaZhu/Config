// =============================================================================
// MiMo TTS (小米 API)
// =============================================================================
const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const AUTH_COOKIE_NAME = 'mimo_auth';
const AUTH_SALT = 'MIMO_SALT_2026';
const TTS_TOKEN_SALT = 'MIMO_TTS_TOKEN_2026';
const MAX_TTS_TEXT_LENGTH = 2000;

const MIMO_VOICES = [
  { id: '冰糖', name: '冰糖 (中文/甜美)' },
  { id: '茉莉', name: '茉莉 (中文/知性)' },
  { id: '苏打', name: '苏打 (中文/清亮)' },
  { id: '白桦', name: '白桦 (中文/醇厚)' }
];

const DEFAULT_STYLE_PROMPT = '';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};
const AUDIO_HEADERS = {
  'Content-Type': 'audio/wav',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};

// =============================================================================
// Microsoft TTS (Azure) - Constants & State
// =============================================================================
const MS_JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};
let msExpiredAt = null;
let msEndpoint = null;

const msPreserveTags = [
  { name: 'break', pattern: /<break\s+[^>]*\/>/g },
  { name: 'speak', pattern: /<speak>|<\/speak>/g },
  { name: 'prosody', pattern: /<prosody\s+[^>]*>|<\/prosody>/g },
  { name: 'emphasis', pattern: /<emphasis\s+[^>]*>|<\/emphasis>/g },
  { name: 'voice', pattern: /<voice\s+[^>]*>|<\/voice>/g },
  { name: 'say-as', pattern: /<say-as\s+[^>]*>|<\/say-as>/g },
  { name: 'phoneme', pattern: /<phoneme\s+[^>]*>|<\/phoneme>/g },
  { name: 'audio', pattern: /<audio\s+[^>]*>|<\/audio>/g },
  { name: 'p', pattern: /<p>|<\/p>/g },
  { name: 's', pattern: /<s>|<\/s>/g },
  { name: 'sub', pattern: /<sub\s+[^>]*>|<\/sub>/g },
  { name: 'mstts', pattern: /<mstts:[^>]*>|<\/mstts:[^>]*>/g }
];

// =============================================================================
// Microsoft TTS - Helper Functions
// =============================================================================
function msUuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

function msEscapeBasicXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function msEscapeSSML(ssml) {
  const placeholders = new Map();
  let processedSSML = ssml;
  let counter = 0;

  for (const tag of msPreserveTags) {
    processedSSML = processedSSML.replace(tag.pattern, function (match) {
      const placeholder = `__SSML_PLACEHOLDER_${tag.name}_${counter++}__`;
      placeholders.set(placeholder, match);
      return placeholder;
    });
  }

  let escapedContent = msEscapeBasicXml(processedSSML);
  placeholders.forEach((tag, placeholder) => {
    escapedContent = escapedContent.replace(placeholder, tag);
  });

  return escapedContent;
}

function msGenerateUserId() {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function msDateFormat() {
  const formattedDate = new Date().toUTCString().replace(/GMT/, '').trim() + 'GMT';
  return formattedDate.toLowerCase();
}

async function msBase64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function msBytesToBase64(bytes) {
  return btoa(String.fromCharCode.apply(null, bytes));
}

async function msHmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function msSign(urlStr) {
  const url = urlStr.split('://')[1];
  const encodedUrl = encodeURIComponent(url);
  const uuidStr = msUuid();
  const formattedDate = msDateFormat();
  const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
  const decode = await msBase64ToBytes('oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==');
  const signData = await msHmacSha256(decode, bytesToSign);
  const signBase64 = await msBytesToBase64(signData);
  return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
}

async function msGetEndpoint() {
  const endpointUrl = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
  const headers = {
    'Accept-Language': 'zh-Hans',
    'X-ClientVersion': '4.0.530a 5fe1dc6c',
    'X-UserId': msGenerateUserId(),
    'X-HomeGeographicRegion': 'zh-Hans-CN',
    'X-ClientTraceId': msUuid(),
    'X-MT-Signature': await msSign(endpointUrl),
    'User-Agent': 'okhttp/4.5.0',
    'Content-Type': 'application/json',
    'Content-Length': '0',
    'Accept-Encoding': 'gzip'
  };

  return fetch(endpointUrl, {
    method: 'POST',
    headers: headers
  }).then(res => res.json());
}

function msGetSsml(text, voiceName, rate, pitch, style = 'general') {
  text = msEscapeSSML(text);
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> <voice name="${voiceName}"> <mstts:express-as style="${style}" styledegree="1.0" role="default"> <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> </mstts:express-as> </voice> </speak>`;
}

async function msRefreshEndpoint() {
  msEndpoint = await msGetEndpoint();
  const jwt = msEndpoint.t.split('.')[1];
  const decodedJwt = JSON.parse(atob(jwt));
  msExpiredAt = decodedJwt.exp;
}

async function msGetVoice(text, voiceName = 'zh-CN-XiaoxiaoMultilingualNeural', rate = 0, pitch = 0, style = 'general', outputFormat = 'audio-24khz-48kbitrate-mono-mp3') {
  if (!msExpiredAt || Date.now() / 1000 > msExpiredAt - 300) {
    await msRefreshEndpoint();
  }

  const url = `https://${msEndpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const headers = {
    'Authorization': msEndpoint.t,
    'Content-Type': 'application/ssml+xml',
    'User-Agent': 'okhttp/4.5.0',
    'X-Microsoft-OutputFormat': outputFormat
  };
  const ssml = msGetSsml(text, voiceName, rate, pitch, style);

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: ssml
  });

  if (response.ok) {
    return response;
  }

  // Failed — retry with fresh endpoint if auth-related
  const errorText = await response.text();
  console.error('MS TTS API错误:', response.status, errorText);

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    await msRefreshEndpoint();

    headers['Authorization'] = msEndpoint.t;
    const retryUrl = `https://${msEndpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const retryResponse = await fetch(retryUrl, {
      method: 'POST',
      headers: headers,
      body: ssml
    });

    if (retryResponse.ok) {
      return retryResponse;
    }

    const retryText = await retryResponse.text();
    console.error('MS TTS API重试失败:', retryResponse.status, retryText);
    return new Response(retryText || retryResponse.statusText, { status: retryResponse.status });
  }

  return new Response(errorText || response.statusText, { status: response.status });
}

// =============================================================================
// Microsoft TTS - Route Handlers
// =============================================================================

/** /ms/tts — core TTS endpoint */
async function handleMsTts(request, auth) {
  const requestUrl = new URL(request.url);

  // Auth: 必须用 auth 令牌(派生哈希)
  const authToken = requestUrl.searchParams.get('auth');
  if (!authToken || authToken !== auth.ttsAuthToken) {
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      message: '无效的 API 令牌。',
      status: 401
    }), { status: 401, headers: MS_JSON_HEADERS });
  }

  const text = requestUrl.searchParams.get('t') || '';
  if (!text) return new Response('Text is empty', { status: 400 });

  const voiceName = requestUrl.searchParams.get('v') || 'zh-CN-XiaoxiaoMultilingualNeural';
  const rate = Number(requestUrl.searchParams.get('r')) || 0;
  const pitch = Number(requestUrl.searchParams.get('p')) || 0;
  const style = requestUrl.searchParams.get('s') || 'general';
  const outputFormat = requestUrl.searchParams.get('o') || 'audio-24khz-48kbitrate-mono-mp3';

  return msGetVoice(text, voiceName, rate, pitch, style, outputFormat);
}

/** /ms/reader.json — config for "阅读" App */
async function handleMsReaderConfig(request, auth) {
  const requestUrl = new URL(request.url);
  const authToken = requestUrl.searchParams.get('auth');

  // Validate: 必须用 auth 令牌(派生哈希)
  if (!authToken || authToken !== auth.ttsAuthToken) {
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      message: '无效的 API 令牌。',
      status: 401
    }), { status: 401, headers: MS_JSON_HEADERS });
  }

  const voice = requestUrl.searchParams.get('v') || '';
  const rate = requestUrl.searchParams.get('r') || '';
  const pitch = requestUrl.searchParams.get('p') || '';
  const style = requestUrl.searchParams.get('s') || '';
  const displayName = requestUrl.searchParams.get('n') || 'Microsoft TTS';
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  const urlParams = ["t={{java.encodeURI(speakText)}}"];
  if (rate) urlParams.push(`r=${rate}`);
  if (voice) urlParams.push(`v=${voice}`);
  if (pitch) urlParams.push(`p=${pitch}`);
  if (style) urlParams.push(`s=${style}`);
  urlParams.push(`auth=${encodeURIComponent(auth.ttsAuthToken)}`);

  const url = `${baseUrl}/ms/tts?${urlParams.join('&')}`;

  return new Response(JSON.stringify({
    id: Date.now(),
    name: displayName,
    url: url,
    contentType: 'audio/mpeg'
  }), { status: 200, headers: MS_JSON_HEADERS });
}

// =============================================================================
// MiMo - Helper Functions
// =============================================================================
async function hashText(value) {
  const msgBuffer = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function getRequestContext(request, env) {
  const requestUrl = new URL(request.url);
  return {
    env,
    requestUrl,
    baseUrl: `${requestUrl.protocol}//${requestUrl.host}`,
    path: requestUrl.pathname,
    serverApiKey: env.MIMO_API_KEY,
    adminPassword: env.ADMIN
  };
}

async function getAuthContext(request, context) {
  const expectedAuthHash = await hashText(context.adminPassword + AUTH_SALT);
  const ttsAuthToken = await hashText(`${context.adminPassword}:${context.serverApiKey}:${TTS_TOKEN_SALT}`);
  const authCookie = (request.headers.get('Cookie') || '').split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${AUTH_COOKIE_NAME}=`))?.split('=')[1];
  const requestAuthToken = context.requestUrl.searchParams.get('auth') || '';
  const hasAdminSession = authCookie === expectedAuthHash;

  return {
    expectedAuthHash,
    ttsAuthToken,
    hasAdminSession,
    hasTtsAccess: hasAdminSession || (requestAuthToken && requestAuthToken === ttsAuthToken)
  };
}

function redirect(message, location, headers = {}) {
  return new Response(message, {
    status: 302,
    headers: { Location: location, ...headers }
  });
}

function decodeBase64Audio(base64Audio) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) bytes[index] = binaryString.charCodeAt(index);
  return bytes;
}

// =============================================================================
// MiMo - Route Handlers
// =============================================================================
async function handleTts(context, auth) {
  if (!auth.hasTtsAccess) return new Response('Unauthorized', { status: 401 });

  const params = {
    text: context.requestUrl.searchParams.get('t') || '',
    voice: context.requestUrl.searchParams.get('v') || ''
  };
  if (!params.text) return new Response('Text is empty', { status: 400 });
  if (params.text.length > MAX_TTS_TEXT_LENGTH) return new Response(`Text is too long. Max length is ${MAX_TTS_TEXT_LENGTH} characters.`, { status: 413 });
  if (!context.serverApiKey) return new Response('Server MIMO_API_KEY not set', { status: 500 });

  return callMiMoAPI(
    '[停顿0.5秒]' + params.text.trim() + '[停顿0.5秒]',
    context.serverApiKey,
    params.voice
  );
}

function handleReaderConfig(context, auth) {
  if (!auth.hasTtsAccess) return new Response('Unauthorized', { status: 401 });

  const config = {
    id: Date.now(),
    name: context.requestUrl.searchParams.get('n'),
    url: `${context.baseUrl}/tts?t={{java.encodeURI(speakText)}}&auth=${encodeURIComponent(auth.ttsAuthToken)}&v=${encodeURIComponent(context.requestUrl.searchParams.get('v'))}`,
    contentType: 'audio/wav'
  };

  return new Response(JSON.stringify(config), { headers: JSON_HEADERS });
}

function handleLogout() {
  return redirect('已登出，跳转中...', '/login', {
    'Set-Cookie': `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`
  });
}

async function handleLogin(request, context, auth) {
  if (auth.hasAdminSession) return redirect('已登录，跳转中...', '/');

  if (request.method === 'POST') {
    const formData = await request.text();
    const params = new URLSearchParams(formData);
    if (params.get('password') === context.adminPassword) {
      return redirect('登录成功，跳转中...', '/', {
        'Set-Cookie': `${AUTH_COOKIE_NAME}=${auth.expectedAuthHash}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`
      });
    }
    return new Response(getLoginHTML(true), { headers: HTML_HEADERS });
  }

  return new Response(getLoginHTML(false), { headers: HTML_HEADERS });
}

async function callMiMoAPI(text, apiKey, voice) {
  const body = {
    model: MIMO_TTS_MODEL,
    audio: { format: 'wav', voice },
    messages: [
      { role: 'user', content: DEFAULT_STYLE_PROMPT },
      { role: 'assistant', content: text }
    ]
  };

  try {
    const response = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`MiMo API Error: ${response.status} - ${errText}`);
      return new Response('MiMo API request failed', { status: response.status });
    }

    const data = await response.json();
    const base64Audio = data.choices?.[0]?.message?.audio?.data;
    if (!base64Audio) return new Response('No audio data returned', { status: 500 });

    return new Response(decodeBase64Audio(base64Audio), { headers: AUDIO_HEADERS });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}

function getLoginHTML(showError) {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - TTS 控制台</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4">
    <div class="bg-white shadow-xl rounded-3xl p-8 max-w-sm w-full border border-slate-100 text-center relative overflow-hidden">
      <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-400 to-orange-500"></div>
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-50 text-orange-500 mb-6">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z"></path></svg>
      </div>
      <h1 class="text-2xl font-bold text-slate-800 mb-2">安全验证</h1>
      <p class="text-sm text-slate-400 mb-8">访问管理面板需要验证身份</p>

      ${showError ? `<div class="bg-red-50 text-red-500 text-sm py-3 px-4 rounded-xl mb-6 text-left border border-red-100 flex items-center"><svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>密码错误，请重新输入</div>` : ''}

      <form method="POST" action="/login" class="space-y-6">
        <div>
          <input type="password" name="password" required autofocus placeholder="请输入ADMIN密码" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-orange-500 outline-none border transition-all text-center tracking-widest bg-slate-50 focus:bg-white text-slate-700 font-mono">
        </div>
        <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-orange-200 transition-all active:scale-95 flex items-center justify-center">
          <span>登录控制台</span>
        </button>
      </form>
    </div>
  </body>
  </html>
  `;
}

function getHTML(ttsAuthToken, baseUrl) {
  const voicesHTML = MIMO_VOICES.map(voice => `<option value="${voice.id}">${voice.name}</option>`).join('');
  const ttsAuthTokenLiteral = JSON.stringify(ttsAuthToken).replace(/</g, '\\u003c');

  const MS_VOICES_FEMALE = [
    { id: 'zh-CN-XiaochenNeural', name: '晓辰 (女)' },
    { id: 'zh-CN-XiaohanNeural', name: '晓涵 (女)' },
    { id: 'zh-CN-XiaomengNeural', name: '晓梦 (女)' },
    { id: 'zh-CN-XiaomoNeural', name: '晓墨 (女)' },
    { id: 'zh-CN-XiaoqiuNeural', name: '晓秋 (女)' },
    { id: 'zh-CN-XiaorouNeural', name: '晓柔 (女)' },
    { id: 'zh-CN-XiaoruiNeural', name: '晓睿 (女)' },
    { id: 'zh-CN-XiaoshuangNeural', name: '晓双 (女)' },
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女)' },
    { id: 'zh-CN-XiaoyanNeural', name: '晓颜 (女)' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (女)' },
    { id: 'zh-CN-XiaoyouNeural', name: '晓悠 (女)' },
    { id: 'zh-CN-XiaozhenNeural', name: '晓甄 (女)' },
  ];
  const MS_VOICES_MALE = [
    { id: 'zh-CN-YunfengNeural', name: '云枫 (男)' },
    { id: 'zh-CN-YunhaoNeural', name: '云皓 (男)' },
    { id: 'zh-CN-YunjianNeural', name: '云健 (男)' },
    { id: 'zh-CN-YunjieNeural', name: '云杰 (男)' },
    { id: 'zh-CN-YunxiaNeural', name: '云夏 (男)' },
    { id: 'zh-CN-YunxiNeural', name: '云希 (男)' },
    { id: 'zh-CN-YunyangNeural', name: '云扬 (男)' },
    { id: 'zh-CN-YunyeNeural', name: '云野 (男)' },
    { id: 'zh-CN-YunzeNeural', name: '云泽 (男)' },
  ];
  const msVoicesHTML = [...MS_VOICES_FEMALE, ...MS_VOICES_MALE]
    .map(v => `<option value="${v.id}">${v.name}</option>`).join('');

  const msStyles = [
    'general', 'chat', 'cheerful', 'affectionate', 'angry', 'sad',
    'calm', 'excited', 'friendly', 'gentle', 'hopeful', 'serious',
    'whispering', 'newscast', 'narration-professional', 'narration-relaxed',
    'poetry-reading', 'assistant', 'empathetic'
  ];
  const msStyleNames = {
    'general': '标准', 'chat': '随意', 'cheerful': '愉快',
    'affectionate': '亲切', 'angry': '愤怒', 'sad': '悲伤',
    'calm': '平静', 'excited': '兴奋', 'friendly': '友好',
    'gentle': '温柔', 'hopeful': '希望', 'serious': '严肃',
    'whispering': '低语', 'newscast': '新闻播报',
    'narration-professional': '专业叙述', 'narration-relaxed': '轻松叙述',
    'poetry-reading': '诗朗诵', 'assistant': '助理', 'empathetic': '共情'
  };
  const msStylesHTML = msStyles.map(s => `<option value="${s}">${msStyleNames[s] || s}</option>`).join('');

  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TTS 配置面板</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-50 p-4 md:p-8">
    <div class="max-w-5xl mx-auto grid md:grid-cols-2 gap-6 items-start">

      <!-- ===== MiMo TTS Card ===== -->
      <div class="bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-slate-100 relative overflow-hidden">
        <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-400 to-orange-500"></div>

        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center">
            <div class="bg-orange-50 p-2 rounded-xl text-orange-500 mr-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
            </div>
            <div>
              <h1 class="text-xl font-bold text-slate-800">MiMo TTS</h1>
              <p class="text-xs text-slate-400">MiMo-V2.5-TTS · 4种中文音色</p>
            </div>
          </div>
          <a href="/logout" class="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 px-3 py-1.5 rounded-lg flex items-center">
            <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            退出
          </a>
        </div>

        <div class="space-y-5">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">选择音色</label>
            <div class="relative">
              <select id="voiceSelect" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-orange-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
                ${voicesHTML}
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
            </div>
          </div>

          <button onclick="mimoImportToReader()" class="w-full bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-orange-200 transition-all active:scale-95 flex items-center justify-center">
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            导入"阅读"App
          </button>

          <div class="flex items-start text-xs text-slate-400 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
            <svg class="w-4 h-4 mr-2 flex-shrink-0 text-slate-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <p>导入后请在"阅读"App → 朗读引擎中启用。不同音色将生成独立的引擎。</p>
          </div>
        </div>
      </div>

      <!-- ===== Microsoft TTS Card ===== -->
      <div class="bg-white shadow-xl rounded-2xl p-6 md:p-8 border border-slate-100 relative overflow-hidden">
        <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-blue-400 to-blue-500"></div>

        <div class="flex items-center mb-6">
          <div class="bg-blue-50 p-2 rounded-xl text-blue-500 mr-3">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
          </div>
          <div>
            <h1 class="text-xl font-bold text-slate-800">Microsoft TTS</h1>
            <p class="text-xs text-slate-400">Azure Cognitive Services · 23种中文音色</p>
          </div>
        </div>

        <div class="space-y-5">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">选择音色</label>
            <div class="relative">
              <select id="msVoiceSelect" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
                ${msVoicesHTML}
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">朗读风格</label>
            <div class="relative">
              <select id="msStyleSelect" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
                ${msStylesHTML}
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-2">语速 <span id="msRateValue" class="text-slate-400 font-normal">0%</span></label>
              <input type="range" id="msRate" min="-50" max="50" value="0" oninput="document.getElementById('msRateValue').textContent=this.value+'%'"
                class="w-full accent-blue-500">
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-2">音调 <span id="msPitchValue" class="text-slate-400 font-normal">0%</span></label>
              <input type="range" id="msPitch" min="-50" max="50" value="0" oninput="document.getElementById('msPitchValue').textContent=this.value+'%'"
                class="w-full accent-blue-500">
            </div>
          </div>

          <button onclick="msImportToReader()" class="w-full bg-gradient-to-r from-blue-500 to-blue-400 hover:from-blue-600 hover:to-blue-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center justify-center">
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            导入"阅读"App
          </button>

          <div class="flex items-start text-xs text-slate-400 leading-relaxed bg-blue-50 p-3 rounded-lg border border-blue-100">
            <svg class="w-4 h-4 mr-2 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <p>导入后请在"阅读"App → 朗读引擎中启用。支持语速、音调、风格调节。</p>
          </div>
        </div>
      </div>

    </div>

    <script>
      const TTS_AUTH_TOKEN = ${ttsAuthTokenLiteral};
      const BASE_URL = ${JSON.stringify(baseUrl || window.location.origin).replace(/</g, '\\u003c')};

      function mimoImportToReader() {
        const voiceSel = document.getElementById('voiceSelect');
        const voice = voiceSel.value;
        const engineName = "MiMo-" + voiceSel.options[voiceSel.selectedIndex].text.split(' ')[0];
        const configUrl = BASE_URL + "/reader.json?auth=" + encodeURIComponent(TTS_AUTH_TOKEN)
          + "&v=" + encodeURIComponent(voice)
          + "&n=" + encodeURIComponent(engineName);
        const deepLink = "legado://import/httpTTS?src=" + encodeURIComponent(configUrl);
        window.location.href = deepLink;
      }

      function msImportToReader() {
        const voiceSel = document.getElementById('msVoiceSelect');
        const voice = voiceSel.value;
        const style = document.getElementById('msStyleSelect').value;
        const rate = document.getElementById('msRate').value;
        const pitch = document.getElementById('msPitch').value;
        const displayName = voiceSel.options[voiceSel.selectedIndex]?.text || voice;
        const engineName = "Azure-" + (displayName.split(' ')[0] || voice.split('-').slice(1, 3).join(''));

        const params = new URLSearchParams();
        params.append('auth', TTS_AUTH_TOKEN);
        params.append('v', voice);
        params.append('r', rate);
        params.append('p', pitch);
        params.append('s', style);
        params.append('n', engineName);

        const configUrl = BASE_URL + "/ms/reader.json?" + params.toString();
        const deepLink = "legado://import/httpTTS?src=" + encodeURIComponent(configUrl);
        window.location.href = deepLink;
      }
    </script>
  </body>
  </html>
  `;
}

// =============================================================================
// Main Request Handler
// =============================================================================
async function handleRequest(request, env) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname;

  // ---- All routes need auth context ----
  const context = getRequestContext(request, env);
  if (!context.adminPassword) return new Response('System Error: Missing ADMIN environment variable.', { status: 500 });
  const auth = await getAuthContext(request, context);

  // ---- Microsoft TTS Routes ----
  if (path === '/ms/tts') return handleMsTts(request, auth);
  if (path === '/ms/reader.json') return handleMsReaderConfig(request, auth);

  // ---- MiMo TTS Routes ----
  if (context.path === '/tts') return handleTts(context, auth);
  if (context.path === '/reader.json') return handleReaderConfig(context, auth);
  if (context.path === '/logout') return handleLogout();
  if (context.path === '/login') return handleLogin(request, context, auth);
  if (context.path === '/') {
    if (!auth.hasAdminSession) return redirect('未授权，跳转中...', '/login');
    return new Response(getHTML(auth.ttsAuthToken, context.baseUrl), { headers: HTML_HEADERS });
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
