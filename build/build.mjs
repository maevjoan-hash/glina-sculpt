// Builds the offline versions of Глина from ../index.html (the single source):
//   dist/glina.html     one self-contained file: double-click to open, no internet needed
//   dist/web/           installable web app (PWA): index.html + manifest + service worker + icons
//   dist/artifact.html  the same page in the artifact format (no <html>/<head>, published online)
// Usage: node build.mjs        (from this folder, after `npm install`)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const take = (re, what) => { const m = src.match(re); if (!m) throw new Error('index.html: cannot find ' + what); return m; };

// ---------- pieces of the source page ----------
const title = take(/<title>[\s\S]*?<\/title>/, '<title>')[0];
const style = take(/<style>([\s\S]*?)<\/style>/, '<style>')[1];
const moduleJs = take(/<script type="module">([\s\S]*?)<\/script>/, 'the module script')[1];
const bodyStart = src.indexOf('<div id="app">');
const bodyEnd = src.indexOf('<script type="importmap">');
if (bodyStart < 0 || bodyEnd < 0) throw new Error('index.html: markup markers not found');
const markup = src.slice(bodyStart, bodyEnd).trim();

// ---------- bundle the app with three.js and three-mesh-bvh into one classic script ----------
const tmpDir = path.join(HERE, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const entry = path.join(tmpDir, 'app.js');
fs.writeFileSync(entry, moduleJs);
const bundled = await esbuild.build({
  entryPoints: [entry], bundle: true, write: false, format: 'iife', minify: true,
  target: ['chrome90', 'firefox90', 'safari15'], legalComments: 'none', logLevel: 'warning',
});
let js = bundled.outputFiles[0].text;
if (js.includes('</script')) js = js.replace(/<\/script/gi, '<\\/script');

// ---------- fonts as data URIs (Cyrillic + Latin subsets of the weights the page uses) ----------
const FONTS = [
  ['ibm-plex-sans', [400, 500, 600]],
  ['ibm-plex-mono', [400, 500]],
  ['unbounded', [600]],
];
let fontCss = '';
for (const [name, weights] of FONTS) {
  const dir = path.join(HERE, 'node_modules', '@fontsource', name);
  for (const w of weights) {
    const css = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
    for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
      const sub = block.match(/-(cyrillic|latin)-\d+-normal\.woff2/);
      if (!sub || /-ext-/.test(block.match(/url\(([^)]*)\.woff2\)/)[1])) continue;
      const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      const b64 = fs.readFileSync(path.join(dir, 'files', file)).toString('base64');
      fontCss += block
        .replace(/src:[^;]*;/, `src: url(data:font/woff2;base64,${b64}) format('woff2');`)
        .replace(/\s+/g, ' ') + '\n';
    }
  }
}

// ---------- standalone page ----------
const reset = `html,body{margin:0;height:100%}html{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}`;
const page = ({ pwa }) => `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${title}
<meta name="description" content="Безплатно 3D скулптиране със стилус. Работи без интернет.">
<meta name="theme-color" content="#1a1e24">
<meta name="color-scheme" content="dark">
<meta name="glina-version" content="${VERSION}">
${pwa ? '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icons/icon-192.png">\n<link rel="apple-touch-icon" href="icons/icon-192.png">' : ''}
<style>${fontCss}${reset}${style}</style>
</head>
<body>
${markup}
<script>${js}</script>
${pwa ? `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
</script>` : ''}
</body>
</html>
`;

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'web', 'icons'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'glina.html'), page({ pwa: false }));
fs.writeFileSync(path.join(DIST, 'web', 'index.html'), page({ pwa: true }));

// ---------- artifact format: content only, the host adds the document skeleton ----------
fs.writeFileSync(path.join(DIST, 'artifact.html'),
  `${title}\n<style>${fontCss}${style}</style>\n\n${markup}\n<script>${js}</script>\n`);

// ---------- PWA files ----------
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  fs.copyFileSync(path.join(HERE, 'icons', f), path.join(DIST, 'web', 'icons', f));
}
fs.writeFileSync(path.join(DIST, 'web', 'manifest.webmanifest'), JSON.stringify({
  name: 'Глина Sculpt',
  short_name: 'Глина',
  description: 'Безплатно 3D скулптиране със стилус. Работи без интернет.',
  lang: 'bg',
  start_url: './',
  scope: './',
  display: 'fullscreen',
  display_override: ['fullscreen', 'standalone'],
  orientation: 'any',
  background_color: '#121519',
  theme_color: '#1a1e24',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
fs.writeFileSync(path.join(DIST, 'web', 'sw.js'), `// Глина ${VERSION}: keeps the whole app on the device so it opens without internet.
const CACHE = 'glina-${VERSION}';
const FILES = ${JSON.stringify(PRECACHE)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// cache first: the app never needs the network once installed; a new version arrives with a new CACHE name
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('index.html'))));
});
`);

const kb = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + ' KB';
console.log(`Глина ${VERSION}: dist/glina.html ${kb('glina.html')}, dist/web/index.html ${kb('web/index.html')}, dist/artifact.html ${kb('artifact.html')}`);
