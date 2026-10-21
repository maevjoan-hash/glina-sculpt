// Copies the finished web build (../dist/web, made by ../build/build.mjs) into www/,
// the folder Capacitor packs into the APK. The app source is never duplicated here.
// sw.js is left out: inside the Android app the files are already on the device, and
// index.html does not register a service worker when window.Capacitor exists.
// Usage: node scripts/copy-web.mjs   (then: npx cap sync android)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'dist', 'web');
const DEST = path.resolve(HERE, '..', 'www');
const SKIP = new Set(['sw.js']);

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error(`Няма ${path.join(SRC, 'index.html')}.\nПърво сглобете уеб версията: cd ../build && npm ci && node build.mjs`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
let count = 0;
(function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (e.isFile()) { fs.copyFileSync(a, b); count++; }
  }
})(SRC, DEST);
console.log(`www/: ${count} файла от dist/web`);
