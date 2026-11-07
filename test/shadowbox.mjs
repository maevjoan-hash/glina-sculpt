// Bend Curve (FFD's curve mode) and ShadowBox: node test/shadowbox.mjs
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
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); W.setDyntopo(false); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// Bend Curve: a tube standing along Y, three points; the middle one dragged to the right
await G(() => { const W = window.__glina; W.newScene(W.makeTube(), 'Тръба'); W.orbit(0, 0); W.S.defAxis = 1; W.selectTool('ffd'); W.brush().ffdMode = 'curve'; W.brush().ffdN = 3; });
await frames(2);
const L = await G(() => { const W = window.__glina, L = W.latticeLive(); return { curve: !!L.curve, n: L.N, scr: W.latticeScreen(L).map((p) => [p[0], p[1]]) }; });
check('„Крива“: three points on a line along the axis', L.curve && L.n === 3 && Math.abs(L.scr[0][0] - L.scr[2][0]) < 2 && Math.abs(L.scr[0][1] - L.scr[2][1]) > 100, L);
const p0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
const u0 = await G(() => window.__glina.undoStack.length);
await drag([[box.x + L.scr[1][0], box.y + L.scr[1][1]], [box.x + L.scr[1][0] + 120, box.y + L.scr[1][1]]]);
const bent = await G((a) => {
  const W = window.__glina, m = W.mesh, P = m.pos;
  let mid = 0, midN = 0, end = 0, endN = 0, thick = Infinity, thickMax = 0;
  for (let i = 0; i < m.n; i++) {
    const dx = P[i * 3] - a[i * 3];
    if (Math.abs(a[i * 3 + 1]) < 0.05) { mid += dx; midN++; }
    if (Math.abs(a[i * 3 + 1]) > 0.85) { end += Math.abs(dx); endN++; }
  }
  return { mid: mid / midN, end: end / endN, undo: W.undoStack.length };
}, p0);
check('dragging the middle point bends the tube: the middle goes right, the ends stay nearly put, one step', bent.mid > 0.15 && bent.end < bent.mid * 0.35 && bent.undo === u0 + 1, bent);
// the cross-sections turn with the curve: every point stays as far from the curve as it was from the line
const wall = await G(() => {
  const W = window.__glina, m = W.mesh, L = W.lattice, N = L.N;
  let worst = 0;
  for (let k = 0; k < L.idx.length; k += 7) {
    const t = L.T[k], b = [(1 - t) ** 2, 2 * t * (1 - t), t * t], v = L.idx[k];
    const c = [0, 1, 2].map((q) => L.P[q] * b[0] + L.P[3 + q] * b[1] + L.P[6 + q] * b[2]);
    const d = Math.hypot(m.pos[v * 3] - c[0], m.pos[v * 3 + 1] - c[1], m.pos[v * 3 + 2] - c[2]), d0 = Math.hypot(L.off[k * 3], L.off[k * 3 + 1], L.off[k * 3 + 2]);
    worst = Math.max(worst, Math.abs(d - d0));
  }
  return { worst, N };
});
check('…and the sections turn with it: every point keeps its distance from the curve', wall.worst < 1e-4, wall);
await G(() => window.__glina.undo());
await G(() => { const W = window.__glina; W.brush().ffdMode = 'cage'; W.S.defAxis = 0; });

// ShadowBox: a circle from the front, a narrower square from the side
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.selectTool('shadowbox'); W.orbit(0, 0); });
await frames(2);
const ax = await G(() => window.__glina.viewAxis());
const circle = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; circle.push([cx + Math.cos(a) * 150, cy + Math.sin(a) * 150]); }
await drag(circle, 2);
const s1 = await G(() => window.__glina.shadows.map((s) => (s ? s.poly.length : 0)));
check('a closed outline becomes the silhouette along the axis of the view', s1[ax] > 20 && s1.filter(Boolean).length === 1, { ax, s1 });
// the side one (as numbers: |y| < 0.6, |z| < 0.5) and the front one replaced by an exact circle of 0.8
const made = await G(async () => {
  const W = window.__glina, c = [0, 0, 0];
  const circ = []; for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2; circ.push([Math.cos(a) * 0.8, Math.sin(a) * 0.8]); }
  W.shadows = [{ c, poly: [[-0.6, -0.5], [0.6, -0.5], [0.6, 0.5], [-0.6, 0.5]] }, null, { c, poly: circ }];
  const t0 = W.TOOLS.length;
  document.getElementById('bShadowMake').click();
  await new Promise((r) => { const k = setInterval(() => { if (!W.working) { clearInterval(k); r(); } }, 30); });
  const t = W.TOOLS[W.curTool], a = W.toolArrays(t), P = a.pos;
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return { tools: W.TOOLS.length - t0, name: t.name, open: W.hasOpenEdges(a.idx), min, max };
});
await idle();
const near = (a, b) => Math.abs(a - b) < 0.06;
check('„Направи от силуетите“: a new closed subtool, the circle from the front and the square from the side', made.tools === 1 && made.name === 'ShadowBox' && !made.open && near(made.max[0], 0.8) && near(made.min[0], -0.8) && near(made.max[1], 0.6) && near(made.min[1], -0.6) && near(made.max[2], 0.5) && near(made.min[2], -0.5), made);
await G(() => window.__glina.undo());
check('undo takes it away', await G(() => window.__glina.TOOLS.length === 1));
await G(() => document.getElementById('bShadowClear').click());
check('„Изчисти“ forgets the silhouettes', await G(() => window.__glina.shadows.every((s) => !s)));

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
