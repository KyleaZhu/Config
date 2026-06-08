const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const MIMO_VOICE_DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';
const AUTH_COOKIE_NAME = 'mimo_auth';
const AUTH_SALT = 'MIMO_SALT_2026';
const TTS_TOKEN_SALT = 'MIMO_TTS_TOKEN_2026';
const DEFAULT_VOICE = '冰糖';
const DEFAULT_DISPLAY_NAME = 'MiMoTTS';
const DEFAULT_MODE = 'preset';
const MAX_TTS_TEXT_LENGTH = 2000;

const MIMO_VOICES = [
  { id: '冰糖', name: '冰糖 (中文/甜美)' },
  { id: '茉莉', name: '茉莉 (中文/知性)' },
  { id: '苏打', name: '苏打 (中文/清亮)' },
  { id: '白桦', name: '白桦 (中文/醇厚)' }
];

const MIMO_STYLES = [
  { value: '一位三十多岁的专业男性有声书演播者。他的嗓音醇厚温暖，带有舒适的磁性。语速适中偏慢，语气从容稳重，像在深夜电台里娓娓道来一个漫长的故事，非常适合长时间聆听。', name: '经典男声 (沉稳醇厚，万能推荐)' },
  { value: '一位二十多岁的年轻女性电台主播。她的声音丝滑清透，没有任何攻击性。语速平缓流畅，语气温柔治愈且带着淡淡的微笑感，像是在午后阳光下为你朗读散文，听感极度放松。', name: '治愈女声 (温柔知性，现言散文)' },
  { value: '一位三十岁左右的男性有声书播音员，正在演播一部悬疑推理小说。他的声音低沉微哑，极具冷峻感。语速缓慢而刻意，语气克制且带着强烈的神秘感，仿佛在压低嗓音向你揭开一个秘密。', name: '悬疑冷峻 (低沉微哑，探险刑侦)' },
  { value: '一位二三十岁的青年男性评书先生。他的声音清朗明快，底气充足，咬字非常清晰干脆。说话节奏感极强，语气中带着一种古代说书人特有的从容与潇洒，适合演播武侠或修仙小说。', name: '潇洒清朗 (咬字干脆，武侠修仙)' },
  { value: '一位十八九岁的活力少女，正在用播客主播的口吻讲述故事。她的声音明亮活泼，充满朝气。语速稍快，语气里带着自然的亲切感和机灵劲儿，就像好朋友坐在身边跟你眉飞色舞地聊天一样生动。', name: '灵动少女 (明亮活泼，轻小说/日常)' },
  { value: '一位声音自然、吐字清晰的主播，语速适中，情绪平稳。', name: '默认 (标准自然播音腔)' }
];

const DEFAULT_PRESET_STYLE_PROMPT = '请用自然清晰、耐听的小说旁白风格朗读。语速适中偏慢，吐字清楚，情绪表达克制自然，停顿舒适；对话根据语境轻微区分，但不要夸张表演。';
const DEFAULT_DESIGN_STYLE_PROMPT = '一位声音自然、吐字清晰的主播，语速适中，情绪平稳。';

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

async function hashText(value) {
  const msgBuffer = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  return hashText(password + AUTH_SALT);
}

async function getTtsAuthToken(adminPassword, apiKey, env) {
  const configuredToken = getBinding(env, 'MIMO_TTS_TOKEN');
  if (configuredToken) return configuredToken;
  return hashText(`${adminPassword}:${apiKey}:${TTS_TOKEN_SALT}`);
}

function getBinding(env, name) {
  if (env && env[name]) return env[name];
  try {
    return globalThis[name] || '';
  } catch (_) {
    return '';
  }
}

function getRequestContext(request, env) {
  const requestUrl = new URL(request.url);
  return {
    env,
    requestUrl,
    path: requestUrl.pathname,
    baseUrl: `${requestUrl.protocol}//${requestUrl.host}`,
    serverApiKey: getBinding(env, 'MIMO_API_KEY'),
    adminPassword: getBinding(env, 'ADMIN')
  };
}

async function getAuthContext(request, context) {
  const expectedAuthHash = await hashPassword(context.adminPassword);
  const ttsAuthToken = await getTtsAuthToken(context.adminPassword, context.serverApiKey, context.env);
  const authCookie = getCookie(request.headers.get('Cookie') || '', AUTH_COOKIE_NAME);
  const requestAuthToken = context.requestUrl.searchParams.get('auth') || '';
  const hasAdminSession = authCookie === expectedAuthHash;

  return {
    expectedAuthHash,
    ttsAuthToken,
    hasAdminSession,
    hasTtsAccess: hasAdminSession || (requestAuthToken && requestAuthToken === ttsAuthToken)
  };
}

function getCookie(cookieHeader, name) {
  return cookieHeader
    .split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`))
    ?.split('=')[1];
}

function redirect(message, location, headers = {}) {
  return new Response(message, {
    status: 302,
    headers: { Location: location, ...headers }
  });
}

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function htmlResponse(html) {
  return new Response(html, { headers: HTML_HEADERS });
}

function appendTtsPause(text) {
  return text.trim() + '[停顿]';
}

function getTtsParams(searchParams) {
  return {
    text: searchParams.get('t') || '',
    mode: searchParams.get('m') || DEFAULT_MODE,
    voice: searchParams.get('v') || DEFAULT_VOICE,
    stylePrompt: searchParams.get('style') || ''
  };
}

function buildReaderUrl(baseUrl, ttsAuthToken, { mode, voice, stylePrompt }) {
  let ttsUrl = `${baseUrl}/tts?t={{java.encodeURI(speakText)}}&m=${encodeURIComponent(mode)}&auth=${encodeURIComponent(ttsAuthToken)}`;
  if (voice) ttsUrl += `&v=${encodeURIComponent(voice)}`;
  if (stylePrompt) ttsUrl += `&style=${encodeURIComponent(stylePrompt)}`;
  return ttsUrl;
}

function buildMiMoRequestBody(text, mode, voice, stylePrompt) {
  const body = { audio: { format: 'wav' } };
  const messages = [];

  if (mode === DEFAULT_MODE) {
    body.model = MIMO_TTS_MODEL;
    body.audio.voice = voice;
    messages.push({ role: 'user', content: stylePrompt.trim() || DEFAULT_PRESET_STYLE_PROMPT });
  } else {
    body.model = MIMO_VOICE_DESIGN_MODEL;
    messages.push({ role: 'user', content: stylePrompt.trim() || DEFAULT_DESIGN_STYLE_PROMPT });
  }

  messages.push({ role: 'assistant', content: text });
  body.messages = messages;
  return body;
}

function decodeBase64Audio(base64Audio) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

async function handleRequest(request, env) {
  const context = getRequestContext(request, env);

  if (!context.adminPassword) {
    return new Response('System Error: Missing ADMIN environment variable.', { status: 500 });
  }

  const auth = await getAuthContext(request, context);

  if (context.path === '/tts') {
    return handleTts(context, auth);
  }

  if (context.path === '/reader.json') {
    return handleReaderConfig(context, auth);
  }

  if (context.path === '/logout') {
    return handleLogout();
  }

  if (context.path === '/login') {
    return handleLogin(request, context, auth);
  }

  if (!auth.hasAdminSession) {
    return redirect('未授权，跳转中...', '/login');
  }

  return htmlResponse(getHTML(auth.ttsAuthToken));
}

async function handleTts(context, auth) {
  if (!auth.hasTtsAccess) return unauthorized();

  const params = getTtsParams(context.requestUrl.searchParams);
  if (!params.text) return new Response('Text is empty', { status: 400 });
  if (params.text.length > MAX_TTS_TEXT_LENGTH) {
    return new Response(`Text is too long. Max length is ${MAX_TTS_TEXT_LENGTH} characters.`, { status: 413 });
  }
  if (!context.serverApiKey) return new Response('Server MIMO_API_KEY not set', { status: 401 });

  return callMiMoAPI(
    appendTtsPause(params.text),
    context.serverApiKey,
    params.mode,
    params.voice,
    params.stylePrompt
  );
}

function handleReaderConfig(context, auth) {
  if (!auth.hasTtsAccess) return unauthorized();

  const searchParams = context.requestUrl.searchParams;
  const displayName = searchParams.get('n') || DEFAULT_DISPLAY_NAME;
  const params = {
    mode: searchParams.get('m') || DEFAULT_MODE,
    voice: searchParams.get('v') || '',
    stylePrompt: searchParams.get('style') || ''
  };

  const config = {
    id: Date.now(),
    name: displayName,
    url: buildReaderUrl(context.baseUrl, auth.ttsAuthToken, params),
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
  if (auth.hasAdminSession) {
    return redirect('已登录，跳转中...', '/');
  }

  if (request.method === 'POST') {
    const formData = await request.text();
    const params = new URLSearchParams(formData);
    if (params.get('password') === context.adminPassword) {
      return redirect('登录成功，跳转中...', '/', {
        'Set-Cookie': `${AUTH_COOKIE_NAME}=${auth.expectedAuthHash}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`
      });
    }
    return htmlResponse(getLoginHTML(true));
  }

  return htmlResponse(getLoginHTML(false));
}

async function callMiMoAPI(text, apiKey, mode, voice, stylePrompt) {
  const body = buildMiMoRequestBody(text, mode, voice, stylePrompt);

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
    <title>登录 - MiMo 控制台</title>
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

function getHTML(ttsAuthToken) {
  const voicesHTML = MIMO_VOICES.map(voice => `<option value="${voice.id}">${voice.name}</option>`).join('');
  const stylesHTML = MIMO_STYLES.map(style => `<option value="${style.value}">${style.name}</option>`).join('');
  const ttsAuthTokenLiteral = JSON.stringify(ttsAuthToken).replace(/</g, '\\u003c');

  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MiMo TTS 配置</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4">
    <div class="bg-white shadow-xl rounded-2xl p-8 max-w-md w-full border border-slate-100 relative overflow-hidden">
      <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-400 to-orange-500"></div>

      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center">
          <div class="bg-orange-50 p-2 rounded-xl text-orange-500 mr-3">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
          </div>
          <div>
            <h1 class="text-xl font-bold text-slate-800">MiMo引擎配置</h1>
            <p class="text-xs text-slate-400">双模型驱动</p>
          </div>
        </div>
        <a href="/logout" class="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 px-3 py-1.5 rounded-lg flex items-center">
          <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
          退出
        </a>
      </div>

      <div class="space-y-6">
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-2">选择模型模式</label>
          <div class="relative">
            <select id="modeSelect" onchange="toggleMode()" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-orange-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
              <option value="preset" selected>MiMo-V2.5-TTS</option>
              <option value="design">MiMo-V2.5-TTS-VoiceDesign</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
          </div>
        </div>

        <div id="designGroup" style="display: none;">
          <label class="block text-sm font-semibold text-slate-700 mb-2">选择定制音色</label>
          <div class="relative">
            <select id="styleSelect" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-orange-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
              ${stylesHTML}
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
          </div>
        </div>

        <div id="presetGroup">
          <label class="block text-sm font-semibold text-slate-700 mb-2">选择预置音色</label>
          <div class="relative">
            <select id="voiceSelect" class="w-full border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-orange-500 outline-none border transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
              ${voicesHTML}
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>
          </div>
        </div>

        <button onclick="importToReader()" class="w-full bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-orange-200 transition-all active:scale-95 flex items-center justify-center mt-2">
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          一键导入“阅读”App
        </button>
      </div>

      <div class="mt-8 pt-6 border-t border-slate-100">
        <div class="flex items-start text-xs text-slate-400 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
          <svg class="w-4 h-4 mr-2 flex-shrink-0 text-slate-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <p>
            导入成功后，请在“阅读”App 的“朗读引擎”中启用并切换至该发音人。不同模型、音色将生成独立的引擎。
          </p>
        </div>
      </div>
    </div>

    <script>
      const TTS_AUTH_TOKEN = ${ttsAuthTokenLiteral};

      function toggleMode() {
        const mode = document.getElementById('modeSelect').value;
        if (mode === 'preset') {
          document.getElementById('presetGroup').style.display = 'block';
          document.getElementById('designGroup').style.display = 'none';
        } else {
          document.getElementById('presetGroup').style.display = 'none';
          document.getElementById('designGroup').style.display = 'block';
        }
      }

      function importToReader() {
        const mode = document.getElementById('modeSelect').value;
        let configUrl = window.location.origin + "/reader.json?m=" + encodeURIComponent(mode) + "&auth=" + encodeURIComponent(TTS_AUTH_TOKEN);
        let engineName = "";

        if (mode === 'preset') {
          const voiceSel = document.getElementById('voiceSelect');
          const voice = voiceSel.value;
          engineName = "MiMo-" + voiceSel.options[voiceSel.selectedIndex].text.split(' ')[0];
          configUrl += "&v=" + encodeURIComponent(voice);
        } else {
          const styleSel = document.getElementById('styleSelect');
          const stylePrompt = styleSel.value;
          const styleName = styleSel.options[styleSel.selectedIndex].text.split(' ')[0] || "自定义";
          engineName = "MiMo设计-" + styleName;
          if (stylePrompt) {
            configUrl += "&style=" + encodeURIComponent(stylePrompt);
          }
        }

        configUrl += "&n=" + encodeURIComponent(engineName);
        const deepLink = "legado://import/httpTTS?src=" + encodeURIComponent(configUrl);
        window.location.href = deepLink;
      }
    </script>
  </body>
  </html>
  `;
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
