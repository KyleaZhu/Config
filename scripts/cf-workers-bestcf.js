const CONFIGS = {
  "0 1,4,7,10,13,16,19,22 * * *": { subdomain: "cm.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cmcc-ip.txt" },
  "5 1,4,7,10,13,16,19,22 * * *": { subdomain: "ct.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/ctcc-ip.txt" },
  "10 1,4,7,10,13,16,19,22 * * *": { subdomain: "cu.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cucc-ip.txt" }
};

const DASHBOARD_LIST = [
  { 
    name: "中国移动", 
    subdomain: "cm.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cmcc-ip.txt",
    bgClass: "bg-blue-50/80 border-blue-100",
    logoUrl: "https://testingcf.jsdelivr.net/gh/KyleaZhu/Config@main/bestcf/cmcc.svg"
  },
  { 
    name: "中国电信", 
    subdomain: "ct.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/ctcc-ip.txt",
    bgClass: "bg-cyan-50/80 border-cyan-100",
    logoUrl: "https://testingcf.jsdelivr.net/gh/KyleaZhu/Config@main/bestcf/ctcc.svg"
  },
  { 
    name: "中国联通", 
    subdomain: "cu.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cucc-ip.txt",
    bgClass: "bg-red-50/80 border-red-100",
    logoUrl: "https://testingcf.jsdelivr.net/gh/KyleaZhu/Config@main/bestcf/cucc.svg"
  }
];

export default {
  async scheduled(event, env, ctx) {
    const config = CONFIGS[event.cron];
    if (config) {
      ctx.waitUntil(syncDomain(config.subdomain, config.url, env));
    }
  },

  async fetch(request, env, ctx) {
    try {
      if (!env.CF_API_TOKEN || !env.ZONE_ID) {
        return new Response("Error: Missing env variables.", { status: 500 });
      }

      const reports = [];
      let allSynced = true;

      for (const item of DASHBOARD_LIST) {
        const ghRes = await fetch(item.url);
        const ghText = ghRes.ok ? await ghRes.text() : "";
        const ghIPs = parseIPs(ghText);

        const cfUrl = `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records?name=${item.subdomain}&per_page=100`;
        const cfRes = await fetch(cfUrl, { headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` } });
        const cfData = cfRes.ok ? await cfRes.json() : { result: [] };
        const cfRecords = (cfData.result || []).filter(r => r.type === 'A' || r.type === 'AAAA');

        const isMatch = ghIPs.length === cfRecords.length && ghIPs.every(n =>
          cfRecords.some(e => e.type === n.type && e.content.toLowerCase() === n.content.toLowerCase())
        );

        if (!isMatch) allSynced = false;

        let lastModified = "暂无记录";
        if (cfRecords.length > 0) {
          const times = cfRecords.map(r => new Date(r.modified_on).getTime());
          lastModified = new Date(Math.max(...times)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
        }

        reports.push({
          ...item,
          inSync: isMatch,
          githubCount: ghIPs.length,
          cfCount: cfRecords.length,
          lastUpdate: lastModified
        });
      }

      return new Response(renderPremiumHTML(reports, allSynced), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });

    } catch (err) {
      return new Response(`Server Error: ${err.message}`, { status: 500 });
    }
  }
};

async function syncDomain(subdomain, url, env) {
  const response = await fetch(url);
  if (!response.ok) return;
  const text = await response.text();
  const newRecords = parseIPs(text);

  const cfUrl = `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records?name=${subdomain}&per_page=100`;
  const cfRes = await fetch(cfUrl, { headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` } });
  const cfData = await cfRes.json();
  const existingRecords = cfData.result.filter(r => r.type === 'A' || r.type === 'AAAA');

  const toDelete = existingRecords.filter(e => !newRecords.some(n => n.type === e.type && n.content.toLowerCase() === e.content.toLowerCase()));
  const toAdd = newRecords.filter(n => !existingRecords.some(e => e.type === n.type && e.content.toLowerCase() === n.content.toLowerCase()));

  const deletePromises = toDelete.map(r => fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records/${r.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` } }));
  const addPromises = toAdd.map(r => fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: r.type, name: subdomain, content: r.content, ttl: 1, proxied: false })
  }));

  await Promise.all([...deletePromises, ...addPromises]);
}

function parseIPs(text) {
  const lines = text.split('\n');
  const records = [];
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const ipPart = line.split('#')[0].trim();
    if (!ipPart) continue;
    if (ipPart.includes('[')) {
      const match = ipPart.match(/\[(.*?)\]/);
      if (match) records.push({ type: 'AAAA', content: match[1] });
    } else if (ipPart.includes(':')) {
      if ((ipPart.match(/:/g) || []).length > 1) {
        records.push({ type: 'AAAA', content: ipPart });
      } else {
        records.push({ type: 'A', content: ipPart.split(':')[0] });
      }
    } else if (ipPart.includes('.')) {
      records.push({ type: 'A', content: ipPart });
    }
  }
  return records;
}

function renderPremiumHTML(reports, allSynced) {
  const cards = reports.map(r => {
    const statusBadge = r.inSync 
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> 已同步
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
           <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-spin"></span> 待更新
         </span>`;

    return `
      <div class="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 flex flex-col justify-between">
        <div>
          <!-- Card Header -->
          <div class="flex items-center justify-between mb-5">
            <div class="flex items-center gap-3">
              <div class="h-9 px-3 rounded-xl border ${r.bgClass} flex items-center justify-center overflow-hidden">
                <img src="${r.logoUrl}" class="h-4 md:h-4.5 object-contain" alt="${r.name}" />
              </div>
              <h3 class="text-base font-semibold text-slate-800">${r.name}</h3>
            </div>
            ${statusBadge}
          </div>
          
          <div class="mb-5 relative group/copy">
            <p class="text-xs text-slate-400 mb-1.5 font-medium tracking-wide uppercase">解析子域名</p>
            <div onclick="copyText('${r.subdomain}', this)" class="cursor-pointer relative flex items-center justify-between bg-slate-50 hover:bg-slate-100/70 border border-slate-100/70 hover:border-slate-200 px-3 py-2 rounded-xl transition-all duration-200">
              <code class="text-xl font-bold text-slate-900 font-mono break-all tracking-tight select-none">${r.subdomain}</code>
              <svg class="w-4 h-4 text-slate-400 group-hover/copy:text-slate-600 flex-shrink-0 ml-2 transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-6a2 2 0 00-2 2zM8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>
              
              <span class="toast-msg absolute right-10 bg-slate-900 text-white text-[11px] font-medium px-2 py-1 rounded-md opacity-0 scale-95 transition-all duration-200 pointer-events-none shadow-md">已复制 !</span>
            </div>
          </div>

          <!-- Data Grid -->
          <div class="grid grid-cols-2 gap-3 mb-6">
            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-3">
              <p class="text-[11px] text-slate-400 font-medium mb-0.5">GitHub 源数据</p>
              <p class="text-xl font-bold text-slate-700 font-mono">${r.githubCount} <span class="text-xs font-normal text-slate-400">IPs</span></p>
            </div>
            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-3">
              <p class="text-[11px] text-slate-400 font-medium mb-0.5">Cloudflare 解析</p>
              <p class="text-xl font-bold text-slate-700 font-mono">${r.cfCount} <span class="text-xs font-normal text-slate-400">IPs</span></p>
            </div>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            最近同步时间
          </span>
          <span class="font-medium text-slate-600 font-mono">${r.lastUpdate}</span>
        </div>
      </div>
    `;
  }).join('');

  const globalStatusBadge = allSynced
    ? `<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shadow-sm">
         <span class="relative flex h-2 w-2">
           <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
           <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
         </span>
         所有网络节点运行正常
       </div>`
    : `<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200 shadow-sm">
         <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> 正在等待同步
       </div>`;

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cloudflare 优选域名自动化平台</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; background-color: #fafbfc; }
      </style>
      <script>
        function copyText(text, element) {
          navigator.clipboard.writeText(text).then(() => {
            const toast = element.querySelector('.toast-msg');
            if (toast) {
              toast.classList.remove('opacity-0', 'scale-95');
              toast.classList.add('opacity-100', 'scale-100');
              setTimeout(() => {
                toast.classList.remove('opacity-100', 'scale-100');
                toast.classList.add('opacity-0', 'scale-95');
              }, 1200);
            }
          });
        }
      </script>
    </head>
    <body class="antialiased text-slate-600 min-h-screen flex flex-col justify-between">
      
      <div class="max-w-6xl mx-auto w-full px-4 py-12 md:py-16">
        <!-- Dashboard Header -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-8 mb-10">
          <div>
            <div class="flex items-center gap-2.5 mb-2">
              <span class="text-2xl">☁️</span>
              <h1 class="text-xl md:text-2xl font-bold tracking-tight text-slate-900">三网优选域名</h1>
            </div>
            <p class="text-sm text-slate-400 max-w-xl">基于 Workers 构建，每日优选三网 Cloudflare IP。</p>
          </div>
          <div class="self-start md:self-center">
            ${globalStatusBadge}
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${cards}
        </div>
      </div>

      <!-- Footer -->
      <footer class="w-full text-center py-6 text-xs text-slate-400 border-t border-slate-100 bg-white">
        <div>每日构建 · Edge Network Status Page</div>
      </footer>

    </body>
    </html>
  `;
}
