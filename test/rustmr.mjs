// Subdivision levels in the Rust core (multires.rs): the same bits as the JavaScript, and faster: node test/rustmr.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => document.getElementById('hintClose').click());
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// the three functions on a bumpy subdivided sphere, both ways
const eq = await G(() => {
  const W = window.__glina, m = W.mesh, n0 = m.n;
  const base = { pos: m.pos.slice(0, n0 * 3), idx: m.idx.slice(0, m.f * 3) };
  const sub = W.subdivideArrays(base.pos, base.idx, null, null, true);
  const n = sub.pos.length / 3;
  const bumpy = sub.pos.map((x, i) => x * (1 + 0.03 * Math.sin(i * 0.731)));
  const run = (rust) => {
    W.rustMR = rust;
    const t0 = performance.now();
    const d = W.mrEncode(bumpy, sub.pos, sub.idx, n);
    const back = W.mrDecode(sub.pos, d, sub.idx, n);
    const low = W.mrLower(bumpy, sub.idx, n, n0);
    return { d, back, low, ms: performance.now() - t0 };
  };
  const r = run(true), j = run(false);
  W.rustMR = true;
  const same = (a, b) => a.length === b.length && new Uint32Array(a.buffer, a.byteOffset, a.length).every((x, k) => x === new Uint32Array(b.buffer, b.byteOffset, b.length)[k]);
  let err = 0; for (let k = 0; k < bumpy.length; k++) err = Math.max(err, Math.abs(r.back[k] - bumpy[k]));
  return { n, d: same(r.d, j.d), back: same(r.back, j.back), low: same(r.low, j.low), err, rust: Math.round(r.ms), js: Math.round(j.ms) };
});
check('detail out and back, and the lower level: the same bits in Rust as in JavaScript', eq.d && eq.back && eq.low, eq);
check('detail out and back gives the surface again', eq.err < 1e-5, { err: eq.err });

// a whole round: two levels up, a stroke on top, down to 0 and up again, with Rust and with JavaScript
async function round(rust) {
  await G((r) => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.rustMR = r; W.S.sym = false; W.syncSym(); }, rust);
  for (let k = 0; k < 2; k++) { await G(() => window.__glina.divide()); await page.waitForFunction(() => !window.__glina.mrPending); }
  // the same pull at the top on every run
  await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) { const y = m.pos[i * 3 + 1]; if (y > 0.7) { const s = 1 + (y - 0.7) * 0.6; m.pos[i * 3] *= s; m.pos[i * 3 + 1] *= s; m.pos[i * 3 + 2] *= s; } } });
  const t0 = Date.now();
  await G(() => window.__glina.setLevel(0)); await page.waitForFunction(() => !window.__glina.mrPending);
  const low = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
  await G(() => window.__glina.setLevel(2)); await page.waitForFunction(() => !window.__glina.mrPending);
  const ms = Date.now() - t0;
  const top = await G(() => { const m = window.__glina.mesh; return { n: m.n, pos: Array.from(m.pos.subarray(0, m.n * 3)) }; });
  return { low, top, ms };
}
const R = await round(true), J = await round(false);
await G(() => { window.__glina.rustMR = true; });
const diff = (a, b) => { let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); return d; };
check('down to level 0 and up to 2: the same model with Rust and with JavaScript', R.top.n === J.top.n && diff(R.low, J.low) === 0 && diff(R.top.pos, J.top.pos) === 0, { n: R.top.n, low: diff(R.low, J.low), top: diff(R.top.pos, J.top.pos) });
check('level 0 shows what was pulled up on top', Math.max(...R.low.filter((_, k) => k % 3 === 1)) > 1.02, { maxY: Math.max(...R.low.filter((_, k) => k % 3 === 1)) });
console.log('INFO  down and up again (ms)', JSON.stringify({ rust: R.ms, js: J.ms }), 'functions', JSON.stringify({ rust: eq.rust, js: eq.js, verts: eq.n }));
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
