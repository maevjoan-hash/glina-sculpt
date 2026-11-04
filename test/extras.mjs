// Gizmo extras (all subtools, Mesh to Axis, straighten), Flatten, Polish by Features, group bands,
// creased subdivision and the gear / tube / ring primitives: node test/extras.mjs
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
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.S.sym = false; window.__glina.syncSym(); window.__glina.setDyntopo(false); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// in the page: bounds and other facts of a subtool (the active one by default)
await G(() => {
  window.__bb = (k) => {
    const W = window.__glina, t = W.TOOLS[k === undefined ? W.curTool : k], a = W.toolArrays(t), P = a.pos;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], P[i + c]); max[c] = Math.max(max[c], P[i + c]); }
    let v = 0; for (let f = 0; f < a.idx.length; f += 3) { const i = a.idx[f] * 3, j = a.idx[f + 1] * 3, q = a.idx[f + 2] * 3; v += P[i] * (P[j + 1] * P[q + 2] - P[j + 2] * P[q + 1]) - P[i + 1] * (P[j] * P[q + 2] - P[j + 2] * P[q]) + P[i + 2] * (P[j] * P[q + 1] - P[j + 1] * P[q]); }
    return { min, max, ext: max.map((x, c) => x - min[c]), mid: max.map((x, c) => (x + min[c]) / 2), vol: v / 6, open: W.hasOpenEdges(a.idx), groups: new Set(a.grp).size, f: a.idx.length / 3, undo: W.undoStack.length };
  };
});
const bb = (k) => G((kk) => window.__bb(kk), k);

// the primitives: closed, outward, with a group for each side
for (const [label, name, groups] of [['Тръба', 'Тръба', 4], ['Пръстен', 'Пръстен', 1], ['Зъбно колело', 'Зъбно колело', 4]]) {
  await G((l) => { document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(l)).click(); }, label);
  await frames(2);
  const b = await bb();
  const nm = await G(() => window.__glina.TOOLS[window.__glina.curTool].name);
  check(`„${label}“ is a new closed model with ${groups} group(s)`, nm === name && !b.open && b.vol > 0 && b.groups === groups && b.f > 5000 && b.f < 200000, b);
}
// the gear has teeth: the rim's radius goes up and down around it
const teeth = await G(() => {
  const m = window.__glina.mesh; let changes = 0, prev = null;
  const R = []; for (let i = 0; i < m.n; i++) { const y = m.pos[i * 3 + 1]; if (Math.abs(y - 0.16) < 1e-6) R.push([Math.atan2(m.pos[i * 3 + 2], m.pos[i * 3]), Math.hypot(m.pos[i * 3], m.pos[i * 3 + 2])]); }
  // the outermost point at each angle
  const by = new Map(); for (const [a, r] of R) { const k = a.toFixed(4); by.set(k, Math.max(by.get(k) || 0, r)); }
  const list = [...by.entries()].map(([a, r]) => [+a, r]).sort((p, q) => p[0] - q[0]);
  for (const [, r] of list) { const hi = r > 0.95; if (prev !== null && hi !== prev) changes++; prev = hi; }
  return changes;
});
check('the gear has 16 teeth (32 ups and downs on the rim)', teeth >= 31 && teeth <= 33, { teeth });

// creased subdivision: a cube with a group per side keeps its corners
const corner = await G(async () => {
  const W = window.__glina, out = {};
  for (const crease of [false, true]) {
    // a cube with a group for each side: through the real app, so groups come from „По ъглите“
    W.newScene(W.makeCube(3), 'Куб');
    W.groupOp('angle');
    W.S.crease = crease; W.S.loop = true;
    W.divide();
    await new Promise((r) => { const t = setInterval(() => { if (W.MR && W.MR.cur === 1 && document.getElementById('busy').hidden) { clearInterval(t); r(); } }, 20); });
    const m = W.mesh; let far = 0;
    for (let i = 0; i < m.n; i++) {
      const x = Math.abs(m.pos[i * 3]), y = Math.abs(m.pos[i * 3 + 1]), z = Math.abs(m.pos[i * 3 + 2]);
      far = Math.max(far, x + y + z);
    }
    out[crease ? 'crease' : 'plain'] = { far, groups: new Set(m.grp.subarray(0, m.n)).size };
  }
  return out;
});
check('„Остри ръбове между групите“: the subdivided cube keeps its corners, plain Loop rounds them', corner.crease.far > 2.399 && corner.plain.far < 2.2 && corner.crease.groups === 6, corner);
// down and up again: the creased level comes back the same
const round = await G(async () => {
  const W = window.__glina, wait = (lv) => new Promise((r) => { const t = setInterval(() => { if (W.MR && W.MR.cur === lv && document.getElementById('busy').hidden) { clearInterval(t); r(); } }, 20); });
  const before = W.mesh.pos.slice(0, W.mesh.n * 3);
  W.setLevel(0); await wait(0); W.setLevel(1); await wait(1);
  let d = 0; for (let i = 0; i < before.length; i++) d = Math.max(d, Math.abs(before[i] - W.mesh.pos[i]));
  return { d, crease: W.MR.levels[1].crease };
});
check('a creased level goes down and up unchanged', round.crease === true && round.d < 1e-4, round);

// Mesh to Axis
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Тор')).click(); });
await frames(2);
await G(() => { const W = window.__glina; W.S.gizmoAll = false; W.selectTool('gizmo'); W.brush().gz = 'move'; });
await frames(2);
const gs = await G(() => { const g = window.__glina.gizmoScreen(); return { c: g.c, x: g.ends[0], y: g.ends[1] }; });
const at = (g, e, f) => [box.x + g.c[0] + (e[0] - g.c[0]) * f, box.y + g.c[1] + (e[1] - g.c[1]) * f];
await drag([at(gs, gs.x, 0.6), at(gs, gs.x, 1.4)]);
await drag([at(gs, gs.y, 0.6), at(gs, gs.y, 1.2)]);
const off = await bb();
await G(() => document.getElementById('gzAxis').click()); await frames(2);
const cen = await bb();
check('„В центъра“ brings the middle of the box to the origin in one step', Math.hypot(...off.mid) > 0.1 && Math.hypot(...cen.mid) < 1e-5 && cen.undo === off.undo + 1, { before: off.mid, after: cen.mid });
await G(() => window.__glina.undo()); await frames(2);
const back = await bb();
check('undo puts it back where it was', Math.hypot(back.mid[0] - off.mid[0], back.mid[1] - off.mid[1], back.mid[2] - off.mid[2]) < 1e-6);
await G(() => window.__glina.redo()); await frames(2);

// Straighten: a box twice as long in X and half as thick in Z, turned 25° about Z and 15° about Y, comes back square to the axes
await G(() => {
  const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Куб')).click();
  const m = W.mesh, P = m.pos, a = 25 * Math.PI / 180, b = 15 * Math.PI / 180;
  const n = m.n, idx = Uint32Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    let x = P[i * 3] * 2, y = P[i * 3 + 1], z = P[i * 3 + 2] * 0.5;
    [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    P[i * 3] = x + 0.3; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
  }
  m.updateNormals(idx, n);
});
const tilted = await bb();
await G(() => document.getElementById('gzStraight').click()); await frames(2);
const straight = await bb();
check('„Изправи“ turns the box back square to the axes (3.2 × 1.6 × 0.8)', Math.abs(straight.ext[0] - 3.2) < 0.01 && Math.abs(straight.ext[1] - 1.6) < 0.01 && Math.abs(straight.ext[2] - 0.8) < 0.01 && Math.abs(straight.vol - tilted.vol) < 1e-3 * Math.abs(tilted.vol), { tilted: tilted.ext, straight: straight.ext });

// „Всички“: the gizmo moves every visible subtool together, one undo step
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.appendPrimitive('cube'); });
await frames(2);
await G(() => { const W = window.__glina; W.activateTool(0); W.selectTool('gizmo'); W.brush().gz = 'move'; document.getElementById('gzAll').click(); });
await frames(2);
const b0 = [await bb(0), await bb(1)];
const g2 = await G(() => { const g = window.__glina.gizmoScreen(); return { c: g.c, x: g.ends[0] }; });
const pivotMid = await G(() => window.__glina.gizmoScreen().p.toArray());
await drag([at(g2, g2.x, 0.6), at(g2, g2.x, 1.3)]);
const b1 = [await bb(0), await bb(1)];
const dxA = b1[0].mid[0] - b0[0].mid[0], dxB = b1[1].mid[0] - b0[1].mid[0];
check('„Всички“: both subtools move the same along X, in one undo step', dxA > 0.05 && Math.abs(dxA - dxB) < 1e-4 && Math.abs(b1[1].mid[1] - b0[1].mid[1]) < 1e-5 && b1[0].undo === b0[0].undo + 1, { dxA, dxB, pivotMid });
await G(() => window.__glina.undo()); await frames(2);
const b2 = [await bb(0), await bb(1)];
check('undo takes both back', Math.abs(b2[0].mid[0] - b0[0].mid[0]) < 1e-6 && Math.abs(b2[1].mid[0] - b0[1].mid[0]) < 1e-6, { a: b2[0].mid[0] - b0[0].mid[0], b: b2[1].mid[0] - b0[1].mid[0] });
await G(() => document.getElementById('gzAll').click());

// Flatten
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.defAxis = 1; W.deform('flatten', 0.8); });
const fl = await bb();
check('„Сплескване“ 80% makes the sphere a fifth as tall along the axis', Math.abs(fl.ext[1] / fl.ext[0] - 0.2) < 0.01, fl.ext);
await G(() => { window.__glina.S.defAxis = 0; });

// Polish by Features: on a rough cube it evens the sides and keeps the corners; plain smoothing rounds them
const pol = await G(() => {
  const W = window.__glina, out = {};
  for (const kind of ['polish', 'smooth']) {
    document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Куб')).click();
    const m = W.mesh, P = m.pos, n = m.n, idx = Uint32Array.from({ length: n }, (_, i) => i);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], l = Math.hypot(x, y, z), e = rnd() * 0.01; P[i * 3] += x / l * e; P[i * 3 + 1] += y / l * e; P[i * 3 + 2] += z / l * e; }
    m.updateNormals(idx, n);
    const rough = () => { let s = 0, c = 0; for (let i = 0; i < n; i++) { const a = [Math.abs(P[i * 3]), Math.abs(P[i * 3 + 1]), Math.abs(P[i * 3 + 2])].sort((p, q) => q - p); if (a[1] < 0.64) { s += Math.abs(a[0] - 0.8); c++; } } return s / c; };
    const far = () => { let f = 0; for (let i = 0; i < n; i++) f = Math.max(f, Math.abs(P[i * 3]) + Math.abs(P[i * 3 + 1]) + Math.abs(P[i * 3 + 2])); return f; };
    const r0 = rough(), u0 = W.undoStack.length;
    if (kind === 'polish') W.polishFeatures(); else for (let k = 0; k < 4; k++) document.getElementById('bSmoothAll').click();
    out[kind] = { r0, r1: rough(), far: far(), undo: W.undoStack.length - u0 };
  }
  return out;
});
check('„Полирай, без да заобляш ръбовете“ evens the sides and keeps the corners (one step)', pol.polish.r1 < pol.polish.r0 * 0.6 && pol.polish.far > 2.37 && pol.smooth.far < pol.polish.far - 0.02 && pol.polish.undo === 1, pol);

// group bands
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.groupOp('clear'); document.getElementById('nSlices').value = 5; document.getElementById('bSliceG').click(); });
const bands = await G(() => { const W = window.__glina, m = W.mesh, A = new Map(); for (let i = 0; i < m.n; i++) { const g = m.grp[i]; const x = m.pos[i * 3]; const r = A.get(g) || [Infinity, -Infinity]; A.set(g, [Math.min(r[0], x), Math.max(r[1], x)]); } return [...A.values()].sort((p, q) => p[0] - q[0]); });
const ordered = bands.every((r, i) => i === 0 || r[0] >= bands[i - 1][1] - 0.05);
check('„Ивици от групи“: five groups, side by side along X', bands.length === 5 && ordered, bands);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
