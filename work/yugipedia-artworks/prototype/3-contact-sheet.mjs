import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const [, , dataDir, depsDir, out, ...names] = process.argv;
const sharp = createRequire(path.join(depsDir, 'package.json'))('sharp');
const cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'cards.json')));
const img = path.join(dataDir, 'img'); const W = 140, H = 204, rows = [];
for (const n of names) {
  const c = cards.find(x => x.name === n);
  const files = [...c.ygoImages.map(id => path.join(img, `ygo-${id}.jpg`)), null,
    ...c.artworks.map(a => fs.readdirSync(img).find(f => f.startsWith(`yp-${c.passcode}-${a.art}.`))).map(f => path.join(img, f))];
  rows.push(files);
}
const cols = Math.max(...rows.map(r => r.length));
const comp = [];
for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x])
  comp.push({ input: await sharp(rows[y][x]).resize(W, H, { fit: 'fill' }).toBuffer(), left: x * (W + 6), top: y * (H + 6) });
await sharp({ create: { width: cols * (W + 6), height: rows.length * (H + 6), channels: 3, background: '#333' } }).composite(comp).png().toFile(out);
