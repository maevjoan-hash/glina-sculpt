// The Rust subdivision (same as the JavaScript one) and the quad remesh (ZRemesher): node test/quadremesh.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.setDyntopo(false); });
const G = (fn, arg) => page.evaluate(fn, arg);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 180000 });
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// the same result from Rust and JavaScript (with colour, mask, groups and creases), and faster
const same = await G(() => {
  const W = window.__glina; W.newScene(W.makeGear(), 'x');
  const m = W.mesh, a = { pos: m.pos.slice(0, m.n * 3), idx: m.idx.slice(0, m.f * 3), col: Float32Array.from({ length: m.n * 3 }, (_, i) => (i % 7) / 7), mask: Float32Array.from({ length: m.n }, (_, i) => (i % 5) / 5), grp: m.grp.slice(0, m.n) };
  const run = (core) => { W.subdivCore = core; const t0 = performance.now(); const r = W.subdivideArrays(a.pos, a.idx, a.col, a.mask, true, a.grp, true); return { r, ms: performance.now() - t0 }; };
  run(true); run(false);
  const R = run(true), J = run(false);
  W.subdivCore = true;
  let d = 0, di = 0;
  for (const k of ['pos', 'col', 'mask', 'grp']) for (let i = 0; i < J.r[k].length; i++) d = Math.max(d, Math.abs(J.r[k][i] - R.r[k][i]));
  for (let i = 0; i < J.r.idx.length; i++) if (J.r.idx[i] !== R.r.idx[i]) di++;
  return { d, di, len: [J.r.pos.length, R.r.pos.length, J.r.idx.length, R.r.idx.length], ms: [Math.round(J.ms), Math.round(R.ms)] };
});
check('Rust subdivision gives the same mesh as the JavaScript one', same.d < 1e-6 && same.di === 0 && same.len[0] === same.len[1] && same.len[2] === same.len[3], same);
check('…and is faster', same.ms[1] < same.ms[0], same.ms);

// the quad remesh of a sculpted sphere
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); });
const u0 = await G(() => window.__glina.undoStack.length);
await G(() => { const W = window.__glina; W.S.quadTarget = 1500; W.mesh.col.fill(0.5); W.quadRemesh(); });
await idle();
const q = await G(() => {
  const W = window.__glina, m = W.mesh, Q = W.quadsOf(m);
  let quads = 0, r0 = Infinity, r1 = 0;
  if (Q) for (let k = 3; k < Q.length; k += 4) if (Q[k] !== 0xffffffff) quads++;
  for (let i = 0; i < m.n; i++) { const r = Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
  // valence
  const val = new Uint16Array(m.n), seen = new Set();
  if (Q) for (let k = 0; k < Q.length; k += 4) { const c = Q[k + 3] === 0xffffffff ? 3 : 4; for (let e = 0; e < c; e++) { const a = Q[k + e], b = Q[k + (e + 1) % c], key = Math.min(a, b) * 1e7 + Math.max(a, b); if (!seen.has(key)) { seen.add(key); val[a]++; val[b]++; } } }
  let v4 = 0; for (let i = 0; i < m.n; i++) if (val[i] === 4) v4++;
  return { faces: Q ? Q.length / 4 : 0, quads, open: W.hasOpenEdges(m.idx.subarray(0, m.f * 3)), r: [r0, r1], v4: v4 / m.n, col: m.col[0], undo: W.undoStack.length };
});
check('ZRemesher: about the wanted number of faces, nearly all quads, closed, on the surface', q.faces > 1000 && q.faces < 2200 && q.quads > q.faces * 0.85 && !q.open && q.r[1] - q.r[0] < 0.02 && q.v4 > 0.8, q);
check('…the colour comes over, and it is one undo step', Math.abs(q.col - 0.5) < 1e-3 && q.undo === u0 + 1, { ...q, u0 });
const obj = await G(() => { const t = window.__glina.exportOBJ(); const s = typeof t === 'string' ? t : new TextDecoder().decode(t); const f = s.split('\n').filter((l) => l.startsWith('f ')); return { four: f.filter((l) => l.trim().split(/\s+/).length === 5).length, three: f.filter((l) => l.trim().split(/\s+/).length === 4).length }; });
check('OBJ writes the quads as quads (and the few triangles as triangles)', obj.four === q.quads && obj.three === q.faces - q.quads, obj);
await G(() => window.__glina.undo());
check('undo brings the sphere back', await G(() => !window.__glina.quadsOf(window.__glina.mesh) && window.__glina.mesh.f === 20480));

// a sculpt: a torus with a pulled horn still gives a closed quad mesh
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Тор')).click(); W.S.quadTarget = 3000; W.quadRemesh(); });
await idle();
const tq = await G(() => { const W = window.__glina, m = W.mesh, Q = W.quadsOf(m); let quads = 0; for (let k = 3; k < Q.length; k += 4) if (Q[k] !== 0xffffffff) quads++; return { faces: Q.length / 4, quads, open: W.hasOpenEdges(m.idx.subarray(0, m.f * 3)) }; });
check('the torus too (no singular points needed): closed, nearly all quads', !tq.open && tq.quads > tq.faces * 0.9, tq);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
