const DOMAINS = [
  { 
    name: "中国移动", 
    subdomain: "cm.bestcf.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cmcc-ip.txt",
    bgClass: "bg-blue-50/80 border-blue-100"
  },
  { 
    name: "中国电信", 
    subdomain: "ct.bestcf.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/ctcc-ip.txt",
    bgClass: "bg-cyan-50/80 border-cyan-100"
  },
  { 
    name: "中国联通", 
    subdomain: "cu.bestcf.xdu.qzz.io", 
    url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cucc-ip.txt",
    bgClass: "bg-red-50/80 border-red-100"
  }
];

export default {
  async scheduled(event, env, ctx) {
    await Promise.all(DOMAINS.map(item =>
      syncDomain(item.subdomain, item.url, env)
    ));
  },

  async fetch(request, env, ctx) {
    try {
      if (!env.CF_API_TOKEN || !env.ZONE_ID) {
        return new Response("Error: Missing env variables.", { status: 500 });
      }

      const reports = [];
      let allSynced = true;

      for (const item of DOMAINS) {
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

  if (toDelete.length === 0 && toAdd.length === 0) return;

  await fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records/batch`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      deletes: toDelete.map(r => ({ id: r.id })),
      posts: toAdd.map(r => ({
        type: r.type,
        name: subdomain,
        content: r.content,
        ttl: 1,
        proxied: false
      }))
    })
  });
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
  const SVG_CMCC = `<svg class="h-4 md:h-4.5 w-auto object-contain" xmlns="http://www.w3.org/2000/svg" viewBox="0 -21.163 1024.0009999999997 1066.3259999999998"><path fill="#8DC21F" d="M995.243 632.832c-90.71-119.552-226.134-242.347-263.51-272.213-26.624-21.334-52.224-32.086-77.909-32.086-26.88.854-52.65 11.435-72.533 29.867-4.267 4.267-10.667 9.643-18.091 16.043-53.333 44.885-219.819 197.546-224.085 201.813a68.95 68.95 0 0 1-46.934 19.2 81.067 81.067 0 0 1-51.2-24.576 1247.317 1247.317 0 0 1-135.509-130.219C64.853 394.752 30.72 354.22 30.72 354.22s-7.51 14.933-11.776 26.624a20.48 20.48 0 0 0 1.11 17.066c22.357 32.086 123.733 152.747 262.4 273.323 21.247 19.968 48.98 31.403 77.909 32.085a111.6 111.6 0 0 0 72.533-29.866c4.267-4.267 10.667-9.643 18.176-16.043C504.491 612.523 605.867 519.68 652.8 475.904c10.667-9.643 18.09-16.043 21.333-19.2a68.95 68.95 0 0 1 46.934-19.285c19.285 2.218 37.29 10.922 51.2 24.576 29.866 25.6 77.909 70.485 135.509 130.304 41.557 44.8 74.667 85.333 74.667 86.442 0 0 7.424-16.042 11.776-26.709a19.37 19.37 0 0 0 1.024-19.2z"/><path fill="#0084CF" d="M0 539.477c50.347 75.179 105.813 146.774 166.059 214.102 42.325 44.544 87.466 86.186 135.168 124.842 113.92 91.478 230.997 83.968 329.984 6.486a1004.66 1004.66 0 0 0 27.989-22.614l32.17-27.477 35.5-31.573 38.058-34.816 59.904-56.32 60.757-58.624a13.056 13.056 0 0 1 20.224-2.134c20.992 20.48 40.96 41.984 59.648 64.598l-5.632 6.058-24.917 25.174-34.901 33.45-41.984 38.912-30.55 27.648-47.616 41.984-47.189 40.192-15.19 12.544c-125.61 103.254-258.73 92.587-327.935 57.003L367.7 986.965l-16.213-9.642a594.773 594.773 0 0 1-8.704-5.376l-18.517-12.118-20.054-14.421-21.76-16.81a792.15 792.15 0 0 1-23.466-19.798l-25.259-22.955c-30.55-28.757-65.024-64.853-103.85-110.677A1019.904 1019.904 0 0 1 11.69 601.941a69.29 69.29 0 0 1-6.4-17.322A257.707 257.707 0 0 1 0 539.392zm3.243-76.458l5.29-30.123 17.579 24.747 22.101 29.013 18.432 23.467 21.163 25.856 23.552 27.818 25.856 29.184c4.437 5.035 8.96 9.984 13.653 15.019l28.672 30.208c4.864 5.12 9.899 10.155 14.934 15.19l30.976 30.037c26.282 24.746 53.93 48.64 82.176 70.144 56.917 42.41 119.381 41.301 173.482 1.024l18.774-15.36 63.317-55.894 77.312-70.656 51.797-48.896 23.467-22.869 20.821-20.821a23.296 23.296 0 0 1 34.048-4.267c23.723 19.968 46.08 41.557 67.072 64.512l-6.314 7.083-18.262 18.944-24.234 24.149-44.374 42.923-66.048 61.952-47.786 43.605-28.16 25.003-23.467 19.968c-6.827 5.717-12.63 10.24-17.067 13.568-74.496 54.869-148.992 43.008-212.906 7.594a278.101 278.101 0 0 1-22.955-14.506l-18.859-13.824-21.418-16.982a955.392 955.392 0 0 1-23.723-20.053l-25.685-23.296-27.392-26.283-28.928-29.354A1714.09 1714.09 0 0 1 7.424 487.765a34.304 34.304 0 0 1-4.267-24.746zm458.752-276.48c74.496-54.955 148.992-43.094 212.906-9.728 8.619 4.778 19.456 11.776 32.086 20.992l20.138 15.36 11.094 8.874 23.637 20.139 25.685 23.21 27.392 26.283 28.928 29.27c54.016 56.49 114.091 128 172.63 213.162 4.522 7.339 5.973 16.214 4.266 24.747l-5.29 30.123-17.664-24.32-22.187-28.843-28.843-35.84-22.528-26.88-24.832-28.501-26.965-29.696-28.757-30.208a1198.08 1198.08 0 0 0-128.342-115.286c-55.893-42.41-118.357-41.301-172.373-1.024l-14.08 11.264-56.49 49.579-62.294 56.405-26.624 24.662-51.797 48.896-23.467 22.869-20.821 20.821a23.296 23.296 0 0 1-34.134 4.267 650.667 650.667 0 0 1-66.986-63.488l14.506-15.787 21.504-21.76 26.71-26.197 63.146-60.245 49.835-46.166 31.403-28.501 40.533-35.67 11.008-9.386 17.067-13.483zM306.517 82.005C432.128-21.163 565.248-10.496 634.453 25.003L656.3 37.035l16.213 9.642c2.901 1.707 5.803 3.414 8.704 5.376l18.517 12.118 20.054 14.421 21.76 16.81c7.509 6.145 15.36 12.715 23.466 19.798l25.259 22.955c8.704 8.192 17.75 17.066 27.136 26.453l29.184 30.55c15.019 16.213 30.89 34.133 47.53 53.76 45.227 53.418 84.822 111.53 118.187 173.226a69.29 69.29 0 0 1 6.4 17.152c3.158 14.933 4.95 30.037 5.291 45.227a1940.424 1940.424 0 0 0-166.059-214.187 1409.11 1409.11 0 0 0-135.168-124.672c-113.92-91.563-230.997-84.053-329.984-6.57a1004.66 1004.66 0 0 0-27.989 22.613l-32.17 27.477-35.5 31.573-38.058 34.816-59.904 56.32-60.757 58.624a13.056 13.056 0 0 1-20.224 2.134 836.864 836.864 0 0 1-59.648-64.598l5.632-6.058 24.917-25.174 34.901-33.45 27.307-25.515 45.227-41.045 31.658-28.075 31.915-27.648 31.232-26.453 15.19-12.544z"/></svg>`;
  const SVG_CTCC = `<svg class="h-4 md:h-4.5 w-auto object-contain" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="#0061b2" d="M775.68 268.8c-2.56 64-130.56 140.8-276.48 171.52 15.36-94.72 48.64-163.84 79.36-171.52 12.8-2.56 25.6-2.56 38.4 12.8 0 0 10.24-2.56 33.28-7.68-33.28-71.68-79.36-115.2-130.56-115.2-87.04 0-158.72 122.88-179.2 289.28-71.68-7.68-120.32-33.28-120.32-76.8 0-48.64 66.56-102.4 153.6-138.24l-7.68-28.16C215.04 261.12 102.4 355.84 102.4 442.88c0 79.36 97.28 130.56 235.52 138.24 10.24 189.44 87.04 340.48 184.32 340.48 87.04 0 158.72-122.88 179.2-289.28l-56.32 15.36c-12.8 89.6-40.96 151.04-71.68 151.04-40.96 0-74.24-99.84-79.36-225.28 7.68 0 15.36-2.56 23.04-5.12 225.28-40.96 409.6-168.96 404.48-279.04-2.56-76.8-102.4-125.44-238.08-133.12l12.8 43.52c53.76 10.24 81.92 33.28 79.36 69.12z"/></svg>`;
  const SVG_CUCC = `<svg class="h-4 md:h-4.5 w-auto object-contain" viewBox="-7.495 107.109 1033.725 808.582" xmlns="http://www.w3.org/2000/svg"><path d="m700.533 649.83c17.414 17.853 35.834 34.833 52.066 53.707 28.951 33.666 37.217 79.805 15.433 121.023-14.532 27.492-34.56 49.522-60.6 65.969-23.85 15.063-49.614 23.04-78.24 17.917-28.091-5.03-50.278-19.596-69.643-40.333-15.258-16.341-32.541-30.776-49.036-46.163-10.562 10.319-23.177 22.165-35.23 34.554-12.981 13.346-24.73 28.15-41.235 37.367-29.433 16.438-60.189 21.82-92.595 9.029-39.836-15.727-68.472-43.884-87.333-81.707-14.19-28.454-14.49-57.818-1.896-87.624 9.183-21.74 26.01-36.823 41.729-53.002 50.235-51.705 100.65-103.239 150.974-154.859 4.018-4.123 7.877-8.408 12.305-13.15-3.583-4.238-6.585-8.25-10.045-11.815-53.907-55.523-107.742-111.111-161.934-166.354-10.787-10.995-21.637-21.592-28.949-35.467-19.24-36.524-17.044-72.368 3.693-107.145 16.71-28.024 39.29-50.472 68.834-64.948 40.257-19.72 79.769-17.152 114.564 10.808 24.001 19.29 44.4 43.085 66.392 64.881.521.515.844 1.23 1.964 2.913 7.36-7.497 14.193-14.397 20.96-21.362 13.351-13.735 26.083-28.144 40.14-41.108 18.423-16.99 40.544-26.192 65.813-27.911 41.542-2.821 72.603 17.426 100.895 44.617 13.912 13.367 23.88 29.548 31.57 46.706 15.332 34.204 12.555 68.311-8.196 99.316-10.371 15.493-24.306 28.712-37.355 42.262-49.312 51.194-98.924 102.096-148.41 153.122-3.474 3.585-6.831 7.282-10.365 11.058 1.432 1.698 2.32 2.896 3.35 3.955 43.453 44.588 86.91 89.172 130.38 133.743zm-336.843-362.937c39.833 41.03 79.67 82.059 119.484 123.113 9.409 9.698 18.734 19.478 28.279 29.41 3.05-2.896 4.924-4.554 6.665-6.347 55.331-56.863 110.697-113.698 165.843-170.74 3.14-3.245 5.38-8.017 6.49-12.465 5.093-20.383-1.011-34.955-18.648-46.194-16.344-10.413-31.023-9.251-44.93 4.41-12.921 12.691-25.281 25.956-37.892 38.966-5.73 5.915-11.469 11.821-17.457 17.995 14.36 15.09 28.164 29.598 42.344 44.497l-60.672 58.806c-12.82-13.552-26.734-28.26-39.88-42.161l-43.172 39.944c-19.442-18.463-39.634-37.637-61.38-58.285 15.124-13.886 29.754-27.314 44.813-41.137-3.303-3.522-5.134-5.518-7.015-7.472-14.656-15.214-29.926-29.886-43.818-45.772-15.815-18.086-35.322-22.404-56.31-6.444-17.043 12.96-20.51 40.512-5.904 56.026 7.595 8.068 15.441 15.9 23.16 23.85zm308.979 534.022c20.544-12.295 26.487-42.473 11.341-58.807-5.82-6.278-11.895-12.321-17.858-18.467-40.707-41.953-81.367-83.957-122.163-125.825-10.485-10.765-21.41-21.098-34.36-33.818-2.758 3.788-5.218 7.997-8.46 11.478-10.817 11.615-21.853 23.022-32.907 34.41-41.763 43.03-83.265 86.321-125.513 128.872-15.596 15.708-14.098 39.019-1.834 53.09 15.663 17.969 41.173 21.59 58.504 2.38 8.413-9.326 17.679-17.873 26.414-26.914 8.855-9.17 17.53-18.516 26.521-28.034l-42.802-44.855c20.642-19.832 40.707-39.114 59.708-57.374 14.012 13.008 28.896 26.82 44.076 40.91 13.315-14.087 27.129-28.706 39.133-41.41l61.332 58.188c-7.422 7.92-14.28 15.235-21.133 22.559-6.872 7.343-13.74 14.691-22.784 24.363 18.959 18.166 37.592 35.441 55.546 53.4 14.154 14.162 31.404 15.333 47.239 5.854zm342.593-359.159c7.19 22.96 10.968 46.053 7.34 69.928-5.395 35.503-18.09 67.632-45.563 92.123-22.4 19.968-49.248 28.432-78.89 29.267-31.974.895-60.864-7.418-86.881-26.56-20.668-15.205-38.783-32.673-53.436-53.748-.555-.8-1.314-1.458-1.58-1.745l-55.109 52.042-60.653-58.28a531562.54 531562.54 0 0 1 54.163-50.805 667563.966 667563.966 0 0 0 -52.982-55.122l59.69-57.442 53.549 50.167c14.279-14.404 28.629-30.175 44.34-44.439 27.668-25.12 60.737-37.017 98.096-35.988 58.035 1.597 100.058 33.568 117.916 90.602zm-80.708 83.444c6.038-10.242 8.852-21.218 8.112-32.57 1.315-28.243-14.538-47.527-32.274-53.082-19.752-6.184-38.12-1.085-54.248 10.213-12.655 8.862-24.157 19.585-35.24 30.437-12.66 12.396-12.992 10.39-.15 23.927 16.207 17.086 33.163 33.235 56.353 40.29 19.319 5.876 44.222 3.223 57.447-19.215zm-669.503 28.7c-11.986 18.333-27.502 33.415-44.412 46.988-18.252 14.655-38.713 26.1-61.816 29.92-65.285 10.804-123.73-14.093-148.44-82.66-17.878-49.607-12.308-96.494 13.93-140.833 19.05-32.196 48.56-49.642 85.99-54.689 46.79-63.307 86.434 8.247 120.357 39.495 12.847 11.833 23.492 26.066 35.159 39.19.824.928 1.797 1.725 3.373 3.222 17.893-18.771 35.394-37.138 52.458-55.044 20.217 19.617 40.094 38.897 60.704 58.896-17.544 18.278-34.534 35.976-52.788 54.998l53.913 50.29-62.919 59.818-52.721-55.296c-1.029 2.136-1.707 4.055-2.788 5.705zm-54.442-58.416c1.215-1.342.602-6.225-.898-7.868-16.622-18.186-33.637-35.798-56.893-46.006-20.598-9.044-47.964-3.732-60.476 12.816-11.275 14.91-12.115 31.838-10.251 49.566 2.68 25.521 22.043 43.25 47.817 43.767 6.356-1.347 12.913-2.093 19.032-4.15 26.103-8.776 43.937-28.496 61.67-48.125z" fill="#d40010"/></svg>`;

  const cards = reports.map(r => {
    const statusBadge = r.inSync 
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> 已同步
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
           <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-spin"></span> 待更新
         </span>`;

    let currentSvg = '';
    if (r.name === "中国移动") currentSvg = SVG_CMCC;
    else if (r.name === "中国电信") currentSvg = SVG_CTCC;
    else if (r.name === "中国联通") currentSvg = SVG_CUCC;

    return `
      <div class="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-5">
            <div class="flex items-center gap-3">
              <div class="h-9 px-3 rounded-xl border ${r.bgClass} flex items-center justify-center overflow-hidden">
                ${currentSvg}
              </div>
              <h3 class="text-base font-semibold text-slate-800">${r.name}</h3>
            </div>
            ${statusBadge}
          </div>
          
          <div class="mb-5 relative group/copy">
            <div onclick="copyText('${r.subdomain}', this)" class="cursor-pointer relative flex items-center justify-between bg-slate-50 hover:bg-slate-100/70 border border-slate-100/70 hover:border-slate-200 px-3 py-2 rounded-xl transition-all duration-200">
              <code class="text-xl font-bold text-slate-900 font-mono break-all tracking-tight select-none">${r.subdomain}</code>
              <svg class="w-4 h-4 text-slate-400 group-hover/copy:text-slate-600 flex-shrink-0 ml-2 transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-6a2 2 0 00-2 2zM8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>
              
              <span class="toast-msg absolute right-10 bg-slate-900 text-white text-[11px] font-medium px-2 py-1 rounded-md opacity-0 scale-95 transition-all duration-200 pointer-events-none shadow-md">已复制 !</span>
            </div>
          </div>

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
      <title>Cloudflare 优选域名</title>
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

      <footer class="w-full text-center py-6 text-xs text-slate-400 border-t border-slate-100 bg-white">
        <div>每日构建 · Edge Network Status Page</div>
      </footer>

    </body>
    </html>
  `;
}
