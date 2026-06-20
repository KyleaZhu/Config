const DOMAINS = [
  { subdomain: "cm.bestcf.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cmcc-ip.txt" },
  { subdomain: "ct.bestcf.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/ctcc-ip.txt" },
  { subdomain: "cu.bestcf.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cucc-ip.txt" },
  { subdomain: "cmin2.bestcf.xdu.qzz.io", url: "https://raw.githubusercontent.com/KyleaZhu/Config/main/bestcf/cmin2-ip.txt" }
];

export default {
  async scheduled(event, env, ctx) {
    await Promise.all(DOMAINS.map(item =>
      syncDomain(item.subdomain, item.url, env)
    ));
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
  const existingRecords = (cfData.result || []).filter(r => r.type === 'A' || r.type === 'AAAA');

  const toDelete = existingRecords.filter(e => !newRecords.some(n => n.type === e.type && n.content.toLowerCase() === e.content.toLowerCase()));
  const toAdd = newRecords.filter(n => !existingRecords.some(e => e.type === n.type && e.content.toLowerCase() === n.content.toLowerCase()));

  if (toDelete.length === 0 && toAdd.length === 0) return;

  const batchRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/dns_records/batch`, {
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

  if (!batchRes.ok) {
    const errText = await batchRes.text();
    console.error(`Batch sync failed for ${subdomain}:`, errText);
  }
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
