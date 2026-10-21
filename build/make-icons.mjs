// Draws the app icons (wax sphere on dark ground) with headless Chromium.
// Usage: node make-icons.mjs   (needs Playwright; the PNGs are kept in icons/, so this is rarely needed)
import { chromium } from 'playwright';  // npm i -D playwright
import path from 'path';
import { fileURLToPath } from 'url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icons');
const draw = (size, maskable) => `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="${size}" height="${size}"></canvas><script>
const s = ${size}, g = document.getElementById('c').getContext('2d');
const bg = g.createLinearGradient(0, 0, 0, s); bg.addColorStop(0, '#232932'); bg.addColorStop(1, '#14171c');
g.fillStyle = bg;
if (${maskable}) g.fillRect(0, 0, s, s);
else { const r = s * 0.22; g.beginPath(); g.roundRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92, r); g.fill(); }
const R = s * (${maskable} ? 0.27 : 0.32), cx = s / 2, cy = s * 0.52;
const sh = g.createRadialGradient(cx, cy + R * 1.05, R * 0.1, cx, cy + R * 1.05, R * 1.1);
sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
g.fillStyle = sh; g.beginPath(); g.ellipse(cx, cy + R * 1.02, R * 1.05, R * 0.28, 0, 0, Math.PI * 2); g.fill();
const wax = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
wax.addColorStop(0, '#ffe3a8'); wax.addColorStop(0.35, '#e7ad4b'); wax.addColorStop(0.8, '#9a6219'); wax.addColorStop(1, '#5a370c');
g.fillStyle = wax; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
// a sculpted groove across the sphere
g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
g.lineCap = 'round'; g.lineWidth = R * 0.13;
g.strokeStyle = 'rgba(70,40,8,0.55)'; g.beginPath(); g.moveTo(cx - R * 0.95, cy + R * 0.18); g.bezierCurveTo(cx - R * 0.3, cy - R * 0.25, cx + R * 0.3, cy + R * 0.55, cx + R * 0.95, cy + R * 0.05); g.stroke();
g.lineWidth = R * 0.05; g.strokeStyle = 'rgba(255,236,190,0.55)'; g.beginPath(); g.moveTo(cx - R * 0.95, cy + R * 0.08); g.bezierCurveTo(cx - R * 0.3, cy - R * 0.35, cx + R * 0.3, cy + R * 0.45, cx + R * 0.95, cy - R * 0.05); g.stroke();
g.restore();
</script></body></html>`;
const browser = await chromium.launch();
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['icon-1024.png', 1024, false]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });   // fresh page: the script's consts must not collide
  await page.setContent(draw(size, maskable));
  await page.locator('#c').screenshot({ path: path.join(OUT, name), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written to', OUT);
