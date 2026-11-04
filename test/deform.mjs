// Gizmo bar, rings, pinned centre, picking with the gizmo; mirrored copy; Bend / Twist / Taper; Array Mesh:
// node test/deform.mjs
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
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const st = () => G(() => {
  const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]), P = a.pos;
  let sp = 0, vol = 0; for (let i = 0; i < P.length; i++) sp += P[i] * ((i % 7) + 1);
  for (let t = 0; t < a.idx.length; t += 3) { const i = a.idx[t] * 3, j = a.idx[t + 1] * 3, k = a.idx[t + 2] * 3; vol += P[i] * (P[j + 1] * P[k + 2] - P[j + 2] * P[k + 1]) - P[i + 1] * (P[j] * P[k + 2] - P[j + 2] * P[k]) + P[i + 2] * (P[j] * P[k + 1] - P[j + 1] * P[k]); }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i + c]); hi[c] = Math.max(hi[c], P[i + c]); }
  return { tools: W.TOOLS.length, cur: W.curTool, name: W.TOOLS[W.curTool].name, sp, vol: vol / 6, f: a.idx.length / 3, lo, hi, undo: W.undoStack.length, open: W.hasOpenEdges(a.idx) };
});
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

await G(() => { const W = window.__glina; W.S.sym = false; W.syncSym(); });
// mirrored copy and a copy beside
const s0 = await st();
await G(() => { const W = window.__glina; W.appendPrimitive('cylinder'); }); await frames(2);
const cyl = await st();
await G(() => { document.getElementById('bToolMirror').click(); }); await frames(2);
const mir = await st();
check('mirrored copy: a new subtool on the other side of X', mir.tools === 3 && near(mir.lo[0], -cyl.hi[0]) && near(mir.hi[0], -cyl.lo[0]) && near(mir.vol, cyl.vol, 1e-4) && mir.name.endsWith('(огледано)'), { cyl: [cyl.lo[0], cyl.hi[0]], mir: [mir.lo[0], mir.hi[0]] });
await G(() => document.getElementById('bToolDup').click()); await frames(2);
const dup = await st();
check('a copy goes beside the original, not on top of it', dup.tools === 4 && (Math.abs(dup.lo[0] - mir.lo[0]) > 0.1 || Math.abs(dup.lo[2] - mir.lo[2]) > 0.1) && near(dup.vol, mir.vol, 1e-4), { a: mir.lo, b: dup.lo });
await G(() => { window.__glina.undo(); window.__glina.undo(); window.__glina.activateTool(1); }); await frames(2);

// the gizmo bar
await G(() => window.__glina.selectTool('gizmo')); await frames(2);
const bar = await G(() => !document.getElementById('gizmoBar').hidden);
await G(() => document.querySelector('#gizmoBar [data-gz=rotate]').click()); await frames(2);
const rings = await G(() => { const g = window.__glina.gizmoScreen(); return { mode: window.__glina.brush().gz, rings: g.rings ? g.rings.length : 0 }; });
check('the gizmo bar shows with the gizmo and switches it to turning, with three rings', bar && rings.mode === 'rotate' && rings.rings === 3, { bar, ...rings });
// a ring turns the part about its axis: the Y ring keeps the heights
const ry = await G(() => { const g = window.__glina.gizmoScreen(); return g.rings[1][6]; });   // (45°: not where the rings cross)
const before = await st();
await drag([[box.x + ry[0], box.y + ry[1]], [box.x + ry[0] + 30, box.y + ry[1] + 25], [box.x + ry[0] + 50, box.y + ry[1] + 60]]);
const turned = await st();
check('the Y ring turns about Y: heights stay, the shape turns', turned.sp !== before.sp && near(turned.lo[1], before.lo[1]) && near(turned.hi[1], before.hi[1]) && near(turned.vol, before.vol, 1e-3), { y: [before.lo[1], turned.lo[1]] });
await G(() => window.__glina.undo()); await frames(2);
// a finger gets a wider target
const tgt = await G(() => { const W = window.__glina; W.setGizmoMode('move'); const g = W.gizmoScreen(); const dx = g.ends[0][0] - g.c[0], dy = g.ends[0][1] - g.c[1], l = Math.hypot(dx, dy); const x = g.c[0] + dx * 0.6 - dy / l * 18, y = g.c[1] + dy * 0.6 + dx / l * 18; return { mouse: W.gizmoHandle(x, y, false), finger: W.gizmoHandle(x, y, true) }; });
check('a finger catches an arrow from farther away than the mouse', tgt.mouse === null && tgt.finger === 0, tgt);
// Alt+click on the model puts the centre there; Нулирай takes it back
const c0 = await G(() => window.__glina.gizmoScreen().c);
const tap = [box.x + c0[0] + 6, box.y + c0[1] - 25];
await page.keyboard.down('Alt'); await page.mouse.click(tap[0], tap[1]); await page.keyboard.up('Alt'); await frames(2);
const pin = await G(() => { const W = window.__glina; return { pinned: !!W.gizmoPin, c: W.gizmoScreen().c }; });
check('Alt+click on the model puts the gizmo centre there', pin.pinned && Math.hypot(pin.c[0] - (tap[0] - box.x), pin.c[1] - (tap[1] - box.y)) < 3, pin);
await G(() => document.getElementById('gzReset').click()); await frames(2);
check('„Нулирай“ puts it back in the middle', await G(() => !window.__glina.gizmoPin));
// with the gizmo, a click on another subtool still selects it
const sph = await G(() => { const W = window.__glina; const v = W.camera.position.clone().set(0, 0, 0).project(W.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width - 60, r.top + (0.5 - v.y * 0.5) * r.height + 40]; });
await page.mouse.click(sph[0], sph[1]); await frames(3);
check('with the gizmo, a click on another subtool selects it', (await st()).cur === 0);
await G(() => { const W = window.__glina; W.activateTool(1); W.selectTool('draw'); }); await frames(2);

// deformers on the cylinder (along Y)
const d0 = await st();
await G(() => { const W = window.__glina; W.S.defAxis = 1; W.S.defTo = 1; W.deform('bend', 90); }); await frames(2);
const bent = await st();
check('Bend 90° along Y toward X: the part curves (wider in X), volume about the same, one step', bent.hi[0] - bent.lo[0] > (d0.hi[0] - d0.lo[0]) * 1.3 && bent.undo === d0.undo + 1 && Math.abs(bent.vol - d0.vol) < d0.vol * 0.08, { w: [d0.hi[0] - d0.lo[0], bent.hi[0] - bent.lo[0]], vol: [d0.vol, bent.vol] });
await G(() => window.__glina.undo()); await frames(2);
check('undo straightens it', near((await st()).sp, d0.sp, 1e-6 * Math.abs(d0.sp)));
await G(() => window.__glina.deform('twist', 180)); await frames(2);
const tw = await st();
check('Twist keeps the heights and the volume', near(tw.lo[1], d0.lo[1]) && near(tw.hi[1], d0.hi[1]) && Math.abs(tw.vol - d0.vol) < d0.vol * 0.01 && tw.sp !== d0.sp, { vol: [d0.vol, tw.vol] });
await G(() => window.__glina.undo()); await frames(2);
await G(() => window.__glina.deform('taper', -0.6)); await frames(2);
const tp = await st();
check('Taper −60% thins the far end: less volume', tp.vol < d0.vol * 0.8 && near(tp.lo[1], d0.lo[1]), { vol: [d0.vol, tp.vol] });
await G(() => window.__glina.undo()); await frames(2);
// the slider: the change while dragging, one step on release, back to 0
await G(() => { const el = document.getElementById('sTwist'); el.value = 40; el.dispatchEvent(new Event('input')); el.value = 90; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }); await frames(2);
const sl = await st();
const sv = await G(() => +document.getElementById('sTwist').value);
check('a deformer slider makes one undo step and returns to 0', sl.undo === d0.undo + 1 && sl.sp !== d0.sp && sv === 0, { undo: [d0.undo, sl.undo], sv });
await G(() => window.__glina.undo()); await frames(2);

// Array Mesh
await G(() => { const W = window.__glina; Object.assign(W.S, { arrCount: 4, arrMode: 'line', arrAxis: 0, arrGap: 0.2, arrScale: 1 }); W.makeArray(); }); await frames(2);
const ar = await st();
check('Array in a row: four copies along X', ar.f === d0.f * 4 && ar.hi[0] - ar.lo[0] > (d0.hi[0] - d0.lo[0]) * 4 && !ar.open && ar.undo === d0.undo + 1, { f: [d0.f, ar.f] });
await G(() => window.__glina.undo()); await frames(2);
await G(() => { const W = window.__glina; Object.assign(W.S, { arrCount: 6, arrMode: 'circle', arrAxis: 1 }); W.makeArray(); }); await frames(2);
const ac = await st();
check('Array in a circle around Y: six copies, as high as one', ac.f === d0.f * 6 && near(ac.lo[1], d0.lo[1]) && near(ac.hi[1], d0.hi[1]) && near(-ac.lo[0], ac.hi[0], 0.05), { f: ac.f, x: [ac.lo[0], ac.hi[0]] });
await G(() => window.__glina.undo()); await frames(2);
check('undo takes the array back', (await st()).f === d0.f);

// Surface Contrast: more detail, less detail, one step each
await G(() => { const W = window.__glina; W.activateTool(0); W.selectTool('draw'); }); await frames(2);
await drag([[box.x + box.w / 2 - 80, box.y + box.h / 2], [box.x + box.w / 2 + 80, box.y + box.h / 2]]);
const roughness = () => G(() => { const m = window.__glina.mesh; let s = 0; for (let i = 0; i < m.n; i++) { let x = 0, y = 0, z = 0, c = 0; for (let j = m.vvOff[i]; j < m.vvOff[i + 1]; j++) { const u = m.vv[j]; x += m.pos[u * 3]; y += m.pos[u * 3 + 1]; z += m.pos[u * 3 + 2]; c++; } s += Math.hypot(m.pos[i * 3] - x / c, m.pos[i * 3 + 1] - y / c, m.pos[i * 3 + 2] - z / c); } return s; });
const r0 = await roughness(), u0 = (await st()).undo;
await G(() => window.__glina.surfaceContrast(1.5)); await frames(2);
const r1 = await roughness(), u1 = (await st()).undo;
await G(() => window.__glina.undo()); await frames(2);
await G(() => window.__glina.surfaceContrast(-0.8)); await frames(2);
const r2 = await roughness();
await G(() => window.__glina.undo()); await frames(2);
const r3 = await roughness();
check('Surface Contrast: + sharpens, − softens, one undo step, undo exact', r1 > r0 * 1.2 && r2 < r0 * 0.9 && u1 === u0 + 1 && Math.abs(r3 - r0) < 1e-9 * r0, { r0, r1, r2, r3 });
// a picture with soft shadows, twice the canvas size
const snap = await G(async () => { const url = await window.__glina.snapshotPNG(2); const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4); const r = document.getElementById('gl').getBoundingClientRect(); return { w: img.width, h: img.height, cw: Math.round(r.width * 2), ch: Math.round(r.height * 2), colours: seen.size, png: url.startsWith('data:image/png') }; });
check('snapshot: a PNG twice the canvas size, with a real picture in it', snap.png && snap.w === snap.cw && snap.h === snap.ch && snap.colours > 10, snap);
const after = await G(() => { const r = document.getElementById('gl'); return { w: r.width, h: r.height }; });
check('the canvas is its own size again after the snapshot', after.w < snap.w, after);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
