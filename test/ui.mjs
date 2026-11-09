// The rail, all brushes, the brush's own panel and the settings tabs: node test/ui.mjs
import { chromium, devices } from 'playwright-core';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const G = (fn, arg) => page.evaluate(fn, arg);
const rail = () => G(() => [...document.querySelectorAll('#rail .tool[data-tool]')].map((e) => e.dataset.tool));
const shown = (id) => G((i) => !document.getElementById(i).hidden, id);

const r0 = await rail();
check('the rail starts with a few everyday brushes, and „Всички“', r0.length === 12 && r0[0] === 'draw' && r0.includes('mask') && (await G(() => !!document.getElementById('bAllBrushes'))), r0);
// all brushes
await page.click('#bAllBrushes');
const pal = await G(() => ({ items: document.querySelectorAll('#palList .palItem').length, cats: [...document.querySelectorAll('#palList .palCat')].map((e) => e.textContent), brushes: window.__glina.S.brushes.length }));
check('„Всички“ shows every brush, by kind', pal.items === pal.brushes && pal.cats.includes('Скулптиране') && pal.cats.includes('Моделиране'), pal);
await page.click('#palList .palItem[data-tool=vdm]');
const picked = await G(() => ({ tool: window.__glina.S.tool, pal: !document.getElementById('palette').hidden, rail: [...document.querySelectorAll('#rail .tool[data-tool]')].map((e) => e.dataset.tool) }));
check('a click there chooses it and closes; while chosen it is in the rail too', picked.tool === 'vdm' && !picked.pal && picked.rail.includes('vdm'), picked);
// a star puts a brush in the rail for good
await page.click('#bAllBrushes');
await page.click('#palList .palItem[data-tool=zmodel] .palStar');
await page.click('#palClose');
await G(() => window.__glina.selectTool('draw'));
const r1 = await rail();
check('☆ puts a brush in the rail and it stays there', r1.includes('zmodel') && !r1.includes('vdm'), r1);
// the brush's own panel: a right click, or a click on the chosen brush
check('the brush panel starts closed', !(await shown('brushPanel')));
await page.click('#rail .tool[data-tool=clay]', { button: 'right' });
const p1 = await G(() => ({ open: !document.getElementById('brushPanel').hidden, tool: window.__glina.S.tool, name: document.getElementById('brushName').textContent }));
check('a right click on a brush chooses it and opens its own settings', p1.open && p1.tool === 'clay' && p1.name === 'Глина', p1);
await page.click('#bpClose');
check('× closes it', !(await shown('brushPanel')));
await page.click('#rail .tool[data-tool=clay]');
check('a click on the brush already chosen opens it too', await shown('brushPanel'));
await page.keyboard.press('Escape');
check('Esc closes it', !(await shown('brushPanel')));
// the settings in tabs
const tabs = await G(() => {
  const out = {};
  for (const t of ['model', 'make', 'view']) {
    document.querySelector(`#drawerTabs [data-tab=${t}]`).click();
    out[t] = [...document.querySelectorAll('#drawer .sec')].filter((s) => !s.hidden).map((s) => s.querySelector('h2').textContent.replace(/\s+/g, ' ').trim().split(' ')[0]);
  }
  return out;
});
check('the settings are in three tabs, each with its own sections', tabs.model.includes('Подобекти') && tabs.model.includes('Геометрия') && tabs.make.includes('Деформации') && tabs.make.includes('Плат') && tabs.view.includes('Материал') && tabs.view.includes('Симетрия') && !tabs.model.includes('Материал'), tabs);
await page.waitForTimeout(700);
await page.reload(); await page.waitForFunction(() => window.__glina && window.__glina.mesh);
const after = await G(() => ({ tab: document.querySelector('#drawerTabs [aria-selected=true]').dataset.tab, rail: [...document.querySelectorAll('#rail .tool[data-tool]')].map((e) => e.dataset.tool) }));
check('after a reload: the same tab and the starred brush still in the rail', after.tab === 'view' && after.rail.includes('zmodel'), after);
// the file menu opens files too
await page.click('#bExport');
const menu = await G(() => [...document.querySelectorAll('#menu button')].map((b) => b.firstChild.textContent));
check('„Файл“: open, save the project, then the exports', menu[0] === 'Отвори…' && menu[1].startsWith('Запази проекта') && menu.some((t) => t.startsWith('OBJ')), menu);
await page.keyboard.press('Escape');
await page.close();

// a phone: a long press on a brush opens its settings; the hint speaks of fingers
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const ph = await ctx.newPage();
ph.on('pageerror', (e) => errors.push(String(e)));
await ph.goto(URL_);
await ph.waitForFunction(() => window.__glina && window.__glina.mesh);
const hint = await ph.evaluate(() => document.getElementById('hintText').textContent);
check('on a phone the hint is about fingers, not keys', /пръст/.test(hint) && !/Ctrl/.test(hint), hint.slice(0, 60));
const el = await ph.$('#rail .tool[data-tool=smooth]'); const bb = await el.boundingBox();
await ph.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
const tapped = await ph.evaluate(() => ({ tool: window.__glina.S.tool, open: !document.getElementById('brushPanel').hidden }));
// a long press: pointerdown held for 0.6 s
await ph.evaluate(async () => {
  const t = document.querySelector('#rail .tool[data-tool=grab]');
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  await new Promise((r) => setTimeout(r, 650));
  t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
});
const held = await ph.evaluate(() => ({ tool: window.__glina.S.tool, open: !document.getElementById('brushPanel').hidden, name: document.getElementById('brushName').textContent }));
check('a tap chooses a brush; a long press opens its settings', tapped.tool === 'smooth' && !tapped.open && held.tool === 'grab' && held.open, { tapped, held });
await ctx.close();

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
