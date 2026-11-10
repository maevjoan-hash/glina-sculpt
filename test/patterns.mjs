// „Шарки“ (array in a row, circle, grid, along a curve; NanoMesh, MicroPoly, radial) and the search: node test/patterns.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); W.orbit(0, 0); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const bb = () => G(() => { const W = window.__glina, m = W.mesh, P = m.pos; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); } return { n: m.n, ext: hi.map((x, k) => x - lo[k]), undo: W.undoStack.length }; });

// the rail button and the tiles
await page.click('#bPatterns');
const tiles = await G(() => [...document.querySelectorAll('#patList .palItem')].map((e) => e.dataset.pat));
check('„Шарки“ in the rail opens a panel of pattern buttons', tiles.join() === 'line,circle,grid,curve,nano,micro,radial', tiles);
// a grid: 4 columns along X, 3 rows along Z, of a cube
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Куб')).click(); });
await G(() => window.__glina.openPatterns());
const c0 = await bb();
await page.click('#patList [data-pat=grid]');
const ui = await G(() => ({ rows: !document.getElementById('arrRowsGrp').hidden, scale: !document.getElementById('arrScaleRow').hidden, mode: window.__glina.S.arrMode, label: document.getElementById('lArrCount').textContent }));
check('„Решетка“ shows its own settings: rows, the second axis, columns (no scale)', ui.rows && !ui.scale && ui.mode === 'grid' && ui.label === 'Колони', ui);
await G(() => { const W = window.__glina; W.S.arrCount = 4; W.S.arrRows = 3; W.S.arrAxis = 0; W.S.arrAxis2 = 2; W.S.arrGap = 0.25; document.getElementById('bArray').click(); });
await frames(2);
const c1 = await bb();
const w = c0.ext[0];
check('the grid: 12 cubes, 4 along X and 3 along Z, one undo step', c1.n === c0.n * 12 && Math.abs(c1.ext[0] - (w * 1.25 * 3 + w)) < 1e-4 && Math.abs(c1.ext[2] - (w * 1.25 * 2 + w)) < 1e-4 && Math.abs(c1.ext[1] - w) < 1e-5 && c1.undo === c0.undo + 1, { c0, c1 });
await G(() => window.__glina.undo());
// in a row: still as before
await G(() => { document.querySelector('#patList [data-pat=line]').click(); const W = window.__glina; W.S.arrCount = 3; W.S.arrScale = 1; document.getElementById('bArray').click(); });
const c2 = await bb();
check('„В редица“: three in a row', c2.n === c0.n * 3 && Math.abs(c2.ext[0] - (w * 1.25 * 2 + w)) < 1e-4, c2);
await G(() => window.__glina.undo());
// along a curve
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.openPatterns('curve'); W.S.pcCount = 9; });
const curveUi = await G(() => !document.querySelector('#patBox .patDetail[data-pat=curve]').hidden && document.querySelector('#patBox .patDetail[data-pat=array]').hidden);
await page.click('#bPcDraw');
const armed = await G(() => ({ panel: !document.getElementById('patterns').hidden, pressed: document.getElementById('bPcDraw').getAttribute('aria-pressed') }));
const box = await G(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2, t0 = await G(() => window.__glina.TOOLS.length);
await page.mouse.move(cx - 150, cy + 40); await page.mouse.down();
for (let i = 1; i <= 30; i++) { await page.mouse.move(cx - 150 + i * 10, cy + 40 - Math.sin(i / 5) * 60); await frames(1); }
await page.mouse.up(); await frames(3);
const pc = await G(() => { const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t); return { tools: W.TOOLS.length, name: t.name, n: a.pos.length / 3, armed: document.getElementById('bPcDraw').getAttribute('aria-pressed') }; });
check('„По крива“: the panel steps aside, a line on the model puts 9 shapes along it as a new subtool', curveUi && !armed.panel && armed.pressed === 'true' && pc.tools === t0 + 1 && pc.name === 'По крива' && pc.armed === 'false', { armed, pc });
// NanoMesh, MicroPoly and radial live here now
const moved = await G(() => ({ nano: !!document.querySelector('#patBox [data-pat=nano] #bNano'), micro: !!document.querySelector('#patBox [data-pat=micro] #bMicro'), radial: !!document.querySelector('#patBox [data-pat=radial] #sRadial') }));
check('NanoMesh, MicroPoly and radial symmetry each have their own box here', moved.nano && moved.micro && moved.radial, moved);
const rad = await G(() => { const W = window.__glina; document.getElementById('bRadialOpen').click(); const el = document.getElementById('sRadial'); el.value = 6; el.dispatchEvent(new Event('input')); const r = { radial: W.S.radial, shown: !document.querySelector('#patBox [data-pat=radial]').hidden }; el.value = 1; el.dispatchEvent(new Event('input')); return r; });
check('„Кръгова симетрия“ from the Symmetry section opens its pattern; its slider sets the copies', rad.radial === 6 && rad.shown, rad);
// the pattern panel's own search
const ps = await G(() => { const el = document.getElementById('patSearch'); el.value = 'ризница'; el.dispatchEvent(new Event('input')); const v = [...document.querySelectorAll('#patList .palItem')].filter((e) => !e.hidden).map((e) => e.dataset.pat); el.value = ''; el.dispatchEvent(new Event('input')); return v; });
check('the patterns’ search finds by what they make', ps.join() === 'micro', ps);
await page.keyboard.press('Escape');

// the search (Ctrl+K)
await page.keyboard.press('Control+k');
const focused = await G(() => document.activeElement && document.activeElement.id);
await page.keyboard.type('глина');
const s1 = await G(() => [...document.querySelectorAll('#palList .palItem')].filter((e) => !e.hidden).map((e) => e.dataset.tool));
check('Ctrl+K opens the search; „глина“ leaves the clay brushes', focused === 'palSearch' && s1.includes('clay') && s1.includes('claybuild') && !s1.includes('smooth'), s1);
await G(() => { const el = document.getElementById('palSearch'); el.value = 'масив'; el.dispatchEvent(new Event('input')); });
const s2 = await G(() => [...document.querySelectorAll('#palFound .foundRow')].map((e) => e.firstChild.textContent));
check('„масив“ finds the array patterns', s2.includes('В редица') && s2.includes('Решетка'), s2);
await G(() => { const el = document.getElementById('palSearch'); el.value = 'ретопология'; el.dispatchEvent(new Event('input')); });
const s3 = await G(() => [...document.querySelectorAll('#palFound .foundRow')].map((e) => e.firstChild.textContent));
await G(() => document.querySelector('#palFound .foundRow').click());
await frames(2);
const shown = await G(() => ({ drawer: !document.getElementById('drawer').hidden, tab: document.querySelector('#drawerTabs [aria-selected=true]').dataset.tab, flash: !!document.querySelector('#drawer .flash'), pal: !document.getElementById('palette').hidden }));
check('a setting found („ретопология“) opens its tab and shows it', s3.some((t) => /Ретопология/.test(t)) && shown.drawer && shown.tab === 'model' && shown.flash && !shown.pal, { s3, shown });
await G(() => { window.__glina.openPalette(); const el = document.getElementById('palSearch'); el.value = 'изгл'; el.dispatchEvent(new Event('input')); });
const first = await G(() => [...document.querySelectorAll('#palList .palItem')].filter((e) => !e.hidden).map((e) => e.dataset.tool));
await page.focus('#palSearch');
await page.keyboard.press('Enter');
const chosen = await G(() => ({ tool: window.__glina.S.tool, pal: !document.getElementById('palette').hidden }));
check('Enter chooses the first brush found', chosen.tool === first[0] && first.includes('smooth') && !chosen.pal, { first, chosen });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
