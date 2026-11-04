// Morph Target with the Morph brush, polypaint fill and colour from cavity: node test/morph.mjs
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
// how far the mesh is from the stored shape
const away = () => G(() => { const m = window.__glina.mesh, T = window.__glina.morphOf(m); let s = 0; for (let i = 0; i < m.n * 3; i++) s += Math.abs(m.pos[i] - T[i]); return s; });

await G(() => window.__glina.storeMorph());
check('the shape is stored, Switch and Forget turn on', await G(() => !!window.__glina.morphOf(window.__glina.mesh) && !document.getElementById('bMorphSwitch').disabled));
await G(() => window.__glina.selectTool('draw'));
for (let k = 0; k < 3; k++) await drag([[cx - 80, cy - 20 + k * 20], [cx + 80, cy - 20 + k * 20]]);
const a0 = await away();
await G(() => window.__glina.selectTool('morph'));
await drag([[cx - 80, cy], [cx + 80, cy]]);
const a1 = await away();
check('the Morph brush brings the surface back toward the stored shape', a0 > 0.1 && a1 < a0 * 0.8, { a0, a1 });
const u0 = await G(() => window.__glina.undoStack.length);
await G(() => window.__glina.switchMorph()); await frames(2);
const sum = () => G(() => { const m = window.__glina.mesh; let t = 0; for (let i = 0; i < m.n * 3; i++) t += m.pos[i] * ((i % 7) + 1); return t; });
const sw = await sum();
const a2 = await away();
check('Switch swaps the two shapes in one step', a2 > 0 && Math.abs(a2 - a1) < 1e-3 * a1 && (await G(() => window.__glina.undoStack.length)) === u0 + 1, { a1, a2 });
await G(() => window.__glina.undo()); await frames(2);
const back = await sum();
check('undo swaps back (the shape and the stored one)', Math.abs(back - sw) > 1e-6 && Math.abs((await away()) - a1) < 1e-3 * a1, { away: await away(), a1 });
await G(() => window.__glina.dropMorph());
check('Forget drops it', await G(() => !window.__glina.morphOf(window.__glina.mesh)));

// fill, and colour from cavity
await G(() => { const W = window.__glina; W.S.paint = [1, 0, 0]; W.fillColour(); });
const fill = await G(() => { const m = window.__glina.mesh; let red = 0; for (let i = 0; i < m.n; i++) if (m.col[i * 3] > 0.99 && m.col[i * 3 + 1] < 0.01) red++; return { red, n: m.n }; });
check('Fill paints the whole subtool', fill.red === fill.n, fill);
await G(() => window.__glina.undo()); await frames(2);
check('undo takes the fill back', await G(() => { const m = window.__glina.mesh; for (let i = 0; i < m.n * 3; i++) if (m.col[i] !== 1) return false; return true; }));
await G(() => window.__glina.selectTool('dam'));
for (let k = 0; k < 2; k++) await drag([[cx - 100, cy + 60], [cx + 100, cy + 60]]);
await G(() => { const W = window.__glina; W.S.paint = [0.1, 0.1, 0.8]; W.cavityColour(); });
const cav = await G(() => { const m = window.__glina.mesh; let tinted = 0; for (let i = 0; i < m.n; i++) if (m.col[i * 3 + 2] > m.col[i * 3] + 0.05) tinted++; return { tinted, n: m.n }; });
check('colour from cavity tints the crease, not everything', cav.tinted > 20 && cav.tinted < cav.n * 0.3, cav);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
