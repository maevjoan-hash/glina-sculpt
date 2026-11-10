// The navigation wheel (AutoCAD: SteeringWheels): every part, the handle, the switches: node test/wheel.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => document.getElementById('hintClose').click());
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const camState = () => G(() => { const W = window.__glina, c = W.cam, p = W.camera.position; return { t: c.target.toArray(), d: c.dist, q: c.q.toArray(), eye: [p.x, p.y, p.z], undo: W.undoStack.length }; });
const far = (a, b) => Math.max(...a.map((x, k) => Math.abs(x - b[k])));
// the centre of a part of the wheel on the screen
const at = (id) => page.$eval(`#nwSvg [data-w="${id}"]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
async function drag(id, dx, dy, steps = 10) {
  const p = await at(id);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(p.x + dx * i / steps, p.y + dy * i / steps);
  await page.mouse.up();
}
const settle = () => page.waitForTimeout(500);   // a view counts for „Назад“ after 0.4 s

check('the wheel is there from the start, the top button pressed', await G(() => !document.getElementById('navWheel').hidden && document.getElementById('bWheel').getAttribute('aria-pressed') === 'true'));
const labels = await G(() => [...document.querySelectorAll('#nwSvg .nwL')].map((t) => t.textContent));
check('eight parts: МАЩАБ ОРБИТА НАЗАД МЕСТИ outside, ГОРЕ/ДОЛУ ОГЛЕДАЙ ЦЕНТЪР НАКЛОН inside', labels.join() === 'МАЩАБ,ОРБИТА,НАЗАД,МЕСТИ,ГОРЕ/ДОЛУ,ОГЛЕДАЙ,ЦЕНТЪР,НАКЛОН', labels);
await settle();
let a = await camState();
await drag('orbit', 80, 30);
let b = await camState();
check('ОРБИТА turns the view about the same centre, and nothing is sculpted', far(a.q, b.q) > 0.05 && far(a.t, b.t) < 1e-9 && Math.abs(a.d - b.d) < 1e-9 && b.undo === a.undo, { dq: far(a.q, b.q), undo: [a.undo, b.undo] });
await settle();
a = b; await drag('pan', 60, 0);
b = await camState();
check('МЕСТИ moves the centre, not the turn', far(a.t, b.t) > 0.05 && far(a.q, b.q) < 1e-9, { dt: far(a.t, b.t) });
await settle();
a = b; const z = await at('zoom'); await page.mouse.click(z.x, z.y);
b = await camState();
check('a click on МАЩАБ comes 20% closer', Math.abs(b.d / a.d - 0.8) < 1e-6, { d: [a.d, b.d] });
await settle();
a = b; await drag('zoom', 0, -60);
b = await camState();
check('МАЩАБ dragged up comes closer still', b.d < a.d * 0.8, { d: [a.d, b.d] });
await settle();
// НАЗАД: the view before the last
const before = a;
const rw = await at('rewind'); await page.mouse.click(rw.x, rw.y);
b = await camState();
check('a click on НАЗАД brings back the view before', Math.abs(b.d - before.d) < 1e-6 && far(b.t, before.t) < 1e-6, { d: [before.d, b.d], tip: await G(() => document.getElementById('nwTip').textContent) });
const hist = await G(() => ({ n: window.__glina.camHist.list.length, at: window.__glina.camHist.at }));
await drag('rewind', -14 * 3, 0, 6);
const back3 = await G(() => window.__glina.camHist.at);
check('НАЗАД dragged left goes further back through the views you had', back3 === Math.max(0, hist.at - 3), { hist, back3 });
await settle();
// ГОРЕ/ДОЛУ: straight up, nothing else
a = await camState(); await drag('updown', 0, -50);
b = await camState();
check('ГОРЕ/ДОЛУ lifts the view straight up', b.t[1] - a.t[1] > 0.01 && Math.abs(b.t[0] - a.t[0]) < 1e-9 && Math.abs(b.t[2] - a.t[2]) < 1e-9 && far(a.q, b.q) < 1e-9, { dy: b.t[1] - a.t[1] });
await settle();
// ОГЛЕДАЙ: the camera stays, it only turns
a = await camState(); await drag('look', 50, 20);
b = await camState();
check('ОГЛЕДАЙ turns the camera where it stands', far(a.eye, b.eye) < 1e-4 && far(a.q, b.q) > 0.02, { eye: far(a.eye, b.eye), dq: far(a.q, b.q) });
await settle();
// НАКЛОН: about the line of sight
a = await camState(); await drag('roll', 60, 0);
b = await camState();
check('НАКЛОН tilts the view and keeps the centre', far(a.q, b.q) > 0.05 && far(a.t, b.t) < 1e-9, { dq: far(a.q, b.q) });
// НАЧАЛО (the middle): the whole model again, from the front-right
await page.mouse.click((await at('home')).x, (await at('home')).y);
const home = await G(() => { const W = window.__glina, { c } = W.mesh.bounds(); return { t: W.cam.target.toArray(), c }; });
check('the middle (НАЧАЛО) frames the whole model again', far(home.t, home.c) < 1e-6, home);
await settle();
// ЦЕНТЪР: dragged onto the model, the point becomes the centre and the camera stays
a = await camState();
const target = await G(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6, lx: r.width * 0.4, ly: r.height * 0.6 }; });
const want = await G((t) => { const h = window.__glina.pick(t.lx, t.ly); return h ? h.point.toArray() : null; }, target);
const cp = await at('center');
await page.mouse.move(cp.x, cp.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(cp.x + (target.x - cp.x) * i / 12, cp.y + (target.y - cp.y) * i / 12);
const mark = await G(() => { const m = document.getElementById('centerMark'); return m && !m.hidden; });
await page.mouse.up();
b = await camState();
const mid = await G(() => { const W = window.__glina, v = W.cam.target.clone().project(W.camera); return [v.x, v.y]; });
const along = await G(([e0, e1]) => { const W = window.__glina, f = W.camera.getWorldDirection(W.cam.target.clone()); return (e1[0] - e0[0]) * f.x + (e1[1] - e0[1]) * f.y + (e1[2] - e0[2]) * f.z; }, [a.eye, b.eye]);
check('ЦЕНТЪР: dragged onto the model, that point goes to the middle of the view (a slide, not a turn)', want && far(b.t, want) < 1e-5 && Math.abs(mid[0]) < 1e-4 && Math.abs(mid[1]) < 1e-4 && Math.abs(along) < 1e-4 && far(a.q, b.q) < 1e-9 && mark, { want, mid, along, mark });
// the mouse wheel over it zooms; nothing has been sculpted all along
const d0 = b.d; const hub = await at('orbit'); await page.mouse.move(hub.x, hub.y); await page.mouse.wheel(0, 200);
const d1 = (await camState()).d;
check('the mouse wheel over it zooms out', d1 > d0, { d0, d1 });
check('no stroke on the model from any of it', (await camState()).undo === a.undo);
// moving and hiding it
const h0 = await page.$eval('#navWheel', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
const mv = await page.$eval('#nwMove', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(mv.x, mv.y); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(mv.x - 50 * i, mv.y + 30 * i);
await page.mouse.up();
const h1 = await G(() => { const r = document.getElementById('navWheel').getBoundingClientRect(); return { x: r.left, y: r.top, saved: window.__glina.S.wheelPos }; });
check('the ✥ handle moves the wheel, and the place is kept', Math.abs(h1.x - h0.x + 400) < 3 && Math.abs(h1.y - h0.y - 240) < 3 && h1.saved, { h0, h1 });
await page.dblclick('#nwMove');
const h2 = await page.$eval('#navWheel', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
check('a double click on the handle puts it back in the corner', Math.abs(h2.x - h0.x) < 2 && Math.abs(h2.y - h0.y) < 2, h2);
await page.click('#nwClose');
const hidden = await G(() => ({ hid: document.getElementById('navWheel').hidden, pressed: document.getElementById('bWheel').getAttribute('aria-pressed'), S: window.__glina.S.wheel }));
check('× hides it (and the top button shows it is off)', hidden.hid && hidden.pressed === 'false' && hidden.S === false, hidden);
await page.click('#gl', { position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press('Shift+W');
check('Shift+W brings it back', await G(() => !document.getElementById('navWheel').hidden));
await page.click('#bWheel');
check('so does the top button (off again)', await G(() => document.getElementById('navWheel').hidden));
await page.click('#bWheel');
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
