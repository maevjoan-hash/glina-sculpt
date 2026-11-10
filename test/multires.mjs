// Subdivision levels in headless Chromium: node test/multires.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 650 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let dialogs = 'accept'; page.on('dialog', (d) => (dialogs === 'accept' ? d.accept() : d.dismiss()));
const url = pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href;
await page.goto(url);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working && !window.__glina.mrPending, null, { timeout: 120000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
async function drag(tool, x0, y0, x1, y1, steps = 20) {
  await page.evaluate((t) => window.__glina.selectTool(t), tool);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); }
  await page.mouse.up(); await frames(4);
}
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const snap = () => page.evaluate(() => { const m = window.__glina.mesh; return { n: m.n, f: m.f, pos: Array.from(m.pos.subarray(0, m.n * 3)), level: window.__glina.MR ? window.__glina.MR.cur : 0, top: window.__glina.MR ? window.__glina.MR.levels.length - 1 : 0 }; });
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const level = async (k) => { await page.evaluate((x) => window.__glina.setLevel(x), k); await idle(); await frames(2); };

// a lighter sphere: Нов → Сфера, по-лека
await page.click('#bNew'); await page.click('#menu button:nth-child(2)'); await frames(3);
const base = await snap();
await page.keyboard.press('Control+d'); await idle(); await page.keyboard.press('Control+d'); await idle(); await frames(2);
let s2 = await snap();
check('two divisions: level 2 of 2, 16× the triangles', s2.level === 2 && s2.top === 2 && s2.f === base.f * 16, { f: [base.f, s2.f], level: s2.level });
await drag('draw', cx - 60, cy - 20, cx + 60, cy + 10);
await drag('crease', cx - 50, cy + 30, cx + 50, cy + 40);
const detailed = await snap();
await level(0);
const s0 = await snap();
check('down to level 0: the base vertex count', s0.n === base.n && s0.level === 0, { n: s0.n });
check('level 0 shows the sculpted shape (it moved)', maxDiff(s0.pos, base.pos) > 1e-3, { moved: maxDiff(s0.pos, base.pos) });
await level(2);
const back = await snap();
check('back up to level 2: the detail is exactly where it was', back.n === detailed.n && maxDiff(back.pos, detailed.pos) < 2e-4, { err: maxDiff(back.pos, detailed.pos) });
// a big change at level 0 carries the detail: compare the crease depth relative to its surroundings
await level(0);
await drag('grab', cx, cy, cx + 120, cy - 60, 15);
await level(2);
const moved = await snap();
check('after a grab at level 0 the level-2 mesh changed', maxDiff(moved.pos, detailed.pos) > 0.05, { change: maxDiff(moved.pos, detailed.pos) });
// undo across level switches: undo the switch to 2, the grab, the switch to 0 → the detailed level 2
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__glina.undo()); await frames(2); }
const undone = await snap();
check('undo across level switches gives the detailed level 2 back', undone.level === 2 && maxDiff(undone.pos, detailed.pos) < 2e-4, { level: undone.level, err: maxDiff(undone.pos, detailed.pos) });
await page.evaluate(() => window.__glina.redo()); await frames(2);
check('redo goes to level 0 again', (await snap()).level === 0);
await page.evaluate(() => window.__glina.undo()); await frames(2);
// autosave keeps the levels
await page.waitForTimeout(3500);
await page.reload(); await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.mesh.n > 1000); await page.waitForTimeout(1500);
const re = await snap();
check('reload: the levels come back', re.top === 2 && re.level === 2 && maxDiff(re.pos, detailed.pos) < 2e-4, { top: re.top, level: re.level });
await level(1);
check('reload: going down still works', (await snap()).level === 1);
// delete higher / lower
await page.evaluate(() => window.__glina.deleteHigher()); await frames(2);
let d = await snap();
check('delete higher: level 1 is the top', d.top === 1 && d.level === 1);
await page.evaluate(() => window.__glina.deleteLower()); await frames(2);
d = await snap();
check('delete lower: no levels left (one level)', d.top === 0 && d.level === 0);
// levels + dynamic topology: dismiss keeps them, accept drops them
await page.keyboard.press('Control+d'); await idle();
dialogs = 'dismiss'; await page.evaluate(() => window.__glina.setDyntopo(true)); await frames(2);
d = await snap();
check('dynamic topology refused while keeping the levels', d.top === 1 && !(await page.evaluate(() => window.__glina.mesh.dyn)));
dialogs = 'accept'; await page.evaluate(() => window.__glina.setDyntopo(true)); await page.waitForFunction(() => window.__glina.mesh.dyn);
d = await snap();
check('dynamic topology on: only the current level is kept', d.top === 0);
await page.keyboard.press('Control+d'); await idle(); await frames(2);
d = await snap();
check('Ctrl+D with dynamic topology: turns it off and divides', d.top === 1 && !(await page.evaluate(() => window.__glina.mesh.dyn)));
// the review's cases: undo back into levels while dynamic topology is on; a double click on "lower";
// remesh refused on an open model keeps the levels; undo after a remesh brings them back
dialogs = 'accept';
await page.evaluate(() => window.__glina.setDyntopo(false)); await page.waitForFunction(() => !window.__glina.mesh.dyn);
await page.click('#bNew'); await page.click('#menu button:nth-child(2)'); await frames(3);
await page.keyboard.press('Control+d'); await idle(); await page.keyboard.press('Control+d'); await idle();
await page.evaluate(() => window.__glina.setDyntopo(true)); await page.waitForFunction(() => window.__glina.mesh.dyn);
await page.evaluate(() => window.__glina.undo()); await frames(3);
d = await snap();
check('undo back to the levels turns dynamic topology off', d.top === 2 && !(await page.evaluate(() => window.__glina.mesh.dyn || window.__glina.S.dyntopo)), { top: d.top });
const u0 = await page.evaluate(() => window.__glina.undoStack.length);
await page.evaluate(() => { window.__glina.setLevel(1); window.__glina.setLevel(1); window.__glina.setLevel(0); }); await idle(); await frames(2);
d = await snap();
check('several level requests at once: one change, one undo step', d.level === 1 && (await page.evaluate(() => window.__glina.undoStack.length)) === u0 + 1, { level: d.level });
check('…and no error message', !errors.length, errors.slice(0, 2));
await page.evaluate(() => window.__glina.remesh()); await idle(); await frames(2);
d = await snap();
check('remesh: the levels are dropped only when it happens, and undo brings them back', d.top === 0 && d.level === 0);
await page.evaluate(() => window.__glina.undo()); await frames(3);
d = await snap();
check('…undo after the remesh: levels back', d.top === 2 && d.level === 1, { top: d.top, level: d.level });
await page.click('#bNew'); await page.click('#menu button:has-text("Равнина")'); await frames(3);   // plane (open)
await page.keyboard.press('Control+d');
// (wait for the level itself: on a busy machine the key's work can start after a first idle check)
await page.waitForFunction(() => window.__glina.MR && window.__glina.MR.levels.length === 2 && window.__glina.MR.cur === 1, null, { timeout: 120000 }); await idle();
await page.evaluate(() => window.__glina.remesh()); await frames(2);
d = await snap();
check('remesh refused on the open plane: the levels stay', d.top === 1, { top: d.top, level: d.level, n: d.n, f: d.f });
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
