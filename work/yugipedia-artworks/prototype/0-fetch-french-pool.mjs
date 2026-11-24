import fs from 'node:fs';
const out = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const all = [];
for (let p = 0; p <= 9; p++) {
  let offset = 0;
  while (offset !== undefined) {
    const query = `[[Concept:CG cards]][[French name::+]][[Password::~${p}*]]|?Password|?French name|?French lore|?French pendulum effect|limit=500|offset=${offset}`;
    const url = 'https://yugipedia.com/api.php?' + new URLSearchParams({ action: 'ask', format: 'json', query });
    const res = await fetch(url, { headers: { 'User-Agent': 'skytrix-card-sync/1.0' } });
    const txt = await res.text(); let d; try { d = JSON.parse(txt); } catch { console.log("challenge", res.status, "-> wait 90s"); await sleep(90000); continue; }
    for (const [title, v] of Object.entries(d.query.results)) all.push({ title, ...v.printouts });
    const next = d['query-continue-offset'];
    console.log(p, offset, Object.keys(d.query.results).length, next);
    offset = next && next > offset ? next : undefined;
    await sleep(3000);
  }
}
fs.writeFileSync(out, JSON.stringify(all));
console.log('total', all.length);
