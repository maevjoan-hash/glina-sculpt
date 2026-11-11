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
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
