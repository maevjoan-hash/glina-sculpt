// Every brush, stroke type and mask gesture once, in headless Chromium: node test/brushes.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(x0, y0, x1, y1, steps = 25, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  await page.mouse.up(); await frames(4);
  for (const m of mods) await page.keyboard.up(m);
}
const state = () => page.evaluate(() => { const m = window.__glina.mesh; const p = m.pos, c = m.col, k = m.mask; let sp = 0, sc = 0, sm = 0; for (let i = 0; i < m.n * 3; i++) { sp += p[i] * ((i % 7) + 1); sc += c[i]; } for (let i = 0; i < m.n; i++) sm += k[i]; return { sp, sc, sm, n: m.n, undo: window.__glina.undoStack.length }; });
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const ids = await page.evaluate(() => window.__glina.S.brushes.map((b) => b.id));
for (const dyn of [false, true]) {
  await page.evaluate((d) => { window.__glina.setDyntopo(d); window.__glina.maskOp('clear'); }, dyn);
  for (const id of ids) {
    if (id === 'gizmo' || id === 'ffd' || id === 'morph' || id === 'groom' || id === 'zmodel' || id === 'topology' || id === 'shadowbox' || id === 'array') continue;   // (gizmo and cage: test/subtools.mjs, test/ffd.mjs; lines and silhouettes: test/topology.mjs, test/shadowbox.mjs; morph needs a stored shape: test/morph.mjs)
    await page.evaluate((i) => window.__glina.selectTool(i), id);
    const a = await state();
    if (id === 'mask' || id === 'paint') await drag(cx - 80, cy, cx + 60, cy + 20);
    else await drag(cx - 60, cy - 10, cx + 40, cy + 30);
    const b = await state();
    const changed = id === 'mask' ? b.sm !== a.sm : id === 'paint' ? b.sc !== a.sc : b.sp !== a.sp || b.n !== a.n;
    check(`${dyn ? 'dyn ' : ''}${id} changes the model and adds one undo step`, changed && b.undo === a.undo + 1, { undo: [a.undo, b.undo] });
    if (id === 'mask') await page.evaluate(() => window.__glina.maskOp('clear'));
    // (Clip/Trim take away the area the next brushes stroke over)
    if (id === 'clip' || id === 'cut') { await page.evaluate(() => window.__glina.undo()); await frames(2); }
  }
  // stroke types and shapes on the standard brush
  for (const conf of [{ stroke: 'dragrect' }, { stroke: 'dragdot' }, { stroke: 'spray' }, { tip: 'square', alpha: 'noise', alphaRot: 'stroke' }, { alpha: 'pores', alphaMid: 0.5 }, { mod: -0.5 }]) {
    await page.evaluate((c) => { window.__glina.selectTool('draw'); Object.assign(window.__glina.brush(), { stroke: 'dots', tip: 'round', alpha: 'none', alphaMid: 0, mod: 0 }, c); }, conf);
    const a = await state();
    await drag(cx - 30, cy + 40, cx + 50, cy + 70, 20);
    const b = await state();
    check(`${dyn ? 'dyn ' : ''}draw ${JSON.stringify(conf)}`, b.sp !== a.sp && b.undo === a.undo + 1);
    if (conf.stroke === 'dragrect') {
      // undo must give back exactly the shape from before the stroke
      await page.evaluate(() => window.__glina.undo()); await frames(2);
      const u = await state();
      check(`${dyn ? 'dyn ' : ''}DragRect undo restores the model`, Math.abs(u.sp - a.sp) < 1e-6 * Math.abs(a.sp), { a: a.sp, u: u.sp });
      await page.evaluate(() => window.__glina.redo());
    }
  }
  await page.evaluate(() => Object.assign(window.__glina.brush(), { stroke: 'dots', tip: 'round', alpha: 'none', alphaMid: 0, mod: 0 }));
  // mask gestures
  await page.evaluate(() => window.__glina.maskOp('clear'));
  let a = await state();
  await drag(cx - 50, cy, cx + 50, cy, 15, ['Control']);
  let b = await state();
  check(`${dyn ? 'dyn ' : ''}Ctrl+drag on the model paints mask`, b.sm > a.sm + 1, { mask: [a.sm, b.sm] });
  await drag(cx - 40, cy, cx - 40, cy, 1, ['Control']);
  const c = await state();
  check(`${dyn ? 'dyn ' : ''}Ctrl+click on the model blurs the mask`, c.sm !== b.sm && c.undo === b.undo + 1, { mask: [b.sm, c.sm] });
  await drag(box.x + 20, box.y + 20, box.x + 20, box.y + 20, 1, ['Control']);
  const d = await state();
  check(`${dyn ? 'dyn ' : ''}Ctrl+click on empty space inverts the mask`, Math.abs(d.sm - (d.n - c.sm)) < 1, { mask: [c.sm, d.sm], n: d.n });
  await drag(box.x + 10, box.y + 10, box.x + 40, box.y + 40, 5, ['Control']);
  const e = await state();
  check(`${dyn ? 'dyn ' : ''}empty Ctrl rectangle clears the mask`, e.sm === 0);
  await drag(cx - 100, cy - 100, cx + 10, cy + 10, 8, ['Control']);
  const f = await state();
  check(`${dyn ? 'dyn ' : ''}Ctrl rectangle masks what is inside`, f.sm > 50 && f.sm < f.n * 0.6, { mask: f.sm, n: f.n });
  for (const op of ['grow', 'shrink', 'sharpen', 'cavity', 'clear']) {
    const g0 = await state(); await page.evaluate((o) => window.__glina.maskOp(o), op); const g1 = await state();
    check(`${dyn ? 'dyn ' : ''}mask ${op}`, op === 'cavity' ? true : g1.sm !== g0.sm, { mask: [g0.sm, g1.sm] });
  }
}
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
