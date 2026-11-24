// Step 2: download images for multi-artwork cards, hash the illustration box, match YGOPRODeck imageIds to Yugipedia artworks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [, , dataDir, depsDir] = process.argv;
const sharp = createRequire(path.join(depsDir, 'package.json'))('sharp');
const UA = { 'User-Agent': 'SkytrixCardSync/1.0 (prototype)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const imgDir = path.join(dataDir, 'img');
fs.mkdirSync(imgDir, { recursive: true });

const cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'cards.json')))
  .filter(c => c.ygoImages.length > 1 || c.artworks.length > 1);

async function download(url, file, delay) {
  if (fs.existsSync(file)) return file;
  await sleep(delay);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

// Illustration box of a standard card frame, as fractions of the card.
const BOX = { left: 0.12, top: 0.185, right: 0.88, bottom: 0.70 };
async function hash(file) {
  const img = sharp(file);
  const { width, height } = await img.metadata();
  const region = {
    left: Math.round(width * BOX.left), top: Math.round(height * BOX.top),
    width: Math.round(width * (BOX.right - BOX.left)), height: Math.round(height * (BOX.bottom - BOX.top)),
  };
  const N = 16;
  const px = await sharp(file).extract(region).greyscale().normalise().resize(N + 1, N, { fit: 'fill' }).raw().toBuffer();
  const bits = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) bits.push(px[y * (N + 1) + x] > px[y * (N + 1) + x + 1] ? 1 : 0);
  return bits;
}
const dist = (a, b) => a.reduce((s, v, i) => s + (v !== b[i]), 0);

const report = [];
let n = 0;
for (const c of cards) {
  const ygo = [];
  for (const id of c.ygoImages) {
    const f = await download(`https://images.ygoprodeck.com/images/cards_small/${id}.jpg`, path.join(imgDir, `ygo-${id}.jpg`), 150);
    ygo.push({ id, h: await hash(f) });
  }
  const yp = [];
  for (const a of c.artworks) {
    const ext = path.extname(a.url.url);
    const f = await download(a.url.url, path.join(imgDir, `yp-${c.passcode}-${a.art}${ext}`), 300);
    yp.push({ art: a.art, scan: a.scan, h: await hash(f) });
  }
  // Distance matrix, then greedy assignment by smallest distance.
  const pairs = [];
  for (const g of ygo) for (const p of yp) pairs.push({ id: g.id, art: p.art, d: dist(g.h, p.h) });
  const T = +(process.env.T || 75);
  const matches = ygo.map(g => {
    const ds = pairs.filter(p => p.id === g.id).sort((a, b) => a.d - b.d);
    return { id: g.id, art: ds[0].d <= T ? ds[0].art : null, d: ds[0].d, bestArt: ds[0].art, next: ds[1]?.d ?? null };
  });
  const usedP = new Set(matches.filter(m => m.art != null).map(m => m.art));
  report.push({ name: c.name, passcode: c.passcode, ygo: c.ygoImages.length, yp: c.artworks.length, matches,
    newArts: c.artworks.filter(a => !usedP.has(a.art)).map(a => ({ art: a.art, scan: a.scan })) });
  console.log(++n, '/', cards.length, c.name);
}
fs.writeFileSync(path.join(dataDir, 'report.json'), JSON.stringify(report, null, 1));
