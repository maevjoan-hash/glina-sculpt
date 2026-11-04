// Sharp edges in the voxel remesh (dual contouring) and quads in the OBJ: node test/sharp.mjs
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
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// how close the mesh comes to the corners of its box (0: a sharp corner)
const corner = () => G(() => { const m = window.__glina.mesh, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < m.n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.pos[i * 3 + c]); hi[c] = Math.max(hi[c], m.pos[i * 3 + c]); } let d = Infinity; for (let i = 0; i < m.n; i++) d = Math.min(d, Math.hypot(m.pos[i * 3] - hi[0], m.pos[i * 3 + 1] - hi[1], m.pos[i * 3 + 2] - hi[2])); return { d: d / (hi[0] - lo[0]), f: m.f, open: window.__glina.hasOpenEdges(m.idx.subarray(0, m.f * 3)) }; });

await G(() => { const W = window.__glina; W.appendPrimitive('cube'); W.TOOLS[0].visible = false; W.S.voxel = 64; });
await frames(2);
await G(() => { window.__glina.S.sharpRemesh = false; window.__glina.remesh(); }); await idle(); await frames(2);
const soft = await corner();
await G(() => window.__glina.undo()); await frames(2);
await G(() => { window.__glina.S.sharpRemesh = true; window.__glina.remesh(); }); await idle(); await frames(2);
const sharp = await corner();
check('„Остри ръбове“: the remeshed cube keeps its corners (dual contouring), without it they round off', sharp.d < 0.01 && soft.d > sharp.d * 3 && !sharp.open, { soft, sharp });
const q = await G(() => { const W = window.__glina, qd = W.quadsOf(W.mesh); const obj = new TextDecoder().decode(W.exportOBJ()); const four = obj.split('\n').filter((l) => /^f \d+ \d+ \d+ \d+$/.test(l)).length; return { quads: qd ? qd.length / 4 : 0, four, f: W.mesh.f }; });
check('the remesh is quads: the OBJ has them as four-cornered faces', q.quads * 2 === q.f && q.four === q.quads, q);
// a stroke keeps them (it moves points, not faces); dynamic topology would not
await G(() => window.__glina.smoothAll && window.__glina.selectTool('draw'));
const keep = await G(() => !!window.__glina.quadsOf(window.__glina.mesh));
check('quads stay while the faces are the same', keep);
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
