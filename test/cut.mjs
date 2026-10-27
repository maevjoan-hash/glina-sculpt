// Lasso mask, Clip, Trim and the Line stroke in headless Chromium: node test/cut.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); document.getElementById('bPanel').click(); const G = window.__glina; G.S.sym = false; G.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function path2(pts, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts.slice(1)) { await page.mouse.move(...p); await frames(1); }
  await page.mouse.up(); await frames(4);
  for (const m of mods) await page.keyboard.up(m);
}
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const st = () => G(() => {
  const m = window.__glina.mesh, P = m.pos, I = m.idx, n = m.n, f = m.f;
  let vol = 0, mx = -1e9, mn = 1e9;
  for (let t = 0; t < f; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  for (let i = 0; i < n; i++) { if (m.dyn && !m.vfA[i].length) continue; mx = Math.max(mx, P[i * 3]); mn = Math.min(mn, P[i * 3]); }
  const E = new Map(); for (let t = 0; t < f; t++) for (let e = 0; e < 3; e++) { const a = I[t * 3 + e], b = I[t * 3 + (e + 1) % 3], k = a < b ? a * 4194304 + b : b * 4194304 + a; E.set(k, (E.get(k) || 0) + 1); }
  let open = 0, nonman = 0; for (const c of E.values()) { if (c === 1) open++; if (c > 2) nonman++; }
  let mask = 0; for (let i = 0; i < n; i++) mask += m.mask[i];
  return { n, f, vol, mx, mn, open, nonman, mask, sum: Array.from(P.subarray(0, n * 3)).reduce((a, v, i) => a + v * ((i % 7) + 1), 0) };
});
// lasso: a triangle around the upper left part of the model, drawn from empty space
await G(() => { window.__glina.S.selShape = 'lasso'; });
await path2([[box.x + 15, box.y + 15], [cx + 30, box.y + 15], [box.x + 15, cy + 30], [box.x + 15, box.y + 15]], ['Control']);
let s = await st();
const lassoMask = s.mask;
await G(() => { window.__glina.maskOp('clear'); window.__glina.S.selShape = 'rect'; });
await path2([[box.x + 15, box.y + 15], [cx + 30, cy + 30]], ['Control']);
s = await st();
check('lasso masks a part, less than the rectangle over the same corner', lassoMask > 50 && lassoMask < s.mask * 0.8, { lasso: Math.round(lassoMask), rect: Math.round(s.mask) });
await G(() => window.__glina.maskOp('clear'));
// clip: a vertical line, drawn downward: the shaded side is to the right of the direction of travel
// (here the left of the screen), so the left part is flattened
const s0 = await st();
await G(() => window.__glina.selectTool('clip'));
await path2(line(cx + 40, box.y + 10, cx + 40, box.y + box.h - 10));
s = await st();
check('clip flattens one side: the model is narrower, nothing removed', s.n === s0.n && s.mn > s0.mn + 0.1 && Math.abs(s.mx - s0.mx) < 1e-6 && s.open === 0, { mn: [s0.mn, s.mn] });
await G(() => window.__glina.undo()); s = await st();
check('clip undo is exact', Math.abs(s.sum - s0.sum) < 1e-6 * Math.abs(s0.sum));
// trim: the same line cuts the right side away and closes it
await G(() => window.__glina.selectTool('cut'));
await path2(line(cx + 40, box.y + 10, cx + 40, box.y + box.h - 10)); await idle(); await frames(2);
s = await st();
check('trim: closed and manifold', s.open === 0 && s.nonman === 0, { open: s.open, nonman: s.nonman });
check('trim: the shaded part cut away (volume smaller, the other side untouched)', s.vol < s0.vol * 0.9 && s.mn > s0.mn + 0.1 && Math.abs(s.mx - s0.mx) < 1e-6, { vol: [s0.vol, s.vol] });
await G(() => window.__glina.undo()); s = await st();
check('trim undo gives the model back', s.n === s0.n && Math.abs(s.vol - s0.vol) < 1e-6);
// trim with X symmetry: a vertical line off the middle cuts both sides
await G(() => { window.__glina.S.sym = true; window.__glina.syncSym(); });
const xs = await G(({ w, h }) => { for (let px = Math.round(w / 2); px < w; px++) { const hit = window.__glina.pick(px, h / 2); if (hit && hit.point.x > 0.55) return px; } return -1; }, { w: box.w, h: box.h });
await path2(line(box.x + xs, box.y + 10, box.x + xs, box.y + box.h - 10)); await idle(); await frames(2);
s = await st();
check('trim with symmetry: both sides cut, the same amount', s.open === 0 && Math.abs(s.mx + s.mn) < 0.05 && s.mx < s0.mx - 0.05, { mx: s.mx, mn: s.mn });
await G(() => { window.__glina.undo(); window.__glina.S.sym = false; window.__glina.syncSym(); });
// clip with dynamic topology
await G(() => window.__glina.setDyntopo(true)); await page.waitForFunction(() => window.__glina.mesh.dyn);
await G(() => window.__glina.selectTool('clip'));
const d0 = await st();
await path2(line(box.x + 10, cy - 40, box.x + box.w - 10, cy - 40));
s = await st();
check('clip with dynamic topology', s.sum !== d0.sum && s.open === 0);
await G(() => window.__glina.undo());   // (the clipped half is now a plane seen edge-on: nothing to draw on there)
await G(() => window.__glina.setDyntopo(false)); await page.waitForFunction(() => !window.__glina.mesh.dyn);
// line stroke
await G(() => { const G = window.__glina; G.selectTool('draw'); G.brush().stroke = 'line'; G.brush().strength = 0.8; });
const l0 = await st();
await path2(line(cx - 100, cy + 40, cx + 100, cy - 20, 20));
s = await st();
check('line stroke changes the model', s.sum !== l0.sum);
await G(() => window.__glina.undo()); s = await st();
check('line stroke undo is exact', Math.abs(s.sum - l0.sum) < 1e-6 * Math.abs(l0.sum));
await G(() => { window.__glina.brush().stroke = 'dots'; });
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
