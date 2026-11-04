// Reference picture (Spotlight in short), painting from it, and the smooth view: node test/reference.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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

// a picture: red on the left half, blue on the right
await G(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 200; const g = c.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 200); g.fillStyle = '#0000ff'; g.fillRect(100, 0, 100, 200);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  window.__glina.refOpen(new File([blob], 'ref.png', { type: 'image/png' }));
});
await page.waitForFunction(() => window.__glina.refState.img);
await frames(2);
const shown = await G(() => { const el = document.getElementById('refImg'); return { hidden: el.hidden, op: +el.style.opacity, front: el.classList.contains('front') }; });
check('the picture shows over the model, half see-through', !shown.hidden && Math.abs(shown.op - 0.5) < 1e-6 && shown.front, shown);
const cols = await G(({ w, h }) => ({ left: window.__glina.refColourAt(w / 2 - 50, h / 2), right: window.__glina.refColourAt(w / 2 + 50, h / 2), out: window.__glina.refColourAt(5, 5) }), { w: box.w, h: box.h });
check('its colours are read where they are on screen (and nothing outside it)', cols.left[0] > 0.9 && cols.left[2] < 0.1 && cols.right[2] > 0.9 && cols.right[0] < 0.1 && cols.out === null, cols);

// paint from the picture: left of the middle red, right of it blue
await G(() => { document.getElementById('bRefPaint').click(); window.__glina.brush().radius = 60; window.__glina.brush().strength = 1; });
for (let k = 0; k < 3; k++) await drag([[cx - 140, cy], [cx + 140, cy]]);
const painted = await G(() => {
  const W = window.__glina, m = W.mesh, cam = W.camera; let redL = 0, blueR = 0, wrong = 0;
  const v = cam.position.clone();
  for (let i = 0; i < m.n; i++) {
    if (m.col[i * 3] > 0.98 && m.col[i * 3 + 1] > 0.98) continue;   // untouched
    v.set(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]).project(cam);
    const red = m.col[i * 3] > m.col[i * 3 + 2] + 0.2, blue = m.col[i * 3 + 2] > m.col[i * 3] + 0.2;
    if (v.x < -0.05 && red) redL++; else if (v.x > 0.05 && blue) blueR++; else if (Math.abs(v.x) > 0.05 && (red || blue)) wrong++;
  }
  return { redL, blueR, wrong, tool: W.S.tool };
});
check('„Боя от картинката“ paints each point with the colour of the picture over it', painted.tool === 'paint' && painted.redL > 50 && painted.blueR > 50 && painted.wrong < (painted.redL + painted.blueR) * 0.05, painted);

// adjusting moves the picture and sculpts nothing
const u0 = await G(() => window.__glina.undoStack.length);
await G(() => document.getElementById('bRefAdjust').click());
await drag([[cx, cy], [cx + 80, cy + 30]]);
const adj = await G(() => ({ x: window.__glina.refState.x, y: window.__glina.refState.y, undo: window.__glina.undoStack.length }));
check('„Нагласи“: a drag moves the picture, not the model', Math.abs(adj.x - 80) < 2 && Math.abs(adj.y - 30) < 2 && adj.undo === u0, adj);
await G(() => document.getElementById('bRefAdjust').click());
await G(() => document.getElementById('bRefClear').click());
check('„Махни“ takes the picture away', await G(() => document.getElementById('refImg').hidden && !window.__glina.refState.img));

// the smooth view
await G(() => { window.__glina.S.paintFromRef = false; window.__glina.selectTool('draw'); const el = document.getElementById('tSmoothView'); el.checked = true; el.dispatchEvent(new Event('change')); });
await frames(3);
const sv = await G(() => { const W = window.__glina, o = W.smoothViewObj; return { on: !!o && o.visible, f: o ? o.geometry.index.count / 3 : 0, base: W.mesh.f }; });
check('the smooth view draws a subdivided copy in place of the mesh', sv.on && sv.f === sv.base * 4, sv);
await drag([[cx - 60, cy + 60], [cx + 60, cy + 60]]);
await frames(3);
const sv2 = await G(() => { const W = window.__glina, o = W.smoothViewObj; return { on: !!o && o.visible, undo: W.undoStack.length }; });
check('a stroke still sculpts the mesh, and the smooth copy comes back after it', sv2.on && sv2.undo === u0 + 1, sv2);
await G(() => { const el = document.getElementById('tSmoothView'); el.checked = false; el.dispatchEvent(new Event('change')); });
await frames(2);
check('off: the mesh itself again', await G(() => !window.__glina.smoothViewObj));

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
