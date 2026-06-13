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
          <p>输入小说标题、小说 ID 或分享链接，预览目录后导出文件。</p>
        </div>
      </div>

      <form id="bookForm" class="query">
        <label for="bookInput">小说标题、ID 或链接</label>
        <div class="query-line">
          <input id="bookInput" name="input" autocomplete="off" placeholder="十日终焉 或 7143038691944959011 或 https://fanqienovel.com/page/7143038691944959011" required>
          <button type="submit">解析</button>
        </div>
      </form>

      <div id="status" class="status" role="status">等待输入。</div>

      <section id="searchResults" class="search-results hidden" aria-live="polite">
        <div class="chapter-title">
          <h3>搜索结果</h3>
          <span id="searchHint"></span>
        </div>
        <div id="resultList" class="result-list"></div>
      </section>

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
.search-results {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
.result-list {
  display: grid;
  gap: 10px;
}
.result-card {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
  align-items: start;
  width: 100%;
  min-height: 0;
  border: 1px solid #dde2dd;
  border-radius: 8px;
  padding: 10px;
  color: #17211f;
  background: #fbfcfa;
  text-align: left;
  cursor: pointer;
}
.result-card:hover {
  border-color: #9ed8ca;
  background: #f4faf7;
}
.result-thumb {
  width: 72px;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border: 1px solid #d8ddd7;
  border-radius: 6px;
  background: #edf0ec;
}
.result-main {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.result-title {
  font-weight: 760;
  overflow-wrap: anywhere;
}
.result-meta,
.result-desc {
  color: #57635f;
  font-size: 13px;
  line-height: 1.45;
}
.result-desc {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
li a:hover { color: #1f7668; text-decoration: none; }
@media (max-width: 760px) {
  .shell { width: min(100% - 20px, 1120px); margin: 10px auto; }
  .tool { padding: 16px; }
  .title-row, .book-head, .download-panel, .query-line {
    grid-template-columns: 1fr;
    display: grid;
  }
  .result-card {
    grid-template-columns: 64px 1fr;
  }
  ul { grid-template-columns: 1fr; }
}
`;

const JS = `
let current = null;

const form = document.getElementById("bookForm");
const input = document.getElementById("bookInput");
const statusEl = document.getElementById("status");
const searchResults = document.getElementById("searchResults");
const searchHint = document.getElementById("searchHint");
const resultList = document.getElementById("resultList");
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

async function loadBookInput(raw, message) {
  if (message) setStatus(message);
  const res = await fetch("/api/book?input=" + encodeURIComponent(raw));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "解析失败");
  if (data.type === "search") {
    renderSearchResults(data);
    setStatus(data.results.length ? "请选择要下载的小说。" : "没有搜索到匹配的小说。");
    return;
  }
  renderBook(data);
  setStatus("解析完成。长篇小说可能触发 Worker 请求限制，建议按范围分段导出。");
}

function renderSearchResults(data) {
  current = null;
  preview.classList.add("hidden");
  searchResults.classList.remove("hidden");
  searchHint.textContent = "共 " + data.results.length + " 本";
  resultList.innerHTML = "";

  for (const item of data.results) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "result-card";
    card.title = "解析《" + (item.title || item.id) + "》";

    const img = document.createElement("img");
    img.className = "result-thumb";
    img.alt = "";
    if (item.thumb) {
      img.src = item.thumb;
    }

    const main = document.createElement("div");
    main.className = "result-main";
    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = item.title || item.id;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = [
      item.author ? "作者：" + item.author : "",
      item.serial ? item.serial + "章" : "",
      formatWordCount(item.word_number),
      item.read_count ? Number(item.read_count).toLocaleString() + "人在读" : ""
    ].filter(Boolean).join(" · ");
    const desc = document.createElement("div");
    desc.className = "result-desc";
    desc.textContent = item.docs || "";
    main.append(title, meta, desc);

    card.append(img, main);
    card.addEventListener("click", async () => {
      form.querySelector("button").disabled = true;
      card.disabled = true;
      input.value = item.id;
      searchResults.classList.add("hidden");
      try {
        await loadBookInput(item.id, "正在解析《" + (item.title || item.id) + "》目录...");
      } catch (error) {
        setStatus(error.message);
      } finally {
        form.querySelector("button").disabled = false;
        card.disabled = false;
      }
    });
    resultList.appendChild(card);
  }
}

function renderBook(data) {
  current = data;
  searchResults.classList.add("hidden");
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
  addStat("分类", m.category);
  addStat("评分", m.score ? m.score + "分" : "");
  addStat("字数", formatWordCount(m.word_number));
  addStat("章节", m.serial ? m.serial + "章" : data.chapters.length + "章");
  addStat("状态", m.update_status === "1" ? "连载中" : m.update_status === "2" ? "已完结" : "");
  addStat("当前在读", m.read_count ? Number(m.read_count).toLocaleString() : "");
  addStat("累计阅读", m.reader_uv_sum_daily ? Number(m.reader_uv_sum_daily).toLocaleString() : "");
  addStat("近14天阅读", m.reader_uv_14day ? Number(m.reader_uv_14day).toLocaleString() : "");
  addStat("总收藏量", m.all_bookshelf_count ? Number(m.all_bookshelf_count).toLocaleString() : "");
  addStat("听书人数", m.listen_count ? Number(m.listen_count).toLocaleString() : "");
  addStat("创建时间", m.create_time ? m.create_time.slice(0, 10) : "");
  addStat("最后更新", m.last_publish_time);

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
    a.rel = "noopener noreferrer";
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
  searchResults.classList.add("hidden");
  current = null;
  form.querySelector("button").disabled = true;

  try {
    await loadBookInput(raw, "正在解析...");
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
  const maxChapter = current.chapters.length;
  const startInput = Number.parseInt(rangeStart.value || "1", 10);
  const endInput = Number.parseInt(rangeEnd.value || String(maxChapter), 10);
  const start = Math.min(maxChapter, Math.max(1, Number.isFinite(startInput) ? startInput : 1));
  const end = Math.min(maxChapter, Math.max(start, Number.isFinite(endInput) ? endInput : maxChapter));
  const total = end - start + 1;
  rangeStart.value = String(start);
  rangeEnd.value = String(end);

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
      allParts.push(txt);
    } catch (e) {
      allParts.push("\\n[第 " + i + "-" + batchEnd + " 章下载失败：" + e.message + "]");
    }
    if (batchEnd < end) await new Promise(r => setTimeout(r, 500));
  }

  const header = (current.meta && current.meta.docs ? "简介\\n" + current.meta.docs + "\\n\\n----------------------------------------\\n" : "");
  const blob = new Blob([header + allParts.join("")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = (current.meta && current.meta.title ? current.meta.title + (current.meta.author ? " 作者：" + current.meta.author : "") : current.bookId) || "novel";
  a.download = name + ".txt";
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
        return json(await loadBook(url.searchParams.get("input") || "", env, ctx, request.url));
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
  const book = await loadBook(input, env, ctx, request.url);
  if (book.type === "search") {
    throw new Error("请先从搜索结果中选择一本小说");
  }
  const start = clampInt(url.searchParams.get("start"), 1, book.chapters.length, 1);
  const end = clampInt(url.searchParams.get("end"), start, book.chapters.length, book.chapters.length);
  const selected = book.chapters.slice(start - 1, end);

  if (selected.length === 0) {
    throw new Error("章节范围为空");
  }

  const chapters = await mapLimit(selected, 4, async (chapter) => {
    try {
      const { content } = await fetchChapter(chapter.id, ctx, request.url);
      const title = chapter.title || chapter.id;
      return {
        id: chapter.id,
        title,
        plain: cleanPlain(content || "")
      };
    } catch (error) {
      return {
        id: chapter.id,
        title: chapter.title || chapter.id,
        plain: "[本章下载失败：" + (error.message || String(error)) + "]"
      };
    }
  });

  const filenameBase = safeFileName(book.meta.bookName || book.bookId);
  const body = buildTxt(chapters);
  return fileResponse(new TextEncoder().encode(body), filenameBase + ".txt", "text/plain; charset=UTF-8");
}

async function loadBook(input, env, ctx, requestUrl) {
  const bookId = parseBookId(input);
  if (!bookId) {
    return await searchBooks(input, env, ctx, requestUrl);
  }
  const cacheKey = ctx && requestUrl
    ? new Request(new URL("/cache/book/" + encodeURIComponent(bookId), requestUrl), {
        method: "GET"
      })
    : null;
  if (cacheKey) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return await cached.json();
  }

  const [chapters, info] = await Promise.all([
    fetchDirectory(bookId),
    fetchBookInfo(bookId)
  ]);
  const book = {
    bookId,
    meta: { bookName: info.title || bookId, ...info },
    chapters
  };
  if (cacheKey) {
    const response = json(book, 200, {
      "cache-control": "public, max-age=1800"
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  }
  return book;
}

async function fetchBookInfo(bookId) {
  try {
    const url = "https://tt.sjmyzq.cn/api/detail?book_id=" + encodeURIComponent(bookId);
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT }
    });
    if (!res.ok) return { title: bookId, apiWarning: "书籍信息接口返回 " + res.status };
    const body = await res.json();
    const d = body?.data?.data;
    if (!d) return { title: bookId, apiWarning: "接口返回异常" };
    return {
      title: d.book_name || bookId,
      author: d.author || "",
      docs: d.abstract || "",
      thumb: d.thumb_url || "",
      serial: d.serial_count || 0,
      word_number: d.word_number || "",
      read_count: d.read_count || "",
      category: d.category || "",
      score: d.score || "",
      update_status: d.status || "",
      reader_uv_sum_daily: d.reader_uv_sum_daily || "",
      reader_uv_14day: d.reader_uv_14day || "",
      all_bookshelf_count: d.all_bookshelf_count || "",
      listen_count: d.listen_count || "",
      create_time: d.create_time || "",
      last_publish_time: d.last_publish_time ? new Date(Number(d.last_publish_time) * 1000).toISOString().slice(0, 10) : ""
    };
  } catch (e) {
    return { title: bookId, apiWarning: "获取书籍信息失败：" + e.message };
  }
}

async function searchBooks(input, env, ctx, requestUrl) {
  const keyword = String(input || "").trim();
  if (!keyword) throw new Error("请输入小说标题、ID 或链接");

  const cacheKey = ctx && requestUrl
    ? new Request(new URL("/cache/search/" + encodeURIComponent(keyword) + "?meta=" + (env.OIAPI ? "1" : "0"), requestUrl), {
        method: "GET"
      })
    : null;
  if (cacheKey) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return await cached.json();
  }

  const key = env.OIAPI;
  if (!key) {
    throw new Error("未配置 OIAPI 环境变量，无法按标题搜索小说");
  }

  const url = "https://oiapi.net/api/FqRead?keyword=" + encodeURIComponent(keyword) + "&key=" + encodeURIComponent(key);
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT }
  });
  if (!res.ok) throw new Error("搜索接口返回 " + res.status);

  const data = await res.json();
  if (data.code !== 1 || !Array.isArray(data.data)) {
    throw new Error(data.message || "搜索接口返回异常");
  }

  const result = {
    type: "search",
    keyword,
    results: data.data.map(normalizeSearchBook).filter((item) => item.id)
  };
  if (cacheKey) {
    const response = json(result, 200, {
      "cache-control": "public, max-age=1800"
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  }
  return result;
}

function normalizeSearchBook(item) {
  return {
    id: pickString(item, ["id", "book_id", "bookId"]),
    title: pickString(item, ["title", "book_name", "bookName", "name"]),
    author: pickString(item, ["author", "author_name", "authorName"]),
    docs: pickString(item, ["docs", "abstract", "description", "desc"]),
    thumb: pickString(item, ["thumb", "cover", "cover_url", "coverUrl"]),
    serial: pickString(item, ["serial", "chapter_count", "chapterCount"]),
    word_number: pickString(item, ["word_number", "wordNumber", "words"]),
    read_count: pickString(item, ["read_count", "readCount"])
  };
}

function parseBookId(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return trimmed;

  const target = trimmed.match(/https?:\/\/\S+/i)?.[0] || trimmed;
  const pageId = target.match(/\/page\/(\d+)/i)?.[1];
  if (pageId) return pageId;

  return "";
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
  const list = data?.data?.chapterListWithVolume;
  if (!Array.isArray(list) || !list.length) throw new Error("目录为空或无法解析章节");
  const chapters = [];
  for (const volume of list) {
    for (const item of volume) {
      const id = item?.itemId || "";
      const title = item?.title || id;
      if (id) chapters.push({ id, title });
    }
  }
  if (!chapters.length) throw new Error("目录为空或无法解析章节");
  return chapters;
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
  const content = data?.data?.content || "";
  if (!content) throw new Error("正文为空");

  const response = json({ content }, 200, {
    "cache-control": "public, max-age=604800"
  });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return { content };
}

function cleanPlain(raw) {
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const lines = [];
  let match;
  while ((match = pRegex.exec(raw)) !== null) {
    const text = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
    if (text) lines.push("　　" + text);
  }
  return lines.join("\n\n");
}

function buildTxt(chapters) {
  const lines = [];
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
