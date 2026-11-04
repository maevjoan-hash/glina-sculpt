// ZSpheres: the armature editor and its skin: node test/zspheres.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.S.sym = true; window.__glina.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 8) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// where a sphere's centre (or a point on it) is on screen
const scr = (k, ox = 0, oy = 0, oz = 0) => G(([kk, a, b, c]) => { const W = window.__glina, q = W.zs.spheres[kk]; const v = W.camera.position.clone().set(q.x + a * q.r, q.y + b * q.r, q.z + c * q.r).project(W.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (0.5 - v.y * 0.5) * r.height]; }, [k, ox, oy, oz]);
const mode = (m) => G((mm) => document.querySelector(`#zsBar [data-zs=${mm}]`).click(), m);
const sph = () => G(() => window.__glina.zs.spheres.map((q) => ({ ...q })));

await G(() => window.__glina.zsOpen(null)); await frames(2);
check('the armature opens with one sphere and its bar', (await sph()).length === 1 && (await G(() => !document.getElementById('zsBar').hidden)));
// grow a sphere out of the right side: with symmetry, one on the left too
await G(() => window.__glina.orbit(0, 0));
const side = await scr(0, 0.9, 0, 0.3);
await drag([side, [side[0] + 60, side[1]]]);
let s1 = await sph();
check('a drag from a sphere grows a new one, and its mirror image', s1.length === 3 && s1[1].parent === 0 && s1[2].parent === 0 && Math.abs(s1[1].x + s1[2].x) < 1e-6 && s1[1].r > 0, s1);
// move one: its mirror follows
await mode('move');
const c1 = await scr(1);
await drag([c1, [c1[0] + 20, c1[1] - 50]]);
let s2 = await sph();
check('moving a sphere moves its mirror image the other way', Math.abs(s2[1].x + s2[2].x) < 1e-6 && Math.abs(s2[1].y - s2[2].y) < 1e-6 && s2[1].y > s1[1].y, { a: s2[1], b: s2[2] });
// scale: up makes it bigger
await mode('scale');
const c2 = await scr(1);
await drag([c2, [c2[0], c2[1] - 60]]);
let s3 = await sph();
check('scaling up makes both bigger', s3[1].r > s2[1].r * 1.3 && Math.abs(s3[1].r - s3[2].r) < 1e-9, { before: s2[1].r, after: s3[1].r });
// a second level, then delete it
await mode('add');
const tip = await scr(1, 0, 0.95, 0.2);
await drag([tip, [tip[0], tip[1] - 40]]);
const s4 = await sph();
await mode('del');
const c4 = await scr(s4.length - 2);
await page.mouse.click(c4[0], c4[1]); await frames(2);
const s5 = await sph();
check('delete takes a sphere and its mirror', s4.length === 5 && s5.length === 3, { before: s4.length, after: s5.length });
await G(() => window.__glina.undo()); await frames(2);
check('Ctrl+Z inside the armature undoes its own steps', (await sph()).length === 5);
// the skin
const t0 = await G(() => window.__glina.TOOLS.length);
await G(() => window.__glina.zsSkin()); await idle(); await frames(3);
const sk = await G(() => { const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t); let v = 0; const P = a.pos; for (let f = 0; f < a.idx.length; f += 3) { const i = a.idx[f] * 3, j = a.idx[f + 1] * 3, k = a.idx[f + 2] * 3; v += P[i] * (P[j + 1] * P[k + 2] - P[j + 2] * P[k + 1]) - P[i + 1] * (P[j] * P[k + 2] - P[j + 2] * P[k]) + P[i + 2] * (P[j] * P[k + 1] - P[j + 1] * P[k]); } return { tools: W.TOOLS.length, name: t.name, open: W.hasOpenEdges(a.idx), vol: v / 6, f: a.idx.length / 3, zs: t.zs ? t.zs.length : 0, editor: !!W.zs }; });
check('„Кожа“ makes a closed subtool that keeps its armature, and the editor closes', sk.tools === t0 + 1 && sk.name === 'Кожа' && !sk.open && sk.vol > 0 && sk.zs === 5 && !sk.editor, sk);
// open it again, change it, skin again: the same subtool is replaced
await G(() => document.getElementById('bZs').click()); await frames(2);
const re = await sph();
await mode('scale');
const c0 = await scr(0);
await drag([c0, [c0[0], c0[1] - 40]]);
await G(() => window.__glina.zsSkin()); await idle(); await frames(3);
const sk2 = await G(() => { const W = window.__glina, t = W.TOOLS[W.curTool]; return { tools: W.TOOLS.length, f: W.toolArrays(t).idx.length / 3, zs: t.zs.length }; });
check('„Арматура“ opens the same spheres; a new skin replaces that subtool', re.length === 5 && sk2.tools === sk.tools && sk2.f !== sk.f && sk2.zs === 5, { re: re.length, sk2 });
await G(() => window.__glina.undo()); await frames(2);
check('undo brings the first skin back', (await G(() => { const W = window.__glina; return W.toolArrays(W.TOOLS[W.curTool]).idx.length / 3; })) === sk.f);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
