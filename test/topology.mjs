// Topology brush and MicroPoly: node test/topology.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.coreSync);
await page.evaluate(() => { document.getElementById('hintClose').click(); const W = window.__glina; W.S.sym = false; W.syncSym(); W.setDyntopo(false); W.orbit(0, 0); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && !window.__glina.working, null, { timeout: 180000 });
const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const G = (fn, arg) => page.evaluate(fn, arg);
async function drag(pts, steps = 10) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await frames(1); } }
  await page.mouse.up(); await frames(3);
}
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// a # of three lines each way over the front of the sphere: four cells inside
await G(() => window.__glina.selectTool('topology'));
for (const d of [-90, 0, 90]) await drag([[cx - 130, cy + d], [cx + 130, cy + d + 6]], 12);
for (const d of [-90, 0, 90]) await drag([[cx + d, cy - 130], [cx + d - 6, cy + 130]], 12);
const lines = await G(() => window.__glina.topoLines.length);
const T = await G(() => { const t = window.__glina.topoBuild(); return t ? { faces: t.faces.length, nodes: t.nodes.length } : null; });
check('six lines are drawn on the model; their crossings make four closed cells', lines === 6 && T && T.faces === 4 && T.nodes >= 9, { lines, T });
const t0 = await G(() => window.__glina.TOOLS.length);
await G(() => document.getElementById('bTopoMake').click());
const made = await G(() => {
  const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t), P = a.pos;
  let rmin = Infinity, rmax = 0; for (let i = 0; i < P.length; i += 3) { const r = Math.hypot(P[i], P[i + 1], P[i + 2]); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  return { tools: W.TOOLS.length, name: t.name, open: W.hasOpenEdges(a.idx), groups: new Set(a.grp).size, f: a.idx.length / 3, rmin, rmax, lines: W.topoLines.length };
});
check('„Направи от линиите“: a new closed subtool lying on the sphere, a group per cell', made.tools === t0 + 1 && made.name === 'Топология' && !made.open && made.groups >= 4 && made.f > 100 && made.rmin > 0.98 && made.rmax < 1.15 && made.lines === 0, made);
await G(() => window.__glina.undo());
check('undo takes it away', await G(() => window.__glina.TOOLS.length) === t0);
// lines that do not close anything
await G(() => { const W = window.__glina; W.topoLines = []; W.activateTool(0); });
await drag([[cx - 100, cy], [cx + 100, cy]], 8);
const none = await G(() => { const W = window.__glina, n = W.TOOLS.length; W.topoMake(); return W.TOOLS.length - n; });
check('a single line makes nothing (and says so)', none === 0);
await G(() => document.getElementById('bTopoClear').click());

// MicroPoly: a quad sphere, a ring in every quad
await G(() => { const W = window.__glina; document.getElementById('bNew').click(); [...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Сфера, по-лека')).click(); W.S.quadTarget = 400; W.quadRemesh(); });
await idle();
const mp = await G(() => {
  const W = window.__glina, Q = W.quadsOf(W.mesh), nf = Q.length / 4, t0 = W.TOOLS.length;
  const got = W.microPoly('ring');
  const t = W.TOOLS[W.curTool], a = W.toolArrays(t), P = a.pos;
  let rmin = Infinity, rmax = 0; for (let i = 0; i < P.length; i += 3) { const r = Math.hypot(P[i], P[i + 1], P[i + 2]); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  return { nf, got, tools: W.TOOLS.length - t0, name: t.name, f: a.idx.length / 3, per: a.idx.length / 3 / nf, rmin, rmax };
});
check('MicroPoly: a ring in every quad of the retopologised sphere, on its surface, as a new subtool', mp.got === mp.nf && mp.tools === 1 && mp.name === 'MicroPoly' && mp.per === 384 && mp.rmin > 0.85 && mp.rmax < 1.3, mp);
for (const k of ['tile', 'bead']) {
  const ok = await G((kk) => { const W = window.__glina; W.activateTool(0); const n = W.TOOLS.length; const got = W.microPoly(kk); return got > 0 && W.TOOLS.length === n + 1; }, k);
  check(`MicroPoly „${k}“ too`, ok);
}

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
