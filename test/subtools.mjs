// SubTools, Gizmo 3D, booleans in the Rust core, Groups Split, Extract, autosave of every subtool:
// node test/subtools.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const URL_ = pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href;
await page.goto(URL_);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3); await idle(); await frames(2);
}
const st = () => page.evaluate(() => {
  const G = window.__glina, a = G.toolArrays(G.TOOLS[G.curTool]);
  let sp = 0, vol = 0; for (let i = 0; i < a.pos.length; i++) sp += a.pos[i] * ((i % 7) + 1);
  const P = a.pos; for (let t = 0; t < a.idx.length; t += 3) { const i = a.idx[t] * 3, j = a.idx[t + 1] * 3, k = a.idx[t + 2] * 3; vol += P[i] * (P[j + 1] * P[k + 2] - P[j + 2] * P[k + 1]) - P[i + 1] * (P[j] * P[k + 2] - P[j + 2] * P[k]) + P[i + 2] * (P[j] * P[k + 1] - P[j + 1] * P[k]); }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
  return { tools: G.TOOLS.length, cur: G.curTool, names: G.TOOLS.map((t) => t.name), sp, vol: vol / 6, f: a.idx.length / 3, open: G.hasOpenEdges(a.idx), undo: G.undoStack.length, x: [x0, x1], y: [y0, y1] };
});
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const G = (fn, arg) => page.evaluate(fn, arg);

await G(() => { window.__glina.S.sym = false; window.__glina.syncSym(); });
let a = await st();
check('one subtool to start', a.tools === 1 && a.cur === 0, a);
await G(() => window.__glina.appendPrimitive('cube')); await frames(2);
let b = await st();
check('a new subtool from a primitive becomes active', b.tools === 2 && b.cur === 1 && b.names[1] === 'Куб' && !b.open, b);
await G(() => window.__glina.undo()); await frames(2);
check('undo removes it', (await st()).tools === 1);
await G(() => window.__glina.redo()); await frames(2);
check('redo brings it back', (await st()).tools === 2);

// strokes on two subtools, undone in order across them
await G(() => window.__glina.selectTool('draw'));
// where a subtool's middle is on screen
const centreOf = (k) => G((kk) => { const W = window.__glina, a = W.toolArrays(W.TOOLS[kk]); let x = 0, y = 0, z = 0; const n = a.pos.length / 3; for (let i = 0; i < n; i++) { x += a.pos[i * 3]; y += a.pos[i * 3 + 1]; z += a.pos[i * 3 + 2]; } const v = W.camera.position.clone().set(x / n, y / n, z / n).project(W.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (0.5 - v.y * 0.5) * r.height]; }, k);
const cc = await centreOf(1);
const cube0 = await st();
await drag([[cc[0] - 15, cc[1] - 5], [cc[0] + 15, cc[1] + 5]]);
const cube1 = await st();
await G(() => window.__glina.activateTool(0)); await frames(2);
const sph0 = await st();
await drag([[cx - 60, cy + 120], [cx + 60, cy + 110]]);
const sph1 = await st();
check('strokes change the active subtool only', cube1.sp !== cube0.sp && sph1.sp !== sph0.sp && sph1.cur === 0, { cube: [cube0.sp, cube1.sp], sph: [sph0.sp, sph1.sp] });
await G(() => window.__glina.undo()); await frames(2);
const u1 = await st();
await G(() => window.__glina.undo()); await frames(2);
const u2 = await st();
check('undo goes back through both: the sphere, then the cube (which becomes active)', u1.cur === 0 && Math.abs(u1.sp - sph0.sp) < 1e-6 * Math.abs(sph0.sp) && u2.cur === 1 && Math.abs(u2.sp - cube0.sp) < 1e-6 * Math.abs(cube0.sp), { u1: [u1.cur, u1.sp, sph0.sp], u2: [u2.cur, u2.sp, cube0.sp] });

// a click on the other subtool selects it
await G(() => window.__glina.activateTool(1)); await frames(2);
const sphPt = await centreOf(0);
await page.mouse.click(sphPt[0] - 60, sphPt[1] + 60); await frames(3);
check('a click on another subtool makes it active', (await st()).cur === 0);
await G(() => window.__glina.activateTool(1)); await frames(2);

// Gizmo: move along X, scale along Y, undo
await G(() => { const W = window.__glina; W.selectTool('gizmo'); W.brush().gz = 'move'; });
await frames(2);
const gs = await G(() => window.__glina.gizmoScreen() && { c: window.__glina.gizmoScreen().c, x: window.__glina.gizmoScreen().ends[0] });
const before = await st();
const mid = [box.x + (gs.c[0] + gs.x[0]) / 2, box.y + (gs.c[1] + gs.x[1]) / 2];
const dir = [gs.x[0] - gs.c[0], gs.x[1] - gs.c[1]];
await drag([mid, [mid[0] + dir[0] * 0.5, mid[1] + dir[1] * 0.5]]);
const mv = await st();
const dx0 = mv.x[0] - before.x[0], dx1 = mv.x[1] - before.x[1];
check('Gizmo X arrow moves along X only', dx0 > 0.01 && Math.abs(dx0 - dx1) < 1e-4 && Math.abs(mv.y[0] - before.y[0]) < 1e-5 && mv.undo === before.undo + 1, { dx: [dx0, dx1], dy: mv.y[0] - before.y[0] });
await G(() => window.__glina.undo()); await frames(2);
check('undo puts it back', Math.abs((await st()).sp - before.sp) < 1e-6 * Math.abs(before.sp));
await G(() => { window.__glina.brush().gz = 'scale'; }); await frames(2);
const gy = await G(() => { const g = window.__glina.gizmoScreen(); return { c: g.c, y: g.ends[1] }; });
const midY = [box.x + (gy.c[0] + gy.y[0]) / 2, box.y + (gy.c[1] + gy.y[1]) / 2], dirY = [gy.y[0] - gy.c[0], gy.y[1] - gy.c[1]];
await drag([midY, [midY[0] + dirY[0] * 0.5, midY[1] + dirY[1] * 0.5]]);
const sc = await st();
const hy0 = before.y[1] - before.y[0], hy1 = sc.y[1] - sc.y[0], hx0 = before.x[1] - before.x[0], hx1 = sc.x[1] - sc.x[0];
check('Gizmo Y arrow in scale mode stretches along Y only', hy1 > hy0 * 1.2 && Math.abs(hx1 - hx0) < 1e-4, { hy: [hy0, hy1], hx: [hx0, hx1] });
await G(() => window.__glina.undo()); await frames(2);
await G(() => { window.__glina.brush().gz = 'rotate'; }); await frames(2);
const gz = await G(() => { const g = window.__glina.gizmoScreen(); return { c: g.c, z: g.ends[2] }; });
const midZ = [box.x + (gz.c[0] + gz.z[0]) / 2, box.y + (gz.c[1] + gz.z[1]) / 2];
await drag([midZ, [midZ[0] + 40, midZ[1] - 40], [midZ[0] + 60, midZ[1] + 20]]);
const ro = await st();
check('Gizmo Z arrow in rotate mode turns it (volume kept)', ro.sp !== before.sp && Math.abs(ro.vol - before.vol) < 1e-3 * Math.abs(before.vol), { vol: [before.vol, ro.vol] });
await G(() => window.__glina.undo()); await frames(2);

// Boolean in the Rust core: sphere minus a cube moved to its edge
await G(() => { const W = window.__glina; W.selectTool('draw'); W.TOOLS[1].op = 'subtract'; });
// move the cube off centre so it bites the sphere
await G(() => { const W = window.__glina, m = W.mesh; let cx = 0, cy = 0, cz = 0; for (let i = 0; i < m.n; i++) { cx += m.pos[i * 3]; cy += m.pos[i * 3 + 1]; cz += m.pos[i * 3 + 2]; } cx /= m.n; cy /= m.n; cz /= m.n; for (let i = 0; i < m.n; i++) { m.pos[i * 3] += 0.9 - cx; m.pos[i * 3 + 1] -= cy; m.pos[i * 3 + 2] -= cz; } });
const sphVol = await G(() => { const W = window.__glina, a = W.toolArrays(W.TOOLS[0]); let v = 0; const P = a.pos; for (let t = 0; t < a.idx.length; t += 3) { const i = a.idx[t] * 3, j = a.idx[t + 1] * 3, k = a.idx[t + 2] * 3; v += P[i] * (P[j + 1] * P[k + 2] - P[j + 2] * P[k + 1]) - P[i + 1] * (P[j] * P[k + 2] - P[j + 2] * P[k]) + P[i + 2] * (P[j] * P[k + 1] - P[j + 1] * P[k]); } return v / 6; });
const t0 = Date.now();
await G(() => window.__glina.makeBoolean()); await idle(); await frames(3);
const bo = await st();
check('Boolean (sphere − cube) in the Rust core: a new closed subtool, smaller, the parts hidden', bo.tools === 3 && bo.cur === 2 && bo.names[2] === 'Булево' && !bo.open && bo.vol < sphVol * 0.97 && bo.vol > sphVol * 0.5, { vol: [sphVol, bo.vol], ms: Date.now() - t0 });
const vis = await G(() => window.__glina.TOOLS.map((t) => t.visible));
check('the parts are hidden, not deleted', vis[0] === false && vis[1] === false && vis[2] === true, vis);
await G(() => window.__glina.undo()); await frames(2);
const ub = await st();
check('undo takes the boolean away and shows the parts', ub.tools === 2 && (await G(() => window.__glina.TOOLS.every((t) => t.visible))), ub);

// Merge Down, then Groups Split
await G(() => { const W = window.__glina; W.TOOLS[1].op = 'add'; W.activateTool(0); }); await frames(2);
const f0 = await G(() => window.__glina.TOOLS.map((t) => window.__glina.toolArrays(t).idx.length / 3));
await G(() => window.__glina.mergeDown()); await frames(2);
const md = await st();
check('Merge Down: one subtool with both', md.tools === 1 && md.f === f0[0] + f0[1], { f0, f: md.f });
await G(() => window.__glina.splitGroups()); await frames(2);
const sg = await st();
const f1 = await G(() => window.__glina.TOOLS.map((t) => window.__glina.toolArrays(t).idx.length / 3));
check('Groups Split: back to two subtools with the same triangles', sg.tools === 2 && f1[0] + f1[1] === f0[0] + f0[1], { f1 });

// Extract a shell from the mask
await G(() => { const W = window.__glina; W.activateTool(0); const m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.5 ? 1 : 0; });
await G(() => window.__glina.extractTool()); await frames(2);
const ex = await st();
check('Extract: a new closed subtool from the masked area', ex.tools === 3 && ex.names[ex.cur] === 'Извадено' && !ex.open && ex.vol > 0, { open: ex.open, vol: ex.vol, f: ex.f });

// duplicate, order, delete
await G(() => window.__glina.duplicateTool()); await frames(2);
let d = await st();
check('duplicate adds a copy after the active one', d.tools === 4 && d.names[d.cur].endsWith('(копие)'), d.names);
await G(() => window.__glina.moveTool(-1)); await frames(2);
const mvd = await st();
check('moving up swaps with the one above', mvd.cur === d.cur - 1 && mvd.names[mvd.cur].endsWith('(копие)'), mvd.names);
await G(() => window.__glina.deleteTool()); await frames(2);
check('delete removes the active one', (await st()).tools === 3);

// export: one object per visible subtool
const objCount = await G(() => (new TextDecoder().decode(window.__glina.exportOBJ()).match(/^o /gm) || []).length);
check('OBJ export has every visible subtool', objCount === 3, { objCount });

// the remesh runs in the worker
const where = await G(async () => (await window.__glina.coreStart()).where);
await G(() => window.__glina.activateTool(0)); await frames(2);
const r0 = await st();
await G(() => window.__glina.remesh()); await idle(); await frames(2);
const r1 = await st();
check('remesh by the Rust core in a worker', where === 'worker' && r1.f !== r0.f && !r1.open, { where, f: [r0.f, r1.f] });

// every subtool comes back after a reload
const names = (await st()).names;
await G(() => window.__glina.scheduleAutosave());
await page.waitForTimeout(3500);
await page.reload();
await page.waitForFunction(() => window.__glina && window.__glina.TOOLS && window.__glina.TOOLS.length > 1, null, { timeout: 20000 }).catch(() => {});
const re = await st();
check('after a reload every subtool is back', re.tools === names.length && re.names.join('|') === names.join('|'), { before: names, after: re.names });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
