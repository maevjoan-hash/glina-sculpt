// Decimation (Rust core) and the print size in millimetres: node test/decimate.mjs
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
const st = () => G(() => { const m = window.__glina.mesh; let lo = Infinity, hi = 0; for (let i = 0; i < m.n; i++) { const r = Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]); lo = Math.min(lo, r); hi = Math.max(hi, r); } return { f: m.f, lo, hi, open: window.__glina.hasOpenEdges(m.idx.subarray(0, m.f * 3)), groups: new Set(m.grp.subarray(0, m.n)).size, red: Array.from(m.col.subarray(0, m.n * 3)).filter((v, i) => i % 3 === 1 && v < 0.5).length }; });

// two groups and a painted half, then a quarter of the triangles
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0 ? 1 : 0; W.groupOp('frommask'); W.S.paint = [1, 0, 0]; W.maskOp('invert'); W.fillColour(); W.maskOp('clear'); });
const a = await st();
await G(() => { window.__glina.S.decimateKeep = 0.25; window.__glina.decimate(); }); await idle(); await frames(2);
const b = await st();
check('a quarter of the triangles, the same round shape, still closed', Math.abs(b.f - a.f / 4) < a.f * 0.01 && b.lo > 0.98 && b.hi < 1.001 && !b.open, { a: a.f, b: b.f, lo: b.lo, hi: b.hi });
check('the groups and the colour stay', b.groups === 2 && b.red > 0 && b.red < b.f, { groups: b.groups, red: b.red });
await G(() => { window.__glina.S.decimateKeep = 0.05; window.__glina.decimate(); }); await idle(); await frames(2);
const c = await st();
check('down to 5 % of that still keeps a sphere', c.f < b.f * 0.06 && c.lo > 0.93 && !c.open, c);
await G(() => { window.__glina.undo(); window.__glina.undo(); }); await frames(2);
check('undo gives the full mesh back', (await st()).f === a.f);

// print size: the longest side in mm in the STL
const mm = await G(() => { const W = window.__glina; W.S.printSize = 50; const u8 = W.exportSTL ? W.exportSTL() : null; return u8 ? (() => { const dv = new DataView(u8.buffer); const n = dv.getUint32(80, true); let lo = Infinity, hi = -Infinity; for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) { const x = dv.getFloat32(84 + t * 50 + 12 + v * 12, true); lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; })() : -1; });
check('with 50 mm set, the STL is 50 mm across', Math.abs(mm - 50) < 0.01, { mm });
const info = await G(() => { window.__glina.renderPrintInfo(); return document.getElementById('printInfo').textContent; });
check('the size is shown', /мм/.test(info) || /50/.test(info), info);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
