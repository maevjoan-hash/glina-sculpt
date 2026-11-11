// The journal: what was done and what went wrong, kept on the device and written out as a file: node test/journal.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.setWheel(false); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const box = await G(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2 - 120, cy = box.y + box.h / 2;
async function drag(x0, y0, x1, y1, steps = 8) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } await page.mouse.up(); await frames(3); }
const of = (k, f) => G(([k]) => window.__glina.journal.filter((e) => e.k === k), [k]).then((a) => (f ? a.filter(f) : a));
const toastNow = () => G(() => document.getElementById('toast').textContent);

const start = await of('start');
check('it starts with the version of the app', start.length === 1 && /^\d+\.\d+\.\d+$/.test(start[0].v), start);
await G(() => { const W = window.__glina; W.S.sym = false; W.syncSym(); W.selectTool('draw'); W.brush().radius = 50; W.brush().strength = 0.5; });
await drag(cx - 40, cy, cx + 40, cy);
const s1 = (await of('stroke')).pop();
check('a stroke is recorded with the brush and its numbers, and how much it touched', s1 && s1.tool === 'draw' && s1.r === 50 && s1.s === 0.5 && s1.changed && s1.touched > 50 && s1.f === 81920 && s1.ms > 0 && !s1.bug && !('pos' in s1), s1);
check('choosing a brush is recorded', (await of('tool')).some((e) => e.id === 'draw'));
// a stroke on a masked model: nothing changes, and the journal says why
await G(() => { const W = window.__glina; W.maskOp('invert'); });
await frames(2);
await drag(cx - 40, cy + 60, cx + 40, cy + 60);
const masked = await of('hint', (e) => e.id === 'masked');
check('a stroke where everything is masked gives the hint „masked“, on the screen too', masked.length === 1 && /маскиран/.test(await toastNow()), { masked, toast: await toastNow() });
await G(() => window.__glina.maskOp('clear')); await frames(2);
// the same brush undone three times in a row
for (let k = 0; k < 3; k++) await drag(cx - 40, cy - 80 + k * 10, cx + 40, cy - 80 + k * 10);
for (let k = 0; k < 3; k++) { await G(() => window.__glina.undo()); await frames(2); }
const u3 = await of('hint', (e) => e.id === 'undo3');
check('three undos in a row after one brush: the hint to open its settings', u3.length === 1 && u3[0].tool === 'draw' && (await of('undo')).length >= 3 && /Три отмени/.test(await toastNow()), { u3, toast: await toastNow() });
// full strength on one place: „hammer“, and the triangles pulled long: „stretch“
await G(() => { const W = window.__glina; W.brush().strength = 1; W.brush().radius = 60; });
for (let k = 0; k < 14; k++) await drag(cx - 30, cy + 120, cx + 30, cy + 120, 5);
const hints = (await of('hint')).map((e) => e.id);
const last = (await of('stroke')).pop();
check('fourteen passes at full strength on one place: „hammer“ and, without dynamic topology, „stretch“', hints.includes('hammer') && hints.includes('stretch') && last.stretch > 8, { hints, stretch: last.stretch });
check('each hint is shown once a session but recorded every time', hints.filter((h) => h === 'stretch').length >= 2);
// an error of the program
await G(() => window.dispatchEvent(new ErrorEvent('error', { message: 'пробна грешка', filename: 'x/app.js', lineno: 7 })));
const err = await of('error');
check('an error of the program is recorded', err.length === 1 && err[0].m === 'пробна грешка' && err[0].at === 'app.js:7', err);
// the file
const file = await G(() => window.__glina.journalFile());
check('the file: version, device, the model in numbers, a summary and the records — no model data', /^\d+\.\d+\.\d+$/.test(file.version) && file.device.agent && file.model.tris === 81920 && file.summary.strokes >= 18 && file.summary.errors === 1 && file.summary.hints >= 4 && Array.isArray(file.journal) && JSON.stringify(file).length < 400000, { summary: file.summary, bytes: JSON.stringify(file).length });
check('the panel shows the counts and has the buttons', await G(() => /записа/.test(document.getElementById('journalInfo').textContent) && !!document.getElementById('bJournalSave') && document.getElementById('tJournal').checked));
// kept across a reload; switched off it records nothing; cleared it is empty
await page.waitForTimeout(800);
const n0 = await G(() => window.__glina.journal.length);
await page.reload(); await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const n1 = await G(() => window.__glina.journal.length);
check('the journal is still there after a reload (with a new „start“)', n1 >= n0 && (await of('start')).length === 2, { n0, n1 });
await G(() => { const b = document.getElementById('hintClose'); if (b) b.click(); const W = window.__glina; W.setDrawerTab('view'); document.getElementById('tJournal').click(); });
const n2 = await G(() => window.__glina.journal.length);
await G(() => { window.__glina.selectTool('clay'); window.__glina.logEv('x'); });
check('switched off, nothing is recorded', await G((n) => window.__glina.journal.length === n && !window.__glina.S.journal, n2));
await G(() => document.getElementById('bJournalClear').click());
check('„Изчисти“ empties it', await G(() => window.__glina.journal.length === 0 && localStorage.getItem('glina.journal') === null));
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
