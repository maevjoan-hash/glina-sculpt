// Copies the offline single-file app (../dist/glina.html) and the window icon into desktop/app/,
// which electron-builder packs into app.asar. The app source stays in ../index.html only.
// Also puts the 1024 px icon into desktop/icons/icon.png: from a folder with a single icon.png,
// electron-builder makes the Linux icon set (16...512 px, the sizes the hicolor theme knows).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '..');
const page = path.join(ROOT, 'dist', 'glina.html');
const icon = path.join(ROOT, 'build', 'icons', 'icon-512.png');
const out = path.join(DESKTOP, 'app');
const iconsOut = path.join(DESKTOP, 'icons');

if (!fs.existsSync(page)) {
  console.error('Липсва dist/glina.html. Първо сглобете уеб версията:\n  cd build && npm ci && node build.mjs');
  process.exit(1);
}
if (fs.statSync(path.join(ROOT, 'index.html')).mtimeMs > fs.statSync(page).mtimeMs) {
  console.warn('Внимание: index.html е по-нов от dist/glina.html. Пуснете отново build/build.mjs.');
}
const webVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'package.json'), 'utf8')).version;
const deskVersion = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).version;
if (webVersion !== deskVersion) console.warn(`Внимание: версиите се различават (build ${webVersion}, desktop ${deskVersion}).`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
fs.copyFileSync(page, path.join(out, 'glina.html'));
fs.copyFileSync(icon, path.join(out, 'icon.png'));
fs.rmSync(iconsOut, { recursive: true, force: true });
fs.mkdirSync(iconsOut);
fs.copyFileSync(path.join(ROOT, 'build', 'icons', 'icon-1024.png'), path.join(iconsOut, 'icon.png'));
console.log(`Глина: app/glina.html (${(fs.statSync(page).size / 1024).toFixed(0)} KB), app/icon.png и icons/icon.png са готови.`);
