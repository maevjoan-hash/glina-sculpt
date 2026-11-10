// Array Mesh controls (offset, turn, stretch of every next copy; the copies shown before they are made) and
// the panels you move and arrange (floating panels dragged and pinned; the drawer's sections folded,
// moved and put on another tab, all remembered): node test/arrange.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const URL = pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href;
await page.goto(URL);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// ---------- arrays ----------
await G(() => { document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Куб')).click(); });
await frames(2);
// with nothing extra the copies are where they were before: one after another along the axis
const plain = await G(() => {
  const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]), n = a.pos.length / 3;
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, a.pos[i * 3]); hi = Math.max(hi, a.pos[i * 3]); }
  const r = W.arrayArrays(a, { count: 3, rows: 1, mode: 'line', axis: 0, axis2: 2, gap: 0.5, scale: 1 });
  const step = (hi - lo) * 1.5; let err = 0;
  for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) err = Math.max(err, Math.abs(r.pos[(k * n + i) * 3 + q] - (a.pos[i * 3 + q] + (q === 0 ? step * k : 0))));
  return { err, n: r.pos.length / 3, want: n * 3 };
});
check('without offset, turn or stretch the copies stand one after another, as before', plain.err < 1e-5 && plain.n === plain.want, plain);
// a spiral staircase: around Y, every next one 0.4 higher and turned 20° about its own centre
const spiral = await G(() => {
  const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]);
  const M = W.arrayMatrices(a, { count: 8, rows: 1, mode: 'circle', axis: 1, axis2: 2, gap: 0, scale: 1, off: [0, 0.4, 0], rot: [0, 20, 0], scl: [1, 1, 1] });
  const ys = M.map((m) => m.elements[13]);
  return { n: M.length, rising: ys.every((y, k) => k === 0 || y > ys[k - 1] + 1e-4), det: M.map((m) => +m.determinant().toFixed(4)) };
});
check('offset + turn in a circle make a spiral staircase: every copy higher, none squashed', spiral.n === 8 && spiral.rising && spiral.det.every((d) => Math.abs(d - 1) < 1e-3), spiral);
// a mirror stretch keeps the faces facing out
const mirror = await G(() => {
  const W = window.__glina, a = W.toolArrays(W.TOOLS[W.curTool]);
  const r = W.arrayArrays(a, { count: 2, rows: 1, mode: 'line', axis: 0, axis2: 2, gap: 0.5, scale: 1, off: [0, 0, 0], rot: [0, 0, 0], scl: [-1, 1, 1] });
  const vol = (k) => { const n = a.pos.length / 3, f = a.idx.length / 3; let v = 0; for (let t = 0; t < f; t++) { const o = (k * f + t) * 3, P = (j) => [r.pos[r.idx[o + j] * 3], r.pos[r.idx[o + j] * 3 + 1], r.pos[r.idx[o + j] * 3 + 2]]; const [p, q, s] = [P(0), P(1), P(2)]; v += (p[0] * (q[1] * s[2] - q[2] * s[1]) - p[1] * (q[0] * s[2] - q[2] * s[0]) + p[2] * (q[0] * s[1] - q[1] * s[0])) / 6; } return v; };
  return { v0: vol(0), v1: vol(1) };
});
check('a mirrored copy still faces outward (its volume stays positive)', mirror.v0 > 0 && mirror.v1 > 0, mirror);

// the panel: the extra sliders, the preview, then the real thing
await page.click('#bPatterns');
await page.click('#patList [data-pat=line]');
const more = await G(() => ({ details: !!document.getElementById('arrMore'), sliders: ['sArrOffX', 'sArrOffY', 'sArrOffZ', 'sArrRotX', 'sArrRotY', 'sArrRotZ', 'sArrSclX', 'sArrSclY', 'sArrSclZ'].every((id) => document.getElementById(id)) }));
check('„В редица“ has offset, turn and stretch for every next copy (X, Y, Z)', more.details && more.sliders, more);
await G(() => { const W = window.__glina; W.S.arrCount = 5; W.S.arrGap = 0.3; W.S.arrLive = true; });
await page.click('#arrMore summary');
await page.$eval('#sArrRotZ', (el) => { el.value = '15'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await frames(2);
const prev = await G(() => { const W = window.__glina, P = W.arrPrev; return P ? { on: P.visible, shown: P.children.filter((c) => c.visible).length, rotZ: W.S.arrRotZ, same: P.children[0].geometry === W.gmesh.geometry, n: W.mesh.n } : null; });
check('moving a slider shows the copies at once, drawn from the part itself (4 besides it)', prev && prev.on && prev.shown === 4 && prev.rotZ === 15 && prev.same, prev);
const n0 = prev ? prev.n : 0;
await page.click('#bArray');
await frames(2);
const made = await G(() => { const W = window.__glina; return { n: W.mesh.n, prev: W.arrPrev.visible }; });
check('„Направи масив“ makes them (5 × the part) and the preview steps aside', made.n === n0 * 5 && !made.prev, { ...made, n0 });
await G(() => window.__glina.undo()); await frames(2);
await page.$eval('#tArrLive', (el) => el.click());
await frames(1);
const off = await G(() => ({ live: window.__glina.S.arrLive, prev: window.__glina.arrPrev.visible, n: window.__glina.mesh.n }));
check('undo brings the part back; without „Покажи копията“ there is no preview', !off.live && !off.prev && off.n === n0, off);
await page.$eval('#tArrLive', (el) => el.click());
await G(() => window.__glina.closePatterns()); await frames(1);
check('closing „Шарки“ hides the preview', await G(() => !window.__glina.arrPrev.visible));

// ---------- floating panels ----------
await page.click('#bPatterns');
await G(() => document.getElementById('toast').classList.remove('show'));
await page.waitForTimeout(400);
const head = await page.$('#patterns .palHead');
const hb = await head.boundingBox();
const p0 = await G(() => { const r = document.getElementById('patterns').getBoundingClientRect(); return { x: r.left, y: r.top }; });
await page.mouse.move(hb.x + 40, hb.y + 8); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + 40 + 30 * i, hb.y + 8 + 15 * i);
await page.mouse.up();
const p1 = await G(() => { const r = document.getElementById('patterns').getBoundingClientRect(); return { x: r.left, y: r.top, saved: window.__glina.S.panels.patterns }; });
check('a floating panel goes where its title is dragged, and that is remembered', Math.abs(p1.x - p0.x - 300) < 4 && Math.abs(p1.y - p0.y - 150) < 4 && p1.saved && Number.isFinite(p1.saved.x), { p0, p1 });
// pinned: it stays open while another opens
await page.click('#patterns .fpPin');
await G(() => window.__glina.openPalette()); await frames(1);
const pin = await G(() => ({ pat: !document.getElementById('patterns').hidden, pal: !document.getElementById('palette').hidden, pinned: window.__glina.S.panels.patterns.pin }));
check('📌 keeps „Шарки“ open next to „Всички“', pin.pat && pin.pal && pin.pinned === true, pin);
await G(() => window.__glina.openBrushPanel()); await frames(1);
const pin2 = await G(() => ({ pat: !document.getElementById('patterns').hidden, pal: !document.getElementById('palette').hidden }));
check('an unpinned panel still gives way', pin2.pat && !pin2.pal, pin2);

// ---------- the drawer's sections ----------
await G(() => { document.getElementById('bPanel').getAttribute('aria-pressed') === 'true' || document.getElementById('bPanel').click(); window.__glina.setDrawerTab('model'); });
await frames(1);
const secH = (title) => page.$$eval('#drawer .sec[data-tab] > h2', (hs, t) => { const h = hs.find((x) => x.firstChild.textContent.trim() === t); h.scrollIntoView({ block: 'center' }); const r = h.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }, title);
let h = await secH('Маска');
await page.mouse.click(h.x, h.y);
const shut = await G(() => { const s = [...document.querySelectorAll('#drawer .sec')].find((x) => x.querySelector('h2').firstChild.textContent.trim() === 'Маска'); return { shut: s.classList.contains('shut'), rows: [...s.children].filter((c) => c.tagName !== 'H2' && c.offsetHeight > 0).length, saved: window.__glina.S.secLayout.shut }; });
check('a click on a section\'s title folds it', shut.shut && shut.rows === 0 && shut.saved.includes('Маска'), shut);
// „Видимост“ (right under „Маска“) dragged above it
h = await secH('Видимост');
const top = await page.$$eval('#drawer .sec[data-tab] > h2', (hs) => { const r = hs.find((x) => x.firstChild.textContent.trim() === 'Маска').getBoundingClientRect(); return { y: r.top + r.height / 2 }; });
await page.mouse.move(h.x, h.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(h.x, h.y + (top.y - 4 - h.y) * i / 12);
await page.mouse.up();
const order = await G(() => [...document.querySelectorAll('#drawer .sec[data-tab="model"]')].map((s) => s.querySelector('h2').firstChild.textContent.trim()));
check('dragging a title moves the section (Видимост above Маска)', order.indexOf('Видимост') === order.indexOf('Маска') - 1, order);
// dropped on the „Изглед“ tab
h = await secH('Групи');
const tab = await page.$eval('#drawerTabs .dtab[data-tab=view]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(h.x, h.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(h.x + (tab.x - h.x) * i / 12, h.y + (tab.y - h.y) * i / 12);
await page.mouse.up();
const moved = await G(() => { const s = [...document.querySelectorAll('#drawer .sec')].find((x) => x.querySelector('h2').firstChild.textContent.trim() === 'Групи'); return { tab: s.dataset.tab, now: window.__glina.S.drawerTab, shown: !s.hidden, saved: window.__glina.S.secLayout.tab }; });
check('dropped on a tab, the section goes there', moved.tab === 'view' && moved.now === 'view' && moved.shown && moved.saved['Групи'] === 'view', moved);

// all of it after a reload
await G(() => { window.__glina.S.drawerTab = 'model'; });
await page.reload();
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await G(() => { const b = document.getElementById('hintClose'); if (b) b.click(); });
const after = await G(() => {
  const secs = [...document.querySelectorAll('#drawer .sec[data-tab]')], by = (t) => secs.find((x) => x.querySelector('h2').firstChild.textContent.trim() === t);
  const model = secs.filter((s) => s.dataset.tab === 'model').map((s) => s.querySelector('h2').firstChild.textContent.trim());
  window.__glina.openPatterns();
  const r = document.getElementById('patterns').getBoundingClientRect();
  return { maskShut: by('Маска').classList.contains('shut'), groups: by('Групи').dataset.tab, maskFirst: model.indexOf('Видимост') < model.indexOf('Маска'), x: r.left, pin: document.querySelector('#patterns .fpPin').getAttribute('aria-pressed') };
});
check('after a reload: the folded, moved and re-tabbed sections and the dragged, pinned panel are as left', after.maskShut && after.groups === 'view' && after.maskFirst && Math.abs(after.x - p1.x) < 4 && after.pin === 'true', after);
// the search still finds a setting in a folded section, and unfolds it
const found = await G(() => { const s = [...document.querySelectorAll('#drawer .sec')].find((x) => x.querySelector('h2').firstChild.textContent.trim() === 'Маска'); return s.classList.contains('shut'); });
await G(() => window.__glina.closePatterns());
await page.keyboard.press('Control+k');
await page.keyboard.type('по вдлъбнатините');
await frames(2);
const hit = await page.$('#palFound .foundRow');
if (hit) await hit.click();
await frames(2);
const unf = await G(() => { const s = [...document.querySelectorAll('#drawer .sec')].find((x) => x.querySelector('h2').firstChild.textContent.trim() === 'Маска'); return { shut: s.classList.contains('shut'), shown: !s.hidden }; });
check('the search opens a setting inside a folded section', found && !!hit && !unf.shut && unf.shown, { found, hit: !!hit, ...unf });
// back to how it was
await G(() => window.__glina.setDrawerTab('view'));
await page.click('#bPanelsReset');
const reset = await G(() => {
  const secs = [...document.querySelectorAll('#drawer .sec[data-tab]')], by = (t) => secs.find((x) => x.querySelector('h2').firstChild.textContent.trim() === t);
  const model = secs.filter((s) => s.dataset.tab === 'model').map((s) => s.querySelector('h2').firstChild.textContent.trim());
  return { shut: secs.some((s) => s.classList.contains('shut')), groups: by('Групи').dataset.tab, first: model[0], panels: Object.keys(window.__glina.S.panels).length, left: document.getElementById('patterns').style.left };
});
check('„Подреди панелите наново“ puts every panel and section back', !reset.shut && reset.groups === 'model' && reset.first === 'Подобекти' && reset.panels === 0 && reset.left === '', reset);

// ---------- the array brush: the copies set by dragging in the view ----------
await G(() => { const W = window.__glina; W.closePatterns(); document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Куб')).click(); W.setWheel(false); W.orbit(0, 0); document.getElementById('bPanel').getAttribute('aria-pressed') === 'true' && document.getElementById('bPanel').click(); });
await frames(3);
await G(() => { const W = window.__glina, S = W.S; S.arrMode = 'line'; S.arrAxis = 0; S.arrCount = 4; S.arrGap = 0.2; S.arrScale = 1; for (const k of ['OffX', 'OffY', 'OffZ', 'RotX', 'RotY', 'RotZ']) S['arr' + k] = 0; W.selectTool('array'); });
await frames(2);
const ab0 = await G(() => { const W = window.__glina, P = W.arrPrev; return { on: !!P && P.visible, shown: P ? P.children.filter((c) => c.visible).length : 0, last: P ? P.children[2].matrix.elements.slice(12, 15) : null }; });
check('choosing „Масив“ shows the copies at once (3 besides the part)', ab0.on && ab0.shown === 3, ab0);
const gl = await page.$eval('#gl', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const drag2 = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await frames(1); } await page.mouse.up(); await frames(2); };
const mx = gl.x + gl.w / 2, my = gl.y + gl.h / 2;
// Мести: a drag up lifts the last copy by what the pen moved (in the world), the ones between in proportion
const wpp = await G(() => { const W = window.__glina, r = document.getElementById('gl').getBoundingClientRect(); return 2 * Math.tan(W.camera.fov * Math.PI / 360) * W.camera.position.distanceTo(new W.cam.target.constructor(0, 0, 0)) / r.height; });
await drag2(mx, my, mx, my - 120);
const ab1 = await G(() => { const W = window.__glina, P = W.arrPrev; return { last: P.children[2].matrix.elements.slice(12, 15), mid: P.children[0].matrix.elements.slice(12, 15), off: [W.S.arrOffX, W.S.arrOffY, W.S.arrOffZ], undo: W.undoStack.length, n: W.mesh.n, note: document.getElementById('arrBrushNote').textContent }; });
const rise = ab1.last[1] - ab0.last[1];
check('Мести: the last copy follows the pen up, the first a third of the way; the model itself is untouched', rise > 120 * wpp * 0.5 && rise < 120 * wpp * 1.6 && Math.abs(ab1.mid[1] * 3 - ab1.last[1]) < 1e-4 && ab1.off[1] > 0, { rise, pen: 120 * wpp, ab1 });
// Брой: right adds copies
await G(() => { window.__glina.brush().arr = 'count'; });
await drag2(mx, my, mx + 28 * 3, my);
check('Брой: dragging right adds copies (4 → 7)', await G(() => window.__glina.S.arrCount === 7 && window.__glina.arrPrev.children.filter((c) => c.visible).length === 6));
// Върти and Мащаб
await G(() => { window.__glina.brush().arr = 'turn'; });
await drag2(mx, my, mx + 100, my);
await G(() => { window.__glina.brush().arr = 'scale'; });
await drag2(mx, my, mx, my - 100);
const ab2 = await G(() => { const S = window.__glina.S; return { rot: [S.arrRotX, S.arrRotY, S.arrRotZ], scale: S.arrScale }; });
check('Върти turns every next copy; Мащаб (up) makes every next one larger', ab2.rot.some((v) => Math.abs(v) >= 20) && ab2.scale > 1.05 && ab2.scale <= 1.5, ab2);
// the box, „Направи масив“ and undo
await G(() => window.__glina.openBrushPanel()); await frames(1);
const boxA = await G(() => ({ grp: !document.getElementById('arrBrushGrp').hidden, radius: document.getElementById('radiusRow').hidden, kind: document.querySelector('#arrKindChips [aria-pressed="true"]').dataset.id, drag: document.querySelectorAll('#arrDragChips button').length }));
check('its box: what the drag changes, the pattern, the numbers, „Направи масив“ (no radius or strength)', boxA.grp && boxA.radius && boxA.kind === 'line' && boxA.drag === 4, boxA);
const nA = await G(() => window.__glina.mesh.n);
await page.click('#bArrMake'); await frames(2);
const madeA = await G(() => ({ n: window.__glina.mesh.n, prev: window.__glina.arrPrev.visible }));
check('„Направи масив“ in the box makes the 7 copies real; undo takes them back', madeA.n === nA * 7 && !madeA.prev && await G(async (n) => { window.__glina.undo(); await new Promise((r) => requestAnimationFrame(r)); return window.__glina.mesh.n === n; }, nA), madeA);
// the fold button: the panel shrinks to its title and comes back
const full = await page.$eval('#brushPanel .brushbox', (el) => el.getBoundingClientRect().height);
await page.click('#brushPanel .fpMin'); await frames(1);
const folded = await G(() => ({ h: document.querySelector('#brushPanel .brushbox').getBoundingClientRect().height, name: document.getElementById('brushName').offsetHeight > 0, rows: document.getElementById('arrBrushGrp').offsetHeight }));
await page.click('#brushPanel .fpMin'); await frames(1);
const unfolded = await page.$eval('#brushPanel .brushbox', (el) => el.getBoundingClientRect().height);
check('„–“ folds a panel to its title so the model shows, and unfolds it again', folded.h < 130 && folded.h < full / 3 && folded.name && folded.rows === 0 && Math.abs(unfolded - full) < 2, { full, folded, unfolded });
await G(() => { window.__glina.openPatterns('line'); }); await frames(1);
const pf = await page.$eval('#patterns', (el) => el.getBoundingClientRect().height);
await page.click('#patterns .fpMin'); await frames(1);
const pm = await G(() => ({ h: document.getElementById('patterns').getBoundingClientRect().height, prev: window.__glina.arrPrev.visible }));
check('„Шарки“ folds too, and the copies stay in sight behind it', pm.h < 140 && pm.h < pf / 4 && pm.prev, { pf, pm });
await G(() => { window.__glina.closePatterns(); window.__glina.selectTool('draw'); }); await frames(1);
check('another brush puts the copies away', await G(() => !window.__glina.arrPrev.visible));
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
