// The studio picture (light, a shadow on the floor) and your own matcap: node test/studio.mjs [out.png]
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const URL_ = pathToFileURL(path.join(ROOT, 'dist', 'glina.html')).href;
await page.goto(URL_);
await page.waitForFunction(() => window.__glina && window.__glina.mesh);
await page.evaluate(() => { document.getElementById('hintClose').click(); });
const G = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev !== undefined ? '  ' + JSON.stringify(ev) : ''}`); };

// a look from a little above, so the floor shows under the model
await G(() => { const W = window.__glina; W.newScene(W.makeGear(), 'Зъбно колело'); W.orbit(0, 90); });
const shot = await G(async () => {
  const W = window.__glina;
  const url = await W.studioPNG(1);
  const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, at = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  // where the model is on screen: its pixels are red-ish (the wax colour), the rest is floor or background
  let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 2] + 40) red++;
  // the floor: lighter far from the model than in its shadow right under it
  const lum = (p) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
  const corner = lum(at(8, c.height - 8));
  const state = { mat: W.gmesh.material === W.material, shadow: W.renderer.shadowMap.enabled, tone: W.renderer.toneMapping };
  return { w: c.width, h: c.height, red: red / (d.length / 4), corner, state, url };
});
if (process.argv[2]) fs.writeFileSync(process.argv[2], Buffer.from(shot.url.split(',')[1], 'base64'));
check('the studio picture shows the model in its own colour', shot.red > 0.05 && shot.w > 300, { red: shot.red, w: shot.w });
check('after it the view is as it was (matcap material, no shadows, no tone mapping)', shot.state.mat && !shot.state.shadow && shot.state.tone === 0, shot.state);
// the shadow: a picture with the floor lit and the model raised off it vs. the same with the model gone
const shade = await G(async () => {
  const W = window.__glina;
  const lumAt = async (hideModel) => {
    W.gmesh.visible = !hideModel;
    const url = await W.studioPNG(0.5);
    W.gmesh.visible = true;
    const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const a = await lumAt(false), b = await lumAt(true);
  // pixels that are floor in both (not red) but darker with the model there: its shadow
  let darker = 0, floor = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] > a[i + 2] + 40) continue;
    floor++;
    if (b[i] + b[i + 1] + b[i + 2] - (a[i] + a[i + 1] + a[i + 2]) > 30) darker++;
  }
  return { darker, floor };
});
check('the model casts a shadow on the floor', shade.darker > 200, shade);

// your own matcap: a green picture
const own = await G(async () => {
  const W = window.__glina;
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d');
  g.fillStyle = '#20c040'; g.fillRect(0, 0, 300, 200);
  await W.setCustomMatcap(c.toDataURL('image/png'));
  const sw = document.querySelectorAll('#matcaps .swatch');
  return { swatches: sw.length, pressed: sw[sw.length - 1].getAttribute('aria-pressed'), sel: W.S.matcap, base: W.customMatcap.base, tex: W.material.uniforms.matcap.value === W.matcapTextures[W.S.matcap], size: W.material.uniforms.matcap.value.image.width, drop: !document.getElementById('bMatDrop').hidden };
});
check('„Свой от снимка“ adds a swatch, selects it and uses its middle square', own.swatches === 7 && own.pressed === 'true' && own.sel === 6 && own.tex && own.size === 256 && own.base[1] > 0.7 && own.base[0] < 0.2 && own.drop, own);
// it stays for the next visit
await page.waitForTimeout(1200);
await page.reload();
await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.customMatcap);
await page.waitForFunction(() => window.__glina.S.matcap === 6);
const again = await G(() => ({ swatches: document.querySelectorAll('#matcaps .swatch').length, tex: window.__glina.material.uniforms.matcap.value === window.__glina.matcapTextures[6] }));
check('…and is there again after a reload, still chosen', again.swatches === 7 && again.tex, again);
const studioGreen = await G(async () => {
  const W = window.__glina; const url = await W.studioPNG(0.5);
  const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let green = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 20) green++;
  return green / (d.length / 4);
});
check('the studio picture takes its colour from your matcap', studioGreen > 0.03, { studioGreen });
await G(() => document.getElementById('bMatDrop').click());
const gone = await G(() => ({ swatches: document.querySelectorAll('#matcaps .swatch').length, sel: window.__glina.S.matcap, stored: localStorage.getItem('glina.matcap') }));
check('„Махни своя“ takes it away (back to the first matcap)', gone.swatches === 6 && gone.sel === 0 && gone.stored === null, gone);

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
