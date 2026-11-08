// Each brush's own box of settings: node test/brushbox.mjs
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
// what is visible in the box for a brush
const box = (id) => G((i) => {
  window.__glina.selectTool(i);
  const vis = (el) => !!el && el.offsetParent !== null && !el.closest('[hidden]');
  const ids = ['radiusRow', 'strengthRow', 'invRow', 'paintGrp', 'vdmGrp', 'morphGrp', 'gzGrp', 'immGrp', 'grabGrp', 'clothGrp', 'zmGrp', 'ffdGrp', 'topoGrp', 'shadowGrp', 'taperRow'];
  const out = {}; for (const k of ids) out[k] = vis(document.getElementById(k));
  out.name = document.getElementById('brushName').textContent; out.about = document.getElementById('bbAbout').textContent; out.icon = !!document.querySelector('#bbIcon svg');
  return out;
}, id);
const all = await G(() => window.__glina.S.brushes.map((b) => b.id));
let missing = [];
for (const id of all) { const b = await box(id); if (!b.about || !b.icon) missing.push(id); }
check('every brush has its box: icon, name and what it does', missing.length === 0, { missing });
const only = (b, keys) => Object.entries(b).filter(([k, v]) => typeof v === 'boolean' && k !== 'icon' && v).map(([k]) => k).sort().join(',') === keys.slice().sort().join(',');
const cases = [
  ['draw', ['radiusRow', 'strengthRow', 'invRow']],
  ['paint', ['radiusRow', 'strengthRow', 'paintGrp']],
  ['vdm', ['radiusRow', 'strengthRow', 'invRow', 'vdmGrp']],
  ['morph', ['radiusRow', 'strengthRow', 'invRow', 'morphGrp']],
  ['gizmo', ['gzGrp']],
  ['ffd', ['ffdGrp']],
  ['topology', ['topoGrp']],
  ['shadowbox', ['shadowGrp']],
  ['zmodel', ['zmGrp']],
  ['imm', ['radiusRow', 'immGrp']],
  ['clothpinch', ['radiusRow', 'strengthRow', 'clothGrp']],
  ['grab', ['radiusRow', 'strengthRow', 'grabGrp']],
  ['curvedam', ['radiusRow', 'strengthRow', 'invRow', 'taperRow']],
  ['snakecurve', ['radiusRow', 'strengthRow']],
];
for (const [id, keys] of cases) { const b = await box(id); check(`${id}: only its own settings (${keys.join(', ')})`, only(b, keys), b); }
// the Bend Curve shows its axis; the cage does not
const ax = await G(() => { const W = window.__glina; W.selectTool('ffd'); const r = []; for (const m of ['curve', 'cage']) { document.querySelector(`#ffdModeChips [data-id=${m}]`).click(); r.push(!document.getElementById('ffdAxisRow').hidden); } return r; });
check('FFD: the axis chips only for the curve', ax[0] && !ax[1], ax);
// the axis chips in the box and in Deformers are one setting
const both = await G(() => { document.querySelector('#ffdModeChips [data-id=curve]').click(); document.querySelector('#ffdAxisChips [data-id="2"]').click(); const a = window.__glina.S.defAxis, d = document.querySelector('#defAxisChips [data-id="2"]').getAttribute('aria-pressed'); document.querySelector('#ffdModeChips [data-id=cage]').click(); return { a, d }; });
check('…and they are the same as the deformers’ axis', both.a === 2 && both.d === 'true', both);
// paint colour from the box
const col = await G(() => { window.__glina.selectTool('paint'); const sw = document.querySelectorAll('#paintRow .swatch, #paintRow button'); if (sw[1]) sw[1].click(); return window.__glina.S.paint; });
check('the paint colour is picked in the paint brush’s box', Array.isArray(col) && col.length === 3, col);
// the morph box knows whether a form is stored
const mo = await G(() => { const W = window.__glina; W.selectTool('morph'); const before = document.getElementById('bbMorphSwitch').disabled; document.getElementById('bbMorphStore').click(); return { before, after: document.getElementById('bbMorphSwitch').disabled }; });
check('the morph box: „Размени“ only once a form is stored', mo.before && !mo.after, mo);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
