// Panel Loops and MeshBalloon: node test/panels.mjs
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
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const st = () => G(() => { const W = window.__glina, t = W.TOOLS[W.curTool], a = W.toolArrays(t); let rMax = 0, rMin = Infinity; for (let i = 0; i < a.pos.length; i += 3) { const r = Math.hypot(a.pos[i], a.pos[i + 1], a.pos[i + 2]); rMax = Math.max(rMax, r); rMin = Math.min(rMin, r); } return { tools: W.TOOLS.length, name: t.name, f: a.idx.length / 3, open: W.hasOpenEdges(a.idx), groups: new Set(a.grp).size, rMax, rMin }; });

// two groups (the top from the mask), then panels
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.3 ? 1 : 0; W.groupOp('frommask'); W.maskOp('clear'); });
await frames(2);
const a0 = await st();
await G(() => window.__glina.panelLoops()); await frames(3);
const p1 = await st();
check('Panel Loops: one closed panel per group, lifted off the old surface', a0.groups === 2 && p1.groups === 2 && !p1.open && p1.f > a0.f * 2 && p1.rMax > 1.005, { a0, p1 });
await G(() => window.__glina.undo()); await frames(2);
check('undo gives the mesh back', (await st()).f === a0.f);

// a balloon from a masked patch
await G(() => { const W = window.__glina, m = W.mesh; for (let i = 0; i < m.n; i++) m.mask[i] = m.pos[i * 3 + 1] > 0.7 ? 1 : 0; W.balloonTool(); });
await frames(3);
const b1 = await st();
check('MeshBalloon: a new closed subtool, thickest in its middle', b1.tools === 2 && b1.name === 'Възглавница' && !b1.open && b1.rMax > 1.02 && b1.rMin > 0.95, b1);
check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
