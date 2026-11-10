// Polygon visibility (Ctrl+Shift, Delete Hidden) and cloth (Dynamics, in the Rust core): node test/dynamics.mjs
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
await page.evaluate(() => document.getElementById('hintClose').click());
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, mods = [], steps = 8) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
  for (const m of mods) await page.keyboard.up(m);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const hid = () => G(() => window.__glina.hiddenCount());
const N = await G(() => window.__glina.mesh.n);
await G(() => { const W = window.__glina; W.S.sym = false; W.syncSym(); W.S.selShape = 'rect'; });

// Ctrl+Shift+drag: only what the rectangle covers stays; Ctrl+Shift+click on empty space shows all again
await drag([[cx - 40, cy - 200], [cx + 250, cy + 220]], ['Control', 'Shift']);
const h1 = await hid();
check('Ctrl+Shift+drag shows only what the rectangle covers', h1 > N * 0.2 && h1 < N * 0.9, { h1, N });
await G(() => window.__glina.undo()); await frames(2);
check('undo shows everything again', (await hid()) === 0);
await drag([[cx - 40, cy - 200], [cx + 250, cy + 220]], ['Control', 'Shift', 'Alt']);
const h2 = await hid();
check('with Alt the rectangle is hidden instead', h2 > N * 0.1 && h2 < N * 0.8 && Math.abs(h2 + h1 - N) < N * 0.1, { h1, h2, N });
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(box.x + 20, box.y + box.h - 60); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frames(2);
check('Ctrl+Shift+click on empty space shows everything', (await hid()) === 0);

// hidden parts: not picked, not touched by a brush
await G(() => { const W = window.__glina, m = W.mesh, next = new Float32Array(m.n); for (let i = 0; i < m.n; i++) next[i] = m.pos[i * 3] < 0 ? 1 : 0; W.setHiddenUndoable(next); });
const snap = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
await G(() => window.__glina.selectTool('draw'));
await drag([[cx - 120, cy], [cx + 120, cy]]);
const touched = await G((s) => { const m = window.__glina.mesh; let hidMoved = 0, visMoved = 0; for (let i = 0; i < m.n; i++) { const d = Math.abs(m.pos[i * 3] - s[i * 3]) + Math.abs(m.pos[i * 3 + 1] - s[i * 3 + 1]) + Math.abs(m.pos[i * 3 + 2] - s[i * 3 + 2]); if (d > 1e-7) { if (m.hid[i]) hidMoved++; else visMoved++; } } return { hidMoved, visMoved }; }, snap);
check('a stroke across the hidden half moves only the shown half', touched.hidMoved === 0 && touched.visMoved > 20, touched);
await G(() => window.__glina.undo()); await frames(2);
const pk = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(); for (let px = 0; px < r.width; px += 4) { const h = W.pick(px, r.height / 2); if (h && h.point.x < -0.3) return { x: h.point.x, ok: false }; } return { ok: true }; });
check('picking goes through the hidden half', pk.ok, pk);

// invert, hide the masked, delete the hidden
const before = await G(() => window.__glina.hiddenCount());
await G(() => window.__glina.invertVisibility()); await frames(2);
const inv = await G(() => window.__glina.hiddenCount());
check('invert shows the hidden and hides the rest', inv > 0 && Math.abs(inv - (N - before)) < N * 0.05, { before, inv });
await G(() => window.__glina.showAll()); await frames(2);
await G(() => { const m = window.__glina.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.5 ? 1 : 0; });
await G(() => window.__glina.hideMasked()); await frames(2);
const hm = await G(() => { const m = window.__glina.mesh; let ok = true; for (let i = 0; i < m.n; i++) if ((m.mask[i] >= 0.5) !== (m.hid[i] > 0)) ok = false; return ok; });
check('„Скрий маскираното“ hides exactly the masked part', hm);
const f0 = await G(() => window.__glina.mesh.f);
await G(() => window.__glina.deleteHidden()); await frames(2);
const del = await G(() => { const m = window.__glina.mesh; return { f: m.f, open: window.__glina.hasOpenEdges(m.idx.subarray(0, m.f * 3)), hid: window.__glina.hiddenCount() }; });
check('Delete Hidden removes those faces (the rim stays open)', del.f < f0 * 0.9 && del.f > f0 * 0.5 && del.open && del.hid === 0, { f0, ...del });
await G(() => window.__glina.undo()); await frames(2);
check('undo brings them back', (await G(() => window.__glina.mesh.f)) === f0);
await G(() => { const W = window.__glina; W.maskOp('clear'); W.showAll(); });
await G(() => { const W = window.__glina, m = W.mesh, next = new Float32Array(m.n); for (let i = 0; i < m.n; i++) next[i] = m.pos[i * 3] < 0 ? 1 : 0; W.setHiddenUndoable(next); W.maskHidden(); });
const mh = await G(() => { const m = window.__glina.mesh; let ok = true; for (let i = 0; i < m.n; i++) if ((m.mask[i] >= 0.5) !== (m.hid[i] > 0)) ok = false; return ok; });
check('„Маскирай скритото“ masks exactly the hidden part', mh);
await G(() => { const W = window.__glina; W.maskOp('clear'); W.showAll(); });

// cloth: a shell from the top of the sphere, pinned at its crown, drapes over the sphere
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.35 ? 1 : 0; W.extractTool(); });
await frames(2);
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.97 ? 1 : 0; W.TOOLS[0].mesh.mask.fill(0); W.S.clothTime = 8; W.S.clothGravity = 1.5; });
const c0 = await G(() => { const m = window.__glina.mesh; return { pos: Array.from(m.pos.subarray(0, m.n * 3)), mask: Array.from(m.mask.subarray(0, m.n)), undo: window.__glina.undoStack.length }; });
await G(() => window.__glina.startCloth());
await frames(5);
const during = await G(() => { const W = window.__glina, u = W.undoStack.length; W.undo(); return { running: !!W.clothRun, undoBlocked: W.undoStack.length === u }; });
await page.waitForFunction(() => !window.__glina.clothRun, null, { timeout: 30000 });
await frames(2);
const c1 = await G((c) => {
  const m = window.__glina.mesh; let pinnedMoved = 0, freeDrop = 0, free = 0, nan = 0, minR = Infinity;
  for (let i = 0; i < m.n; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    if (!Number.isFinite(x + y + z)) nan++;
    minR = Math.min(minR, Math.hypot(x, y, z));
    if (c.mask[i] >= 1) { if (Math.abs(x - c.pos[i * 3]) + Math.abs(y - c.pos[i * 3 + 1]) + Math.abs(z - c.pos[i * 3 + 2]) > 1e-6) pinnedMoved++; }
    else { free++; freeDrop += c.pos[i * 3 + 1] - y; }
  }
  return { pinnedMoved, drop: freeDrop / free, nan, minR, undo: window.__glina.undoStack.length };
}, c0);
check('while it runs, undo waits', during.running && during.undoBlocked, during);
check('cloth: the free part falls, the pinned crown stays, no NaN, one undo step', c1.drop > 0.01 && c1.pinnedMoved === 0 && c1.nan === 0 && c1.undo === c0.undo + 1, c1);
check('cloth: it lies on the sphere, not through it', c1.minR > 0.97, { minR: c1.minR });
await G(() => window.__glina.undo()); await frames(2);
const back = await G((c) => { const m = window.__glina.mesh; let d = 0; for (let i = 0; i < m.n * 3; i++) d = Math.max(d, Math.abs(m.pos[i] - c.pos[i])); return d; }, c0);
check('undo puts the cloth back', back === 0, { back });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
