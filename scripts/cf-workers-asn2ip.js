export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/asn") {
      return getAsnCidrs(url);
    }

    return new Response(HTML, {
      headers: {
        "content-type": "text/html; charset=UTF-8",
      },
    });
  },
};

async function getAsnCidrs(url) {
  const input = (url.searchParams.get("asn") || "").trim().toUpperCase();
  const match = input.match(/^(?:AS)?(\d+)$/);

  if (!match) {
    return textResponse("ASN 格式错误，例如 AS906 或 906", 400);
  }

  const asn = "AS" + match[1];
  const apiUrl = "https://asn.ipinfo.app/api/text/list/" + encodeURIComponent(asn);
  const upstream = await fetch(apiUrl, {
    headers: {
      "accept": "text/plain",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    return textResponse(text || "获取 ASN CIDR 失败", upstream.status);
  }

  return new Response(text.trim(), {
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

function textResponse(text, status) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
    },
  });
}

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ASN2IP 工具</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #1877f2;
      --accent-hover: #0f63d6;
      --danger: #b42318;
      --ok: #067647;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 20px;
    }

    main {
      width: min(1360px, 100%);
      min-height: calc(100vh - 40px);
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(280px, 420px) minmax(320px, 1fr);
      grid-template-rows: minmax(320px, 1fr) minmax(320px, 1fr);
      gap: 16px;
    }

    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      min-width: 0;
      box-shadow: 0 10px 32px rgba(16, 24, 40, 0.07);
      display: flex;
      flex-direction: column;
    }

    h1,
    h2 {
      margin: 0;
      letter-spacing: 0;
      line-height: 1.25;
    }

    h1 {
      font-size: 24px;
    }

    h2 {
      font-size: 18px;
    }

    p {
      margin: 8px 0 18px;
      color: var(--muted);
      line-height: 1.55;
      font-size: 14px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 650;
    }

    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      color: var(--text);
      background: #fff;
      font: 14px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
      outline: none;
    }

    input:focus,
    textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.14);
    }

    #cidrInput {
      min-height: 150px;
      resize: vertical;
    }

    #ipResultText,
    #asnCidrResultText {
      flex: 1;
      min-height: 220px;
      resize: none;
    }

    .controls,
    .result-header {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin-top: 14px;
    }

    .result-header {
      margin: 0 0 10px;
    }

    .option {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 14px;
      user-select: none;
    }

    .option input {
      width: 16px;
      height: 16px;
    }

    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: white;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    button:hover {
      background: var(--accent-hover);
    }

    button:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    button.secondary {
      background: #eef2f7;
      color: var(--text);
    }

    button.secondary:hover {
      background: #e3e8ef;
    }

    .status {
      min-height: 22px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 14px;
    }

    .status.error {
      color: var(--danger);
    }

    .status.ok {
      color: var(--ok);
    }

    @media (max-width: 820px) {
      body {
        padding: 12px;
      }

      main {
        min-height: auto;
        grid-template-columns: 1fr;
        grid-template-rows: none;
      }

      #ipResultText,
      #asnCidrResultText {
        min-height: 300px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section>
      <h2>ASN 转 CIDR</h2>
      <p>输入 ASN。点击获取后，右侧窗口显示该 ASN 的 CIDR 列表。</p>

      <label for="asnInput">ASN</label>
      <input id="asnInput" type="text" spellcheck="false" placeholder="AS906">

      <div class="controls">
        <span></span>
        <div class="buttons">
          <button id="fetchAsnButton" type="button">获取 CIDR</button>
          <button id="clearAsnButton" class="secondary" type="button">清空</button>
        </div>
      </div>

      <div id="asnMessage" class="status" role="status" aria-live="polite"></div>
    </section>

    <section>
      <div class="result-header">
        <div>
          <h2>CIDR 结果</h2>
          <p id="asnCountText">等待获取</p>
        </div>
        <button id="copyAsnCidrButton" type="button">复制全部</button>
      </div>

      <textarea id="asnCidrResultText" spellcheck="false" readonly placeholder="获取到的 CIDR 会显示在这里，每行一个。"></textarea>
    </section>

    <section>
      <h2>CIDR 转 IP</h2>
      <p>输入一个或多个 CIDR，每行一个。点击转换后，右侧窗口显示全部 IP。</p>

      <label for="cidrInput">CIDR</label>
      <textarea id="cidrInput" spellcheck="false" placeholder="45.59.184.0/22"></textarea>

      <div class="controls">
        <label class="option">
          <input id="usableOnly" type="checkbox">
          只输出可用主机 IP
        </label>
        <div class="buttons">
          <button id="convertButton" type="button">转换</button>
          <button id="clearCidrButton" class="secondary" type="button">清空</button>
        </div>
      </div>

      <div id="cidrMessage" class="status" role="status" aria-live="polite"></div>
    </section>

    <section>
      <div class="result-header">
        <div>
          <h2>IP 结果</h2>
          <p id="ipCountText">等待转换</p>
        </div>
        <button id="copyIpButton" type="button">复制全部</button>
      </div>

      <textarea id="ipResultText" spellcheck="false" readonly placeholder="转换后的 IP 会显示在这里，每行一个。"></textarea>
    </section>
  </main>

  <script>
    const asnInput = document.getElementById("asnInput");
    const asnMessage = document.getElementById("asnMessage");
    const asnCountText = document.getElementById("asnCountText");
    const asnCidrResultText = document.getElementById("asnCidrResultText");
    const fetchAsnButton = document.getElementById("fetchAsnButton");
    const clearAsnButton = document.getElementById("clearAsnButton");
    const copyAsnCidrButton = document.getElementById("copyAsnCidrButton");

    const cidrInput = document.getElementById("cidrInput");
    const usableOnly = document.getElementById("usableOnly");
    const cidrMessage = document.getElementById("cidrMessage");
    const ipCountText = document.getElementById("ipCountText");
    const ipResultText = document.getElementById("ipResultText");
    const convertButton = document.getElementById("convertButton");
    const clearCidrButton = document.getElementById("clearCidrButton");
    const copyIpButton = document.getElementById("copyIpButton");

    fetchAsnButton.addEventListener("click", fetchAsnCidrs);
    clearAsnButton.addEventListener("click", clearAsn);
    copyAsnCidrButton.addEventListener("click", () => copyText(asnCidrResultText, copyAsnCidrButton, asnMessage, "已复制全部 CIDR。"));
    asnInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        fetchAsnCidrs();
      }
    });

    convertButton.addEventListener("click", convertCidrToIp);
    clearCidrButton.addEventListener("click", clearCidr);
    copyIpButton.addEventListener("click", () => copyText(ipResultText, copyIpButton, cidrMessage, "已复制全部 IP。"));

    async function fetchAsnCidrs() {
      const asn = asnInput.value.trim();
      setStatus(asnMessage, "");

      if (!/^(?:AS)?\\d+$/i.test(asn)) {
        setStatus(asnMessage, "ASN 格式错误，例如 AS906 或 906。", "error");
        return;
      }

      fetchAsnButton.disabled = true;
      fetchAsnButton.textContent = "获取中";
      asnCountText.textContent = "正在获取";

      try {
        const response = await fetch("/api/asn?asn=" + encodeURIComponent(asn));
        const text = await response.text();

        if (!response.ok) {
          throw new Error(text || "获取失败。");
        }

        const cidrs = text
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        asnCidrResultText.value = cidrs.join("\\n");
        asnCountText.textContent = "共 " + cidrs.length + " 个 CIDR";
        setStatus(asnMessage, "");
      } catch (error) {
        asnCidrResultText.value = "";
        asnCountText.textContent = "获取失败";
        setStatus(asnMessage, error.message, "error");
      } finally {
        fetchAsnButton.disabled = false;
        fetchAsnButton.textContent = "获取 CIDR";
      }
    }

    function convertCidrToIp() {
      setStatus(cidrMessage, "");

      try {
        const cidrs = cidrInput.value
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (cidrs.length === 0) {
          throw new Error("请输入至少一个 CIDR。");
        }

        const lines = [];
        for (const cidr of cidrs) {
          lines.push(...expandCidr(cidr, usableOnly.checked));
        }

        ipResultText.value = lines.join("\\n");
        ipCountText.textContent = "共 " + lines.length + " 个 IP";
        setStatus(cidrMessage, "");
      } catch (error) {
        ipResultText.value = "";
        ipCountText.textContent = "转换失败";
        setStatus(cidrMessage, error.message, "error");
      }
    }

    function clearAsn() {
      asnInput.value = "";
      asnCidrResultText.value = "";
      asnCountText.textContent = "等待获取";
      setStatus(asnMessage, "");
      asnInput.focus();
    }

    function clearCidr() {
      cidrInput.value = "";
      ipResultText.value = "";
      ipCountText.textContent = "等待转换";
      setStatus(cidrMessage, "");
      cidrInput.focus();
    }

    async function copyText(textarea, button, statusNode, successText) {
      if (!textarea.value) {
        setStatus(statusNode, "还没有可复制的结果。", "error");
        return;
      }

      textarea.focus();
      textarea.select();

      try {
        await navigator.clipboard.writeText(textarea.value);
        button.textContent = "已复制";
        setStatus(statusNode, successText, "ok");
        setTimeout(() => {
          button.textContent = "复制全部";
        }, 1200);
      } catch (error) {
        document.execCommand("copy");
        setStatus(statusNode, "已选中结果，可按 Ctrl+C 复制。", "ok");
      }
    }

    function setStatus(node, text, type) {
      node.textContent = text;
      node.className = type ? "status " + type : "status";
    }

    function expandCidr(cidr, onlyUsable) {
      const match = cidr.match(/^(\\d{1,3}(?:\\.\\d{1,3}){3})\\/(\\d|[12]\\d|3[0-2])$/);
      if (!match) {
        throw new Error("格式错误：" + cidr);
      }

      const base = ipToNumber(match[1]);
      const prefix = Number(match[2]);
      const hostCount = 2 ** (32 - prefix);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const start = (base & mask) >>> 0;
      const end = (start + hostCount - 1) >>> 0;

      let first = start;
      let last = end;

      if (onlyUsable && prefix <= 30) {
        first = start + 1;
        last = end - 1;
      }

      if (last < first) {
        return [];
      }

      const ips = [];
      for (let current = first; current <= last; current += 1) {
        ips.push(numberToIp(current));
      }

      return ips;
    }

    function ipToNumber(ip) {
      const parts = ip.split(".").map(Number);
      for (const part of parts) {
        if (!Number.isInteger(part) || part < 0 || part > 255) {
          throw new Error("IP 地址错误：" + ip);
        }
      }

      return (
        ((parts[0] << 24) >>> 0) +
        (parts[1] << 16) +
        (parts[2] << 8) +
        parts[3]
      ) >>> 0;
    }

    function numberToIp(number) {
      return [
        (number >>> 24) & 255,
        (number >>> 16) & 255,
        (number >>> 8) & 255,
        number & 255,
      ].join(".");
    }
  </script>
</body>
</html>`;
