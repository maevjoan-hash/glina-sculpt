// HistoryRecall (the Morph brush toward a step of the history) and FiberMesh: node test/fibers.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.S.sym = false; window.__glina.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 10) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const orig = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
const away = () => G((o) => { const m = window.__glina.mesh; let s = 0; for (let i = 0; i < m.n * 3; i++) s += Math.abs(m.pos[i] - o[i]); return s; }, orig);

// two strokes, then the shape from the very start of the history is what the Morph brush paints back to
await G(() => window.__glina.selectTool('draw'));
await drag([[cx - 90, cy], [cx + 90, cy]]);
await drag([[cx - 90, cy + 20], [cx + 90, cy + 20]]);
const a0 = await away();
await G(() => document.getElementById('bRecall').click());
await G(() => document.querySelector('#history .hstep').click()); await frames(3);
const st = await G(() => ({ tool: window.__glina.S.tool, recall: !!document.querySelector('#history .hstep.recall'), undo: window.__glina.undoStack.length }));
check('„Форма от стъпка“ + a click on a history mark: that shape is stored, the history stays where it was', st.tool === 'morph' && st.recall && st.undo === 2 && Math.abs((await away()) - a0) < 1e-6 * a0, st);
await drag([[cx - 90, cy + 10], [cx + 90, cy + 10]]);
const a1 = await away();
check('the Morph brush then paints back toward the start (HistoryRecall)', a1 < a0 * 0.8, { a0, a1 });

// FiberMesh from the masked crown
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.6 ? 1 : 0; Object.assign(W.S, { fibCount: 300, fibLength: 0.3, fibWidth: 0.008, fibGravity: 0.6, fibVary: 0.3 }); W.makeFibers(); });
await frames(3);
const fb = await G(() => {
  const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t);
  let nan = 0, lo = Infinity, hi = -Infinity, minR = Infinity;
  for (let i = 0; i < a.pos.length; i += 3) { if (!Number.isFinite(a.pos[i] + a.pos[i + 1] + a.pos[i + 2])) nan++; lo = Math.min(lo, a.pos[i + 1]); hi = Math.max(hi, a.pos[i + 1]); minR = Math.min(minR, Math.hypot(a.pos[i], a.pos[i + 1], a.pos[i + 2])); }
  return { tools: W.TOOLS.length, name: t.name, f: a.idx.length / 3, open: W.hasOpenEdges(a.idx), nan, lo, hi, minR };
});
check('fibres grow out of the mask as a new closed subtool', fb.tools === 2 && fb.name === 'Косми' && fb.f > 300 * 20 && !fb.open && fb.nan === 0 && fb.minR > 0.5 && fb.hi > 1.05, fb);
await G(() => window.__glina.undo()); await frames(2);
check('undo takes the fibres away', (await G(() => window.__glina.TOOLS.length)) === 1);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
