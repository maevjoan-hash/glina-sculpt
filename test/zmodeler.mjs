// ZModeler in short: Extrude and Inset of a polygroup: node test/zmodeler.mjs
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
const st = () => G(() => { const W = window.__glina, m = W.mesh; let rMax = 0, rMin = Infinity; for (let i = 0; i < m.n; i++) { const r = Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]); rMax = Math.max(rMax, r); rMin = Math.min(rMin, r); } return { n: m.n, f: m.f, rMax, rMin, open: W.hasOpenEdges(m.idx.subarray(0, m.f * 3)), undo: W.undoStack.length, groups: new Set(m.grp.subarray(0, m.n)).size }; });

// a group: a cap in front
await G(() => { const W = window.__glina, m = W.mesh, c = W.camera.position.clone().normalize(); for (let i = 0; i < m.n; i++) m.mask[i] = (m.pos[i * 3] * c.x + m.pos[i * 3 + 1] * c.y + m.pos[i * 3 + 2] * c.z) > 0.85 ? 1 : 0; W.groupOp('frommask'); W.maskOp('clear'); W.selectTool('zmodel'); W.brush().zm = 'inset'; });
const a = await st();
await drag([[cx, cy], [cx, cy - 25]]);
const b = await st();
check('Inset: a ring along the rim of the group, still closed, one step', b.f > a.f && b.n > a.n && !b.open && b.undo === a.undo + 1 && Math.abs(b.rMax - a.rMax) < 0.01, { a, b });
await G(() => { window.__glina.brush().zm = 'extrude'; });
await drag([[cx, cy], [cx, cy - 60]]);
const c = await st();
check('Extrude: the group lifted out with walls, still closed', c.f > b.f && !c.open && c.rMax > 1.05 && c.undo === b.undo + 1, { c });
await G(() => window.__glina.undo()); await frames(2);
await drag([[cx, cy], [cx, cy + 40]]);
const d = await st();
check('Extrude inward makes a hollow (the group goes below the surface)', !d.open && d.rMin < 0.97, { d });
await G(() => window.__glina.undo()); await frames(2);
await G(() => window.__glina.undo()); await frames(2);
const e = await st();
check('undo takes all three back', e.f === a.f && e.n === a.n, { e });
// Bevel: out and narrower at once: the top of the lifted group is smaller than its foot
await G(() => { window.__glina.brush().zm = 'bevel'; });
const pb = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
await drag([[cx, cy], [cx, cy - 40]]);
const bev = await G(() => {
  const W = window.__glina, m = W.mesh, c = W.camera.position.clone().normalize();
  // the points furthest out (the new top) and how wide they spread square to the view
  let top = 0; for (let i = 0; i < m.n; i++) top = Math.max(top, m.pos[i * 3] * c.x + m.pos[i * 3 + 1] * c.y + m.pos[i * 3 + 2] * c.z);
  let w = 0; for (let i = 0; i < m.n; i++) { const h = m.pos[i * 3] * c.x + m.pos[i * 3 + 1] * c.y + m.pos[i * 3 + 2] * c.z; if (h > top - 1e-4) { const px = m.pos[i * 3] - c.x * h, py = m.pos[i * 3 + 1] - c.y * h, pz = m.pos[i * 3 + 2] - c.z * h; w = Math.max(w, Math.hypot(px, py, pz)); } }
  return { top, w, open: W.hasOpenEdges(m.idx.subarray(0, m.f * 3)), undo: W.undoStack.length };
});
// the group's own width at its foot: the cap of the sphere beyond 0.85 has radius sqrt(1 − 0.85²) ≈ 0.53
check('Bevel: lifted with a chamfer (its top narrower than its foot), closed, one step', bev.top > 1.03 && bev.w < 0.5 && !bev.open && bev.undo === e.undo + 1, bev);
await G(() => window.__glina.undo()); await frames(2);
await G(() => { window.__glina.brush().zm = 'extrude'; });
// a press and no drag changes nothing
await page.mouse.click(cx, cy); await frames(3);
check('a click without a drag changes nothing', (await st()).f === a.f && (await st()).undo === e.undo);
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
