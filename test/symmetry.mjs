// Grab near the symmetry plane: the grabbed point must follow the pen (soft and elastic), static and dynamic.
// (dynamic: detail so coarse that nothing is split or merged, so vertex numbers stay put)
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => document.getElementById('hintClose').click());   // the hint box covers the upper middle
// the camera as far as a wide window frames the unit sphere, so the brushes cover the same part of it
// whatever the window's shape (a narrow window now moves the camera back to fit the model across)
await page.evaluate(() => { const W = window.__glina; W.cam.dist = 1 / Math.sin((19 * Math.PI) / 180) * 1.15; W.orbit(0, 0); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
let ok = true;
for (const dyn of [false, true]) for (const tool of ['grab', 'elastic']) {
  await page.evaluate(({ d, t }) => { const G = window.__glina; G.setDyntopo(d); G.selectTool(t); G.S.sym = true; G.S.symY = G.S.symZ = false; G.S.radial = 0; G.syncSym(); G.S.detail = 400; G.S.decimate = false; }, { d: dyn, t: tool });
  await page.waitForFunction((d) => !!window.__glina.mesh.dyn === d, dyn);
  const y = box.y + box.h / 2;
  // the screen point on the middle row whose surface point is closest to the symmetry plane x = 0
  const sx = await page.evaluate(({ w, h }) => { let best = w / 2, bd = 1e9; for (let px = 0; px < w; px += 1) { const hit = window.__glina.pick(px, h / 2); if (hit && Math.abs(hit.point.x) < bd) { bd = Math.abs(hit.point.x); best = px; } } return best; }, { w: box.w, h: box.h });
  const x = box.x + sx;
  // the vertex nearest the press point, and its x before
  const before = await page.evaluate(({ x, y }) => { const h = window.__glina.pick(x, y); const m = window.__glina.mesh; let best = -1, bd = 1e9; for (let i = 0; i < m.n; i++) { const d = (m.pos[i * 3] - h.point.x) ** 2 + (m.pos[i * 3 + 1] - h.point.y) ** 2 + (m.pos[i * 3 + 2] - h.point.z) ** 2; if (d < bd) { bd = d; best = i; } } return { i: best, x: m.pos[best * 3], y: m.pos[best * 3 + 1] }; }, { x: x - box.x, y: y - box.y });
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x + k * 4, y - k * 6); await frames(1); }
  await page.mouse.up(); await frames(3);
  const after = await page.evaluate((i) => { const m = window.__glina.mesh; return { x: m.pos[i * 3], y: m.pos[i * 3 + 1] }; }, before.i);
  // pen moved right and up: the vertex must not go left, and must go up
  const pass = Math.abs(before.x) < 0.03 && after.y > before.y + 0.05 && after.x >= before.x - 0.02;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${dyn ? 'dyn ' : ''}${tool} at the symmetry plane follows the pen`, JSON.stringify({ before, after }));
  await page.evaluate(() => window.__glina.undo()); await frames(2);
}
// Y/Z mirrors and radial copies: a short Draw stroke must raise a bump of the same height at every copy
await page.evaluate(() => window.__glina.setDyntopo(false)); await page.waitForFunction(() => !window.__glina.mesh.dyn);
for (const conf of [{ sym: false, symY: true }, { sym: false, symZ: true }, { sym: true, symY: true }, { sym: false, radial: 5, radialAxis: 'y' }, { sym: true, radial: 3, radialAxis: 'z' }]) {
  await page.evaluate((c) => { const G = window.__glina; Object.assign(G.S, { sym: false, symY: false, symZ: false, radial: 0, radialAxis: 'y' }, c); G.syncSym(); G.selectTool('draw'); G.brush().strength = 0.8; }, conf);
  const x = box.x + box.w / 2 + 60, y = box.y + box.h / 2 - 50;
  const hit = await page.evaluate(({ x, y }) => { const h = window.__glina.pick(x, y); return h && [h.point.x, h.point.y, h.point.z]; }, { x: x - box.x, y: y - box.y });
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 3; k++) { await page.mouse.move(x + k, y); await frames(1); }
  await page.mouse.up(); await frames(3);
  const heights = await page.evaluate((h) => {
    const G = window.__glina, m = G.mesh, P = m.pos, rec = G.undoStack[G.undoStack.length - 1];
    const before = new Map(); for (let k = 0; k < rec.idx.length; k++) before.set(rec.idx[k], [rec.pos[k * 3], rec.pos[k * 3 + 1], rec.pos[k * 3 + 2]]);
    const centres = [h, ...G.SYM.map(({ m: M }) => [M[0] * h[0] + M[1] * h[1] + M[2] * h[2], M[3] * h[0] + M[4] * h[1] + M[5] * h[2], M[6] * h[0] + M[7] * h[1] + M[8] * h[2]])];
    return centres.map((c) => { let best = 0; for (const [i, o] of before) { if (Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 0.08) continue; best = Math.max(best, Math.hypot(P[i * 3] - o[0], P[i * 3 + 1] - o[1], P[i * 3 + 2] - o[2])); } return best; });
  }, hit);
  const mx = Math.max(...heights), mn = Math.min(...heights);
  const pass = heights.length > 1 && mn > 0.003 && mn > mx * 0.75;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${JSON.stringify(conf)}: ${heights.length} bumps of the same height`, JSON.stringify(heights.map((v) => +v.toFixed(4))));
  await page.evaluate(() => window.__glina.undo()); await frames(2);
}
// Pose near the symmetry plane: the overlap of the two copies must bend smoothly (no tearing):
// the largest jump in displacement along an edge, relative to the edge, stays like without symmetry
for (const symOn of [false, true]) {
  await page.evaluate((on) => { const G = window.__glina; Object.assign(G.S, { sym: on, symY: false, symZ: false, radial: 0 }); G.syncSym(); G.selectTool('pose'); G.brush().radius = 90; }, symOn);
  const sx = await page.evaluate(({ w, h }) => { let best = w / 2, bd = 1e9; for (let px = 0; px < w; px += 1) { const hit = window.__glina.pick(px, h / 2); if (hit && Math.abs(hit.point.x - 0.1) < bd) { bd = Math.abs(hit.point.x - 0.1); best = px; } } return best; }, { w: box.w, h: box.h });
  const x = box.x + sx, y = box.y + box.h / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x + k * 3, y - k * 8); await frames(1); }
  await page.mouse.up(); await frames(3);
  const jump = await page.evaluate(() => {
    const G = window.__glina, m = G.mesh, P = m.pos, rec = G.undoStack[G.undoStack.length - 1], d = new Map();
    for (let k = 0; k < rec.idx.length; k++) { const i = rec.idx[k]; d.set(i, [P[i * 3] - rec.pos[k * 3], P[i * 3 + 1] - rec.pos[k * 3 + 1], P[i * 3 + 2] - rec.pos[k * 3 + 2]]); }
    let worst = 0;
    const I = m.idx;
    for (let f = 0; f < m.f * 3; f += 3) for (let e = 0; e < 3; e++) {
      const a = I[f + e], b = I[f + (e + 1) % 3], da = d.get(a) || [0, 0, 0], db = d.get(b) || [0, 0, 0];
      const len = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) || 1e-9;
      const orig = Math.hypot(rec.pos ? 0 : 0, 0, 0);
      worst = Math.max(worst, Math.hypot(da[0] - db[0], da[1] - db[1], da[2] - db[2]) / len);
    }
    return worst;
  });
  console.log(`INFO  pose at x=0.1, symmetry ${symOn ? 'on' : 'off'}: worst displacement jump along an edge = ${jump.toFixed(2)} edge lengths`);
  if (!symOn) globalThis.__poseBase = jump;
  else { const pass = jump < globalThis.__poseBase * 1.6 + 0.5; ok = ok && pass; console.log(`${pass ? 'PASS' : 'FAIL'}  pose near the plane bends as smoothly as without symmetry`); }
  await page.evaluate(() => window.__glina.undo()); await frames(2);
}
console.log(errors.length ? 'FAIL  page errors ' + errors.slice(0, 3) : 'PASS  no page errors');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
