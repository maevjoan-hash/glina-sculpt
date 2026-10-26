// Grab near the symmetry plane: the grabbed point must follow the pen (soft and elastic), static and dynamic.
// (dynamic: detail so coarse that nothing is split or merged, so vertex numbers stay put)
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
let ok = true;
for (const dyn of [false, true]) for (const tool of ['grab', 'elastic']) {
  await page.evaluate(({ d, t }) => { const G = window.__glina; G.setDyntopo(d); G.selectTool(t); G.S.sym = true; G.S.detail = 400; G.S.decimate = false; }, { d: dyn, t: tool });
  await page.waitForFunction((d) => !!window.__glina.mesh.dyn === d, dyn);
  const y = box.y + box.h / 2;
  // the screen point on the middle row whose surface point is closest to the symmetry plane x = 0
  const sx = await page.evaluate(({ w, h }) => { let best = w / 2, bd = 1e9; for (let px = 0; px < w; px += 1) { const hit = window.__glina.pick(px, h / 2); if (hit && Math.abs(hit.point.x) < bd) { bd = Math.abs(hit.point.x); best = px; } } return best; }, { w: box.w, h: box.h });
  const x = box.x + sx;
  // the vertex nearest the press point, and its x before
  const before = await page.evaluate(({ x, y }) => { const h = window.__glina.pick(x, y); const m = window.__glina.mesh; let best = -1, bd = 1e9; for (let i = 0; i < m.n; i++) { const d = (m.pos[i * 3] - h.point.x) ** 2 + (m.pos[i * 3 + 1] - h.point.y) ** 2 + (m.pos[i * 3 + 2] - h.point.z) ** 2; if (d < bd) { bd = d; best = i; } } return { i: best, x: m.pos[best * 3], y: m.pos[best * 3 + 1] }; }, { x: x - box.x, y: y - box.y });
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x + k * 4, y - k * 6); await frames(1); }
  await page.mouse.up(); await frames(3);
  const after = await page.evaluate((i) => { const m = window.__glina.mesh; return { x: m.pos[i * 3], y: m.pos[i * 3 + 1] }; }, before.i);
  // pen moved right and up: the vertex must not go left, and must go up
  const pass = Math.abs(before.x) < 0.03 && after.y > before.y + 0.05 && after.x >= before.x - 0.02;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${dyn ? 'dyn ' : ''}${tool} at the symmetry plane follows the pen`, JSON.stringify({ before, after }));
  await page.evaluate(() => window.__glina.undo()); await frames(2);
}
console.log(errors.length ? 'FAIL  page errors ' + errors.slice(0, 3) : 'PASS  no page errors');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
