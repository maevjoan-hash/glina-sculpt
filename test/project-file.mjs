// The project file (.glina): every subtool, levels, layers, groups, mask, stored shape, armature, view:
// node test/project-file.mjs
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
// a fingerprint of the whole scene
const scene = () => G(() => {
  const W = window.__glina; W.toolArrays(W.TOOLS[W.curTool]);
  return W.TOOLS.map((t, k) => { const a = W.toolArrays(t), m = k === W.curTool ? W.mesh : t.mesh; let s = 0, c = 0, mk = 0, g = 0; for (let i = 0; i < a.pos.length; i++) { s += a.pos[i] * ((i % 7) + 1); c += a.col[i]; } for (let i = 0; i < a.mask.length; i++) { mk += a.mask[i]; g += a.grp[i]; } return { name: t.name, visible: t.visible, op: t.op, f: a.idx.length / 3, s: +s.toFixed(5), c: +c.toFixed(4), mk: +mk.toFixed(4), g, levels: (k === W.curTool ? W.MR : t.MR)?.levels.length || 0, layers: (k === W.curTool ? W.LAYERS : t.LAYERS).length, zs: t.zs ? t.zs.length : 0, morph: !!(m.morph && m.morph.length === a.pos.length) }; });
});

// a scene with a bit of everything
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.5 ? 1 : 0; W.groupOp('frommask'); W.maskOp('clear'); for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3] > 0.7 ? 0.5 : 0; W.storeMorph(); });
await G(() => window.__glina.divide()); await idle(); await frames(2);
await G(() => window.__glina.addLayer()); await frames(2);
await G(() => { const W = window.__glina; W.appendPrimitive('torus'); W.TOOLS[1].op = 'subtract'; W.S.paint = [0.2, 0.6, 0.3]; W.fillColour(); });
await G(() => { const W = window.__glina; W.zsOpen(null); W.zs.spheres.push({ x: 0.3, y: 0.2, z: 0, r: 0.12, parent: 0 }); }); await G(() => window.__glina.zsSkin()); await idle(); await frames(2);
await G(() => { window.__glina.TOOLS[1].visible = false; window.__glina.activateTool(0); }); await frames(2);
await G(() => window.__glina.orbit(40, 10));
const before = await scene();
const camBefore = await G(() => ({ d: window.__glina.cam.dist, q: window.__glina.cam.q.toArray() }));
const size = await G(async () => { const b = await window.__glina.projectBytes(); window.__saved = b; return { n: b.length, head: new TextDecoder().decode(b.subarray(0, 6)), gz: b[6] }; });
check('the project is one file, packed', size.head === 'GLINA1' && size.n > 1000, size);

// a new scene, then the file opened again
await G(() => window.__glina.newScene(new (window.__glina.mesh.constructor)(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2])), 'x'));
await frames(2);
check('(a different scene in between)', (await scene()).length === 1);
await G(async () => { await window.__glina.openProject(window.__saved, 'test.glina'); }); await frames(3);
const after = await scene();
const camAfter = await G(() => ({ d: window.__glina.cam.dist, q: window.__glina.cam.q.toArray() }));
check('opened: every subtool comes back the same (shape, colour, mask, groups, levels, layers, armature, stored shape)', JSON.stringify(after) === JSON.stringify(before), { before, after });
check('the view comes back too', Math.abs(camAfter.d - camBefore.d) < 1e-9 && camAfter.q.every((v, i) => Math.abs(v - camBefore.q[i]) < 1e-9));
await G(() => window.__glina.undo()); await frames(2);
check('undo after opening gives back the scene from before', (await scene()).length === 1);
// a level up still works on the opened one (its levels are real)
await G(() => window.__glina.redo()); await frames(2);
const lv = await G(() => { const W = window.__glina; const L0 = W.MR ? W.MR.cur : -1; W.setLevel(0); return { L0, now: W.MR.cur }; }); await idle(); await frames(2);
check('the opened levels work (down to level 0)', lv.L0 === 1 && (await G(() => window.__glina.MR.cur)) === 0, lv);
const bad = await G(async () => { try { await window.__glina.openProject(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'bad'); return 'opened'; } catch (e) { return e.message; } });
check('a file that is not a project is refused with a reason', bad !== 'opened' && bad.length > 3, bad);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
