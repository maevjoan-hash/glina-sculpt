// Tests the web app exactly as the APK carries it (android/app/src/main/assets/public, made by
// `npm run sync`) in Chromium, with the native (Java) side of Capacitor imitated:
//
// 1. Service worker: dist/web registers sw.js in an ordinary browser, but not when window.Capacitor
//    exists, and the APK's copy has no sw.js at all.
// 2. Simple stand-in: window.Capacitor = { isNativePlatform() -> true, Plugins: { Filesystem, Share } }
//    is set before the page's scripts. Export -> OBJ / STL from the menu; Filesystem.writeFile must
//    get the right file as base64 in CACHE, and Share.share the uri that writeFile returned.
//    A cancelled share shows no error; a failed write shows a Bulgarian error.
// 3. The real Capacitor 8 bridge: the page is served from https://localhost with the same <script>
//    that Capacitor's JSInjector puts after <head> on Android (the globals, native-bridge.js from
//    @capacitor/android, and the plugin proxies JSExport.getPluginJS writes for every registered
//    plugin). window.androidBridge plays the native side and answers the way MessageHandler does.
//    A pen stroke with pressure through Chromium's input pipeline (as the WebView gets it from an
//    S Pen), then both exports through window.Capacitor.Plugins.
//
// Usage: npm run sync && npm test
// Browser: CHROME_PATH=/path/to/chrome, otherwise Playwright's Chromium, otherwise the installed Google Chrome.
import { chromium } from 'playwright-core';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ANDROID = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_WEB = path.resolve(ANDROID, '..', 'dist', 'web');
const WWW = path.join(ANDROID, 'www');
const ASSETS = path.join(ANDROID, 'android', 'app', 'src', 'main', 'assets');
const PUBLIC = path.join(ASSETS, 'public');
const CAP_ANDROID = path.join(ANDROID, 'node_modules', '@capacitor', 'android', 'capacitor', 'src', 'main');
const CACHE_DIR = 'file:///data/user/0/bg.glina.sculpt/cache/';

const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  ' + JSON.stringify(evidence) : ''}`);
}

// ---------- files ----------
for (const p of [path.join(DIST_WEB, 'index.html'), path.join(PUBLIC, 'index.html')]) {
  if (!fs.existsSync(p)) { console.error(`Missing ${p}. Run: (cd ../build && node build.mjs) && npm run sync`); process.exit(2); }
}
const distIndex = fs.readFileSync(path.join(DIST_WEB, 'index.html'));
check('www/index.html is byte-identical to dist/web/index.html', fs.readFileSync(path.join(WWW, 'index.html')).equals(distIndex));
check('APK asset public/index.html is byte-identical to dist/web/index.html', fs.readFileSync(path.join(PUBLIC, 'index.html')).equals(distIndex));
check('no sw.js in www/ or in the APK assets', !fs.existsSync(path.join(WWW, 'sw.js')) && !fs.existsSync(path.join(PUBLIC, 'sw.js')));

// ---------- local http server: /web/ = dist/web, /apk/ = the APK's public folder ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const served = [];
function fileFor(root, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  return file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  served.push(u.pathname);
  const m = u.pathname.match(/^\/(web|apk)(\/.*)$/);
  const file = m && fileFor(m[1] === 'web' ? DIST_WEB : PUBLIC, m[2]);
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------- the <script> Capacitor injects into index.html on Android (Bridge.getJSInjector) ----------
function pluginSource(dir, className) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === className + '.java' || e.name === className + '.kt') return fs.readFileSync(p, 'utf8');
    }
  }
  throw new Error(`source of ${className} not found in ${dir}`);
}
function pluginHandle(src, className) {
  const ann = src.match(/@CapacitorPlugin\s*(\(([\s\S]*?)\))?\s*(public\s+)?class\s/);
  const named = ann && ann[2] && ann[2].match(/\bname\s*=\s*"([^"]+)"/);
  const methods = [...src.matchAll(/@PluginMethod\s*(?:\(([^)]*)\))?\s+(?:public\s+)?(?:void\s+|fun\s+)(\w+)\s*\(/g)]
    .map((m) => ({ name: m[2], rtype: /RETURN_CALLBACK/.test(m[1] || '') ? 'callback' : /RETURN_NONE/.test(m[1] || '') ? 'none' : 'promise' }));
  return { id: named ? named[1] : className, methods };
}
// same text as JSExport.getPluginJS / generateMethodJS
function pluginJS(plugins) {
  const lines = ['// Begin: Capacitor Plugin JS'];
  for (const p of plugins) {
    lines.push(`(function(w) {\nvar a = (w.Capacitor = w.Capacitor || {});\nvar p = (a.Plugins = a.Plugins || {});\nvar t = (p['${p.id}'] = {});\nt.addListener = function(eventName, callback) {\n  return w.Capacitor.addListener('${p.id}', eventName, callback);\n}`);
    for (const m of p.methods) {
      if (m.name === 'addListener' || m.name === 'removeListener') continue;
      const args = m.rtype === 'callback' ? '_options, _callback' : '_options';
      const call = m.rtype === 'promise' ? `return w.Capacitor.nativePromise('${p.id}', '${m.name}', _options)`
        : m.rtype === 'callback' ? `return w.Capacitor.nativeCallback('${p.id}', '${m.name}', _options, _callback)`
        : `return w.Capacitor.nativeCallback('${p.id}', '${m.name}', _options)`;
      lines.push(`t['${m.name}'] = function(${args}) {\n${call}\n}`);
    }
    lines.push('})(window);\n');
  }
  const headers = plugins.map((p) => ({ name: p.id, methods: p.methods.map((m) => (m.rtype === 'none' ? { name: m.name } : { name: m.name, rtype: m.rtype })) }));
  return lines.join('\n') + '\nwindow.Capacitor.PluginHeaders = ' + JSON.stringify(headers) + ';';
}
const builtIn = ['CapacitorCookies', 'WebView', 'CapacitorHttp', 'SystemBars']
  .map((c) => pluginHandle(pluginSource(path.join(CAP_ANDROID, 'java', 'com', 'getcapacitor', 'plugin'), c), c));
const installed = JSON.parse(fs.readFileSync(path.join(ASSETS, 'capacitor.plugins.json'), 'utf8')).map((e) => {
  const cls = e.classpath.split('.').pop();
  return pluginHandle(pluginSource(path.join(ANDROID, 'node_modules', ...e.pkg.split('/'), 'android', 'src', 'main'), cls), cls);
});
const readAsset = (rel) => (fs.existsSync(path.join(ASSETS, rel)) ? fs.readFileSync(path.join(ASSETS, rel), 'utf8') : '');
const injected = [
  'window.Capacitor = { DEBUG: true, isLoggingEnabled: true, Plugins: {} };', // a debug APK
  "window.WEBVIEW_SERVER_URL = 'https://localhost';",
  fs.readFileSync(path.join(CAP_ANDROID, 'assets', 'native-bridge.js'), 'utf8'),
  pluginJS([...builtIn, ...installed]),
  readAsset('public/cordova.js'), readAsset('public/cordova_plugins.js'), '',
].join('\n\n');
const fsPlugin = installed.find((p) => p.id === 'Filesystem'), sharePlugin = installed.find((p) => p.id === 'Share');
check('the APK registers the Filesystem and Share plugins with writeFile, appendFile and share',
  fsPlugin && sharePlugin && ['writeFile', 'appendFile'].every((n) => fsPlugin.methods.some((m) => m.name === n && m.rtype === 'promise')) && sharePlugin.methods.some((m) => m.name === 'share'),
  { plugins: [...builtIn, ...installed].map((p) => p.id) });

// ---------- page helpers ----------
const FAKE_CAPACITOR = `
  window.__calls = []; window.__mode = 'ok';
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    Plugins: {
      Filesystem: {
        writeFile: async (o) => { window.__calls.push(['writeFile', o]); if (window.__mode === 'nospace') throw new Error('No space left on device'); return { uri: '${CACHE_DIR}' + o.path }; },
        appendFile: async (o) => { window.__calls.push(['appendFile', o]); },
      },
      Share: { share: async (o) => { window.__calls.push(['share', o]); if (window.__mode === 'cancel') throw new Error('Share canceled'); return { activityType: 'com.example.files' }; } },
    },
  };`;
const FAKE_NATIVE = `
  window.__msgs = [];
  window.androidBridge = {
    postMessage(json) {
      const m = JSON.parse(json); window.__msgs.push(m);
      let data = {};
      if (m.pluginId === 'Filesystem' && m.methodName === 'writeFile') data = { uri: '${CACHE_DIR}' + m.options.path };
      // appendFile answers with no data
      if (m.pluginId === 'Share' && m.methodName === 'share') data = { activityType: 'com.example.files' };
      const reply = { save: false, callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data };
      setTimeout(() => window.androidBridge.onmessage({ data: JSON.stringify(reply) }), 5);
    },
  };`;

async function launchBrowser() {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  try { return await chromium.launch({ args }); } catch (e) { return chromium.launch({ channel: 'chrome', args }); }
}
const frames = (page, n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const ready = (page) => page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.mesh.n > 0, null, { timeout: 60000 });
const model = (page) => page.evaluate(() => {
  const m = window.__glina.mesh;
  return { n: m.n, f: m.f, pos: Array.from(m.pos.subarray(0, m.n * 3)), idx: Array.from(m.idx.subarray(0, m.f * 3)) };
});
async function exportFromMenu(page, label) {
  await page.click('#bExport');
  await page.locator('#menu button', { hasText: label }).click();
}

// ---------- file checks ----------
function objProblem(bytes, m) {
  const text = bytes.toString('utf8'), lines = text.split('\n');
  if (!lines[0].startsWith('# Глина')) return 'first line: ' + lines[0];
  const v = lines.filter((l) => l.startsWith('v ')), f = lines.filter((l) => l.startsWith('f '));
  if (v.length !== m.n || f.length !== m.f) return `counts v=${v.length} f=${f.length}, model ${m.n}/${m.f}`;
  for (let i = 0; i < m.n; i++) {
    const p = v[i].split(' ').slice(1, 4).map(Number);
    for (let k = 0; k < 3; k++) if (!(Math.abs(p[k] - m.pos[i * 3 + k]) <= 6e-7)) return `vertex ${i}: ${v[i]} vs ${m.pos.slice(i * 3, i * 3 + 3)}`;
  }
  for (let t = 0; t < m.f; t++) {
    const q = f[t].split(' ').slice(1).map(Number);
    if (q.length !== 3 || q.some((x, k) => x !== m.idx[t * 3 + k] + 1)) return `face ${t}: ${f[t]}`;
  }
  return null;
}
function stlProblem(buf, m) {
  if (buf.length !== 84 + 50 * m.f) return `size ${buf.length}, expected ${84 + 50 * m.f}`;
  if (buf.readUInt32LE(80) !== m.f) return `triangle count ${buf.readUInt32LE(80)}, model ${m.f}`;
  for (let t = 0; t < m.f; t++) {
    const o = 84 + t * 50;
    const nl = Math.hypot(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8));
    if (!(Math.abs(nl - 1) < 1e-4 || nl === 0)) return `triangle ${t}: normal length ${nl}`;
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
      const want = Math.fround(m.pos[m.idx[t * 3 + c] * 3 + k]), got = buf.readFloatLE(o + 12 + c * 12 + k * 4);
      if (got !== want) return `triangle ${t} corner ${c}: ${got} vs ${want}`;
    }
  }
  return null;
}
const isBase64 = (s) => typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
// The file arrives as writeFile (first part) + appendFile (the rest, 3 MB each) + share.
// Returns the joined bytes, or a description of what is wrong with the sequence.
function joinParts(parts, file) {
  if (!parts.length) return { problem: 'no writeFile' };
  const [first, ...rest] = parts;
  if (first.method !== 'writeFile') return { problem: 'first call is ' + first.method };
  for (const p of parts) {
    if (p !== first && p.method !== 'appendFile') return { problem: 'unexpected ' + p.method };
    if (p.o.path !== file || p.o.directory !== 'CACHE' || p.o.encoding !== undefined || !isBase64(p.o.data)) return { problem: 'bad options ' + JSON.stringify({ ...p.o, data: String(p.o.data).slice(0, 20) }) };
    if (p !== parts[parts.length - 1] && Buffer.from(p.o.data, 'base64').length !== 3 * 1024 * 1024) return { problem: 'a middle part is not 3 MB' };
  }
  return { bytes: Buffer.concat(parts.map((p) => Buffer.from(p.o.data, 'base64'))), count: parts.length, appends: rest.length };
}

let browser;
try {
  browser = await launchBrowser();
  check('browser', true, browser.version());

  // ---------------- 1. service worker ----------------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/web/`);
    const sw = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((r) => (r.active || r.waiting || r.installing).scriptURL),
      new Promise((r) => setTimeout(() => r(null), 15000)),
    ]));
    check('control: dist/web in an ordinary browser registers its service worker', sw && sw.endsWith('/web/sw.js'), sw);
    await ctx.close();
  }
  for (const where of ['web', 'apk']) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(FAKE_CAPACITOR);
    const page = await ctx.newPage();
    served.length = 0;
    await page.goto(`${ORIGIN}/${where}/`, { waitUntil: 'load' });
    await ready(page); await page.waitForTimeout(1500);
    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check(`with window.Capacitor no service worker registers (${where === 'web' ? 'dist/web, which has sw.js' : 'the APK assets'})`,
      regs === 0 && !served.some((p) => p.endsWith('/sw.js')), { registrations: regs, swRequested: served.filter((p) => p.endsWith('sw.js')) });
    await ctx.close();
  }

  // ---------------- 2. simple stand-in for window.Capacitor ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(FAKE_CAPACITOR);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${ORIGIN}/apk/`);
    await ready(page);
    for (const [label, file, kind] of [['OBJ', 'glina-model.obj', 'obj'], ['STL', 'glina-model.stl', 'stl']]) {
      await page.evaluate(() => { window.__calls.length = 0; });
      await exportFromMenu(page, label);
      await page.waitForFunction(() => window.__calls.some((c) => c[0] === 'share'), null, { timeout: 30000 });
      const calls = await page.evaluate(() => window.__calls);
      const m = await model(page);
      const s = calls[calls.length - 1];
      const j = joinParts(calls.slice(0, -1).map(([method, o]) => ({ method, o })), file);
      const problem = j.problem || (kind === 'obj' ? objProblem(j.bytes, m) : stlProblem(j.bytes, m));
      check(`stand-in: Export > ${label}: writeFile + appendFile parts in CACHE join into a correct ${label} of the model`,
        !problem, { problem, bytes: j.bytes && j.bytes.length, parts: j.count, vertices: m.n, triangles: m.f });
      check(`stand-in: Export > ${label}: share() gets the uri writeFile returned`,
        s[0] === 'share' && s[1].url === CACHE_DIR + file && s[1].title === file && s[1].dialogTitle === 'Запази или изпрати модела', s[1]);
    }
    await page.evaluate(() => { window.__calls.length = 0; window.__mode = 'cancel'; document.getElementById('toast').textContent = ''; });
    await exportFromMenu(page, 'STL');
    await page.waitForFunction(() => window.__calls.some((c) => c[0] === 'share'), null, { timeout: 30000 }); await page.waitForTimeout(300);
    const cancelToast = await page.evaluate(() => document.getElementById('toast').textContent);
    check('stand-in: closing the share sheet ("Share canceled") shows no error', cancelToast === '', cancelToast);
    await page.evaluate(() => { window.__calls.length = 0; window.__mode = 'nospace'; });
    await exportFromMenu(page, 'STL');
    await page.waitForFunction(() => window.__calls.length >= 1, null, { timeout: 30000 }); await page.waitForTimeout(300);
    const failToast = await page.evaluate(() => document.getElementById('toast').textContent);
    check('stand-in: a failed write shows a Bulgarian error and does not open the share sheet',
      failToast.startsWith('Файлът не може да се запише') && (await page.evaluate(() => window.__calls.length)) === 1, failToast);
    check('stand-in: no uncaught page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ---------------- 3. the real Capacitor bridge, served like WebViewLocalServer ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const requested = [];
    await ctx.route('https://localhost/**', async (route) => {
      const u = new URL(route.request().url());
      requested.push(u.pathname);
      const file = fileFor(PUBLIC, u.pathname);
      if (!file) return route.fulfill({ status: 404, body: '' });
      let body = fs.readFileSync(file);
      if (path.basename(file) === 'index.html') {
        // JSInjector.getInjectedStream: the script goes right after the first <head>
        const html = body.toString('utf8');
        body = html.replace('<head>', () => '<head>\n<script type="text/javascript">' + injected + '</script>\n');
      }
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body });
    });
    await ctx.addInitScript(FAKE_NATIVE);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://localhost/');
    await ready(page);
    const env = await page.evaluate(() => ({
      platform: window.Capacitor.getPlatform(), native: window.Capacitor.isNativePlatform(),
      writeFile: typeof window.Capacitor.Plugins.Filesystem?.writeFile, share: typeof window.Capacitor.Plugins.Share?.share,
      touchAction: getComputedStyle(document.getElementById('gl')).touchAction,
    }));
    check('bridge: window.Capacitor is the Android bridge with Plugins.Filesystem.writeFile and Plugins.Share.share',
      env.platform === 'android' && env.native === true && env.writeFile === 'function' && env.share === 'function', env);
    check('the 3D view has touch-action: none, so pen and finger strokes are not taken for scrolling or zooming', env.touchAction === 'none', env.touchAction);

    // pen stroke with pressure through Chromium's input pipeline
    await page.evaluate(() => {
      window.__seen = [];
      for (const t of ['pointerdown', 'pointermove']) document.getElementById('gl').addEventListener(t, (e) => window.__seen.push([e.type, e.pointerType, Math.round(e.pressure * 100) / 100]), true);
    });
    const before = await model(page);
    const cdp = await ctx.newCDPSession(page);
    const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const pen = (type, x, y, force, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force, ...extra });
    await pen('mouseMoved', box.x - 50, box.y, 0, { buttons: 0, button: 'none' });
    await pen('mousePressed', box.x - 50, box.y, 0.7);
    for (let i = 1; i <= 25; i++) { await pen('mouseMoved', box.x - 50 + i * 4, box.y + i, 0.7); await frames(page, 1); }
    await pen('mouseReleased', box.x + 50, box.y + 25, 0);
    await frames(page, 10);
    const seen = await page.evaluate(() => window.__seen);
    const after = await model(page);
    let moved = 0;
    for (let i = 0; i < Math.min(before.pos.length, after.pos.length); i++) moved = Math.max(moved, Math.abs(after.pos[i] - before.pos[i]));
    const down = seen.find((e) => e[0] === 'pointerdown');
    check('bridge: a pen stroke reaches the canvas as pointerType "pen" with pressure 0.7 and sculpts the model',
      down && down[1] === 'pen' && Math.abs(down[2] - 0.7) < 0.02 && moved > 0, { pointerdown: down, maxMove: moved });

    for (const [label, file, kind] of [['OBJ', 'glina-model.obj', 'obj'], ['STL', 'glina-model.stl', 'stl']]) {
      await page.evaluate(() => { window.__msgs.length = 0; });
      await exportFromMenu(page, label);
      await page.waitForFunction(() => window.__msgs.some((m) => m.pluginId === 'Share'), null, { timeout: 30000 });
      await page.waitForTimeout(200);
      const msgs = (await page.evaluate(() => window.__msgs)).filter((m) => m.pluginId === 'Filesystem' || m.pluginId === 'Share');
      const m = await model(page);
      const s = msgs[msgs.length - 1];
      const fsMsgs = msgs.slice(0, -1);
      const j = fsMsgs.every((x) => x.pluginId === 'Filesystem') ? joinParts(fsMsgs.map((x) => ({ method: x.methodName, o: x.options })), file) : { problem: 'non-Filesystem message before share' };
      const problem = j.problem || (kind === 'obj' ? objProblem(j.bytes, m) : stlProblem(j.bytes, m));
      check(`bridge: Export > ${label} sends Filesystem.writeFile (+ appendFile parts) to native that join into a correct ${label} of the sculpted model`,
        !problem, { problem, bytes: j.bytes && j.bytes.length, parts: j.count, vertices: m.n, triangles: m.f });
      check(`bridge: then Share.share with the uri native returned`,
        s.pluginId === 'Share' && s.methodName === 'share' && s.options.url === CACHE_DIR + file && s.options.title === file && s.options.dialogTitle === 'Запази или изпрати модела',
        s.options);
    }
    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check('bridge: no service worker, sw.js never requested', regs === 0 && !requested.some((p) => p.endsWith('sw.js')), { registrations: regs });
    check('bridge: no uncaught page errors', errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  check('test run', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
