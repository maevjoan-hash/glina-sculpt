// UV unwrap, colour and normal maps, OBJ with UVs (Rust core): node test/uv.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const inspect = (withNormal) => G(async (wn) => {
  const W = window.__glina, r = await W.texturedFiles(256);
  // UVs inside the square, no face turned over in UV
  let out = 0, flipped = 0;
  for (const v of r.uv) if (v < 0 || v > 1) out++;
  for (let f = 0; f < r.faces; f++) { const w = [0, 1, 2].map((e) => [r.uv[r.corner[f * 3 + e] * 2], r.uv[r.corner[f * 3 + e] * 2 + 1]]); if ((w[1][0] - w[0][0]) * (w[2][1] - w[0][1]) - (w[2][0] - w[0][0]) * (w[1][1] - w[0][1]) <= 0) flipped++; }
  const img = async (bytes) => { const b = new Blob([bytes], { type: 'image/png' }), im = new Image(); im.src = URL.createObjectURL(b); await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return { w: im.width, d: g.getImageData(0, 0, im.width, im.height).data }; };
  const col = await img(r.files.find((f) => f.name === 'glina-color.png').data);
  let red = 0, white = 0; for (let k = 0; k < col.d.length; k += 4) { if (col.d[k] > 200 && col.d[k + 1] < 60) red++; else if (col.d[k] > 200 && col.d[k + 1] > 200) white++; }
  let blue = 0, cnt = 0;
  if (wn) { const nm = await img(r.files.find((f) => f.name === 'glina-normal.png').data); for (let k = 0; k < nm.d.length; k += 4) { blue += nm.d[k + 2]; cnt++; } }
  const obj = new TextDecoder().decode(r.files.find((f) => f.name === 'glina.obj').data);
  const vt = (obj.match(/^vt /gm) || []).length, fs = (obj.match(/^f \d+\/\d+ \d+\/\d+ \d+\/\d+$/gm) || []).length;
  return { names: r.files.map((f) => f.name), charts: r.charts, uvs: r.uvs, faces: r.faces, out, flipped, size: col.w, red, white, blue: cnt ? blue / cnt : 0, vt, fs, zip: W.zipMany(r.files).length };
}, withNormal);

// half painted red
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3] > 0 ? 0 : 1; W.S.paint = [1, 0, 0]; W.fillColour(); W.maskOp('clear'); });
const a = await inspect(false);
check('unwrap: charts packed in the square, no face turned over, every corner has a UV', a.out === 0 && a.flipped === 0 && a.charts >= 6 && a.vt === a.uvs && a.fs === a.faces, a);
check('the colour map has the painted half and the white half', a.size === 256 && a.red > 256 * 256 * 0.15 && a.white > 256 * 256 * 0.15, { red: a.red, white: a.white });
check('OBJ, MTL and the colour PNG, in one zip', a.names.join() === 'glina.obj,glina.mtl,glina-color.png' && a.zip > 1000, a.names);
// with levels: the normal map from the highest onto the lowest
await G(() => window.__glina.divide()); await idle(); await frames(2);
await G(() => window.__glina.selectTool('draw'));
const b = await inspect(true);
check('with levels: the lowest level is exported, with a normal map of the highest (mostly flat blue)', b.names.includes('glina-normal.png') && b.faces === 81920 && b.blue > 200, { faces: b.faces, blue: b.blue, names: b.names });
// a stroke on the high level shows in the normal map
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.brush().radius = 40; window.__glina.brush().strength = 1; });
for (let k = 0; k < 3; k++) { await page.mouse.move(box.x - 80, box.y + k * 10); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x - 80 + i * 16, box.y + k * 10); await frames(1); } await page.mouse.up(); await frames(2); }
const detail = await G(async () => {
  const W = window.__glina, r = await W.texturedFiles(256), b = new Blob([r.files.find((f) => f.name === 'glina-normal.png').data], { type: 'image/png' }), im = new Image(); im.src = URL.createObjectURL(b); await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, im.width, im.height).data;
  let tilted = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 2] < 250) tilted++; return tilted;
});
check('the detail sculpted on the high level is in the normal map', detail > 200, { tilted: detail });
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
