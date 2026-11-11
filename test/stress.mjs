// Every brush pushed to the extreme (full strength, many passes over one place, long drags) must leave a
// sound surface: no NaN, no spikes, no folded or needle triangles, nothing flung far away: node test/stress.mjs
// With --report it only prints the table (for tuning).
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report'), ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.setWheel(false); document.getElementById('bPanel').click(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const box = await G(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(pts, steps = 6) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) for (let i = 1; i <= steps; i++) { await page.mouse.move(pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * i / steps, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * i / steps); await frames(1); }
  await page.mouse.up(); await frames(2);
}
const fresh = (dyn) => G(async (dyn) => {
  const W = window.__glina; if (W.mesh.dyn) { W.setDyntopo(false); await new Promise((r) => setTimeout(r, 120)); }
  document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click();
  W.S.sym = false; W.syncSym(); W.orbit(0, 0); W.undoStack.length = 0;
  if (dyn) { W.S.detail = 8; W.setDyntopo(true); await new Promise((r) => { const k = setInterval(() => { if (W.mesh.dyn) { clearInterval(k); r(); } }, 10); }); }
}, dyn);
// how sound the surface is
const health = () => G(() => {
  const m = window.__glina.mesh, a = m.dyn ? m.arrays() : { pos: m.pos, idx: m.idx.subarray(0, m.f * 3) }, P = a.pos, I = a.idx, n = P.length / 3 | 0, f = I.length / 3;
  let nan = 0, maxR = 0;
  for (let i = 0; i < (m.dyn ? n : m.n); i++) { const r = Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (!Number.isFinite(r)) nan++; else if (r < 1e5) maxR = Math.max(maxR, r); }
  // face normals, needles, folded edges
  const FN = new Float32Array(f * 3), edge = new Map(); let needles = 0, folded = 0, edges = 0, sumL = 0, cntL = 0, maxL = 0;
  for (let t = 0; t < f; t++) {
    const A = I[t * 3] * 3, B = I[t * 3 + 1] * 3, C = I[t * 3 + 2] * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ar = Math.hypot(nx, ny, nz) / 2;
    const l2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (ux - vx) ** 2 + (uy - vy) ** 2 + (uz - vz) ** 2);
    if (ar > 0 && l2 / (2.309 * ar) > 60) needles++; else if (!(ar > 0) && l2 > 0) needles++;
    const l = ar > 0 ? 2 * ar : 1; FN[t * 3] = nx / l; FN[t * 3 + 1] = ny / l; FN[t * 3 + 2] = nz / l;
    sumL += Math.sqrt(l2); cntL++; maxL = Math.max(maxL, Math.sqrt(l2));
    for (let e = 0; e < 3; e++) { const p = I[t * 3 + e], q = I[t * 3 + (e + 1) % 3], k = p < q ? p * 4294967296 + q : q * 4294967296 + p, o = edge.get(k); if (o === undefined) edge.set(k, t); else { edges++; if (FN[o * 3] * FN[t * 3] + FN[o * 3 + 1] * FN[t * 3 + 1] + FN[o * 3 + 2] * FN[t * 3 + 2] < -0.5) folded++; } }
  }
  // spikes: a point far out of the ring of its neighbours, measured in the ring's own size (a point beside
  // a very thin triangle counts too, though nothing sticks out there: hence the looser limit below)
  const sum = new Float64Array(n * 3), cnt = new Uint16Array(n), ring = new Float64Array(n);
  for (let t = 0; t < f; t++) for (let e = 0; e < 3; e++) { const p = I[t * 3 + e], q = I[t * 3 + (e + 1) % 3]; sum[p * 3] += P[q * 3]; sum[p * 3 + 1] += P[q * 3 + 1]; sum[p * 3 + 2] += P[q * 3 + 2]; cnt[p]++; }
  for (let t = 0; t < f; t++) { const A = I[t * 3], B = I[t * 3 + 1], C = I[t * 3 + 2], d = Math.hypot(P[B * 3] - P[C * 3], P[B * 3 + 1] - P[C * 3 + 1], P[B * 3 + 2] - P[C * 3 + 2]); ring[A] += d; }
  let spikes = 0;
  for (let i = 0; i < n; i++) { if (!cnt[i]) continue; const d = Math.hypot(P[i * 3] - sum[i * 3] / cnt[i], P[i * 3 + 1] - sum[i * 3 + 1] / cnt[i], P[i * 3 + 2] - sum[i * 3 + 2] / cnt[i]), rs = ring[i] / cnt[i]; if (rs > 0 && d > rs * 2.5) spikes++; }
  return { f, nan, maxR: +maxR.toFixed(2), needles, folded, spikes, maxEdge: +(maxL / (sumL / cntL)).toFixed(1) };
});
const ids = (await G(() => window.__glina.S.brushes.filter((b) => b.builtin).map((b) => ({ id: b.id, base: b.base, stroke: b.stroke })))).filter((b) => !ONLY.length || ONLY.includes(b.id));
// brushes that do not sculpt by dabs or drags over the surface are not part of this
const SKIP = new Set(['gizmo', 'ffd', 'zmodel', 'topology', 'shadowbox', 'clip', 'cut', 'slice', 'insert', 'tube', 'array', 'groom', 'mask', 'paint', 'vdm']);
const table = [];
for (const b of ids) {
  if (SKIP.has(b.base) || b.stroke === 'curve') continue;
  for (const dyn of [false, true]) {
    if (dyn && (b.base === 'pose' || b.base === 'kelvin' || b.base === 'morph' || b.base === 'layer')) continue;
    await fresh(dyn);
    await G((id) => { const W = window.__glina; W.selectTool(id); const br = W.brush(); br.strength = 1; br.radius = Math.max(br.radius, 70); }, b.id);
    const pull = b.base === 'grab' || b.base === 'snake' || b.base === 'pose' || b.base === 'kelvin';
    if (pull) {
      // long pulls, far off the model and back across it, several times from the same place
      // (fast: few steps, so every frame carries the pen a long way)
      for (let k = 0; k < 4; k++) await drag([[cx + 60 - k * 40, cy + k * 20], [cx + 420, cy - 200 + k * 60]], 5);
      await drag([[cx - 80, cy + 80], [cx - 380, cy + 260], [cx - 100, cy - 300]], 6);
    } else {
      // thirty passes over one place, then scribbling on it
      for (let k = 0; k < 15; k++) await drag([[cx - 70, cy], [cx + 70, cy], [cx - 70, cy]], 5);
      await drag([[cx - 60, cy - 60], [cx + 60, cy + 60], [cx + 60, cy - 60], [cx - 60, cy + 60], [cx, cy], [cx + 5, cy + 5], [cx, cy]], 6);
    }
    const h = await health();
    table.push({ id: b.id, dyn, ...h });
    if (REPORT) console.log(JSON.stringify(table[table.length - 1]));
    else check(`${b.id}${dyn ? ' (дин. топология)' : ''}: sound after the extreme`, h.nan === 0 && h.spikes <= h.f * 0.015 && h.folded <= h.f * 0.005 && h.needles <= h.f * 0.01 && h.maxR < 12, h);
  }
}
// carving (the brush turned inward) close up on a coarse model with dynamic topology, from changing angles:
// big triangles beside the brush must be split before they are moved, or they are dragged into the pit as
// shards (a mouth carved with „Надуване“ → „Навътре“)
for (const id of ['inflate', 'draw', 'clay', 'claybuild', 'dam', 'crease']) {
  if (ONLY.length && !ONLY.includes(id) && !ONLY.includes('carve')) continue;
  await fresh(true);
  await G((id) => { const W = window.__glina; W.S.sym = true; W.syncSym(); W.cam.dist *= 0.45; W.orbit(0, 0); W.selectTool(id); const br = W.brush(); br.strength = 0.7; br.radius = 69; br.dir = -1; }, id);
  for (let k = 0; k < 24; k++) {
    if (k % 5 === 4) await G((k) => window.__glina.orbit(k % 10 === 4 ? 90 : -90, k % 10 === 4 ? 40 : -40), k);
    await drag([[cx - 70, cy + (k % 3) * 8], [cx + 70, cy + (k % 3) * 8], [cx - 50, cy + 10]], 5);
  }
  const h = await health();
  await G((id) => { window.__glina.brush().dir = id === 'dam' || id === 'crease' ? -1 : 1; }, id);
  if (REPORT) console.log(JSON.stringify({ id, carve: true, ...h }));
  else check(`${id}: carving close up on a coarse model (дин. топология) stays sound`, h.nan === 0 && h.folded <= h.f * 0.003 && h.needles <= h.f * 0.005 && h.spikes <= h.f * 0.015, h);
}
if (!REPORT) check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
