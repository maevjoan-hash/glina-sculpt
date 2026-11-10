// Dynamic topology in the Rust core: node test/rustdyn.mjs
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
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); W.orbit(0, 0); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 10) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(4);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// the state of the live mesh: closed and manifold, no NaN, how long its edges are
const state = () => G(() => {
  const W = window.__glina, m = W.mesh, a = m.dyn ? m.arrays() : { pos: m.pos.subarray(0, m.n * 3), idx: m.idx.subarray(0, m.f * 3) };
  const cnt = new Map(); let nan = 0, maxE = 0;
  const P = a.pos, I = a.idx;
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const x = I[t + k], y = I[t + (k + 1) % 3], key = x < y ? x * 4294967296 + y : y * 4294967296 + x; cnt.set(key, (cnt.get(key) || 0) + 1);
    const e = Math.hypot(P[x * 3] - P[y * 3], P[x * 3 + 1] - P[y * 3 + 1], P[x * 3 + 2] - P[y * 3 + 2]); if (e < 1e9) maxE = Math.max(maxE, e);
  }
  for (let t = 0; t < I.length; t++) { const v = I[t]; if (!Number.isFinite(P[v * 3]) || Math.abs(P[v * 3]) > 1e9) nan++; }
  let bad = 0; for (const c of cnt.values()) if (c !== 2) bad++;
  return { f: I.length / 3, bad, nan, maxE, dyn: m.dyn, undo: W.undoStack.length };
});
for (const rust of [true, false]) {
  const R = rust ? 'Rust' : 'JavaScript';
  await G((r) => { const W = window.__glina; W.setDyntopo(false); document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.rustDyn = r; W.S.detail = 8; W.S.decimate = true; W.setDyntopo(true); W.selectTool('draw'); W.undoStack.length = 0; }, rust);
  const a = await state();
  for (let k = 0; k < 3; k++) await drag([[cx - 120, cy - 40 + k * 40], [cx + 120, cy - 30 + k * 40]]);
  const b = await state();
  check(`${R}: strokes with dynamic topology add triangles; the surface stays closed and whole`, b.dyn && b.f > a.f * 1.15 && b.bad === 0 && b.nan === 0 && b.undo === 3, { a, b });
  if (rust) var rustF = b.f; else check('Rust and JavaScript refine about as much', Math.abs(b.f - rustF) < 0.35 * Math.max(b.f, rustF), { rust: rustF, js: b.f });
  await G(() => { const W = window.__glina; W.undo(); W.undo(); W.undo(); });
  const c = await state();
  check(`${R}: undo takes the strokes back`, c.f === a.f && c.bad === 0, { a: a.f, c: c.f });
}
// the whole model to one detail size (all mode) in Rust: every edge short enough, closed
await G(() => { const W = window.__glina; W.rustDyn = true; W.S.detail = 10; W.floodDetail(); });
await idle(); await frames(2);
const fl = await state();
const L = await G(() => { const W = window.__glina, c = W.pick(document.getElementById('gl').getBoundingClientRect().width / 2, document.getElementById('gl').getBoundingClientRect().height / 2); return W.S.detail * (c ? 1 : 1); });
check('„Покрий целия модел“ in Rust: the whole model refined, closed, no NaN', fl.f > 30000 && fl.bad === 0 && fl.nan === 0, fl);
// coarse detail on the dense model: collapses thin it out
await G(() => { const W = window.__glina; W.S.detail = 40; W.floodDetail(); });
await idle(); await frames(2);
const co = await state();
check('coarse detail: collapses make it lighter, still closed', co.f < fl.f * 0.6 && co.bad === 0 && co.nan === 0, { before: fl.f, after: co.f, bad: co.bad });
// the same refinement of the whole model, timed: Rust against JavaScript
const timing = await G(async () => {
  const W = window.__glina, out = {};
  for (const r of [true, false]) {
    W.setDyntopo(false); document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
    W.setDyntopo(true); W.rustDyn = r; W.S.detail = 3;
    await new Promise((res) => { const k = setInterval(() => { if (W.mesh.dyn) { clearInterval(k); res(); } }, 5); });
    const toastEl = document.getElementById('toast'); toastEl.textContent = '';
    const f0 = W.mesh.f, t0 = performance.now(); W.floodDetail();
    await new Promise((res) => { const k = setInterval(() => { if (/Целият модел|вече|Ще станат|2 млн/.test(toastEl.textContent)) { clearInterval(k); res(); } }, 2); setTimeout(() => { clearInterval(k); res(); }, 60000); });
    out[r ? 'rust' : 'js'] = { ms: Math.round(performance.now() - t0), f: W.mesh.f };
  }
  W.rustDyn = true;
  return out;
});
console.log('INFO  whole-model refine', JSON.stringify(timing));
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
