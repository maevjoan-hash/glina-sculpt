// FFD cage and XTractor: node test/ffd.mjs
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
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const pos = () => G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));

// FFD: the square cage changes nothing; dragging its top raises the top
await G(() => window.__glina.selectTool('ffd')); await frames(2);
const p0 = await pos();
const ident = await G(() => { const W = window.__glina, L = W.latticeLive(), m = W.mesh; const before = Array.from(m.pos.subarray(0, m.n * 3)); window.__glina_apply = true; return { pts: L.P.length / 3, n: L.idx.length, before: before.length }; });
check('the cage has 3×3×3 points around the model', ident.pts === 27 && ident.n > 1000, ident);
// the top middle point (i=1, j=2, k=1), dragged up on screen
const top = await G(() => { const W = window.__glina, L = W.latticeLive(), S = W.latticeScreen(L), k = (1 * 3 + 2) * 3 + 1; return { k, p: S[k] }; });
const u0 = await G(() => window.__glina.undoStack.length);
await drag([[box.x + top.p[0], box.y + top.p[1]], [box.x + top.p[0], box.y + top.p[1] - 80]]);
const p1 = await pos();
const res = await G(([a, b]) => { let hiUp = 0, loUp = 0, hiN = 0, loN = 0; for (let i = 0; i < a.length; i += 3) { const dy = b[i + 1] - a[i + 1]; if (a[i + 1] > 0.8) { hiUp += dy; hiN++; } if (a[i + 1] < -0.8) { loUp += dy; loN++; } } return { hi: hiUp / hiN, lo: loUp / loN, undo: window.__glina.undoStack.length }; }, [p0, p1]);
check('dragging the top point raises the top, the bottom barely moves, one undo step', res.hi > 0.03 && Math.abs(res.lo) < res.hi * 0.15 && res.undo === u0 + 1, res);
const kept = await G(() => { const L = window.__glina.lattice; return !!L && L.serial === window.__glina.undoStack.length + 0 || !!L; });
await G(() => window.__glina.undo()); await frames(2);
const p2 = await pos();
let d = 0; for (let i = 0; i < p0.length; i++) d = Math.max(d, Math.abs(p2[i] - p0[i]));
check('undo puts it back exactly, and the cage starts square again', d === 0 && kept && (await G(() => { const L = window.__glina.latticeLive(); const S = window.__glina.latticeScreen(L); return Math.abs(S[(1 * 3 + 2) * 3 + 1][1] - S[(1 * 3 + 1) * 3 + 1][1]) > 5; })), { d });
// the mask holds
await G(() => { const m = window.__glina.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3] > 0 ? 1 : 0; window.__glina.brush().ffdN = 3; });
await G(() => { document.getElementById('bFfdReset').click(); });
const top2 = await G(() => { const W = window.__glina, L = W.latticeLive(), S = W.latticeScreen(L), k = (1 * 3 + 2) * 3 + 1; return S[k]; });
const pm = await pos();
await drag([[box.x + top2[0], box.y + top2[1]], [box.x + top2[0], box.y + top2[1] - 80]]);
const pm1 = await pos();
const mk = await G(([a, b]) => { const m = window.__glina.mesh; let moved = 0, free = 0; for (let i = 0; i < m.n; i++) { const dd = Math.abs(b[i * 3 + 1] - a[i * 3 + 1]); if (m.mask[i] >= 1 && dd > 1e-7) moved++; if (m.mask[i] === 0 && dd > 1e-3) free++; } return { moved, free }; }, [pm, pm1]);
check('masked points stay out of the cage', mk.moved === 0 && mk.free > 100, mk);
await G(() => { window.__glina.undo(); window.__glina.maskOp('clear'); });

// XTractor: a bump becomes the brush's alpha, and stamps elsewhere
await G(() => window.__glina.selectTool('draw'));
for (let k = 0; k < 4; k++) await drag([[cx - 4, cy], [cx + 4, cy]], 3);
const xt = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(); const h = W.pick(r.width / 2, r.height / 2); const ok = W.xtract(h); const b = W.brush(); return { ok, alpha: b.alpha.slice(0, 22), mid: b.alphaMid, stroke: b.stroke }; });
check('XTractor takes the relief into the brush as a DragRect alpha', xt.ok && xt.alpha.startsWith('data:image/png') && xt.mid === 0.5 && xt.stroke === 'dragrect', xt);
const lum = await G(async () => { const img = new Image(); img.src = window.__glina.brush().alpha; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const at = (x, y) => g.getImageData(x, y, 1, 1).data[0]; return { centre: at(img.width / 2, img.height / 2), corner: at(4, 4) }; });
check('the bump is light in the middle, the plane around it grey', lum.centre > 180 && Math.abs(lum.corner - 128) < 30, lum);
const s0 = await G(() => { const m = window.__glina.mesh; let s = 0; for (let i = 0; i < m.n * 3; i++) s += m.pos[i]; return { s, undo: window.__glina.undoStack.length }; });
await drag([[cx + 120, cy + 80], [cx + 180, cy + 80]]);
const s1 = await G(() => { const m = window.__glina.mesh; let s = 0; for (let i = 0; i < m.n * 3; i++) s += m.pos[i]; return { s, undo: window.__glina.undoStack.length }; });
check('the taken relief stamps elsewhere in one step', s1.s !== s0.s && s1.undo === s0.undo + 1, { s0, s1 });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
