// Project All (Rust core) and the Extender deformer: node test/project.mjs
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
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.S.sym = false; window.__glina.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 6) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const top = () => G(() => { const m = window.__glina.mesh; let r = 0; for (let i = 0; i < m.n; i++) r = Math.max(r, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2])); return r; });

// a sharp bump on the sphere, a copy of it in the same place, the copy remeshed coarse (the bump goes soft)
await G(() => window.__glina.selectTool('draw'));
await G(() => { window.__glina.brush().radius = 45; window.__glina.brush().strength = 1; });
for (let k = 0; k < 6; k++) await drag([[cx - 2, cy], [cx + 2, cy]], 2);
const r0 = await top();
await G(() => { const W = window.__glina; W.addTool(new W.mesh.constructor(...(() => { const a = W.toolArrays(W.TOOLS[0]); return [Float32Array.from(a.pos), Uint32Array.from(a.idx), Float32Array.from(a.col), new Float32Array(a.pos.length / 3), 0, Float32Array.from(a.grp)]; })()), 'Копие'); W.S.voxel = 48; W.remesh(); });
await idle(); await frames(2);
const r1 = await top();
await G(() => window.__glina.divide()); await idle(); await frames(4);
await G(() => window.__glina.projectAll()); await idle(); await frames(2);
const r2 = await top();
await G(() => window.__glina.undo()); await frames(2);
const r3 = await top();   // the soft copy, as it was before the projection
check('Project All brings the bump back onto the soft, coarse copy', r3 < r0 - 0.003 && Math.abs(r2 - r0) < Math.abs(r3 - r0) * 0.35, { r0, r1, soft: r3, projected: r2 });
check('undo takes the projection back', r3 < r2);

// Extender: a cylinder made longer along Y
await G(() => { const W = window.__glina; W.appendPrimitive('cylinder'); W.S.defAxis = 1; }); await frames(2);
const h = () => G(() => { const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]); let lo = Infinity, hi = -Infinity; for (let i = 1; i < a.pos.length; i += 3) { lo = Math.min(lo, a.pos[i]); hi = Math.max(hi, a.pos[i]); } return { lo, hi }; });
const e0 = await h();
await G(() => window.__glina.deform('extend', 0.5)); await frames(2);
const e1 = await h();
check('Extender makes it half again as long, from its far end', Math.abs((e1.hi - e1.lo) - (e0.hi - e0.lo) * 1.5) < 0.02 * (e0.hi - e0.lo) && Math.abs(e1.lo - e0.lo) < 1e-5, { e0, e1 });
await G(() => window.__glina.undo()); await frames(2);
const e2 = await h();
check('undo makes it short again', Math.abs(e2.hi - e0.hi) < 1e-6);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
