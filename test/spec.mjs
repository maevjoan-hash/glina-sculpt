// From the specification: Thick Skin and the elastic twist / scale / pinch brushes (kelvin.rs): node test/spec.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.setWheel(false); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const box = await G(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(x0, y0, x1, y1, steps = 12) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  await page.mouse.up(); await frames(3);
}
const fresh = (sym) => G((s) => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = s; W.syncSym(); W.orbit(0, 0); W.undoStack.length = 0; }, sym);
// the volume inside (signed) and the largest move of any point from the unit sphere
const shape = () => G(() => {
  const m = window.__glina.mesh, P = m.pos, I = m.idx; let vol = 0, maxR = 0, minR = 9, nan = 0;
  for (let t = 0; t < m.f; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  for (let i = 0; i < m.n; i++) { const r = Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (!Number.isFinite(r)) nan++; maxR = Math.max(maxR, r); minR = Math.min(minR, r); }
  return { vol, maxR, minR, nan, undo: window.__glina.undoStack.length };
});

// ---------- Thick Skin ----------
await fresh(false);
await G(() => { const W = window.__glina; W.selectTool('draw'); W.brush().radius = 60; W.brush().strength = 1; });
for (let k = 0; k < 6; k++) await drag(cx - 60, cy, cx + 60, cy);
const free = await shape();
await fresh(false);
await G(() => { const W = window.__glina; W.selectTool('draw'); W.brush().radius = 60; W.brush().strength = 1; W.S.thick = 0.03; W.setThick(true); });
for (let k = 0; k < 6; k++) await drag(cx - 60, cy, cx + 60, cy);
const thick = await shape();
const T = await G(() => window.__glina.thickOf(window.__glina.mesh).t);
check('without Thick Skin six passes pile up high', free.maxR - 1 > T * 2, { rise: free.maxR - 1, T });
check('with Thick Skin they stop at the set thickness (and reach it)', thick.maxR - 1 <= T * 1.05 && thick.maxR - 1 > T * 0.9 && thick.nan === 0, { rise: thick.maxR - 1, T });
// carving stops at the same depth
await G(() => { const W = window.__glina; W.brush().dir = -1; });
for (let k = 0; k < 8; k++) await drag(cx - 60, cy + 120, cx + 60, cy + 120);
const carved = await shape();
await G(() => { const W = window.__glina; W.brush().dir = 1; });
check('and carving stops as deep', 1 - carved.minR <= T * 1.001 && 1 - carved.minR > T * 0.7, { depth: 1 - carved.minR, T });
// a new base lets it grow again; switching off frees it
await G(() => window.__glina.setThick(true));
for (let k = 0; k < 6; k++) await drag(cx - 60, cy, cx + 60, cy);
const again = await shape();
check('„Нова основа“ gives another layer on top', again.maxR - 1 > T * 1.6 && again.maxR - 1 <= T * 3, { rise: again.maxR - 1 });
await G(() => window.__glina.setThick(false));
check('the switch in the panel follows', await G(() => !document.getElementById('tThick').checked && document.getElementById('bThickBase').disabled));

// ---------- elastic twist, scale, pinch ----------
await fresh(false);
const v0 = await shape();
await G(() => window.__glina.selectTool('ktwist'));
const before = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
await drag(cx, cy, cx + 120, cy);
const tw = await shape();
const twisted = await G((b) => {
  // the points near the front pole turn about the view axis: their distance from it stays, their angle changes
  const W = window.__glina, P = W.mesh.pos, back = new W.cam.target.constructor(0, 0, 1).applyQuaternion(W.cam.q); let moved = 0, turn = 0, radial = 0, k = 0;
  for (let i = 0; i < W.mesh.n; i++) {
    const d = Math.hypot(P[i * 3] - b[i * 3], P[i * 3 + 1] - b[i * 3 + 1], P[i * 3 + 2] - b[i * 3 + 2]); if (d > 1e-6) moved++;
    const along = (x, y, z) => x * back.x + y * back.y + z * back.z;
    const a0 = along(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]); if (a0 < 0.97) continue;
    const r0 = Math.sqrt(Math.max(0, 1 - a0 * a0)), a1 = along(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), r1 = Math.sqrt(Math.max(0, P[i * 3] ** 2 + P[i * 3 + 1] ** 2 + P[i * 3 + 2] ** 2 - a1 * a1));
    radial = Math.max(radial, Math.abs(r1 - r0)); turn += d; k++;
  }
  return { moved, turn: turn / k, radial, k };
}, before);
check('Усукване: the clay under the brush turns about the point, the rest stays', twisted.moved > 200 && twisted.moved < before.length / 3 * 0.6 && twisted.turn > 0.01 && twisted.radial < 0.02 && tw.nan === 0, twisted);
check('… and keeps its volume (a true rotation)', Math.abs(tw.vol - v0.vol) / v0.vol < 0.002, { v0: v0.vol, v1: tw.vol });
check('… as one undo step', tw.undo === v0.undo + 1 && await G(async (b) => { const W = window.__glina; W.undo(); await new Promise((r) => requestAnimationFrame(r)); const P = W.mesh.pos; let e = 0; for (let k = 0; k < b.length; k++) e = Math.max(e, Math.abs(P[k] - b[k])); return e === 0; }, before));
await G(() => window.__glina.selectTool('kscale'));
await drag(cx, cy, cx, cy - 120);
const up = await shape();
await G(() => window.__glina.undo()); await frames(2);
await drag(cx, cy, cx, cy + 120);
const down = await shape();
await G(() => window.__glina.undo()); await frames(2);
check('Раздуване: dragging up swells, dragging down shrinks', up.vol > v0.vol * 1.002 && down.vol < v0.vol * 0.999 && up.nan + down.nan === 0, { v0: v0.vol, up: up.vol, down: down.vol });
await G(() => window.__glina.selectTool('kpinch'));
await drag(cx, cy, cx + 100, cy);
const pin = await G((b) => {
  const W = window.__glina, P = W.mesh.pos, right = new W.cam.target.constructor(1, 0, 0).applyQuaternion(W.cam.q), up = new W.cam.target.constructor(0, 1, 0).applyQuaternion(W.cam.q);
  let along = 0, across = 0;
  for (let i = 0; i < W.mesh.n; i++) {
    const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2], dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z;
    const pr = x * right.x + y * right.y + z * right.z, pu = x * up.x + y * up.y + z * up.z;
    if (Math.abs(pr) > 0.02 && Math.abs(pr) < 0.09 && Math.abs(pu) < 0.03) along += Math.sign(pr) * (dx * right.x + dy * right.y + dz * right.z);
    if (Math.abs(pu) > 0.02 && Math.abs(pu) < 0.09 && Math.abs(pr) < 0.03) across += Math.sign(pu) * (dx * up.x + dy * up.y + dz * up.z);
  }
  return { along, across };
}, before);
check('Прищипване: it stretches along the drag and draws in across it', pin.along > 0 && pin.across < 0, pin);
await G(() => window.__glina.undo()); await frames(2);
// with symmetry the two sides stay mirror images
await fresh(true);
await G(() => window.__glina.selectTool('ktwist'));
await drag(cx + 110, cy - 20, cx + 190, cy - 20);
const mirror = await G(() => {
  // every point's mirror image (x → −x) is a point of the model too
  const m = window.__glina.mesh, P = m.pos, key = (x, y, z) => Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4), set = new Set();
  for (let i = 0; i < m.n; i++) set.add(key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  let miss = 0, moved = 0;
  for (let i = 0; i < m.n; i++) { if (!set.has(key(-P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) miss++; if (Math.abs(Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) - 1) > 1e-5) moved++; }
  return { miss, moved, n: m.n };
});
check('with symmetry the twist on one side is mirrored on the other', mirror.moved > 20 && mirror.miss < mirror.n * 0.002, mirror);
check('the three brushes are in „Всички“ with their own box', await G(() => { const W = window.__glina; W.openPalette(); const ok = ['ktwist', 'kscale', 'kpinch'].every((id) => document.querySelector(`#palList [data-tool="${id}"]`)); W.closePalette(); W.selectTool('kpinch'); W.openBrushPanel(); const grp = !document.getElementById('kelGrp').hidden && !document.getElementById('volRow').hidden; W.closeBrushPanel(); return ok && grp; }));
// ---------- Transpose Master ----------
await fresh(false);
await G(() => { const W = window.__glina; W.appendPrimitive('cube'); });
await frames(2);
// the cube gets two levels with a bump on the top one
await G(() => window.__glina.divide()); await page.waitForFunction(() => !window.__glina.mrPending);
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.pos[i * 3 + 1] += 0.01 * Math.sin(m.pos[i * 3] * 40); });
const tp0 = await G(() => { const W = window.__glina; return W.TOOLS.map((t, k) => { const m = k === W.curTool ? W.mesh : t.mesh; let cx = 0; for (let i = 0; i < m.n; i++) cx += m.pos[i * 3]; return { n: m.n, f: m.f, cx: cx / m.n, lv: (k === W.curTool ? W.MR : t.MR) ? (k === W.curTool ? W.MR : t.MR).cur : 0 }; }); });
await G(() => window.__glina.tposeStart()); await page.waitForFunction(() => window.__glina.TP && document.getElementById('busy').hidden);
const prox = await G(() => { const W = window.__glina, m = W.mesh; const g = new Set(); for (let i = 0; i < m.n; i++) g.add(m.grp[i]); return { n: m.n, groups: g.size, tools: W.TOOLS.length, hidden: W.TOOLS.filter((t) => !t.visible).length, label: document.getElementById('bTpose').textContent, apply: !document.getElementById('bTposeApply').disabled }; });
check('„Поза на всички“: one light mesh of the lowest levels, a group per subtool, the originals hidden', prox.tools === 3 && prox.hidden === 2 && prox.groups === 2 && prox.n < tp0[0].n + tp0[1].n && prox.apply && prox.label === 'Откажи позата', { prox, tp0 });
// the pose: everything moves 0.5 to the right and the cube's part turns a little
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) { m.pos[i * 3] += 0.5; if (m.grp[i] === 2) m.pos[i * 3 + 1] += 0.2; } });
await G(() => window.__glina.tposeApply()); await page.waitForFunction(() => !window.__glina.TP && document.getElementById('busy').hidden);
const tp1 = await G(() => { const W = window.__glina; return W.TOOLS.map((t, k) => { const m = k === W.curTool ? W.mesh : t.mesh; let cx = 0, cy = 0, rough = 0; for (let i = 0; i < m.n; i++) { cx += m.pos[i * 3]; cy += m.pos[i * 3 + 1]; } return { n: m.n, f: m.f, cx: cx / m.n, lv: (k === W.curTool ? W.MR : t.MR) ? (k === W.curTool ? W.MR : t.MR).cur : 0, vis: t.visible }; }); });
check('„Приложи позата“: every subtool has its part of the pose, with its points and level as before', tp1.length === 2 && tp1.every((t, k) => t.n === tp0[k].n && t.f === tp0[k].f && t.lv === tp0[k].lv && t.vis && Math.abs(t.cx - tp0[k].cx - 0.5) < 0.01), { tp0, tp1 });
await G(() => window.__glina.undo()); await frames(2);
check('undo brings the pose mesh back', await G(() => window.__glina.TOOLS.length === 3));
await G(() => window.__glina.undo()); await frames(2);
const tp2 = await G(() => { const W = window.__glina; return W.TOOLS.map((t, k) => { const m = k === W.curTool ? W.mesh : t.mesh; let cx = 0; for (let i = 0; i < m.n; i++) cx += m.pos[i * 3]; return { cx: cx / m.n, vis: t.visible }; }); });
check('and once more the subtools as they were', tp2.length === 2 && tp2.every((t, k) => t.vis && Math.abs(t.cx - tp0[k].cx) < 1e-6), tp2);
// ---------- the studio picture's skin: light under it, pores, rim ----------
await fresh(false);
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) { const k = 1 + 0.04 * Math.sin(m.pos[i * 3] * 30) * Math.sin(m.pos[i * 3 + 1] * 30); m.pos[i * 3] *= k; m.pos[i * 3 + 1] *= k; m.pos[i * 3 + 2] *= k; } W.setLevel; });
const fxDiff = await G(async () => {
  const W = window.__glina, S = W.S;
  const px = async (url) => { const im = new Image(); im.src = url; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const shot = async (sss, cav, rim) => { S.bprSSS = sss; S.bprCavity = cav; S.bprRim = rim; return px(await W.studioPNG(0.5)); };
  const none = await shot(0, 0, 0), diff = (a) => { let d = 0, mx = 0; for (let k = 0; k < a.length; k += 4) { const e = Math.abs(a[k] - none[k]) + Math.abs(a[k + 1] - none[k + 1]) + Math.abs(a[k + 2] - none[k + 2]); d += e; mx = Math.max(mx, e); } return { mean: d / (a.length / 4), max: mx }; };
  const out = { sss: diff(await shot(0.8, 0, 0)), cav: diff(await shot(0, 0.8, 0)), rim: diff(await shot(0, 0, 0.8)), same: diff(await shot(0, 0, 0)) };
  S.bprSSS = 0.35; S.bprCavity = 0.35; S.bprRim = 0.25;
  return out;
});
check('each of the three effects changes the studio picture (more than two plain pictures differ)', fxDiff.sss.mean > fxDiff.same.mean * 1.3 && fxDiff.sss.max > fxDiff.same.max * 1.5 && fxDiff.cav.mean > fxDiff.same.mean * 1.8 && fxDiff.rim.mean > fxDiff.same.mean * 1.8 && fxDiff.rim.mean < 40, fxDiff);
check('their sliders are in „Изглед“', await G(() => ['sBprSSS', 'sBprCav', 'sBprRim', 'bStudioNow'].every((id) => document.getElementById(id))));
// ---------- more baked maps ----------
await fresh(false);
await G(() => window.__glina.divide()); await page.waitForFunction(() => !window.__glina.mrPending);
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) { const k = 1 + 0.01 * Math.sin(m.pos[i * 3] * 60) * Math.sin(m.pos[i * 3 + 1] * 60); m.pos[i * 3] *= k; m.pos[i * 3 + 1] *= k; m.pos[i * 3 + 2] *= k; } });
const maps = await G(async () => {
  const W = window.__glina, r = await W.texturedFiles(256), out = { names: r.files.map((f) => f.name) };
  for (const name of ['glina-normal-object.png', 'glina-height.png', 'glina-cavity.png']) {
    const f = r.files.find((q) => q.name === name); if (!f) continue;
    const im = new Image(); im.src = URL.createObjectURL(new Blob([f.data], { type: 'image/png' })); await im.decode();
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, 256, 256).data;
    let lo = 255, hi = 0, grey = true; for (let k = 0; k < d.length; k += 4) { lo = Math.min(lo, d[k]); hi = Math.max(hi, d[k]); if (d[k] !== d[k + 1] || d[k] !== d[k + 2]) grey = false; }
    out[name] = { lo, hi, grey };
  }
  out.txt = new TextDecoder().decode(r.files.find((q) => q.name === 'glina-maps.txt').data).split('\n').length;
  return out;
});
check('with levels the ZIP also has object-space normals, height and cavity maps (and a note on their scale)', ['glina-normal-object.png', 'glina-height.png', 'glina-cavity.png', 'glina-maps.txt'].every((n) => maps.names.includes(n)) && maps.txt >= 4, maps.names);
check('height and cavity are grey maps around the middle, with the bumps in them; object normals are coloured', maps['glina-height.png'].grey && maps['glina-height.png'].hi - maps['glina-height.png'].lo > 8 && maps['glina-height.png'].lo < 128 && maps['glina-height.png'].hi > 128 && maps['glina-cavity.png'].grey && maps['glina-cavity.png'].hi - maps['glina-cavity.png'].lo > 10 && !maps['glina-normal-object.png'].grey, maps);
// ---------- Move Topological: the distance is measured along the surface ----------
await fresh(false);
// a thin lens: the front and the back are close through the air, far round the rim
await G(() => { const W = window.__glina, T = W.cam.target.constructor, M3 = W.camera.normalMatrix.constructor; W.transformTools([W.TOOLS[W.curTool]], new M3().set(1, 0, 0, 0, 1, 0, 0, 0, 0.06), new T(0, 0, 0), new T(0, 0, 0)); W.orbit(0, 0); });
await frames(3);
const lens0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
// press near the right rim of the front and pull outward (toward the eye and right)
const rim = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0.8, 0, 0.03).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, wpp: 2 * Math.tan(W.camera.fov * Math.PI / 360) * W.camera.position.distanceTo(new W.cam.target.constructor(0.8, 0, 0.03)) / r.height }; });
await G((wpp) => { const W = window.__glina; W.selectTool('grabtopo'); W.brush().radius = Math.round(0.4 / wpp); W.brush().strength = 1; }, rim.wpp);
await drag(rim.x, rim.y, rim.x, rim.y - 60);
const lens = await G((b) => {
  // how far the front and the back moved, at x ≈ 0.6 (0.2 from the press through the air on either side; on
  // the back that is 0.6 along the surface, round the rim: more than the brush)
  const P = window.__glina.mesh.pos; let front = 0, back = 0, nf = 0, nb = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2]; if (Math.abs(x - 0.6) > 0.04 || Math.abs(y) > 0.04) continue;
    const d = Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y, P[i * 3 + 2] - z);
    if (z > 0) { front += d; nf++; } else { back += d; nb++; }
  }
  return { front: front / nf, back: back / nb, nf, nb };
}, lens0);
check('„Хващане на част“: the front follows the pen, the back (close through the air, far along the surface) stays', lens.nf > 0 && lens.nb > 0 && lens.front > 0.02 && lens.back < lens.front * 0.05, lens);
await G(() => window.__glina.undo()); await frames(2);
// ---------- decimation keeps painted borders ----------
await fresh(false);
const dec = async (keep) => {
  await G((keep) => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) { const c = m.pos[i * 3] > 0 ? 1 : 0; m.col[i * 3] = c; m.col[i * 3 + 1] = c; m.col[i * 3 + 2] = c; } W.S.decPaint = keep; W.S.decimateKeep = 0.08; }, keep);
  const r = await G(async (keep) => { const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]), out = await W.decimateArrays(a, Math.round(a.idx.length / 3 * 0.08)); let grey = 0; for (let i = 0; i < out.col.length; i += 3) if (out.col[i] > 0.1 && out.col[i] < 0.9) grey++; return { f: out.idx.length / 3, n: out.pos.length / 3, grey }; }, keep);
  return r;
};
const decPlain = await dec(false), decKeep = await dec(true);
check('„При намаляване пази боята“: no point is a blend of the two colours; without it the border blurs', decKeep.grey === 0 && decPlain.grey > 0 && decKeep.f < 20480 * 0.1, { decPlain, decKeep });
check('its switch is in „Геометрия“', await G(() => !!document.getElementById('tDecPaint')));
// ---------- Layer rises along each point's own normal (as in Blender), not the brush's ----------
const layerRun = async (rust) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.orbit(0, 0); });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  await G((rust) => { const W = window.__glina; W.selectTool('layer'); W.brush().radius = 120; W.brush().strength = 1; W.rustBrushes = rust; }, rust);
  await drag(cx - 160, cy, cx + 160, cy);
  const r = await G((b0) => { const P = window.__glina.mesh.pos; let s = 0, c = 0; for (let i = 0; i < P.length / 3; i++) { const dx = P[i*3]-b0[i*3], dy = P[i*3+1]-b0[i*3+1], dz = P[i*3+2]-b0[i*3+2], d = Math.hypot(dx, dy, dz); if (d < 1e-4) continue; const x = b0[i*3], y = b0[i*3+1], z = b0[i*3+2], l = Math.hypot(x, y, z); s += Math.hypot((dy*z-dz*y)/l, (dz*x-dx*z)/l, (dx*y-dy*x)/l) / d; c++; } return { sideways: s / c, n: c, pos: Array.from(P.subarray(0, P.length)) }; }, b0);
  await G(() => { window.__glina.rustBrushes = true; });
  return r;
};
const layR = await layerRun(true), layJ = await layerRun(false);
check('„Слой“ lifts each point straight out from the surface, not sideways (along its own normal)', layR.n > 100 && layR.sideways < 0.06, { sideways: layR.sideways, n: layR.n });
check('… the same to the bit in Rust and in JavaScript', layR.pos.length === layJ.pos.length && layR.pos.every((v, k) => v === layJ.pos[k]));
// ---------- the strength slider is the square root of the strength (as in Blender) ----------
const sq = await G(() => {
  const W = window.__glina; W.selectTool('draw'); W.brush().strength = 0.5; W.openBrushPanel();
  const el = document.getElementById('sStrength'), out = document.getElementById('oStrength');
  const shown = { slider: +el.value, text: out.textContent };
  el.value = '0.5'; el.dispatchEvent(new Event('input'));
  const half = W.brush().strength;
  el.value = '1'; el.dispatchEvent(new Event('input'));
  const full = W.brush().strength;
  el.value = '0.1'; el.dispatchEvent(new Event('input'));
  const low = W.brush().strength;
  W.brush().strength = 0.5; W.closeBrushPanel();
  return { shown, half, full, low, min: +el.min };
});
check('a brush at strength 0.5 shows the slider at 71%; the slider at half is a quarter of the strength, full is full', Math.abs(sq.shown.slider - Math.SQRT1_2) < 0.004 && sq.shown.text === '71%' && Math.abs(sq.half - 0.25) < 1e-9 && sq.full === 1 && Math.abs(sq.low - 0.01) < 1e-9 && sq.min === 0.1, sq);
// ---------- smoothing an open edge along itself (as in Blender) ----------
const rimRun = async (rust, rims) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Равнина')).click(); W.S.sym = false; W.syncSym(); W.cam.q.setFromAxisAngle(new W.cam.target.constructor(1, 0, 0), -Math.PI / 2); W.orbit(0, 0); });
  // a jagged rim: every rim point pushed in or out across the rim, in the plane
  await G(() => { const W = window.__glina, m = W.mesh; let k = 0; for (let i = 0; i < m.n; i++) if (m.boundary[i]) { const x = m.pos[i * 3], z = m.pos[i * 3 + 2]; const ax = Math.abs(x) > Math.abs(z) ? 0 : 2; const along = ax === 0 ? z : x; m.pos[i * 3 + ax] += (Math.round(along * 70) % 2 ? 1 : -1) * 0.012 * Math.sign(m.pos[i * 3 + ax]); k++; } m.computeAllNormals(); W.gmesh.geometry.attributes.position.needsUpdate = true; });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  await G(([rust, rims]) => { const W = window.__glina; W.rustBrushes = rust; W.S.smoothRims = rims; W.selectTool('smooth'); W.brush().radius = 90; W.brush().strength = 1; }, [rust, rims]);
  // the right rim is at x ≈ +1 in the model: along it, top to bottom
  const sx = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), T = W.cam.target.constructor; const a = new T(0.97, 0, 0.6).project(W.camera), b = new T(0.97, 0, -0.6).project(W.camera); return [[r.left + (a.x * 0.5 + 0.5) * r.width, r.top + (-a.y * 0.5 + 0.5) * r.height], [r.left + (b.x * 0.5 + 0.5) * r.width, r.top + (-b.y * 0.5 + 0.5) * r.height]]; });
  for (let k = 0; k < 3; k++) await drag(sx[0][0], sx[0][1], sx[1][0], sx[1][1]);
  const r = await G((b0) => {
    // on the right rim (x > 0.9, |z| < 0.5): how far each point is from its two rim neighbours' middle, and
    // how far the rim moved in on average
    const W = window.__glina, m = W.mesh, P = m.pos; let jag0 = 0, jag1 = 0, inward = 0, c = 0;
    const rim = []; for (let i = 0; i < m.n; i++) if (m.boundary[i] && b0[i * 3] > 0.9 && Math.abs(b0[i * 3 + 2]) < 0.5) rim.push(i);
    rim.sort((a, b) => b0[a * 3 + 2] - b0[b * 3 + 2]);
    for (let k = 1; k < rim.length - 1; k++) { const [a, i, b] = [rim[k - 1], rim[k], rim[k + 1]]; jag0 += Math.abs(b0[i * 3] - (b0[a * 3] + b0[b * 3]) / 2); jag1 += Math.abs(P[i * 3] - (P[a * 3] + P[b * 3]) / 2); inward += b0[i * 3] - P[i * 3]; c++; }
    return { jag0: jag0 / c, jag1: jag1 / c, inward: inward / c, n: c, pos: Array.from(P) };
  }, b0);
  await G(() => { window.__glina.rustBrushes = true; window.__glina.S.smoothRims = true; });
  return r;
};
const rimOff = await rimRun(true, false), rimR = await rimRun(true, true), rimJ = await rimRun(false, true);
check('„Изглаждане“ smooths a jagged open rim along itself (it stayed jagged before)', rimR.n > 10 && rimR.jag1 < rimR.jag0 * 0.35 && rimOff.jag1 > rimOff.jag0 * 0.9, { before: rimR.jag0, now: rimR.jag1, without: rimOff.jag1 });
check('… without pulling the rim in from the side', Math.abs(rimR.inward) < 0.004, { inward: rimR.inward });
check('… the same to the bit in Rust and in JavaScript', rimR.pos.length === rimJ.pos.length && rimR.pos.every((v, k) => v === rimJ.pos[k]));
// ---------- pen tilt steers the push (as Blender's Tilt Strength) ----------
const tl = await G(() => { const W = window.__glina; W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); const a = W.tiltNormal(0, 0, 1, [0.5, 0], 1, null), c = W.tiltNormal(0, 0, 1, [0, 0.5], 1, null), z = W.tiltNormal(0, 0, 1, [0, 0], 1, null); return { a, c, z }; });
check('the pen leaning right turns the push right, leaning down turns it down, upright leaves it', tl.a[0] > 0.4 && Math.abs(tl.a[1]) < 1e-6 && tl.c[1] < -0.4 && Math.abs(tl.c[0]) < 1e-6 && Math.abs(tl.z[2] - 1) < 1e-9, tl);
// ---------- pinch toward the stroke's line (as Blender) ----------
const pinchRun = async (line) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.orbit(0, 0); });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  await G((line) => { const W = window.__glina; W.S.pinchLine = line; W.selectTool('pinch'); W.brush().radius = 50; W.brush().strength = 1; }, line);
  for (let k = 0; k < 4; k++) await drag(cx - 130, cy, cx + 130, cy);
  const r = await G((b0) => { const P = window.__glina.mesh.pos; let along = 0, across = 0, c = 0; for (let i = 0; i < P.length / 3; i++) { const d = Math.hypot(P[i*3]-b0[i*3], P[i*3+1]-b0[i*3+1], P[i*3+2]-b0[i*3+2]); if (d < 1e-4 || b0[i*3+2] < 0.5) continue; along += Math.abs(P[i*3] - b0[i*3]); across += Math.abs(P[i*3+1] - b0[i*3+1]); c++; } return { along: along / c, across: across / c }; }, b0);
  await G(() => { window.__glina.S.pinchLine = true; });
  return r;
};
const pOld = await pinchRun(false), pNew = await pinchRun(true);
check('„Притискане“ draws toward the stroke\'s line: much less movement along the stroke, as much across it', pNew.along < pOld.along * 0.5 && pNew.across > pOld.across * 0.7, { before: pOld, now: pNew });
// ---------- smoothing that keeps the volume (as Blender's Surface Smooth) ----------
const hcRun = async (keep) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.orbit(0, 0); });
  const rad = () => G(() => { const m = window.__glina.mesh, P = m.pos; let s = 0, c = 0; for (let i = 0; i < m.n; i++) { if (P[i*3+2] < 0.9) continue; s += Math.hypot(P[i*3], P[i*3+1], P[i*3+2]); c++; } return s / c; });
  const r0 = await rad();
  await G((keep) => { const W = window.__glina; W.selectTool('smooth'); W.brush().keepVol = keep; W.brush().radius = 120; W.brush().strength = 1; }, keep);
  for (let k = 0; k < 6; k++) await drag(cx - 60, cy - 30 + k * 12, cx + 60, cy - 30 + k * 12);
  const r1 = await rad();
  await G(() => { window.__glina.brush().keepVol = false; });
  return 1 - r1 / r0;
};
const shrinkPlain = await hcRun(false), shrinkHC = await hcRun(true);
check('„Без свиване“: smoothing a coarse sphere does not shrink it (the plain smoothing does)', shrinkPlain > 0.002 && Math.abs(shrinkHC) < shrinkPlain * 0.05, { shrinkPlain, shrinkHC });
check('the switch is in the smooth brush\'s box', await G(() => { const W = window.__glina; W.selectTool('smooth'); W.openBrushPanel(); const ok = !document.getElementById('keepVolRow').hidden && document.getElementById('silRow').hidden; W.closeBrushPanel(); return ok; }));
// ---------- Grab Silhouette: only the side facing the pull ----------
const silRun = async (sil) => {
  await G(() => { const W = window.__glina, T = W.cam.target.constructor, M3 = W.camera.normalMatrix.constructor; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.transformTools([W.TOOLS[W.curTool]], new M3().set(1, 0, 0, 0, 1, 0, 0, 0, 0.08), new T(0, 0, 0), new T(0, 0, 0)); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); });
  await frames(2);
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  // pull the middle of the front outward, to the side (the side of a thin lens: its silhouette)
  await G((sil) => { const W = window.__glina; W.selectTool('grab'); W.brush().silhouette = sil; W.brush().radius = 90; W.brush().strength = 1; }, sil);
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0.97, 0, 0).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await drag(e.x, e.y, e.x + 80, e.y);
  const r = await G((b0) => { const P = window.__glina.mesh.pos; let mv = 0, back = 0, nb = 0; for (let i = 0; i < P.length / 3; i++) { const d = Math.hypot(P[i*3]-b0[i*3], P[i*3+1]-b0[i*3+1], P[i*3+2]-b0[i*3+2]); mv = Math.max(mv, d); if (b0[i*3] > 0.6 && b0[i*3] < 0.85 && Math.abs(b0[i*3+1]) < 0.15) { back += P[i*3] - b0[i*3]; nb++; } } return { most: mv, inner: back / nb }; }, b0);
  await G(() => { window.__glina.brush().silhouette = false; });
  return r;
};
const silOff = await silRun(false), silOn = await silRun(true);
check('„Само страната към дърпането“: the rim still comes out, the clay further in follows much less', silOn.most > silOff.most * 0.6 && silOn.inner < silOff.inner * 0.6, { off: silOff, on: silOn });
// ---------- Pose by groups, and twisting (as Blender's Pose) ----------
const poseRun = async (opts) => {
  await G(() => { const W = window.__glina, m = W.mesh; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); const M = W.mesh; for (let i = 0; i < M.n; i++) M.grp[i] = M.pos[i * 3 + 1] > 0.5 ? 1 : 0; });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  await G((o) => { const W = window.__glina; W.selectTool('pose'); W.brush().radius = 25; W.brush().strength = 1; W.brush().poseGroups = o.groups; W.brush().poseMode = o.mode; }, opts);
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0.8, 0.6).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await drag(e.x, e.y, e.x + 120, e.y);
  const res = await G((b0) => { const P = window.__glina.mesh.pos; let cap = 0, nc = 0, body = 0, nb = 0, dy = 0, dr = 0; for (let i = 0; i < P.length / 3; i++) { const d = Math.hypot(P[i*3]-b0[i*3], P[i*3+1]-b0[i*3+1], P[i*3+2]-b0[i*3+2]); if (b0[i*3+1] > 0.7) { cap += d > 1e-3 ? 1 : 0; nc++; dy = Math.max(dy, Math.abs(P[i*3+1]-b0[i*3+1])); dr = Math.max(dr, Math.abs(Math.hypot(P[i*3], P[i*3+2]) - Math.hypot(b0[i*3], b0[i*3+2]))); } else if (b0[i*3+1] < 0.3) { body = Math.max(body, d); nb++; } } return { capMoved: cap / nc, bodyMost: body, dy, dr }; }, b0);
  await G(() => { const W = window.__glina; W.brush().poseGroups = false; W.brush().poseMode = 'bend'; });
  return res;
};
const poseR = await poseRun({ groups: false, mode: 'bend' }), poseG = await poseRun({ groups: true, mode: 'bend' }), poseT = await poseRun({ groups: true, mode: 'twist' });
check('„Поза“ по групи: the whole group under the press turns (a small radius alone takes only a part of it), the rest stays', poseG.capMoved > 0.95 && poseR.capMoved < 0.6 && poseG.bodyMost < 1e-3, { radius: poseR, groups: poseG });
check('„Усукване около оста“: the part turns about its own axis — no point rises or leaves the axis', poseT.capMoved > 0.5 && poseT.dy < 0.01 && poseT.dr < 0.01 && poseT.bodyMost < 1e-3, poseT);
// ---------- round blob (as Blender's Blob): out along the normal, spread apart ----------
const blR = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); W.selectTool('blobround'); W.brush().radius = 40; });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await drag(e.x - 40, e.y, e.x + 40, e.y, 12);
  return G((b0) => { const m = window.__glina.mesh, P = m.pos; let rise = 0, spread = 0, n = 0; for (let i = 0; i < m.n; i++) { const y0 = b0[i * 3 + 1], z0 = b0[i * 3 + 2]; if (z0 < 0.9) continue; rise = Math.max(rise, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) - 1); if (Math.abs(y0) > 0.01 && Math.abs(y0) < 0.08 && Math.abs(b0[i * 3]) < 0.1) { spread += Math.sign(y0) * (P[i * 3 + 1] - y0); n++; } } return { rise, spread: spread / n }; }, b0);
})();
check('„Кръгла буца“ rises along the normal and spreads apart from the stroke (Blender\'s Blob: the crease turned round)', blR.rise > 0.005 && blR.spread > 0, blR);
// ---------- Smear: the colour is dragged along the stroke ----------
const smRes = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0);
    // the left half red, the right half white
    const m = W.mesh; for (let i = 0; i < m.n; i++) { const red = m.pos[i * 3] < 0; m.col[i * 3] = 1; m.col[i * 3 + 1] = red ? 0 : 1; m.col[i * 3 + 2] = red ? 0 : 1; }
    W.selectTool('smear'); W.brush().radius = 50; W.brush().strength = 0.8; });
  const red = () => G(() => { const m = window.__glina.mesh; let n = 0, s = 0; for (let i = 0; i < m.n; i++) { const x = m.pos[i * 3], z = m.pos[i * 3 + 2]; if (z > 0.9 && x > 0.05 && x < 0.2 && Math.abs(m.pos[i * 3 + 1]) < 0.05) { s += 1 - m.col[i * 3 + 1]; n++; } } return { red: s / n, n, undo: window.__glina.undoStack.length }; });
  const a = await red();
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await drag(e.x - 60, e.y, e.x + 60, e.y, 20);
  const b = await red();
  await G(() => window.__glina.undo());
  return { a, b, c: await red() };
})();
check('„Размазване на цвета“: dragging from the red half into the white drags red along; undo takes it back', smRes.a.red === 0 && smRes.b.red > 0.15 && smRes.b.undo === smRes.a.undo + 1 && smRes.c.red === 0, smRes);
// ---------- cloth: pinch toward the line, and expand (as Blender) ----------
const clothRun = async (id) => {
  await G((id) => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); W.selectTool(id); W.brush().radius = 60; W.brush().strength = 0.8; }, id);
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  for (let k = 0; k < 2; k++) await drag(e.x - 70, e.y, e.x + 70, e.y, 16);
  return G((b0) => { const m = window.__glina.mesh, P = m.pos; let across = 0, along = 0, up = 0, down = 0, nan = 0;
    for (let i = 0; i < m.n; i++) { if (!Number.isFinite(P[i * 3])) nan++; const x0 = b0[i * 3], y0 = b0[i * 3 + 1], z0 = b0[i * 3 + 2]; if (z0 < 0.8) continue;
      // (along the surface only: the folds' lift along the normal is left out)
      const l0 = Math.hypot(x0, y0, z0), nx = x0 / l0, ny = y0 / l0, nz = z0 / l0, ex = P[i * 3] - x0, ey = P[i * 3 + 1] - y0, ez = P[i * 3 + 2] - z0, en = ex * nx + ey * ny + ez * nz;
      across -= Math.sign(y0) * (ey - ny * en); along += Math.abs(ex - nx * en); const dr = Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) - 1; up = Math.max(up, dr); down = Math.min(down, dr); }
    return { across, along, up, down, nan }; }, b0);
};
const cP = await clothRun('clothperp'), cE = await clothRun('clothexpand'), cQ = await clothRun('clothpinch');
check('„Плат: гънки по линия“ draws the cloth in toward the stroke\'s line far more than pinching to points does', cP.across > cQ.across * 1.5 && cP.across > 0 && cP.nan === 0, { perp: cP, pinch: cQ });
check('„Плат: разширяване“ buckles into folds: some up, some down', cE.up > 0.002 && cE.down < -0.002 && cE.nan === 0, cE);
// ---------- elastic grab: one, two or three scales (as Blender) ----------
const kelRun = async (sc) => {
  await G((sc) => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); W.selectTool('elastic'); W.brush().radius = 60; W.brush().strength = 1; W.brush().kelScale = sc; }, sc);
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await drag(e.x, e.y, e.x, e.y - 25, 6);
  return G((b0) => { const m = window.__glina.mesh, P = m.pos, ring = (a, b) => { let s = 0, n = 0; for (let i = 0; i < m.n; i++) { const x = b0[i * 3], y = b0[i * 3 + 1], z = b0[i * 3 + 2], d = Math.hypot(x, y); if (z < 0 || d < a || d >= b) continue; s += Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y, P[i * 3 + 2] - z); n++; } return s / n; };
    const c = ring(0, 0.03); return { centre: c, near: ring(0.15, 0.2) / c, far: ring(0.35, 0.4) / c }; }, b0);
};
const kS = await kelRun('single'), kB = await kelRun('bi'), kT = await kelRun('tri');
await G(() => { window.__glina.brush().kelScale = 'bi'; });
check('elastic grab: „Широко“ reaches furthest, „Стегнато“ least; the grabbed point follows the pen in all three', kS.far > kB.far * 1.3 && kB.far > kT.far * 1.3 && kS.near > kT.near && Math.abs(kS.centre - kB.centre) < 0.3 * kB.centre && Math.abs(kT.centre - kB.centre) < 0.3 * kB.centre, { single: kS, bi: kB, tri: kT });
// ---------- gather through the tree: the same points, in the same order, as scanning them all ----------
const gaRes = await G(() => {
  const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
  W.S.sym = true; W.syncSym(); W.orbit(0, 0); W.selectTool('clay');
  const r = document.getElementById('gl').getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
  // a few strokes first, so the points have moved since the tree was built
  for (let s = 0; s < 3; s++) { W.beginStroke({ pointerId: -1, pointerType: 'mouse', pressure: 1 }, cx - 100, cy - 40 + s * 40, W.brush(), 1); for (let i = 1; i <= 20; i++) { W.stroke.queue.push({ x: cx - 100 + i * 10, y: cy - 40 + s * 40 + Math.sin(i / 3) * 30, p: 1 }); W.processStroke(); } W.endStroke(true); }
  const m = W.mesh;
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let bad = 0, total = 0, cases = 0;
  for (let t = 0; t < 300; t++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), rr = 0.02 + rnd() * 0.6, c = [Math.sin(ph) * Math.cos(th) * 1.05, Math.sin(ph) * Math.sin(th) * 1.05, Math.cos(ph) * 1.05];
    const front = t % 3 === 0;
    const run = (scan) => { W.S.gatherScan = scan; const n = W.gather(c[0], c[1], c[2], rr, c[0], c[1], c[2], front); return { idx: Array.from(m.gIdx.subarray(0, n)), fall: Array.from(m.gFall.subarray(0, n)) }; };
    const a = run(true), b = run(false); cases++; total += a.idx.length;
    if (a.idx.length !== b.idx.length || a.idx.some((v, k) => v !== b.idx[k]) || a.fall.some((v, k) => v !== b.fall[k])) bad++;
  }
  W.S.gatherScan = false;
  return { cases, bad, points: total };
});
const gaStroke = (scan, tool) => G(([scan, tool]) => {
  const W = window.__glina; W.S.gatherScan = scan; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
  W.S.sym = true; W.syncSym(); W.orbit(0, 0); W.selectTool(tool);
  const r = document.getElementById('gl').getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
  // across the middle, where the dab and its mirror image meet
  for (let s = 0; s < 3; s++) { W.beginStroke({ pointerId: -1, pointerType: 'mouse', pressure: 1 }, cx - 60, cy - 40 + s * 40, W.brush(), 1); for (let i = 1; i <= 24; i++) { W.stroke.queue.push({ x: cx - 60 + i * 5, y: cy - 40 + s * 40 + Math.sin(i / 3) * 20, p: 1 }); W.processStroke(); } W.endStroke(true); }
  W.S.gatherScan = false;
  return Array.from(W.mesh.pos.subarray(0, W.mesh.n * 3));
}, [scan, tool]);
const gaSame = [];
for (const tool of ['draw', 'clay', 'smooth', 'inflate']) { const A = await gaStroke(true, tool), B = await gaStroke(false, tool); gaSame.push([tool, A.length === B.length && A.every((v, k) => v === B[k])]); }
check('strokes across the symmetry plane give the same surface to the bit with gather through the tree as with the scan', gaSame.every((x) => x[1]), gaSame);
check('gather through the tree finds the same points, in the same order, with the same falloff, as scanning every point (also with only the side facing the brush)', gaRes.bad === 0 && gaRes.points > 10000, gaRes);
// ---------- the tree's own refit gives the library's boxes to the bit ----------
const bvhRun = (lib) => G((lib) => {
  const W = window.__glina; W.S.libRefit = lib; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
  W.S.sym = true; W.syncSym(); W.orbit(0, 0); W.selectTool('draw');
  const r = document.getElementById('gl').getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
  // (a newly built tree's boxes are a little looser than refit ones: start from a refit tree)
  W.gmesh.geometry.boundsTree.refit();
  W.beginStroke({ pointerId: -1, pointerType: 'mouse', pressure: 1 }, cx - 100, cy, W.brush(), 1);
  for (let i = 1; i <= 20; i++) { W.stroke.queue.push({ x: cx - 100 + i * 10, y: cy + Math.sin(i / 3) * 30, p: 1 }); W.processStroke(); }
  const bvh = W.gmesh.geometry.boundsTree, snap = () => bvh._roots.map((b) => Array.from(new Uint32Array(b.slice(0))));
  // during the stroke only the nodes the brush reached are refit after each dab; against a full refit at the
  // same moment, how many nodes are behind (the healer also moves points just outside the brush, so some
  // may be — the whole tree is refit once a frame anyway)
  const part = snap(); bvh.refit(); const now = snap();
  let behind = 0; for (let k = 0; k < part.length; k++) for (let i = 0; i < part[k].length; i += 8) for (let q = 0; q < 6; q++) if (part[k][i + q] !== now[k][i + q]) { behind++; break; }
  W.endStroke(true);
  W.bvhRefit(null); const full = snap();
  W.S.libRefit = false;
  return { part, full, behind };
}, lib);
const bvF = await bvhRun(false), bvL = await bvhRun(true);
const sameB = (a, b) => a.length === b.length && a.every((x, k) => x.length === b[k].length && x.every((v, i) => v === b[k][i]));
const bvhRes = { behindOurs: bvF.behind, behindLib: bvL.behind, fullSame: sameB(bvF.full, bvL.full), nodes: bvF.full[0].length / 8 };
// with the real frame step (the tree, the strokes, the healer, the normals), frame after frame: is the tree, refit
// only where things moved, the same as a full refit at that moment?
const bvhFrames = await G(() => {
  const W = window.__glina, res = {};
  for (const tool of ['draw', 'grab', 'smooth']) {
    document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
    W.S.sym = true; W.syncSym(); W.orbit(0, 0); W.selectTool(tool);
    const bvh = W.gmesh.geometry.boundsTree; bvh.refit();
    const r = document.getElementById('gl').getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
    let behind = 0, frames = 0;
    W.beginStroke({ pointerId: -1, pointerType: 'mouse', pressure: 1 }, cx - 60, cy, W.brush(), 1);
    for (let i = 1; i <= 16; i++) {
      W.stroke.queue.push({ x: cx - 60 + i * 8, y: cy + Math.sin(i / 3) * 25, p: 1 }); W.strokeFrame(); frames++;
      W.strokeFrame();   // (the next frame's start makes the tree current if it was left for it)
      const mine = bvh._roots.map((b) => new Uint32Array(b.slice(0))); bvh.refit();
      for (let k = 0; k < mine.length; k++) { const now = new Uint32Array(bvh._roots[k]); for (let j = 0; j < now.length; j += 8) for (let q = 0; q < 6; q++) if (mine[k][j + q] !== now[j + q]) { behind++; break; } }
    }
    W.endStroke(true);
    res[tool] = { frames, behind };
  }
  return res;
});
check('frame after frame (drawing, grabbing, smoothing), the tree refit only where points moved is the same as a full refit', Object.values(bvhFrames).every((x) => x.behind === 0), bvhFrames);
check('the tree refit by the brush: all of it gives the library\'s boxes to the bit; after each dab no more nodes are behind than with the library\'s', bvhRes.fullSame && bvhRes.behindOurs <= bvhRes.behindLib, bvhRes);
// (the checks below that count undo steps start the list empty: it keeps the newest 100 steps)
// ---------- Rotate: the clay in the circle turns with the pen, as a dial ----------
const rotRes = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); W.undoStack.length = 0; W.selectTool('rotate'); W.brush().radius = 80; W.brush().strength = 1; });
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3))), u0 = await G(() => window.__glina.undoStack.length);
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  // press in the middle, out to the right, then a quarter turn round to the top (anticlockwise on screen)
  await page.mouse.move(e.x, e.y); await page.mouse.down();
  for (let k = 1; k <= 4; k++) { await page.mouse.move(e.x + 10 * k, e.y); await frames(1); }
  for (let k = 1; k <= 12; k++) { const t = (k / 12) * Math.PI / 2; await page.mouse.move(e.x + 40 * Math.cos(t), e.y - 40 * Math.sin(t)); await frames(1); }
  await page.mouse.up(); await frames(3);
  return G(([b0, u0]) => {
    const m = window.__glina.mesh, P = m.pos; let turn = 0, n = 0, drift = 0, outside = 0;
    for (let i = 0; i < m.n; i++) { const x0 = b0[i * 3], y0 = b0[i * 3 + 1], z0 = b0[i * 3 + 2]; if (z0 < 0) continue; const d0 = Math.hypot(x0, y0);
      if (d0 > 0.02 && d0 < 0.06 && z0 > 0.99) { let da = Math.atan2(P[i * 3 + 1], P[i * 3]) - Math.atan2(y0, x0); if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; turn += da; n++; drift = Math.max(drift, Math.abs(Math.hypot(P[i * 3], P[i * 3 + 1]) - d0), Math.abs(P[i * 3 + 2] - z0)); }
      if (d0 > 0.6) outside = Math.max(outside, Math.hypot(P[i * 3] - x0, P[i * 3 + 1] - y0, P[i * 3 + 2] - z0)); }
    return { turn: turn / n, n, drift, outside, undo: window.__glina.undoStack.length - u0 };
  }, [b0, u0]);
})();
check('„Завъртане“: the clay in the middle turns with the pen (a quarter turn anticlockwise), about its axis, the rest stays', rotRes.turn > 1.0 && rotRes.turn < 1.7 && rotRes.drift < 0.002 && rotRes.outside < 1e-6 && rotRes.undo === 1, rotRes);
// ---------- Draw Face Sets: a new group where the brush goes ----------
const fsRes = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); W.undoStack.length = 0; W.selectTool('drawgroups'); W.brush().radius = 40; });
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  const st = () => G(() => { const W = window.__glina, m = W.mesh, c = new Map(); for (let i = 0; i < m.n; i++) c.set(m.grp[i], (c.get(m.grp[i]) || 0) + 1); return { groups: [...c.entries()].sort((a, b) => a[0] - b[0]), undo: W.undoStack.length, pos: m.pos[0] }; });
  const a = await st();
  await drag(e.x - 60, e.y, e.x + 60, e.y, 12);
  const b = await st();
  await page.keyboard.down('Alt'); await drag(e.x, e.y, e.x, e.y + 60, 8); await page.keyboard.up('Alt');
  const c = await st();
  await G(() => { window.__glina.undo(); window.__glina.undo(); });
  const d = await st();
  return { a, b, c, d };
})();
check('„Рисуване на групи“: a stroke makes one new group; Alt from it grows the same group; undo takes each back', fsRes.a.groups.length === 1 && fsRes.b.groups.length === 2 && fsRes.b.undo === fsRes.a.undo + 1 && fsRes.c.groups.length === 2 && fsRes.c.groups[1][1] > fsRes.b.groups[1][1] && fsRes.d.groups.length === 1 && fsRes.d.pos === fsRes.a.pos, fsRes);
// ---------- Enhance Details: smoothing turned round ----------
const enhRes = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0);
    const m = W.mesh, P = m.pos; for (let i = 0; i < m.n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], f = 1 + 0.006 * Math.sin(40 * x) * Math.sin(40 * y); P[i * 3] = x * f; P[i * 3 + 1] = y * f; P[i * 3 + 2] = z * f; }
    const all = new Uint32Array(m.n); for (let i = 0; i < m.n; i++) all[i] = i; m.updateNormals(all, m.n); });
  const stat = () => G(() => { const m = window.__glina.mesh, P = m.pos, I = m.idx; let s = 0, s2 = 0, n = 0, flip = 0, nan = 0;
    for (let i = 0; i < m.n; i++) { const r = Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (!Number.isFinite(r)) nan++; if (P[i * 3 + 2] > 0.95) { s += r; s2 += r * r; n++; } }
    for (let t = 0; t < m.f; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; if ((uy * vz - uz * vy) * P[a] + (uz * vx - ux * vz) * P[a + 1] + (ux * vy - uy * vx) * P[a + 2] <= 0) flip++; }
    const mean = s / n; return { mean, bump: Math.sqrt(Math.max(0, s2 / n - mean * mean)), flip, nan }; });
  const s0 = await stat();
  await G(() => { const W = window.__glina; W.selectTool('enhance'); W.brush().radius = 90; W.brush().strength = 0.6; });
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  for (let k = 0; k < 3; k++) await drag(e.x - 70, e.y + (k - 1) * 20, e.x + 70, e.y + (k - 1) * 20, 16);
  return { before: s0, after: await stat() };
})();
check('„Изостряне на детайла“: the bumps get higher, the form stays where it was, nothing folds', enhRes.after.bump > enhRes.before.bump * 1.3 && Math.abs(enhRes.after.mean - enhRes.before.mean) < 0.002 && enhRes.after.flip === 0 && enhRes.after.nan === 0, enhRes);
// ---------- Boundary: the strip by an open rim bends ----------
const bndRun = async (mode) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Равнина')).click(); W.S.sym = false; W.syncSym(); W.cam.q.setFromAxisAngle(new W.cam.target.constructor(1, 0, 0), -Math.PI / 2); W.orbit(0, 0); });
  await G((md) => { const W = window.__glina; W.undoStack.length = 0; W.selectTool('boundary'); W.brush().radius = 80; W.brush().strength = 1; W.brush().bnd = md; }, mode);
  const b0 = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3))), u0 = await G(() => window.__glina.undoStack.length);
  // press on the right rim (x = +1) and drag out, away from the middle
  const e = await G((md) => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), T = W.cam.target.constructor; return [new T(0.98, 0, 0), new T(md === 'bend' ? 1.06 : 1.3, 0, 0)].map((v) => { v.project(W.camera); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; }); }, mode);
  await drag(e[0][0], e[0][1], e[1][0], e[1][1], 10);
  return G(([b0, u0]) => {
    const m = window.__glina.mesh, P = m.pos; let rimUp = 0, rimOut = 0, nr = 0, far = 0, flip = 0, I = m.idx;
    for (let i = 0; i < m.n; i++) { const x0 = b0[i * 3], z0 = b0[i * 3 + 2]; if (x0 > 0.99 && Math.abs(z0) < 0.03) { rimUp += P[i * 3 + 1]; rimOut += P[i * 3] - x0; nr++; } if (x0 < 0.3) far = Math.max(far, Math.hypot(P[i * 3] - x0, P[i * 3 + 1] - b0[i * 3 + 1], P[i * 3 + 2] - z0)); }
    for (let t = 0; t < m.f; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vz = P[c + 2] - P[a + 2]; if ((uz * vx - ux * vz) <= 0) flip++; }
    return { rimUp: rimUp / nr, rimOut: rimOut / nr, far, flip, undo: window.__glina.undoStack.length - u0 };
  }, [b0, u0]);
};
const bndB = await bndRun('bend'), bndE = await bndRun('expand'), bndI = await bndRun('inflate');
check('„Отворен ръб“: pressing by the rim and dragging out curls the strip up toward its normal; the far side stays', bndB.rimUp > 0.03 && bndB.rimOut < 0 && bndB.flip === 0 && bndB.far < 1e-6 && bndB.undo === 1, bndB);
check('… „Разтяга навън“ pushes the rim out across itself, flat; „Надува“ lifts it along the normals', bndE.rimOut > 0.05 && Math.abs(bndE.rimUp) < 1e-4 && bndE.flip === 0 && bndI.rimUp > 0.05 && Math.abs(bndI.rimOut) < 1e-3, { expand: bndE, inflate: bndI });
// ---------- Clay Thumb: the clay goes ahead of the thumb ----------
const ctRes = await (async () => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Равнина')).click(); W.S.sym = false; W.syncSym(); W.cam.q.setFromAxisAngle(new W.cam.target.constructor(1, 0, 0), -Math.PI / 2); W.orbit(0, 0); });
  await G(() => { const W = window.__glina; W.selectTool('claythumb'); W.brush().radius = 50; W.brush().strength = 0.6; });
  const ends = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), T = W.cam.target.constructor; return [new T(-0.4, 0, 0), new T(0.3, 0, 0)].map((v) => { v.project(W.camera); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; }); });
  await drag(ends[0][0], ends[0][1], ends[1][0], ends[1][1], 30);
  return G(() => {
    const m = window.__glina.mesh, P = m.pos; let behind = 0, nb = 0, front = -1, flip = 0, I = m.idx;
    for (let i = 0; i < m.n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (Math.abs(z) > 0.03) continue; if (x > -0.4 && x < -0.2) { behind += P[i * 3 + 1]; nb++; } if (x > 0.25 && x < 0.5) front = Math.max(front, P[i * 3 + 1]); }
    for (let t = 0; t < m.f; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vz = P[c + 2] - P[a + 2]; if ((uz * vx - ux * vz) <= 0) flip++; }
    return { behind: behind / nb, front, flip };
  });
})();
check('„Глина с палец“: a hollow where the stroke began, the clay pushed along and piled up where it ended, nothing folds', ctRes.behind < -0.002 && ctRes.front > 0.004 && ctRes.flip === 0, ctRes);
// ---------- Multiplane Scrape: a sharp ridge from two planes ----------
const mpRun = async (sign) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Равнина')).click(); W.S.sym = false; W.syncSym(); W.cam.q.setFromAxisAngle(new W.cam.target.constructor(1, 0, 0), -Math.PI / 2); W.orbit(0, 0); });
  await G((sg) => { const W = window.__glina; W.selectTool('mpscrape'); W.brush().radius = 60; W.brush().strength = 1; W.brush().mpAngle = '60'; W.brush().dir = sg; }, sign);
  const ends = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), T = W.cam.target.constructor; return [new T(-0.4, 0, 0), new T(0.4, 0, 0)].map((v) => { v.project(W.camera); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; }); });
  for (let k = 0; k < 3; k++) await drag(ends[0][0], ends[0][1], ends[1][0], ends[1][1], 16);
  const res = await G(() => {
    const m = window.__glina.mesh, P = m.pos, band = (a, b) => { let y = 0, n = 0; for (let i = 0; i < m.n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (Math.abs(x) > 0.2 || Math.abs(z) < a || Math.abs(z) >= b) continue; y += P[i * 3 + 1]; n++; } return n ? y / n : 0; };
    const side = (sg) => { let y = 0, n = 0; for (let i = 0; i < m.n; i++) { const x = P[i * 3], z = P[i * 3 + 2] * sg; if (Math.abs(x) > 0.2 || z < 0.03 || z > 0.08) continue; y += P[i * 3 + 1]; n++; } return y / n; };
    let maxDy = 0; for (let i = 0; i < m.n; i++) maxDy = Math.max(maxDy, Math.abs(P[i * 3 + 1]));
    return { ridge: band(0, 0.012), slope: band(0.03, 0.08), left: side(-1), right: side(1), maxDy };
  });
  await G(() => { window.__glina.brush().dir = 1; });
  return res;
};
const mpR = await mpRun(1), mpA = await mpRun(-1);
check('„Ръб от две равнини“: a sharp ridge along the stroke — the top stays, both sides fall away alike', mpR.ridge > -0.004 && mpR.slope < mpR.ridge - 0.008 && Math.abs(mpR.left - mpR.right) < 0.35 * Math.abs(mpR.slope), mpR);
check('… Alt (the angle turned over) leaves a flat surface as it is: it cuts only an inner corner', mpA.maxDy < 1e-6, mpA);
// ---------- Relax and Slide (as Blender's Relax and Topology Slide) ----------
const meshRun = async (tool, opts = {}) => {
  await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.sym = false; W.syncSym(); W.cam.q.set(0, 0, 0, 1); W.orbit(0, 0); });
  if (opts.jitter) await G(() => {
    // the polygons in front, stretched and bunched: every point pushed sideways (along the surface) at random
    const m = window.__glina.mesh, P = m.pos; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < m.n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (z < 0.5) continue; let tx = rnd(), ty = rnd(), tz = rnd(); const d = tx * x + ty * y + tz * z; tx -= x * d; ty -= y * d; tz -= z * d; const nx = x + tx * 0.025, ny = y + ty * 0.025, nz = z + tz * 0.025, l = Math.hypot(nx, ny, nz); P[i * 3] = nx / l; P[i * 3 + 1] = ny / l; P[i * 3 + 2] = nz / l; }
    const all = new Uint32Array(m.n); for (let i = 0; i < m.n; i++) all[i] = i; m.updateNormals(all, m.n);
  });
  const stat = () => G(() => {
    const m = window.__glina.mesh, P = m.pos, I = m.idx, L = []; let rr = 0, nr = 0, flip = 0;
    for (let t = 0; t < m.f; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; if (P[a * 3 + 2] < 0.95 || P[b * 3 + 2] < 0.95 || P[c * 3 + 2] < 0.95) continue;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) L.push(Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]));
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      if ((uy * vz - uz * vy) * P[a * 3] + (uz * vx - ux * vz) * P[a * 3 + 1] + (ux * vy - uy * vx) * P[a * 3 + 2] <= 0) flip++; }
    for (let i = 0; i < m.n; i++) if (P[i * 3 + 2] > 0.95) { rr += Math.abs(Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) - 1); nr++; }
    const mean = L.reduce((a, b) => a + b, 0) / L.length, cv = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length) / mean;
    return { cv, rad: rr / nr, flip, cx: (() => { let x = 0, k = 0; for (let i = 0; i < m.n; i++) if (P[i * 3 + 2] > 0.95) { x += P[i * 3]; k++; } return x / k; })() };
  });
  const s0 = await stat();
  await G((o) => { const W = window.__glina; W.selectTool(o.tool); W.brush().radius = 90; W.brush().strength = 0.7; }, { tool });
  const e = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(), v = new W.cam.target.constructor(0, 0, 1).project(W.camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  for (let k = 0; k < (opts.passes || 3); k++) await drag(e.x - 70, e.y + (k % 3 - 1) * 20, e.x + 70, e.y + (k % 3 - 1) * 20, 16);
  return { before: s0, after: await stat() };
};
const relaxR = await meshRun('relax', { jitter: true, passes: 5 }), relaxS = await meshRun('smooth', { jitter: true, passes: 5 }), slideR = await meshRun('slide', { passes: 2 });
check('„Отпускане на мрежата“: the polygons even out (edge lengths far more alike) and the form stays — far less shrink than smoothing', relaxR.after.cv < relaxR.before.cv * 0.75 && relaxR.after.rad < 0.004 && relaxR.after.rad < relaxS.after.rad * 0.5 && relaxR.after.flip === 0, { relax: relaxR, smooth: relaxS });
const nudgeR = await meshRun('nudge', { passes: 2 });
check('„Побутване“: the clay goes with the pen along the surface — the form stays round, nothing folds', nudgeR.after.cx > nudgeR.before.cx + 0.02 && nudgeR.after.rad < 0.01 && nudgeR.after.flip === 0, nudgeR);
check('„Плъзгане на мрежата“: the polygons slide along the stroke over the surface — the form stays, nothing folds', slideR.after.cx > slideR.before.cx + 0.005 && slideR.after.rad < 0.004 && slideR.after.flip === 0, slideR);
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
