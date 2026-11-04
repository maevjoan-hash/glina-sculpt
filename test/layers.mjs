// Polygroups and 3D layers in headless Chromium: node test/layers.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); const G = window.__glina; G.S.sym = false; G.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(tool, x0, y0, x1, y1, steps = 15, mods = []) {
  if (tool) await page.evaluate((t) => window.__glina.selectTool(t), tool);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  await page.mouse.up(); await frames(4);
  for (const m of mods) await page.keyboard.up(m);
}
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const st = () => page.evaluate(() => { const G = window.__glina, m = G.mesh; return { n: m.n, pos: Array.from(m.pos.subarray(0, m.n * 3)), groups: [...new Set(Array.from(m.grp.subarray(0, m.n)))].sort((a, b) => a - b), mask: Array.from(m.mask.subarray(0, m.n)).reduce((a, b) => a + b, 0), layers: G.LAYERS.length, rec: G.recLayer }; });
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const G = (fn, arg) => page.evaluate(fn, arg);

// ---------- groups ----------
await page.click('#bNew'); await page.click('#menu button:nth-child(2)'); await frames(3);   // lighter sphere
await drag(null, cx - 200, cy - 200, cx, cy + 40, 6, ['Control']);                              // mask rectangle
await G(() => window.__glina.groupOp('frommask')); await frames(2);
let s = await st();
check('group from the mask: two groups', s.groups.length === 2, s.groups);
await G(() => window.__glina.undo()); s = await st();
check('undo: one group again', s.groups.length === 1);
await G(() => window.__glina.redo()); s = await st();
check('redo: two groups', s.groups.length === 2);
await G(() => window.__glina.maskOp('clear'));
// a brush that keeps to its group: start inside the new group (upper left), cross into the other
const before = await st();
await G(() => { const G = window.__glina; G.selectTool('draw'); G.brush().group = true; G.brush().strength = 1; });
await drag(null, cx - 70, cy - 70, cx + 120, cy + 120, 30);
const moved = await G((b) => { const m = window.__glina.mesh, P = m.pos, out = new Set(); for (let i = 0; i < m.n; i++) if (Math.abs(P[i * 3] - b[i * 3]) + Math.abs(P[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(P[i * 3 + 2] - b[i * 3 + 2]) > 1e-6) out.add(m.grp[i]); return [...out]; }, before.pos);
check('“only the group under the brush”: only one group moved', moved.length === 1, moved);
await G(() => { window.__glina.brush().group = false; window.__glina.undo(); });
// Ctrl+Shift+click on a group shows only it (ZBrush); „Маскирай скритото“ then masks the rest
await drag(null, cx + 60, cy + 60, cx + 60, cy + 60, 1, ['Control', 'Shift']);
await G(() => window.__glina.maskHidden());
s = await st();
const gm = await G(() => { const m = window.__glina.mesh; let groupsShown = new Set(); for (let i = 0; i < m.n; i++) if (!m.hid[i]) groupsShown.add(m.grp[i]); return { masked: Array.from(m.mask.subarray(0, m.n)).filter((v) => v > 0.5).length, n: m.n, shown: groupsShown.size }; });
check('Ctrl+Shift+click shows one group; masking the hidden masks everything but it', gm.shown === 1 && gm.masked > 0 && gm.masked < gm.n, gm);
await G(() => { window.__glina.maskOp('clear'); window.__glina.showAll(); });
// groups follow subdivision, remesh and dynamic topology
await page.keyboard.press('Control+d'); await idle(); s = await st();
check('subdivision keeps the groups', s.groups.length === 2);
await G(() => window.__glina.remesh()); await idle(); await frames(2); s = await st();
check('remesh keeps the groups', s.groups.length === 2, s.groups);
await G(() => window.__glina.setDyntopo(true)); await page.waitForFunction(() => window.__glina.mesh.dyn);
await drag('draw', cx - 80, cy - 40, cx + 80, cy + 20, 15);
s = await st();
check('dynamic topology: new vertices take a group, still two groups', s.groups.length === 2, s.groups);
await G(() => window.__glina.setDyntopo(false)); await page.waitForFunction(() => !window.__glina.mesh.dyn);

// ---------- layers ----------
await page.click('#bNew'); await page.click('#menu button:nth-child(2)'); await frames(3);
const base = await st();
await G(() => window.__glina.addLayer()); await frames(1);
s = await st();
check('new layer: it records', s.layers === 1 && s.rec === 0);
await drag('draw', cx - 60, cy, cx + 60, cy + 10, 15);
const withLayer = await st();
check('a stroke while recording changes the model', maxDiff(withLayer.pos, base.pos) > 1e-3);
await G(() => { const G = window.__glina; G.recordLayer(G.LAYERS[0]); });   // stop recording
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); }); s = await st();
check('hiding the layer gives the base back', maxDiff(s.pos, base.pos) < 1e-5, { err: maxDiff(s.pos, base.pos) });
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); }); s = await st();
check('showing it again', maxDiff(s.pos, withLayer.pos) < 1e-5);
await G(() => { const G = window.__glina; G.setLayerStrength(G.LAYERS[0], 2); }); s = await st();
const dBase = withLayer.pos.map((v, i) => v - base.pos[i]), dTwo = s.pos.map((v, i) => v - base.pos[i]);
check('strength 200%: twice the change', maxDiff(dTwo, dBase.map((v) => v * 2)) < 1e-5);
await G(() => { const G = window.__glina; G.setLayerStrength(G.LAYERS[0], -1); }); s = await st();
check('strength −100%: the change turned inside out', maxDiff(s.pos.map((v, i) => v - base.pos[i]), dBase.map((v) => -v)) < 1e-5);
await G(() => window.__glina.undo()); await G(() => window.__glina.undo()); s = await st();
check('undo the two strength changes', maxDiff(s.pos, withLayer.pos) < 1e-5);
// a stroke with no layer recording changes the base: hiding the layer keeps that stroke
await drag('inflate', cx - 40, cy - 80, cx + 40, cy - 70, 10);
const baseStroke = await st();
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); }); s = await st();
const expect = baseStroke.pos.map((v, i) => v - dBase[i]);
check('a stroke outside the layer stays when the layer is hidden', maxDiff(s.pos, expect) < 1e-5, { err: maxDiff(s.pos, expect) });
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); });
// delete, undo; bake, undo
await G(() => { const G = window.__glina; G.deleteLayer(G.LAYERS[0]); }); s = await st();
check('deleting the layer removes its change', s.layers === 0 && maxDiff(s.pos, expect) < 1e-5);
await G(() => window.__glina.undo()); s = await st();
check('undo brings the layer back', s.layers === 1 && maxDiff(s.pos, baseStroke.pos) < 1e-5);
await G(() => window.__glina.bakeLayers()); s = await st();
check('apply: no layers, the model as shown', s.layers === 0 && maxDiff(s.pos, baseStroke.pos) < 1e-6);
await G(() => window.__glina.undo()); s = await st();
check('undo the apply: the layer is back', s.layers === 1);
// undo of a recorded stroke takes it out of the layer too
await G(() => { const G = window.__glina; G.recordLayer(G.LAYERS[0]); });
const pre = await st();
await drag('draw', cx - 50, cy + 60, cx + 50, cy + 70, 10);
await G(() => window.__glina.undo()); s = await st();
await G(() => { const G = window.__glina; G.recordLayer(G.LAYERS[0]); G.toggleLayer(G.LAYERS[0]); });
const hidden = await st();
check('undo of a recorded stroke: it is gone from the layer as well', maxDiff(s.pos, pre.pos) < 1e-5 && maxDiff(hidden.pos, expect) < 1e-5, { err: maxDiff(hidden.pos, expect) });
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); });
// a level change applies the layers; undo brings them back
await page.keyboard.press('Control+d'); await idle(); s = await st();
check('dividing applies the layers', s.layers === 0);
await G(() => window.__glina.undo()); s = await st();
check('undo: the layers are back with the model', s.layers === 1 && maxDiff(s.pos, baseStroke.pos) < 1e-5);
// reload keeps layers and groups
await G(() => window.__glina.groupOp('parts'));
await page.waitForTimeout(3500);
await page.reload(); await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.mesh.n > 1000); await page.waitForTimeout(1500);
s = await st();
check('reload: the layer is still there', s.layers === 1 && maxDiff(s.pos, baseStroke.pos) < 1e-5);
// the review's cases
await page.click('#bNew'); await page.click('#menu button:nth-child(2)'); await frames(3);
// a layer and dynamic topology: turning it on applies the layer; undo turns it off again and brings the layer back
await G(() => window.__glina.addLayer());
await drag('draw', cx - 60, cy + 20, cx + 60, cy + 30, 10);
const lay = await st();
await G(() => window.__glina.setDyntopo(true)); await page.waitForFunction(() => window.__glina.mesh.dyn);
s = await st();
check('dynamic topology on: the layer is applied', s.layers === 0 && maxDiff(s.pos, lay.pos) < 1e-6);
await G(() => window.__glina.undo()); await frames(2);
s = await st();
check('undo: the layer is back on a static mesh', s.layers === 1 && !(await G(() => window.__glina.mesh.dyn)) && maxDiff(s.pos, lay.pos) < 1e-6);
// the recording layer cannot be hidden (a hidden recording layer would take strokes twice)
await G(() => { const G = window.__glina; G.toggleLayer(G.LAYERS[0]); });
check('the recording layer stays visible', await G(() => window.__glina.LAYERS[0].on));
// paint into a layer, strength 2 then back to 1: the colour comes back exactly
await G(() => { const G = window.__glina; G.selectTool('paint'); G.S.paint = [0.1, 0.8, 0.2]; });
await drag(null, cx - 60, cy - 60, cx + 60, cy - 50, 10);
await G(() => { const G = window.__glina; G.recordLayer(G.LAYERS[0]); });
const colA = await G(() => Array.from(window.__glina.mesh.col.subarray(0, window.__glina.mesh.n * 3)));
await G(() => { const G = window.__glina; G.setLayerStrength(G.LAYERS[0], 2); G.setLayerStrength(G.LAYERS[0], 1); });
const colB = await G(() => Array.from(window.__glina.mesh.col.subarray(0, window.__glina.mesh.n * 3)));
check('layer colour at 200% and back: unchanged', maxDiff(colA, colB) < 1e-5, { err: maxDiff(colA, colB) });
// groups made at a higher level survive a trip down and up
await G(() => window.__glina.bakeLayers());
await page.keyboard.press('Control+d'); await idle();
await drag(null, cx - 220, cy - 220, cx - 20, cy, 6, ['Control']);
await G(() => { window.__glina.groupOp('frommask'); window.__glina.maskOp('clear'); });
const g1 = await G(() => Array.from(window.__glina.mesh.grp.subarray(0, window.__glina.mesh.n)));
await G(() => window.__glina.setLevel(0)); await idle(); await G(() => window.__glina.setLevel(1)); await idle();
const g2 = await G(() => Array.from(window.__glina.mesh.grp.subarray(0, window.__glina.mesh.n)));
check('groups set at level 1 are the same after going to 0 and back', g1.length === g2.length && g1.every((v, i) => v === g2[i]));
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
