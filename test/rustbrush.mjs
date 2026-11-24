// The brushes in the Rust core give the same surface as the JavaScript ones: node test/rustbrush.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// one stroke, the same points every time, with the core or without; what the surface is afterwards
const run = (id, rust, sign = 1, dyn = false) => page.evaluate(([id, rust, sign, dyn]) => {
  const W = window.__glina;
  W.setDyntopo(false);
  // (relaxing an open rim: a plane seen from above, far enough that the stroke crosses its edge)
  const bnd = id.startsWith('bnd'), rim = id === 'relaxrim' || bnd;
  document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith(rim ? 'Равнина' : 'Сфера, по-лека')).click();
  W.S.sym = true; W.syncSym(); W.setDyntopo(dyn);
  if (rim) {
    W.cam.q.setFromAxisAngle(new W.cam.target.constructor(1, 0, 0), -Math.PI / 2); W.cam.dist *= 2.6;
    // the rim points pushed along the rim, unevenly, so relaxing has something to even out there
    const m = W.mesh; for (let i = 0; i < m.n; i++) if (m.boundary[i]) { const x = m.pos[i * 3], z = m.pos[i * 3 + 2], along = Math.abs(x) > Math.abs(z) ? 2 : 0; m.pos[i * 3 + along] += 0.012 * Math.sin(i * 1.7); }
    m.computeAllNormals();
  }
  W.orbit(0, 0);
  if (id === 'morph') { W.storeMorph(); const m = W.mesh; for (let i = 0; i < m.n; i++) m.pos[i * 3] *= 1.1; }
  // (smearing needs colours to smear: stripes)
  if (id === 'smear') { const m = W.mesh; for (let i = 0; i < m.n; i++) { const t = 0.5 + 0.5 * Math.sin(m.pos[i * 3] * 23); m.col[i * 3] = 1; m.col[i * 3 + 1] = t; m.col[i * 3 + 2] = 1 - t; } }
  const tool = id === 'slidepinch' ? 'slide' : bnd ? 'boundary' : rim ? 'relax' : id.startsWith('elastic') ? 'elastic' : id;
  W.selectTool(tool); W.rustBrushes = rust;
  if (tool === 'elastic') W.brush().kelScale = id === 'elastic1' ? 'single' : id === 'elastic3' ? 'tri' : 'bi';
  if (bnd) W.brush().bnd = id.slice(3);
  if (id === 'slide' || id === 'slidepinch') W.brush().relax = id === 'slidepinch' ? 'pinch' : 'drag';
  if (W.brush().alphaRot === 'random') W.brush().alphaRot = 'fixed';   // (a random turn would differ between the two runs)
  const r = document.getElementById('gl').getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
  W.undoStack.length = 0;   // (a long run reaches the 100-step limit, where a new step drops an old one)
  const b = W.brush(), u0 = W.undoStack.length;
  // (the open rim: pressed just inside the plane's right edge and pulled out from it)
  let x0 = cx - 120, y0 = cy - 30, step = 6;
  if (bnd) { const v = new W.cam.target.constructor(0.97, 0, 0.1).project(W.camera); x0 = (v.x * 0.5 + 0.5) * r.width; y0 = (-v.y * 0.5 + 0.5) * r.height; step = 1.5; }
  W.beginStroke({ pointerId: -1, pointerType: 'mouse', pressure: 1 }, x0, y0, b, sign * (b.dir || 1));
  for (let i = 1; i <= 40; i++) { W.stroke.queue.push({ x: x0 + i * step, y: y0 + Math.sin(i / 5) * 25 * (bnd ? 0.2 : 1), p: 0.4 + 0.6 * (i % 7) / 7 }); W.processStroke(); }
  W.endStroke(true);
  const m = W.mesh; W.rustBrushes = true;
  return { pos: Array.from(m.pos.subarray(0, m.n * 3)), mask: Array.from(m.mask.subarray(0, m.n)), col: Array.from(m.col.subarray(0, m.n * 3)), undo: W.undoStack.length - u0 };
}, [id, rust, sign, dyn]);
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
// (rotate, boundary and the cloth's twist use cos and sin, which in the core and in the browser can differ in
// the last bit of an f64; they are held to the same 1e-6 as the rest, and agree to the bit almost always)
// (dynamic topology changes the mesh by the time a stroke takes, so two runs never match: its strokes
// are checked by the other tests)
for (const [id, sign, dyn] of [['smooth', 1], ['clothpinch', 1], ['clothpinch', -1], ['clothslide', 1], ['clothhook', 1], ['clothtwist', 1], ['clothinflate', 1], ['clothperp', 1], ['clothexpand', 1], ['clothexpand', -1], ['nudge', 1], ['mpscrape', 1], ['claythumb', 1], ['claythumb', -1], ['relax', 1], ['relaxrim', 1], ['slide', 1], ['slide', -1], ['slidepinch', 1], ['slidepinch', -1], ['enhance', 1], ['smear', 1], ['rotate', 1], ['rotate', -1], ['elastic', 1], ['elastic1', 1], ['elastic3', 1], ['bndbend', 1], ['bndbend', -1], ['bndexpand', 1], ['bndinflate', 1], ['draw', 1], ['draw', -1], ['dam', 1], ['clay', 1], ['claybuild', 1], ['inflate', 1], ['pinch', 1], ['magnify', 1], ['crease', 1], ['flatten', 1], ['flatten', -1], ['trim', 1], ['planar', 1], ['layer', 1], ['layer', -1], ['blob', 1], ['morph', 1], ['mask', 1], ['mask', -1], ['paint', 1]]) {
  const R = await run(id, true, sign, dyn), J = await run(id, false, sign, dyn);
  const d = Math.max(diff(R.pos, J.pos), diff(R.mask, J.mask), diff(R.col, J.col));
  const changedAny = R.undo === 1;
  check(`${id}${sign < 0 ? ' (Alt)' : ''}${dyn ? ' (dynamic topology)' : ''}: the core gives the same surface as JavaScript, one undo step`, (d < (id.startsWith('cloth') ? 1e-5 : 1e-6)) && changedAny && R.pos.length === J.pos.length && J.undo === 1, { d, undo: [R.undo, J.undo] });
}
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
