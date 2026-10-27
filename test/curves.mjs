// Insert a shape, curve strokes and tubes along a curve, in headless Chromium: node test/curves.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(pts, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    for (let i = 1; i <= 6; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await frames(1); }
  }
  await page.mouse.up(); await frames(3); await idle(); await frames(2);
  for (const m of mods) await page.keyboard.up(m);
}
const state = () => page.evaluate(() => {
  const G = window.__glina, m = G.mesh, a = m.dyn ? m.arrays() : { pos: m.pos.subarray(0, m.n * 3), idx: m.idx.subarray(0, m.f * 3), grp: m.grp, mask: m.mask };
  let sp = 0, sm = 0, gmax = 0; const n = a.pos.length / 3;
  for (let i = 0; i < n * 3; i++) sp += a.pos[i] * ((i % 7) + 1);
  for (let i = 0; i < n; i++) { sm += a.mask[i]; gmax = Math.max(gmax, a.grp[i]); }
  return { sp, sm, gmax, n, f: a.idx.length / 3, open: G.hasOpenEdges(a.idx), undo: G.undoStack.length, curve: !!G.curve };
});
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// the shapes themselves: closed, outward
const shapes = await page.evaluate(() => ['sphere', 'cube', 'cylinder', 'cone', 'torus'].map((k) => {
  const s = window.__glina.immShape(k, 0.1); let v = 0;
  for (let t = 0; t < s.idx.length; t += 3) { const P = s.pos, a = s.idx[t] * 3, b = s.idx[t + 1] * 3, c = s.idx[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  return { k, f: s.idx.length / 3, open: window.__glina.hasOpenEdges(s.idx), vol: v / 6 };
}));
for (const s of shapes) check(`shape ${s.k}: closed, faces outward`, !s.open && s.vol > 0 && s.f > 20, s);

for (const dyn of [false, true]) {
  const D = dyn ? 'dyn ' : '';
  await page.evaluate((d) => { const G = window.__glina; G.setDyntopo(d); G.maskOp('clear'); G.S.sym = false; G.S.symY = false; G.S.symZ = false; G.S.radial = 0; G.syncSym(); }, dyn);
  // Insert: a sphere, dragged out from the middle
  await page.evaluate(() => { const G = window.__glina; G.selectTool('imm'); G.brush().imm = 'sphere'; });
  let a = await state();
  await drag([[cx + 20, cy], [cx + 90, cy + 10]]);
  let b = await state();
  check(`${D}insert adds a closed part as a new group, rest masked, one undo step`, b.f > a.f && b.gmax > a.gmax && !b.open && b.sm >= a.n - 1 && b.undo === a.undo + 1, { f: [a.f, b.f], g: [a.gmax, b.gmax], mask: b.sm, n: a.n });
  await page.evaluate(() => window.__glina.undo()); await frames(2);
  let u = await state();
  check(`${D}undo takes the part out`, u.f === a.f && Math.abs(u.sp - a.sp) < 1e-6 * Math.abs(a.sp), { f: u.f });
  // with X symmetry: two copies
  await page.evaluate(() => { const G = window.__glina; G.S.sym = true; G.syncSym(); G.brush().imm = 'cylinder'; });
  a = await state();
  await drag([[cx + 60, cy - 30], [cx + 110, cy - 30]]);
  b = await state();
  check(`${D}insert with symmetry adds two copies`, b.f > a.f && (b.f - a.f) % 2 === 0 && !b.open, { add: b.f - a.f });
  await page.evaluate(() => { const G = window.__glina; G.undo(); G.maskOp('clear'); G.S.sym = false; G.syncSym(); }); await frames(2);

  // Curve stroke: draw, then bend, then undo
  await page.evaluate(() => window.__glina.selectTool('curvedam'));
  a = await state();
  await drag([[cx - 80, cy + 40], [cx - 20, cy + 20], [cx + 40, cy + 40], [cx + 90, cy + 20]]);
  b = await state();
  check(`${D}curve stroke changes the model in one step and the curve stays`, b.sp !== a.sp && b.undo === a.undo + 1 && b.curve, { undo: [a.undo, b.undo], curve: b.curve });
  // bend it: grab the middle and pull down
  const mid = await page.evaluate(() => { const c = window.__glina.curve; const q = c.pts[Math.floor(c.pts.length / 2)].p.clone().project(window.__glina.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + (q.x * 0.5 + 0.5) * r.width, r.top + (0.5 - q.y * 0.5) * r.height]; });
  await drag([mid, [mid[0], mid[1] + 40]]);
  const c = await state();
  check(`${D}bending the curve redoes the stroke (still one step)`, c.sp !== b.sp && c.undo === b.undo && c.curve, { undo: [b.undo, c.undo] });
  await page.evaluate(() => window.__glina.undo()); await frames(2);
  u = await state();
  check(`${D}undo after bending gives back the model from before the curve`, Math.abs(u.sp - a.sp) < 1e-6 * Math.abs(a.sp) && u.f === a.f && !u.curve, { a: a.sp, u: u.sp, curve: u.curve });
  // a press away from the curve starts a new one; Esc lets it go
  await drag([[cx - 60, cy - 60], [cx + 60, cy - 70]]);
  check(`${D}a new curve`, (await state()).curve);
  await page.keyboard.press('Escape'); await frames(2);
  check(`${D}Esc lets the curve go`, !(await state()).curve);

  // Tube along a curve, bent, undone
  await page.evaluate(() => { const G = window.__glina; G.selectTool('tube'); G.brush().taper = 0.3; });
  a = await state();
  await drag([[cx - 90, cy - 10], [cx - 30, cy - 40], [cx + 30, cy - 10], [cx + 90, cy - 40]]);
  b = await state();
  check(`${D}tube adds a closed part as a new group`, b.f > a.f && !b.open && b.gmax > a.gmax && b.undo === a.undo + 1 && b.curve, { f: [a.f, b.f], open: b.open });
  const mid2 = await page.evaluate(() => { const c = window.__glina.curve; const q = c.pts[Math.floor(c.pts.length / 2)].p.clone().project(window.__glina.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + (q.x * 0.5 + 0.5) * r.width, r.top + (0.5 - q.y * 0.5) * r.height]; });
  await drag([mid2, [mid2[0] + 10, mid2[1] - 50]]);
  const t2 = await state();
  check(`${D}bending the tube rebuilds it (still one step)`, t2.sp !== b.sp && t2.undo === b.undo && !t2.open, { undo: [b.undo, t2.undo] });
  await page.evaluate(() => window.__glina.undo()); await frames(2);
  u = await state();
  check(`${D}undo takes the tube out`, u.f === a.f && Math.abs(u.sp - a.sp) < 1e-6 * Math.abs(a.sp), { f: [a.f, u.f] });
}
// a tube along a sharp zig-zag stays sound
const zz = await page.evaluate(() => {
  const V = window.__glina.camera.position.constructor;
  const pts = []; for (let i = 0; i < 40; i++) pts.push({ p: new V(i * 0.02, (i % 2) * 0.03, 0), n: new V(0, 0, 1) });
  const t = window.__glina.tubeArrays(pts, 0.02, 0.5, 0.008);
  let bad = 0; for (let k = 0; k < t.pos.length; k++) if (!Number.isFinite(t.pos[k])) bad++;
  return { f: t.idx.length / 3, open: window.__glina.hasOpenEdges(t.idx), bad };
});
check('tube along a zig-zag: closed, no NaN', !zz.open && zz.bad === 0 && zz.f > 100, zz);
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
