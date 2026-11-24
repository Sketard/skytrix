// Step 1: pick sample, read Yugipedia card pages, extract artwork list, resolve scan URLs.
import fs from 'node:fs';
import path from 'node:path';

const [, , protoDir, outDir] = process.argv;
const UA = { 'User-Agent': 'SkytrixCardSync/1.0 (prototype)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ygo = JSON.parse(fs.readFileSync(path.join(protoDir, 'ygo.json'))).data;
const yp = JSON.parse(fs.readFileSync(path.join(protoDir, 'all.json')));
const titleByPass = new Map(yp.map(x => [+x.Password[0], x.title]));

// Sample: multi-art cards + 75 random single-art cards (seeded).
const withTitle = ygo.filter(c => titleByPass.has(c.id));
const multi = withTitle.filter(c => c.card_images.length > 1);
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const single = withTitle.filter(c => c.card_images.length === 1).sort(() => rnd() - 0.5).slice(0, 75);
const sample = [...multi, ...single];
console.log('sample', sample.length, 'multi', multi.length);

async function api(params) {
  for (let i = 0; i < 5; i++) {
    await sleep(3000);
    const r = await fetch('https://yugipedia.com/api.php?' + new URLSearchParams({ format: 'json', ...params }), { headers: UA });
    const t = await r.text();
    try { return JSON.parse(t); } catch { console.log('challenge, wait 90s'); await sleep(90000); }
  }
  throw new Error('blocked');
}

function parseImageParam(wikitext) {
  const m = wikitext.match(/\|\s*image\s*=([\s\S]*?)(?=\n\s*\|\s*[a-z_]+\s*=|\n}})/);
  if (!m) return [];
  const rows = [];
  for (let line of m[1].replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    line = line.trim();
    const r = line.match(/^(\d+)(?:\.(\d+))?\s*;\s*([^;]*?)\s*(?:;\s*(.*?))?\s*$/);
    if (r && r[3]) rows.push({ art: +r[1], sub: r[2] ? +r[2] : 0, scan: r[3], artOnly: r[4] || null });
    else if (!rows.length && /.(png|jpe?g|gif)$/i.test(line) && !line.includes(";")) rows.push({ art: 1, sub: 0, scan: line, artOnly: null });
  }
  return rows;
}
const lang = f => (f.match(/-(EN|FR|DE|IT|SP|PT|JP|JA|KR|SC|TC|AE|EU|NA)-/) || [])[1] || '?';
const langRank = l => (l === 'EN' || l === 'NA' || l === 'EU') ? 0 : ['FR', 'DE', 'IT', 'SP', 'PT', 'AE'].includes(l) ? 1 : 2;

const cacheFile = path.join(outDir, "pages.json");
const cards = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile)) : [];
const todo = cards.length ? 0 : sample.length;
for (let i = 0; i < todo; i += 50) {
  const batch = sample.slice(i, i + 50);
  const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: batch.map(c => titleByPass.get(c.id)).join('|') });
  const byTitle = new Map(Object.values(d.query.pages).map(p => [p.title, p.revisions?.[0]?.slots?.main?.['*'] || '']));
  // MediaWiki normalizes titles; map back via d.query.normalized
  const norm = new Map((d.query.normalized || []).map(n => [n.from, n.to]));
  for (const c of batch) {
    const t = titleByPass.get(c.id);
    const text = byTitle.get(norm.get(t) || t) || '';
    const rows = parseImageParam(text);
    const arts = {};
    for (const r of rows) (arts[r.art] = arts[r.art] || []).push(r);
    const artworks = Object.entries(arts).map(([n, rs]) => {
      const best = [...rs].sort((a, b) => langRank(lang(a.scan)) - langRank(lang(b.scan)))[0];
      return { art: +n, scan: best.scan, lang: lang(best.scan), artOnly: rs.find(r => r.artOnly)?.artOnly || null };
    });
    cards.push({ passcode: c.id, name: c.name, title: t, ygoImages: c.card_images.map(x => x.id), artworks });
  }
  console.log('pages', i + batch.length);
}

fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cards));
// Resolve scan thumbnail URLs (300px wide).
const files = [...new Set(cards.flatMap(c => c.artworks.map(a => 'File:' + a.scan)))];
const urls = {};
for (let i = 0; i < files.length; i += 50) {
  const d = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|size', titles: files.slice(i, i + 50).join('|') });
  if (!d.query) { console.log(JSON.stringify(d).slice(0, 400)); process.exit(1); }
  const norm = new Map((d.query.normalized || []).map(n => [n.to, n.from]));
  for (const p of Object.values(d.query.pages)) {
    const key = (norm.get(p.title) || p.title).replace(/^File:/, '');
    urls[key] = p.imageinfo ? { url: p.imageinfo[0].url, size: p.imageinfo[0].size } : null;
  }
  console.log('files', Math.min(i + 50, files.length), '/', files.length);
}
for (const c of cards) for (const a of c.artworks) a.url = urls[a.scan] ?? urls[a.scan.replace(/_/g, ' ')] ?? null;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'cards.json'), JSON.stringify(cards, null, 1));
console.log('done', cards.length);
