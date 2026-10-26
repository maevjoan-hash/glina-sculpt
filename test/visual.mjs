// Visual check of brushes in headless Chromium: node test/visual.mjs <scenario> <out.png> [key=value settings...]
// Builds nothing: loads dist/glina.html (run `node build/build.mjs` first).
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [scenario = 'pull', out = 'shot.png', ...kv] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { localStorage.clear(); document.getElementById('hintClose')?.click(); document.getElementById('bPanel').click(); });
// key=value sets a setting; b.key=value sets a field of the brush chosen with tool=<id>
await page.evaluate((kv) => {
  const G = window.__glina, val = (v) => (v[0] === '[' ? JSON.parse(v) : v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v);
  for (const s of kv) { const [k, v] = s.split('='); if (k === 'tool') G.selectTool(v); }
  for (const s of kv) { const [k, v] = s.split('='); if (k === 'tool') continue; if (k.startsWith('b.')) G.brush()[k.slice(2)] = val(v); else G.S[k] = val(v); }
}, kv);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
async function drag(x0, y0, x1, y1, steps = 40, button = 'left') {
  await page.mouse.move(x0, y0); await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  await page.mouse.up({ button }); await frames(5);
}
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
if (scenario === 'pull') {
  await page.keyboard.press('g');
  await drag(cx + 60, cy, cx + 60, cy, 2);         // no-op click
  await drag(cx + 70, cy - 10, cx + 230, cy - 40, 50);
  await drag(box.x + 20, cy + 200, box.x + 120, cy + 200, 20, 'right'); // orbit a bit to see the side
} else if (scenario === 'across') {
  // grab the middle of the front and pull far across the surface, then orbit 70° to look from the side
  await page.keyboard.press('g');
  await drag(cx, cy, cx + 260, cy - 60, 60);
  await page.evaluate(() => window.__glina.orbit(260, 0)); await frames(3);
} else if (scenario === 'out') {
  // orbit first so the pull goes outward from the surface, then look from the front again
  await page.keyboard.press('g');
  await page.evaluate(() => window.__glina.orbit(260, 0)); await frames(3);
  await drag(cx - 60, cy, cx + 240, cy, 60);
  await page.evaluate(() => window.__glina.orbit(-200, 0)); await frames(3);
} else if (scenario === 'nose') {
  // grab at the right silhouette and pull straight outward 1.5× the sphere radius, then look from 45°
  const edge = await page.evaluate(({ cx, cy }) => { for (let x = cx + 400; x > cx; x -= 2) if (window.__glina.pick(x - document.getElementById('gl').getBoundingClientRect().left, cy - document.getElementById('gl').getBoundingClientRect().top)) return x; return cx; }, { cx, cy });
  await drag(edge - 12, cy, edge + 260, cy, 80);
  if (process.env.REMESH) { await page.evaluate(() => window.__glina.remesh()); await page.waitForFunction(() => document.getElementById('busy').hidden); await frames(3); }
  const orb = +(process.env.ORBIT || 0);
  if (orb) { await page.evaluate((o) => window.__glina.orbit(o, 0), orb); await frames(3); }
  await page.keyboard.press('g');
  // pull toward the viewer: drag in screen from centre outward after orbiting so the pull goes sideways
  await drag(cx + 100, cy, cx + 300, cy, 60);
}
const info = await page.evaluate(() => { const m = window.__glina.mesh; return { v: m.n ?? m.pos.length / 3, f: m.f ?? m.idx.length / 3, undo: window.__glina.undoStack.length }; });
await page.screenshot({ path: out });
console.log(JSON.stringify({ scenario, info, errors }));
await browser.close();
