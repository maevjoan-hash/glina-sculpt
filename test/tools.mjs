// Planar, Layer, Magnify, Blob, Move Infinite Depth, Slice, Mirror (and Weld), surface noise, the view
// without perspective, snapping views, the history bar and dynamic brush size: node test/tools.mjs
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
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  }
  await page.mouse.up(); await frames(3); await idle(); await frames(2);
}
const state = () => page.evaluate(() => {
  const G = window.__glina, m = G.mesh, a = m.dyn ? m.arrays() : { pos: m.pos.subarray(0, m.n * 3), idx: m.idx.subarray(0, m.f * 3), grp: m.grp };
  let sp = 0; const n = a.pos.length / 3, groups = new Set();
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n * 3; i++) sp += a.pos[i] * ((i % 7) + 1);
  for (let i = 0; i < n; i++) { groups.add(a.grp[i]); minX = Math.min(minX, a.pos[i * 3]); maxX = Math.max(maxX, a.pos[i * 3]); }
  return { sp, n, f: a.idx.length / 3, groups: groups.size, open: G.hasOpenEdges(a.idx), undo: G.undoStack.length, minX, maxX };
});
const snapPos = () => page.evaluate(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const same = (a, b) => Math.abs(a.sp - b.sp) < 1e-6 * Math.abs(a.sp) && a.f === b.f;

for (const dyn of [false, true]) {
  const D = dyn ? 'dyn ' : '';
  await page.evaluate((d) => { const G = window.__glina; G.setDyntopo(d); G.S.sym = false; G.syncSym(); }, dyn);
  for (const id of ['planar', 'layer', 'magnify', 'blob']) {
    await page.evaluate((i) => window.__glina.selectTool(i), id);
    const a = await state();
    await drag([[cx - 60, cy + 10], [cx + 40, cy + 30]]);
    const b = await state();
    check(`${D}${id} changes the model in one step`, b.sp !== a.sp && b.undo === a.undo + 1, { undo: [a.undo, b.undo] });
  }
}
await page.evaluate(() => { const G = window.__glina; G.setDyntopo(false); while (G.undoStack.length) G.undo(); });

// Layer: going back and forth raises no higher than one pass (Draw keeps adding)
async function peak(id, pts) {
  await page.evaluate((i) => { const G = window.__glina; G.selectTool(i); }, id);
  const p0 = await snapPos();
  await drag(pts, 10);
  const p1 = await snapPos();
  await page.evaluate(() => window.__glina.undo()); await frames(2);
  let mx = 0; for (let i = 0; i < p0.length; i += 3) mx = Math.max(mx, Math.hypot(p1[i] - p0[i], p1[i + 1] - p0[i + 1], p1[i + 2] - p0[i + 2]));
  return mx;
}
const one = [[cx - 60, cy], [cx + 60, cy]], three = [[cx - 60, cy], [cx + 60, cy], [cx - 60, cy], [cx + 60, cy]];
const l1 = await peak('layer', one), l3 = await peak('layer', three), d1 = await peak('draw', one), d3 = await peak('draw', three);
check('Layer: three passes rise no higher than one; Draw keeps adding', l3 < l1 * 1.15 && d3 > d1 * 1.5, { layer: [l1, l3], draw: [d1, d3] });

// Move Infinite Depth reaches the back of the sphere
async function backMoved(id) {
  await page.evaluate((i) => window.__glina.selectTool(i), id);
  const p0 = await snapPos();
  const camZ = await page.evaluate(() => window.__glina.camera.position.clone().normalize().toArray());
  await drag([[cx, cy], [cx + 60, cy]], 6);
  const p1 = await snapPos();
  await page.evaluate(() => window.__glina.undo()); await frames(2);
  let c = 0; for (let i = 0; i < p0.length; i += 3) if (p0[i] * camZ[0] + p0[i + 1] * camZ[1] + p0[i + 2] * camZ[2] < -0.5 && Math.hypot(p1[i] - p0[i], p1[i + 1] - p0[i + 1], p1[i + 2] - p0[i + 2]) > 1e-4) c++;
  return c;
}
const deep = await backMoved('movedeep'), plain = await backMoved('grab');
check('Move Infinite Depth moves the back too, Move does not', deep > 50 && plain === 0, { deep, plain });

// Slice: a new group along a line, closed, undo
await page.evaluate(() => window.__glina.selectTool('slice'));
let a = await state();
await drag([[cx + 10, cy - 150], [cx + 30, cy + 250]], 6);
let b = await state();
check('Slice adds a group along the line, keeps the mesh closed', b.groups === a.groups + 1 && b.f > a.f && !b.open && b.undo === a.undo + 1, { g: [a.groups, b.groups], f: [a.f, b.f] });
await page.evaluate(() => window.__glina.undo()); await frames(2);
check('undo takes the slice back', same(await state(), a));

// Mirror and Weld after a one-sided stroke: closed and symmetric
await page.evaluate(() => window.__glina.selectTool('draw'));
await drag([[cx + 60, cy - 40], [cx + 100, cy + 20]]);
a = await state();
await page.evaluate(() => window.__glina.mirrorWeld()); await idle(); await frames(2);
b = await state();
const sym = await page.evaluate(() => {
  const m = window.__glina.mesh, P = m.pos, keys = new Set();
  const k = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
  for (let i = 0; i < m.n; i++) keys.add(k(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  let miss = 0; for (let i = 0; i < m.n; i++) if (!keys.has(k(-P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) miss++;
  return { miss, n: m.n };
});
check('Mirror and Weld: closed, every point has its mirror image', !b.open && sym.miss === 0 && b.undo === a.undo + 1, { ...sym, open: b.open });
await page.evaluate(() => window.__glina.undo()); await frames(2);
check('undo takes Mirror and Weld back', same(await state(), a));
await page.evaluate(() => window.__glina.mirrorFlip()); await frames(2);
b = await state();
check('Mirror flips across X', Math.abs(b.minX + a.maxX) < 1e-5 && Math.abs(b.maxX + a.minX) < 1e-5 && !b.open, { a: [a.minX, a.maxX], b: [b.minX, b.maxX] });
await page.evaluate(() => window.__glina.undo()); await frames(2);

// surface noise
a = await state();
await page.evaluate(() => window.__glina.applyNoise()); await frames(2);
b = await state();
check('surface noise changes the model in one step', b.sp !== a.sp && b.undo === a.undo + 1);
await page.evaluate(() => window.__glina.undo()); await frames(2);
check('undo takes the noise back', same(await state(), a));

// view without perspective: picking, Trim and the framing still work
const v0 = await page.evaluate(() => { const G = window.__glina; const h = G.pick(550, 380); return h ? h.point.toArray() : null; });
await page.evaluate(() => window.__glina.setOrtho(true)); await frames(2);
const v1 = await page.evaluate(() => { const G = window.__glina; const r = document.getElementById('gl').getBoundingClientRect(); const h = G.pick(r.width / 2, r.height / 2); return { fov: G.camera.fov, hit: !!h }; });
await page.evaluate(() => window.__glina.selectTool('cut'));
a = await state();
await drag([[cx + 40, cy - 150], [cx + 40, cy + 250]], 6);
b = await state();
check('without perspective: narrow camera, picking and Trim work', v1.fov < 2 && v1.hit && b.f !== a.f && !b.open && !!v0, { v1, f: [a.f, b.f] });
await page.evaluate(() => { const G = window.__glina; G.undo(); G.setOrtho(false); }); await frames(2);

// Shift while turning: straight along an axis
const axis = await page.evaluate(() => { const G = window.__glina; G.orbit(37, 21); G.snapView(); const c = G.camera, b = c.position.clone().sub(G.cam.target).normalize(); return Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.z)); });
check('snapped view looks straight along an axis', axis > 0.99999, { axis });

// history bar: jump back and forward
await page.evaluate(() => window.__glina.selectTool('draw'));
const h0 = await state();
for (let k = 0; k < 3; k++) await drag([[cx - 50, cy - 60 + k * 30], [cx + 50, cy - 60 + k * 30]], 5);
const h1 = await state();
const marks = await page.evaluate(() => document.querySelectorAll('#history .hstep').length);
await page.evaluate((n) => window.__glina.historyJump(n), h0.undo); await frames(2);
const h2 = await state();
await page.evaluate((n) => window.__glina.historyJump(n), h1.undo); await frames(2);
const h3 = await state();
check('history bar: one mark per step, jumps back and forward', marks === h1.undo + 1 && same(h2, h0) && same(h3, h1), { marks, undo: [h0.undo, h1.undo, h2.undo, h3.undo] });
await page.evaluate(async () => { const b = document.querySelector('#history .hstep'); b.click(); }); await frames(2);
check('a click on the first mark goes to the start', (await state()).undo === 0);

// Polyframe and dynamic size
const pf = await page.evaluate(() => { const G = window.__glina; G.polyframe(); const on = [G.S.wire, G.S.showGroups]; G.polyframe(); return { on, off: [G.S.wire, G.S.showGroups] }; });
check('Shift+F shows and hides the wire with the groups', pf.on.every(Boolean) && !pf.off.some(Boolean), pf);
const ds = await page.evaluate(() => {
  const G = window.__glina; G.selectTool('draw');
  const el = document.getElementById('tDynSize'); el.checked = true; el.dispatchEvent(new Event('change'));
  const r0 = G.brush().radius; const w0 = G.cam.dist; G.cam.dist = w0 / 2;
  const k = G.S.dynRef / G.cam.dist; G.cam.dist = w0; el.checked = false; el.dispatchEvent(new Event('change'));
  return { k, r0 };
});
check('Dynamic size: zooming in twice as close doubles the brush on screen', Math.abs(ds.k - 2) < 1e-9, ds);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
