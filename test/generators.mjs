// Groom brush on fibres, Slime Bridge, NanoMesh, cloth hook and twister: node test/generators.mjs
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
const sum = () => G(() => { const m = window.__glina.mesh; let t = 0; for (let i = 0; i < m.n * 3; i++) t += m.pos[i] * ((i % 7) + 1); return { t, undo: window.__glina.undoStack.length }; });

// cloth hook and twister
for (const id of ['clothhook', 'clothtwist']) {
  await G((i) => window.__glina.selectTool(i), id);
  const a = await sum();
  await drag([[cx - 60, cy], [cx + 60, cy + 20]]);
  const b = await sum();
  check(`${id} changes the model in one step`, b.t !== a.t && b.undo === a.undo + 1, { undo: [a.undo, b.undo] });
}
// fibres, then the groom brush combs the tips more than the roots
await G(() => { const W = window.__glina, m = W.mesh, c = W.camera.position.clone().normalize(); for (let i = 0; i < m.n; i++) m.mask[i] = (m.pos[i * 3] * c.x + m.pos[i * 3 + 1] * c.y + m.pos[i * 3 + 2] * c.z) > 0.8 ? 1 : 0; Object.assign(W.S, { fibCount: 300, fibLength: 0.25, fibWidth: 0.006, fibGravity: 0, fibVary: 0.1 }); W.makeFibers(); W.TOOLS[0].mesh.mask.fill(0); });
await frames(2);
const before = await G(() => Array.from(window.__glina.mesh.pos.subarray(0, window.__glina.mesh.n * 3)));
await G(() => { window.__glina.selectTool('groom'); window.__glina.brush().radius = 120; });
await drag([[cx - 60, cy], [cx + 60, cy]]);
const g = await G((b) => { const m = window.__glina.mesh; let tip = 0, root = 0; for (let i = 0; i < m.n; i++) { const d = Math.hypot(m.pos[i * 3] - b[i * 3], m.pos[i * 3 + 1] - b[i * 3 + 1], m.pos[i * 3 + 2] - b[i * 3 + 2]); if (m.along[i] > 0.9) tip = Math.max(tip, d); else if (m.along[i] < 0.1) root = Math.max(root, d); } return { tip, root }; }, before);
check('the groom brush moves the fibre tips, the roots stay', g.tip > 0.02 && g.root < g.tip * 0.05, g);

// Slime Bridge between two masked places, NanoMesh on one
await G(() => { const W = window.__glina; W.activateTool(0); const m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = Math.abs(m.pos[i * 3]) > 0.85 ? 1 : 0; W.slimeBridge(); });
await frames(2);
const sl = await G(() => { const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t); return { name: t.name, f: a.idx.length / 3, open: W.hasOpenEdges(a.idx) }; });
check('Slime Bridge: strands between the two masked places, as a closed subtool', sl.name === 'Нишки' && sl.f > 100 && !sl.open, sl);
await G(() => { const W = window.__glina; W.activateTool(0); W.S.nanoCount = 40; W.nanoMesh(); });
await frames(2);
const nm = await G(() => { const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t); let lo = Infinity; for (let i = 0; i < a.pos.length; i += 3) lo = Math.min(lo, Math.abs(a.pos[i])); return { name: t.name, f: a.idx.length / 3, open: W.hasOpenEdges(a.idx), lo }; });
check('NanoMesh: 40 shapes standing on the masked area', nm.name === 'NanoMesh' && nm.f > 40 * 20 && !nm.open && nm.lo > 0.6, nm);
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
