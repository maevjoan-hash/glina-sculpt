// VDM brush, Snake Curve and Dimple: node test/vdm.mjs
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
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); W.setDyntopo(false); localStorage.removeItem('glina.vdm'); });
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
const newSphere = () => G(() => { document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера')).click(); window.__glina.orbit(0, 0); });
// how far the points went: the biggest move, and the biggest move along the screen's up and toward the viewer
const moves = (p0) => G((a) => {
  const W = window.__glina, m = W.mesh, up = W.camera.up.clone().applyQuaternion(W.camera.quaternion), cz = W.camera.position.clone().sub(W.cam.target).normalize();
  const upv = { x: 0, y: 1, z: 0 }; const U = W.camera.quaternion ? (() => { const v = W.camera.position.clone().set(0, 1, 0).applyQuaternion(W.camera.quaternion); return v; })() : upv;
  let mx = 0, side = 0, out = 0, count = 0;
  for (let i = 0; i < m.n; i++) {
    const dx = m.pos[i * 3] - a[i * 3], dy = m.pos[i * 3 + 1] - a[i * 3 + 1], dz = m.pos[i * 3 + 2] - a[i * 3 + 2], l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) count++;
    mx = Math.max(mx, l); side = Math.max(side, dx * U.x + dy * U.y + dz * U.z); out = Math.max(out, dx * cz.x + dy * cz.y + dz * cz.z);
  }
  return { mx, side, out, count, undo: W.undoStack.length };
}, p0);
const snapPos = () => G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));

// VDM: a click stamps the horn, its top toward the top of the screen (it hangs over: it moves sideways too)
await newSphere();
await G(() => window.__glina.selectTool('vdm'));
let p0 = await snapPos(), u0 = await G(() => window.__glina.undoStack.length);
await page.mouse.click(cx, cy); await frames(3);
const click = await moves(p0);
check('VDM: a click stamps the shape: up out of the surface and over toward the top of the screen, one step', click.out > 0.08 && click.side > 0.04 && click.undo === u0 + 1, click);
await G(() => window.__glina.undo()); await frames(2);
// a drag: bigger
p0 = await snapPos();
await drag([[cx, cy], [cx, cy - 160]]);
const dragged = await moves(p0);
check('…a drag makes it as big as the drag is long', dragged.out > click.out * 1.5 && dragged.undo === u0 + 1, { click: click.out, drag: dragged.out });
await G(() => window.__glina.undo()); await frames(2);

// a shape of your own, from a plane: store the form, pull a bump up and over to one side, save
const cap = await G(() => {
  const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Равнина')).click();
  W.storeMorph();
  const m = W.mesh, P = m.pos, idx = Uint32Array.from({ length: m.n }, (_, i) => i);
  for (let i = 0; i < m.n; i++) { const r = Math.hypot(P[i * 3], P[i * 3 + 2]); if (r < 0.4) { const h = (1 - (r / 0.4) ** 2) ** 2; P[i * 3 + 1] += 0.5 * h; P[i * 3 + 2] += 0.3 * h * h; } }
  m.updateNormals(idx, m.n);
  W.vdmCapture();
  const F = W.vdmField, n = F.n, k = ((n >> 1) * n + (n >> 1)) * 3, def = W.vdmDefault();
  let diff = 0; for (let i = 0; i < F.d.length; i++) diff = Math.max(diff, Math.abs(F.d[i] - def.d[i]));
  return { up: F.d[k + 2], side: [F.d[k], F.d[k + 1]], diff, stored: !!localStorage.getItem('glina.vdm') };
});
check('„Запази от формата“: what moved becomes the brush’s shape (up and to one side), kept for the next visit', cap.up > 0.8 && Math.abs(cap.side[0]) + Math.abs(cap.side[1]) > 0.2 && cap.diff > 0.1 && cap.stored, cap);
await newSphere();
await G(() => window.__glina.selectTool('vdm'));
p0 = await snapPos();
await page.mouse.click(cx, cy); await frames(3);
const own = await moves(p0);
check('…and the brush stamps it', own.out > 0.06 && own.count > 50, own);
await G(() => window.__glina.undo());
// symmetry: both sides
await G(() => { const W = window.__glina; W.S.sym = true; W.syncSym(); });
p0 = await snapPos();
await page.mouse.click(cx + 80, cy); await frames(3);
const sym = await G((a) => { const m = window.__glina.mesh; let L = 0, R = 0; for (let i = 0; i < m.n; i++) { const d = Math.hypot(m.pos[i * 3] - a[i * 3], m.pos[i * 3 + 1] - a[i * 3 + 1], m.pos[i * 3 + 2] - a[i * 3 + 2]); if (d > 1e-4) { if (a[i * 3] > 0) R++; else L++; } } return { L, R }; }, p0);
check('…with symmetry on both sides', sym.L > 30 && Math.abs(sym.L - sym.R) < Math.max(sym.L, sym.R) * 0.2, sym);
await G(() => { const W = window.__glina; W.undo(); W.S.sym = false; W.syncSym(); W.vdmReset(); });
check('„Вградената форма“ brings the horn back', await G(() => { const W = window.__glina, a = W.vdmField.d, b = W.vdmDefault().d; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return !localStorage.getItem('glina.vdm'); }));

// Snake Curve: a line from the model out into the air pulls it out along the line
await newSphere();
await G(() => window.__glina.selectTool('snakecurve'));
p0 = await snapPos(); u0 = await G(() => window.__glina.undoStack.length);
await drag([[cx, cy], [cx + 120, cy - 40], [cx + 250, cy - 20]], 8);
const sn = await G((a) => { const W = window.__glina, m = W.mesh, right = W.camera.position.clone().set(1, 0, 0).applyQuaternion(W.camera.quaternion); let mx = 0, along = 0; for (let i = 0; i < m.n; i++) { const dx = m.pos[i * 3] - a[i * 3], dy = m.pos[i * 3 + 1] - a[i * 3 + 1], dz = m.pos[i * 3 + 2] - a[i * 3 + 2], l = Math.hypot(dx, dy, dz); if (l > mx) { mx = l; along = (dx * right.x + dy * right.y + dz * right.z) / l; } } return { mx, along, undo: W.undoStack.length }; }, p0);
check('„Издърпване по крива“ pulls the surface out along the line (to the right) as far as it goes, one step', sn.mx > 0.5 && sn.along > 0.8 && sn.undo === u0 + 1, sn);
const starts = await G(() => { const W = window.__glina; const u = W.undoStack.length; W.snakeAlongCurve({ b: W.brush(), sign: 1, pts: [[5, 5], [200, 5]] }); return W.undoStack.length - u; });
check('…a line that does not start on the model does nothing', starts === 0);

// Dimple: a press-and-hold dent
await newSphere();
await G(() => window.__glina.selectTool('dimple'));
p0 = await snapPos();
await drag([[cx, cy], [cx + 1, cy]], 4);
const dim = await G((a) => { const W = window.__glina, m = W.mesh, cz = W.camera.position.clone().sub(W.cam.target).normalize(); let inw = 0; for (let i = 0; i < m.n; i++) { const d = (m.pos[i * 3] - a[i * 3]) * cz.x + (m.pos[i * 3 + 1] - a[i * 3 + 1]) * cz.y + (m.pos[i * 3 + 2] - a[i * 3 + 2]) * cz.z; inw = Math.min(inw, d); } return inw; }, p0);
check('„Вдлъбнатина“ (Dimple) pushes the surface in', dim < -0.008, { dim });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
