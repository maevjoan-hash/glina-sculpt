// The brushes that draw on the overlay (gizmo, cage, curve, lines, silhouettes): what they draw goes
// when another brush is chosen, and follows the view while they are chosen: node test/overlay.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); window.__glina.orbit(0, 0); });
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
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
const count = () => G(() => document.getElementById('overlay').childElementCount);
const sig = () => G(() => document.getElementById('overlay').innerHTML.length + ':' + (document.getElementById('overlay').firstElementChild || { getAttribute: () => '' }).getAttribute('points'));

await G(() => { const W = window.__glina; W.topoLines = []; W.shadows = [null, null, null]; });
// lines and a silhouette to show
await G(() => window.__glina.selectTool('topology'));
await drag([[cx - 100, cy], [cx + 100, cy]]);
await G(() => window.__glina.selectTool('shadowbox'));
const circle = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; circle.push([cx + Math.cos(a) * 120, cy + Math.sin(a) * 120]); }
await drag(circle, 2);

for (const id of ['gizmo', 'ffd', 'topology', 'shadowbox']) {
  await G((i) => { const W = window.__glina; W.selectTool(i); if (i === 'ffd') W.brush().ffdMode = 'cage'; }, id);
  await frames(3);
  const on = await count();
  // the view turns: what is drawn turns with it
  const s0 = await sig();
  await G(() => window.__glina.orbit(40, 0)); await frames(3);
  const s1 = await sig();
  await G(() => window.__glina.orbit(-40, 0)); await frames(2);
  await G(() => window.__glina.selectTool('draw'));
  await frames(3);
  const off = await count();
  check(`${id}: shows its things, they follow the view, and go when another brush is chosen`, on > 0 && s1 !== s0 && off === 0, { on, off, moved: s1 !== s0 });
}
// the curve mode of the cage too
await G(() => { const W = window.__glina; W.selectTool('ffd'); W.brush().ffdMode = 'curve'; }); await frames(3);
const cOn = await count();
await G(() => { const W = window.__glina; W.brush().ffdMode = 'cage'; W.selectTool('clay'); }); await frames(3);
check('the Bend Curve too', cOn > 0 && (await count()) === 0, { cOn });
// and back: the lines and the silhouette are still there for their brushes
await G(() => window.__glina.selectTool('topology')); await frames(3);
const back = await count();
check('chosen again, the lines are back', back > 0, { back });

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
