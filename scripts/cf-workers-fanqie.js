const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>番茄小说下载</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="shell">
    <section class="tool">
      <div class="title-row">
        <div>
          <h1>番茄小说下载</h1>
          <p>输入小说 ID 或分享链接，预览目录后导出文件。</p>
        </div>
        <span class="badge">Cloudflare Worker</span>
      </div>

      <form id="bookForm" class="query">
        <label for="bookInput">小说 ID 或链接</label>
        <div class="query-line">
          <input id="bookInput" name="input" autocomplete="off" placeholder="7276384138653862966 或 https://fanqienovel.com/page/7276384138653862966" required>
          <button type="submit">解析</button>
        </div>
      </form>

      <div id="status" class="status" role="status">等待输入。</div>

      <section id="preview" class="preview hidden" aria-live="polite">
        <div class="book-head">
          <img id="cover" alt="" class="cover hidden">
          <div class="book-meta">
            <h2 id="bookTitle"></h2>
            <p id="bookAuthor"></p>
            <p id="apiWarning" class="api-warning hidden"></p>
            <p id="bookDesc"></p>
            <div id="bookStats" class="stats"></div>
          </div>
        </div>

        <div class="download-panel">
          <fieldset>
            <legend>章节范围</legend>
            <div class="range-row">
              <input id="rangeStart" type="number" min="1" value="1" aria-label="起始章节">
              <span>到</span>
              <input id="rangeEnd" type="number" min="1" value="1" aria-label="结束章节">
            </div>
          </fieldset>

          <button id="downloadBtn" type="button" class="primary">下载</button>
        </div>

        <div class="chapter-box">
          <div class="chapter-title">
            <h3>章节预览</h3>
            <span id="chapterHint"></span>
          </div>
          <ul id="chapters"></ul>
        </div>
      </section>
    </section>
  </main>
  <script src="/app.js" type="module"></script>
</body>
</html>`;

const CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
  color: #17211f;
  background: #f6f7f4;
}
.shell {
  width: min(1120px, calc(100% - 32px));
  margin: 32px auto;
}
.tool {
  background: #ffffff;
  border: 1px solid #d9ded8;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 14px 40px rgba(40, 55, 48, 0.08);
}
.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #e7e9e4;
  padding-bottom: 18px;
}
h1, h2, h3, p { margin: 0; }
h1 { font-size: 28px; line-height: 1.2; font-weight: 740; letter-spacing: 0; }
h2 { font-size: 23px; line-height: 1.25; letter-spacing: 0; }
h3 { font-size: 16px; letter-spacing: 0; }
.title-row p {
  margin-top: 8px;
  color: #64706c;
  line-height: 1.6;
}
.badge {
  flex: 0 0 auto;
  font-size: 13px;
  color: #175e52;
  background: #e5f4ef;
  border: 1px solid #c3e4da;
  padding: 6px 10px;
  border-radius: 999px;
}
.query {
  display: grid;
  gap: 8px;
  margin-top: 22px;
}
label, legend {
  font-size: 13px;
  color: #46524f;
  font-weight: 650;
}
.query-line {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}
input {
  width: 100%;
  min-height: 42px;
  border: 1px solid #cbd2cc;
  border-radius: 6px;
  padding: 0 12px;
  color: #17211f;
  background: #fbfcfa;
  font: inherit;
}
input:focus {
  outline: 2px solid #9ed8ca;
  border-color: #2f8a78;
}
button {
  min-height: 42px;
  border: 1px solid #25302e;
  border-radius: 6px;
  padding: 0 18px;
  color: #ffffff;
  background: #25302e;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
button:hover { background: #111715; }
button:disabled { cursor: wait; opacity: 0.62; }
.primary {
  background: #1f7668;
  border-color: #1f7668;
}
.primary:hover { background: #175e52; }
.status {
  min-height: 38px;
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid #e1ded3;
  background: #fbf7ed;
  color: #5e5036;
  border-radius: 6px;
  line-height: 1.45;
}
.hidden { display: none !important; }
.api-warning {
  width: fit-content;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid #f1c3bd;
  border-radius: 6px;
  color: #8b1f13;
  background: #fff1ef;
  line-height: 1.45;
}
.preview {
  display: grid;
  gap: 20px;
  margin-top: 20px;
}
.book-head {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  align-items: start;
}
.cover {
  width: 120px;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #d8ddd7;
  background: #edf0ec;
}
.book-meta { min-width: 0; display: grid; gap: 6px; }
.book-meta h2 { font-size: 20px; }
#bookAuthor { color: #57635f; }
#bookDesc {
  color: #384541;
  line-height: 1.65;
  white-space: pre-line;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.stats div {
  min-width: 100px;
  max-width: 100%;
  border: 1px solid #dde2dd;
  background: #f8faf7;
  border-radius: 6px;
  padding: 6px 10px;
}
.stats dt { color: #69746f; font-size: 12px; }
.stats dd { margin: 2px 0 0; font-weight: 700; overflow-wrap: anywhere; }
.download-panel {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 14px;
  padding: 16px;
  border: 1px solid #dde2dd;
  background: #fbfcfa;
  border-radius: 8px;
}
fieldset {
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
}
.range-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.range-row span { color: #68736f; }
.chapter-box {
  border-top: 1px solid #e7e9e4;
  padding-top: 18px;
}
.chapter-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}
#chapterHint {
  color: #68736f;
  font-size: 13px;
}
ul {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
  max-height: 380px;
  overflow: auto;
  margin: 0;
  padding: 0;
}
li {
  min-width: 0;
  border: 1px solid #e1e5e0;
  background: #ffffff;
  border-radius: 6px;
  padding: 8px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
li a {
  color: #17211f;
  text-decoration: none;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
li a:hover { color: #1f7668; text-decoration: underline; }
@media (max-width: 760px) {
  .shell { width: min(100% - 20px, 1120px); margin: 10px auto; }
  .tool { padding: 16px; }
  .title-row, .book-head, .download-panel, .query-line {
    grid-template-columns: 1fr;
    display: grid;
  }
  .badge { width: fit-content; }
  ul { grid-template-columns: 1fr; }
}
`;

const JS = `
let current = null;

const form = document.getElementById("bookForm");
const input = document.getElementById("bookInput");
const statusEl = document.getElementById("status");
const preview = document.getElementById("preview");
const cover = document.getElementById("cover");
const bookTitle = document.getElementById("bookTitle");
const bookAuthor = document.getElementById("bookAuthor");
const apiWarning = document.getElementById("apiWarning");
const bookDesc = document.getElementById("bookDesc");
const bookStats = document.getElementById("bookStats");
const chaptersEl = document.getElementById("chapters");
const chapterHint = document.getElementById("chapterHint");
const rangeStart = document.getElementById("rangeStart");
const rangeEnd = document.getElementById("rangeEnd");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(message) {
  statusEl.textContent = message;
}

function renderBook(data) {
  current = data;
  preview.classList.remove("hidden");

  var m = data.meta || {};
  bookTitle.textContent = m.title || data.bookId;
  bookAuthor.textContent = m.author ? "作者：" + m.author : "";
  bookDesc.textContent = m.docs || "";
  apiWarning.textContent = m.apiWarning || "";
  apiWarning.classList.toggle("hidden", !m.apiWarning);

  if (m.thumb) {
    cover.src = m.thumb;
    cover.classList.remove("hidden");
  } else {
    cover.removeAttribute("src");
    cover.classList.add("hidden");
  }

  bookStats.innerHTML = "";
  addStat("书籍 ID", m.remoteId || data.bookId);
  addStat("章节", m.serial ? m.serial + "章" : data.chapters.length + "章");
  addStat("字数", formatWordCount(m.word_number));
  addStat("在读", m.read_count ? Number(m.read_count).toLocaleString() + "人" : "");

  rangeStart.value = "1";
  rangeStart.max = String(data.chapters.length);
  rangeEnd.value = String(data.chapters.length);
  rangeEnd.max = String(data.chapters.length);
  chapterHint.textContent = "共 " + data.chapters.length + " 章，显示前 " + Math.min(10, data.chapters.length) + " 章";

  chaptersEl.innerHTML = "";
  for (const chapter of data.chapters.slice(0, 10)) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "https://fanqienovel.com/reader/" + chapter.id;
    a.target = "_blank";
    a.textContent = chapter.title || chapter.id;
    li.appendChild(a);
    chaptersEl.appendChild(li);
  }
}

function addStat(label, value) {
  if (!value) return;
  var div = document.createElement("div");
  var dt = document.createElement("dt");
  var dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  div.append(dt, dd);
  bookStats.appendChild(div);
}

function formatWordCount(n) {
  if (!n) return "";
  var num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (num >= 10000) return (num / 10000).toFixed(1) + "万字";
  return num + "字";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;

  preview.classList.add("hidden");
  current = null;
  form.querySelector("button").disabled = true;
  setStatus("正在解析目录...");

  try {
    const res = await fetch("/api/book?input=" + encodeURIComponent(raw));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "解析失败");
    renderBook(data);
    setStatus("解析完成。长篇小说可能触发 Worker 请求限制，建议按范围分段导出。");
  } catch (error) {
    setStatus(error.message);
  } finally {
    form.querySelector("button").disabled = false;
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!current) {
    setStatus("请先解析小说。");
    return;
  }
  const start = Math.max(1, Number.parseInt(rangeStart.value || "1", 10));
  const end = Math.max(start, Number.parseInt(rangeEnd.value || String(current.chapters.length), 10));
  const total = Math.min(end, current.chapters.length) - start + 1;

  downloadBtn.disabled = true;
  const BATCH = 10;
  const totalBatches = Math.ceil(total / BATCH);
  const allParts = [];
  for (let i = start; i <= end; i += BATCH) {
    const batchEnd = Math.min(i + BATCH - 1, end);
    const batchNum = Math.floor((i - start) / BATCH) + 1;
    setStatus("正在下载第 " + batchNum + "/" + totalBatches + " 批（第 " + i + "-" + batchEnd + " 章）...");
    try {
      const params = new URLSearchParams({
        input: current.bookId,
        start: String(i),
        end: String(batchEnd)
      });
      const res = await fetch("/api/download?" + params.toString());
      if (!res.ok) throw new Error("批次下载失败: " + res.status);
      const txt = await res.text();
      const marker = "\\n========================================\\n";
      const mi = txt.indexOf(marker);
      if (mi >= 0) {
        allParts.push(txt.slice(mi + marker.length));
      } else {
        allParts.push(txt);
      }
    } catch (e) {
      allParts.push("　　[第 " + i + "-" + batchEnd + " 章下载失败：" + e.message + "]");
    }
    if (batchEnd < end) await new Promise(r => setTimeout(r, 500));
  }

  const header = "book_id=" + current.bookId + "\\n章节：" + current.chapters.length + "\\n导出范围：" + start + "-" + end + "\\n\\n========================================";
  const blob = new Blob([header + "\\n" + allParts.join("\\n----------------------------------------\\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (current.bookId || "novel") + ".txt";
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("下载完成，共 " + totalBatches + " 批 " + total + " 章。");
  downloadBtn.disabled = false;
});
`;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/") {
        return html(HTML);
      }
      if (request.method === "GET" && url.pathname === "/app.css") {
        return text(CSS, "text/css; charset=UTF-8");
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return text(JS, "application/javascript; charset=UTF-8");
      }
      if (request.method === "GET" && url.pathname === "/api/book") {
        return json(await loadBook(url.searchParams.get("input") || "", env));
      }
      if (request.method === "GET" && url.pathname === "/api/download") {
        return await downloadBook(request, ctx, env);
      }
      return text("Not found", "text/plain; charset=UTF-8", 404);
    } catch (error) {
      const message = error.message || String(error);
      const status = /请输入|无法解析|范围|格式|为空/.test(message) ? 400 : 500;
      return json({ error: message }, status);
    }
  }
};

async function downloadBook(request, ctx, env) {
  const url = new URL(request.url);
  const input = url.searchParams.get("input") || "";
  const book = await loadBook(input, env);
  const start = clampInt(url.searchParams.get("start"), 1, book.chapters.length, 1);
  const end = clampInt(url.searchParams.get("end"), start, book.chapters.length, book.chapters.length);
  const selected = book.chapters.slice(start - 1, end);

  if (selected.length === 0) {
    throw new Error("章节范围为空");
  }

  const chapters = await mapLimit(selected, 4, async (chapter) => {
    try {
      const raw = await fetchChapter(chapter.id, ctx, request.url);
      const title = raw.title || chapter.title || chapter.id;
      return {
        id: chapter.id,
        title,
        plain: cleanPlain(raw.content || "", title)
      };
    } catch (error) {
      return {
        id: chapter.id,
        title: chapter.title || chapter.id,
        plain: "　　[本章下载失败：" + (error.message || String(error)) + "]"
      };
    }
  });

  const filenameBase = safeFileName(book.meta.bookName || book.bookId);
  const body = buildTxt(book, chapters, start, end);
  return fileResponse(new TextEncoder().encode(body), filenameBase + ".txt", "text/plain; charset=UTF-8");
}

async function loadBook(input, env) {
  const bookId = parseBookId(input);
  const [chapters, info] = await Promise.all([
    fetchDirectory(bookId),
    fetchBookInfo(bookId, env)
  ]);
  return {
    bookId,
    meta: { bookName: info.title || bookId, ...info },
    chapters
  };
}

async function fetchBookInfo(bookId, env) {
  const key = env && env.OIAPI;
  if (!key) {
    return { title: bookId, apiWarning: "未配置 OIAPI 环境变量，无法获取小说信息。请在 Cloudflare Worker 设置中添加环境变量 OIAPI。" };
  }
  try {
    const url = "https://oiapi.net/api/FqRead?id=" + encodeURIComponent(bookId) + "&key=" + encodeURIComponent(key);
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT }
    });
    if (!res.ok) return { title: bookId, apiWarning: "小说信息接口返回 " + res.status };
    const json = await res.json();
    if (json.code !== 1 || !json.data) return { title: bookId, apiWarning: json.message || "接口返回异常" };
    const d = json.data;
    return {
      remoteId: d.id || bookId,
      title: d.title || bookId,
      author: d.author || "",
      docs: d.docs || "",
      thumb: d.thumb || "",
      serial: d.serial || 0,
      word_number: d.word_number || "",
      read_count: d.read_count || ""
    };
  } catch (e) {
    return { title: bookId, apiWarning: "获取小说信息失败：" + e.message };
  }
}

function parseBookId(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("请输入小说 ID 或链接");
  if (/^\d+$/.test(trimmed)) return trimmed;

  const target = trimmed.match(/https?:\/\/\S+/i)?.[0] || trimmed;
  const queryId = target.match(/[?&](?:book_id|bookId)=(\d+)/i)?.[1];
  if (queryId) return queryId;

  const pageId = target.match(/\/page\/(\d+)/i)?.[1];
  if (pageId) return pageId;

  throw new Error("无法解析小说 ID");
}

async function fetchDirectory(bookId) {
  const url = "https://fanqienovel.com/api/reader/directory/detail?bookId=" + encodeURIComponent(bookId);
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://fanqienovel.com/page/" + bookId,
      "user-agent": USER_AGENT
    }
  });
  if (!res.ok) throw new Error("获取目录失败：" + res.status);
  const data = await res.json();
  const array = findChapterArray(data);
  const chapters = [];
  const seen = new Set();
  for (const item of array) {
    const chapter = parseChapterRef(item);
    if (chapter && !seen.has(chapter.id)) {
      seen.add(chapter.id);
      chapters.push(chapter);
    }
  }
  if (!chapters.length) throw new Error("目录为空或无法解析章节");
  return chapters;
}

function findChapterArray(data) {
  const root = data?.data || data;
  const keys = ["chapterList", "chapter_list", "chapters", "item_list", "items", "list"];
  for (const key of keys) {
    if (Array.isArray(root?.[key])) return root[key];
  }
  if (Array.isArray(root?.chapterListWithVolume)) {
    return root.chapterListWithVolume.flatMap((group) => Array.isArray(group) ? group : []);
  }
  if (root?.data) {
    for (const key of keys) {
      if (Array.isArray(root.data[key])) return root.data[key];
    }
  }

  let best = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === "object" && pickString(item, ID_KEYS))) {
        if (value.length > best.length) best = value;
      }
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(root);
  return best;
}

const ID_KEYS = ["item_id", "itemId", "chapter_id", "chapterId", "catalog_id", "catalogId", "id"];
const TITLE_KEYS = ["title", "chapter_title", "chapterTitle", "name", "chapter_name"];

function parseChapterRef(value) {
  const maps = collectObjects(value);
  const idMap = maps.find((item) => pickString(item, ID_KEYS));
  const id = pickString(idMap, ID_KEYS);
  if (!id) return null;
  const title = pickString(idMap, TITLE_KEYS) || maps.map((item) => pickString(item, TITLE_KEYS)).find(Boolean) || id;
  return { id, title };
}

function collectObjects(value, out = []) {
  if (value && typeof value === "object") {
    if (!Array.isArray(value)) out.push(value);
    for (const child of Object.values(value)) collectObjects(child, out);
  }
  return out;
}

function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

async function fetchChapter(chapterId, ctx, requestUrl) {
  const cacheKey = new Request(new URL("/cache/chapter/" + encodeURIComponent(chapterId), requestUrl), {
    method: "GET"
  });
  const cached = await caches.default.match(cacheKey);
  if (cached) return await cached.json();

  const url = "https://tt.sjmyzq.cn/api/raw_full?item_id=" + encodeURIComponent(chapterId);
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": USER_AGENT
    }
  });
  if (!res.ok) throw new Error("正文接口失败：" + res.status);
  const data = await res.json();
  const payload = {
    title: data?.data?.title || data?.data?.origin_chapter_title || "",
    content: data?.data?.content || ""
  };
  if (!payload.content) throw new Error("正文为空");

  const response = json(payload, 200, {
    "cache-control": "public, max-age=604800"
  });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return payload;
}

function cleanPlain(raw, title = "") {
  const normalized = String(raw || "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n");
  const withoutTags = decodeEntities(normalized.replace(/<[^>]+>/g, ""));
  const lines = withoutTags
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const titleNorm = normalizeTitle(title);
  while (lines.length && titleNorm && normalizeTitle(lines[0]) === titleNorm) {
    lines.shift();
  }
  return lines.map((line) => "　　" + line).join("\n\n");
}

function buildTxt(book, chapters, start, end) {
  const lines = [];
  lines.push("书名：" + (book.meta.bookName || book.bookId));
  lines.push("book_id=" + book.bookId);
  lines.push("章节：" + book.chapters.length);
  lines.push("导出范围：" + start + "-" + end);
  lines.push("");
  lines.push("========================================");
  for (const chapter of chapters) {
    lines.push("");
    lines.push(chapter.title);
    lines.push("");
    lines.push(chapter.plain);
    lines.push("");
    lines.push("----------------------------------------");
  }
  return lines.join("\n");
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[：:，,。.!！?？]/g, "").trim();
}

function safeFileName(value) {
  return String(value || "novel").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "novel";
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function html(body) {
  return text(body, "text/html; charset=UTF-8");
}

function text(body, contentType, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "x-content-type-options": "nosniff"
    }
  });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function fileResponse(bytes, filename, contentType) {
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
