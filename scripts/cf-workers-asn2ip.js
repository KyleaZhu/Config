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
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            bg: "#f4f6f8",
            panel: "#ffffff",
            ink: "#17202a",
            muted: "#667085",
            line: "#d9dee7",
            accent: { DEFAULT: "#1877f2", hover: "#0f63d6" },
            danger: "#b42318",
            ok: "#067647",
          },
          fontFamily: {
            sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
            mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace'],
          },
          boxShadow: {
            panel: "0 10px 32px rgba(16, 24, 40, 0.07)",
          },
        },
      },
    };
  </script>
  <style type="text/tailwindcss">
    @layer base {
      html { color-scheme: light; }
      body { @apply bg-bg text-ink font-sans; }
      textarea { @apply font-mono; }
      *:focus-visible { @apply outline-none; }
    }
  </style>
</head>
<body class="min-h-screen p-5">
  <main class="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-[1360px] gap-4
               grid-cols-1 grid-rows-none
               md:grid-cols-[minmax(280px,420px)_minmax(320px,1fr)]
               md:grid-rows-[minmax(320px,1fr)_minmax(320px,1fr)]">

    <!-- 左上：ASN 转 CIDR -->
    <section class="flex flex-col rounded-lg border border-line bg-panel p-4 shadow-panel md:p-[18px]">
      <h2 class="text-lg font-semibold tracking-tight">ASN 转 CIDR</h2>
      <p class="mt-2 mb-4 text-sm leading-relaxed text-muted">输入 ASN。点击获取后，右侧窗口显示该 ASN 的 CIDR 列表。</p>

      <label for="asnInput" class="mb-2 block text-sm font-semibold">ASN</label>
      <input id="asnInput" type="text" spellcheck="false" autocomplete="off" placeholder="AS906"
             class="w-full rounded-md border border-line bg-white px-3 py-3 font-mono text-sm text-ink outline-none
                    focus:border-accent focus:ring-2 focus:ring-accent/14">

      <div class="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <span></span>
        <div class="flex flex-wrap gap-2">
          <button id="fetchAsnButton" type="button"
                  class="rounded-md bg-accent px-3.5 py-2.5 font-bold whitespace-nowrap text-white transition-colors
                         hover:bg-accent-hover disabled:cursor-wait disabled:opacity-72">获取 CIDR</button>
          <button id="clearAsnButton" type="button"
                  class="rounded-md bg-[#eef2f7] px-3.5 py-2.5 font-bold whitespace-nowrap text-ink transition-colors
                         hover:bg-[#e3e8ef]">清空</button>
        </div>
      </div>

      <div id="asnMessage" class="status mt-3 min-h-[22px] text-sm text-muted" role="status" aria-live="polite"></div>
    </section>

    <!-- 右上：CIDR 结果 -->
    <section class="flex flex-col rounded-lg border border-line bg-panel p-4 shadow-panel md:p-[18px]">
      <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 class="text-lg font-semibold tracking-tight">CIDR 结果</h2>
          <p id="asnCountText" class="mt-1 text-sm text-muted">等待获取</p>
        </div>
        <button id="copyAsnCidrButton" type="button"
                class="rounded-md bg-accent px-3.5 py-2.5 font-bold whitespace-nowrap text-white transition-colors
                       hover:bg-accent-hover disabled:cursor-wait disabled:opacity-72">复制全部</button>
      </div>
      <textarea id="asnCidrResultText" spellcheck="false" readonly
                placeholder="获取到的 CIDR 会显示在这里，每行一个。"
                class="min-h-[220px] flex-1 resize-none rounded-md border border-line bg-white px-3 py-3 font-mono text-sm
                       text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/14 md:min-h-[300px]"></textarea>
    </section>

    <!-- 左下：CIDR 转 IP -->
    <section class="flex flex-col rounded-lg border border-line bg-panel p-4 shadow-panel md:p-[18px]">
      <h2 class="text-lg font-semibold tracking-tight">CIDR 转 IP</h2>
      <p class="mt-2 mb-4 text-sm leading-relaxed text-muted">输入一个或多个 CIDR，每行一个。点击转换后，右侧窗口显示全部 IP。</p>

      <label for="cidrInput" class="mb-2 block text-sm font-semibold">CIDR</label>
      <textarea id="cidrInput" spellcheck="false" placeholder="45.59.184.0/22"
                class="min-h-[150px] flex-1 resize-y rounded-md border border-line bg-white px-3 py-3 font-mono text-sm
                       text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/14"></textarea>

      <div class="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <label class="inline-flex select-none items-center gap-2 text-sm text-muted">
          <input id="usableOnly" type="checkbox" class="h-4 w-4">
          只输出可用主机 IP
        </label>
        <div class="flex flex-wrap gap-2">
          <button id="convertButton" type="button"
                  class="rounded-md bg-accent px-3.5 py-2.5 font-bold whitespace-nowrap text-white transition-colors
                         hover:bg-accent-hover disabled:cursor-wait disabled:opacity-72">转换</button>
          <button id="clearCidrButton" type="button"
                  class="rounded-md bg-[#eef2f7] px-3.5 py-2.5 font-bold whitespace-nowrap text-ink transition-colors
                         hover:bg-[#e3e8ef]">清空</button>
        </div>
      </div>

      <div id="cidrMessage" class="status mt-3 min-h-[22px] text-sm text-muted" role="status" aria-live="polite"></div>
    </section>

    <!-- 右下：IP 结果 -->
    <section class="flex flex-col rounded-lg border border-line bg-panel p-4 shadow-panel md:p-[18px]">
      <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 class="text-lg font-semibold tracking-tight">IP 结果</h2>
          <p id="ipCountText" class="mt-1 text-sm text-muted">等待转换</p>
        </div>
        <button id="copyIpButton" type="button"
                class="rounded-md bg-accent px-3.5 py-2.5 font-bold whitespace-nowrap text-white transition-colors
                       hover:bg-accent-hover disabled:cursor-wait disabled:opacity-72">复制全部</button>
      </div>
      <textarea id="ipResultText" spellcheck="false" readonly
                placeholder="转换后的 IP 会显示在这里，每行一个。"
                class="min-h-[220px] flex-1 resize-none rounded-md border border-line bg-white px-3 py-3 font-mono text-sm
                       text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/14 md:min-h-[300px]"></textarea>
    </section>
  </main>

  <style>
    /* 状态色：JS 用 "status error/ok" 字符串切类名，Tailwind CDN 无法运行时拼缀，故保留语义化片段 */
    .status.error { color: #b42318; }
    .status.ok { color: #067647; }
  </style>

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
