// Smoke test of the Linux desktop app, headless:
//   xvfb-run -a node test/smoke.mjs            tests the packaged app in out/linux-unpacked/
//   xvfb-run -a node test/smoke.mjs --dev      tests `electron .` (after npm run prepare-app)
//   xvfb-run -a node test/smoke.mjs --exe P    tests another build of the app, e.g. glina from an unpacked .deb
// (keep TMPDIR short: Chromium puts its single-instance socket there and the path must be < 108 bytes)
// Checks: the page loads offline (no DNS, sockets or http requests), window settings, the model is drawn
// (also after a lost WebGL context), a pen stroke with pressure changes the mesh, Ctrl+Z restores it, OBJ
// export goes through will-download and the Save dialog (stubbed) with the right file name, F11 fullscreen,
// permissions/popups/navigation are denied, the autosave survives a restart, a second instance exits,
// and there are no console errors.
// Machines without a GPU (CI, containers): Chromium's first GPU process fails there and is restarted in
// software mode, which loses the page's first WebGL context (the app redraws after the restore, but three.js
// logs a shader error). The test therefore passes --disable-gpu, which goes straight to that same software
// mode. GLINA_TEST_GPU=1 runs with the app's own default flags instead.
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const exeArg = process.argv.indexOf('--exe');
const exe = dev ? path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron')
  : exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : path.join(DESKTOP, 'out', 'linux-unpacked', 'glina');
const appArgs = dev ? [DESKTOP] : [];
// Chromium refuses to start as root with its sandbox (containers, CI as root)
const sandboxArgs = process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [];
const gpuArgs = process.env.GLINA_TEST_GPU === '1' ? [] : ['--disable-gpu'];

// GLINA_TEST_DIR: where the test keeps its throw-away HOME, net log and exported file (default: the temp dir)
const tmp = fs.mkdtempSync(path.join(process.env.GLINA_TEST_DIR || os.tmpdir(), 'glina-test-'));
const env = { ...process.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, '.config') };
delete env.ELECTRON_RUN_AS_NODE;
const netlog = path.join(tmp, 'netlog.json');
const netlog2 = path.join(tmp, 'netlog2.json');

const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok: !!ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  ' + JSON.stringify(evidence) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chromium's --log-net-log JSON; if the app was killed the closing brackets may be missing
function readNetLog(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  try { return JSON.parse(text); } catch (e) { return JSON.parse(text.replace(/,\s*$/, '') + ']}'); }
}

// Chromium's own record of network activity: DNS lookups, TCP connects and URLs (the test's example.com is allowed)
function netCheck(name, file) {
  const nl = readNetLog(file);
  const typeName = Object.fromEntries(Object.entries(nl.constants.logEventTypes).map(([k, v]) => [v, k]));
  const urls = [...new Set(nl.events.map((e) => e.params && e.params.url).filter(Boolean))];
  const remoteUrls = urls.filter((u) => !/^(file|blob|data|devtools|chrome|about):/i.test(u) && u !== 'https://example.com/');
  const dns = nl.events.filter((e) => /^HOST_RESOLVER/.test(typeName[e.type]));
  const connects = nl.events.filter((e) => typeName[e.type] === 'TCP_CONNECT');
  check(name, dns.length === 0 && connects.length === 0 && remoteUrls.length === 0, { events: nl.events.length, dns: dns.length, tcpConnect: connects.length, remoteUrls });
}

async function launch(extraArgs = []) {
  const app = await electron.launch({ executablePath: exe, args: [...appArgs, ...sandboxArgs, ...gpuArgs, ...extraArgs], env, timeout: 60000 });
  const log = [];
  app.process().stdout.on('data', (d) => log.push(String(d)));
  app.process().stderr.on('data', (d) => log.push(String(d)));
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForFunction(() => window.__glina && window.__glina.mesh && window.__glina.mesh.pos.length > 0, null, { timeout: 60000 });
  return { app, page, log, errors };
}

// a weighted sum of all vertex positions: changes when any vertex moves
const meshSum = (page) => page.evaluate(() => {
  const p = window.__glina.mesh.pos; let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i] * ((i % 7) + 1);
  return s;
});
const maxMove = (page, before) => page.evaluate((b) => {
  const p = window.__glina.mesh.pos; let m = 0;
  for (let i = 0; i < p.length; i += 3) m = Math.max(m, Math.hypot(p[i] - b[i], p[i + 1] - b[i + 1], p[i + 2] - b[i + 2]));
  return m;
}, before);
const snapshot = (page) => page.evaluate(() => Array.from(window.__glina.mesh.pos));
// share of bright pixels in the middle of the 3D view, from the composited window (capturePage)
const litShare = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]; const [cw, ch] = w.getContentSize();
  const img = await w.webContents.capturePage({ x: Math.round(cw * 0.25), y: Math.round(ch * 0.3), width: Math.round(cw * 0.4), height: Math.round(ch * 0.5) });
  const bmp = img.toBitmap(); let lit = 0;
  for (let i = 0; i < bmp.length; i += 4) if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 200) lit++;
  return Math.round((lit / (bmp.length / 4)) * 1000) / 1000;
});
const frames = (page, n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);

// synthetic stroke: PointerEvents with pointerType 'pen' dispatched on the canvas
async function penStroke(page, pressure) {
  await page.evaluate(async (pr) => {
    const c = document.getElementById('gl'); const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, x, y, p, buttons) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'pen', isPrimary: true,
      clientX: x, clientY: y, pressure: p, buttons, button: type === 'pointermove' ? -1 : 0,
    });
    c.dispatchEvent(ev('pointerdown', cx - 60, cy, pr, 1));
    for (let i = 1; i <= 30; i++) {
      c.dispatchEvent(ev('pointermove', cx - 60 + i * 4, cy + Math.sin(i / 4) * 12, pr, 1));
      await new Promise((res) => requestAnimationFrame(res));
    }
    c.dispatchEvent(ev('pointerup', cx + 60, cy, 0, 0));
  }, pressure);
  await frames(page, 10);
}

let failed = false;
try {
  // ---------------- first run ----------------
  const { app, page, log, errors } = await launch([`--log-net-log=${netlog}`]);
  check('page loads, window.__glina.mesh exists', true, { url: page.url().replace(/^.*\/resources\//, '…/resources/'), vertices: await page.evaluate(() => window.__glina.mesh.pos.length / 3) });

  const win = await app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows()[0]; const wp = w.webContents.getLastWebPreferences();
    return { title: w.getTitle(), size: w.getSize(), min: w.getMinimumSize(), bg: w.getBackgroundColor(), menu: Menu.getApplicationMenu(),
      contextIsolation: wp.contextIsolation, nodeIntegration: wp.nodeIntegration, sandbox: wp.sandbox, spellcheck: wp.spellcheck, count: BrowserWindow.getAllWindows().length };
  });
  check('window: title Глина, 1400x900, min size, #121519, no menu, isolated+sandboxed', win.title === 'Глина' && win.size[0] === 1400 && win.size[1] === 900 && win.min[0] > 0 && win.bg.toLowerCase() === '#121519' && win.menu === null && win.contextIsolation && !win.nodeIntegration && win.sandbox && win.count === 1, win);
  check('no Node.js in the page', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));
  // with the app's default flags on a machine without a usable GPU the first context is lost and restored ~1 s later
  await sleep(2000);   // (a loss may still be on its way)
  await page.waitForFunction(() => {
    const c = document.getElementById('gl'); const g = c.getContext('webgl2') || c.getContext('webgl');
    return g && !g.isContextLost();
  }, null, { timeout: 15000 });
  const gl = await page.evaluate(() => {
    const c = document.getElementById('gl'); const g = c.getContext('webgl2') || c.getContext('webgl');
    return g ? `${g.getParameter(g.VERSION)} / ${g.getParameter(g.RENDERER)}` : null;
  });
  const gpu = await app.evaluate(({ app: a }) => a.getGPUFeatureStatus());
  check('WebGL works', !!gl, { gl, webgl: gpu.webgl, gpu_compositing: gpu.gpu_compositing });
  await sleep(500);
  const drawn0 = await litShare(app);
  check('the model is drawn in the 3D view', drawn0 > 0.3, { litShare: drawn0 });
  // a lost WebGL context (GPU reset, driver fallback) must come back with the model drawn, without any input
  await page.evaluate(async () => {
    const c = document.getElementById('gl'); const g = c.getContext('webgl2') || c.getContext('webgl');
    const ext = g.getExtension('WEBGL_lose_context');
    const restored = new Promise((r) => c.addEventListener('webglcontextrestored', r, { once: true }));
    ext.loseContext(); await new Promise((r) => setTimeout(r, 300)); ext.restoreContext(); await restored;
  });
  await sleep(800);
  const drawn1 = await litShare(app);
  check('after a lost + restored WebGL context the model is drawn again', drawn1 > 0.3, { litShare: drawn1 });

  // record what the canvas receives
  await page.evaluate(() => {
    window.__seen = [];
    const c = document.getElementById('gl');
    for (const t of ['pointerdown', 'pointermove']) c.addEventListener(t, (e) => window.__seen.push([e.type, e.pointerType, Math.round(e.pressure * 100) / 100]), true);
  });

  const s0 = await meshSum(page); const base = await snapshot(page);
  await penStroke(page, 0.15);
  const light = await maxMove(page, base); const s1 = await meshSum(page);
  check('synthetic pen stroke (pressure 0.15) changes the mesh', s1 !== s0 && light > 0, { maxVertexMove: light });
  await page.keyboard.press('Control+z'); await frames(page, 5);
  check('Ctrl+Z restores the mesh', (await meshSum(page)) === s0);
  await penStroke(page, 1.0);
  const heavy = await maxMove(page, base);
  check('pressure matters: pressure 1.0 moves the surface more than 0.15', heavy > light * 1.3, { light, heavy });
  await page.keyboard.press('Control+z'); await frames(page, 5);
  check('Ctrl+Z again', (await meshSum(page)) === s0);

  // real input through Chromium's input pipeline (CDP Input.dispatchMouseEvent, pointerType pen, force)
  const cdp = await page.context().newCDPSession(page);
  const box = await page.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(() => { window.__seen.length = 0; });
  const m = (type, x, y, force, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force, ...extra });
  await m('mouseMoved', box.x - 50, box.y, 0, { buttons: 0, button: 'none' });
  await m('mousePressed', box.x - 50, box.y, 0.7);
  for (let i = 1; i <= 25; i++) { await m('mouseMoved', box.x - 50 + i * 4, box.y + i, 0.7); await frames(page, 1); }
  await m('mouseReleased', box.x + 50, box.y + 25, 0);
  await frames(page, 10);
  const seen = await page.evaluate(() => window.__seen);
  const downs = seen.filter((e) => e[0] === 'pointerdown');
  const moves = seen.filter((e) => e[0] === 'pointermove' && e[2] > 0);
  check('Chromium input pipeline delivers pointerType "pen" with pressure', downs.length === 1 && downs[0][1] === 'pen' && Math.abs(downs[0][2] - 0.7) < 0.02 && moves.length > 0 && moves.every((e) => e[1] === 'pen'), { pointerdown: downs, sampleMove: moves[0] });
  const s2 = await meshSum(page);
  check('real pen stroke changes the mesh', s2 !== s0);
  await page.keyboard.press('Control+z'); await frames(page, 5);
  check('Ctrl+Z restores it', (await meshSum(page)) === s0);

  // OBJ export: will-download -> Save dialog (stubbed here) -> file written
  const target = path.join(tmp, 'saved', 'export-test.obj');
  fs.mkdirSync(path.dirname(target));
  const docs = await app.evaluate(({ app: a, dialog }, t) => {
    globalThis.__saveCalls = [];
    dialog.showSaveDialogSync = (w, opts) => { globalThis.__saveCalls.push(opts || w); return t; };
    return a.getPath('documents');
  }, target);
  await page.click('#bExport');
  await page.click('#menu button:has-text("OBJ с цветовете")');
  let size = -1;
  for (let i = 0; i < 100; i++) { await sleep(100); if (fs.existsSync(target)) { const s = fs.statSync(target).size; if (s > 0 && s === size) break; size = s; } }
  const calls = await app.evaluate(() => globalThis.__saveCalls);
  const obj = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const counts = await page.evaluate(() => ({ v: window.__glina.mesh.pos.length / 3, f: window.__glina.mesh.idx.length / 3 }));
  const vLines = (obj.match(/^v /gm) || []).length, fLines = (obj.match(/^f /gm) || []).length;
  check('OBJ export opens the Save dialog in Documents with the suggested name', calls.length === 1 && calls[0].defaultPath === path.join(docs, 'glina-model.obj') && calls[0].filters[0].extensions[0] === 'obj', calls[0]);
  check('OBJ file is written where the dialog said, with every vertex and face', vLines === counts.v && fLines === counts.f, { bytes: obj.length, vLines, fLines });

  check('no console errors (run 1)', errors.length === 0, errors);

  // nothing may leave the window
  const popup = await page.evaluate(() => window.open('https://example.com/') === null);
  await page.evaluate(() => { location.href = 'https://example.com/'; });
  await sleep(800);
  const stillHome = /\/glina\.html$/.test(page.url());
  const notif = await page.evaluate(() => Notification.requestPermission());
  const geo = await page.evaluate(() => new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('granted'), (e) => r(e.code), { timeout: 5000 })));
  const camState = await page.evaluate(() => navigator.permissions.query({ name: 'camera' }).then((s) => s.state, (e) => e.name));
  const cam = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', (e) => e.name));
  const fetchRes = await page.evaluate(() => fetch('https://example.com/').then(() => 'loaded', () => 'blocked'));
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  // (getUserMedia may say NotFoundError on a machine without a camera; either way nothing is granted)
  check('window.open denied, navigation away denied, permissions denied, http blocked',
    popup && stillHome && notif === 'denied' && geo === 1 && camState === 'denied' && cam !== 'granted' && fetchRes === 'blocked' && windows === 1,
    { popup, stillHome, notif, geolocation: geo === 1 ? 'PERMISSION_DENIED' : geo, camState, cam, fetchRes, windows });
  const unexpected = errors.filter((t) => !/ERR_BLOCKED_BY_CLIENT/.test(t));
  check('the blocked request is the only new console error', unexpected.length === 0, errors);

  // F11 fullscreen toggle. Playwright's keyboard (CDP) skips the browser-side key handling, so the key is sent
  // with webContents.sendInputEvent, which goes through before-input-event like a real key press.
  const f11 = () => app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  const isFs = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  await f11(); await sleep(1000); const fsOn = await isFs();
  await f11(); await sleep(1000); const fsOff = await isFs();
  check('F11 toggles fullscreen', fsOn && !fsOff, { on: fsOn, off: fsOff });

  // last stroke, kept for the restart check
  await penStroke(page, 0.8);
  const kept = await meshSum(page);
  await sleep(3500);   // autosave runs 2.5 s after the last change
  await app.close();

  const blocked = log.join('').match(/blocked network request \S+/g) || [];
  check('only the test\'s own fetch was blocked (nothing else tried the network)', blocked.length === 1 && blocked[0].endsWith('https://example.com/'), blocked);
  netCheck('net log (first launch, fresh profile): zero DNS lookups, zero outgoing connections, no remote URLs', netlog);

  // ---------------- second run: autosave restored, second instance exits ----------------
  const run2 = await launch([`--log-net-log=${netlog2}`]);
  await sleep(500);
  check('autosave (IndexedDB, file://) restores the model after restart', (await meshSum(run2.page)) === kept);
  const second = spawn(exe, [...appArgs, ...sandboxArgs, ...gpuArgs], { env, stdio: 'ignore' });
  const code = await Promise.race([new Promise((r) => second.on('exit', (c) => r(c))), sleep(15000).then(() => 'still running')]);
  if (code === 'still running') second.kill();
  const count = await run2.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check('single instance: a second launch exits, still one window', code === 0 && count === 1, { exitCode: code, windows: count });
  check('no console errors (run 2)', run2.errors.length === 0, run2.errors);
  await run2.app.close();
  netCheck('net log (second launch, existing profile): zero DNS lookups, zero outgoing connections', netlog2);
} catch (e) {
  console.error(e);
  check('test ran to the end', false, String(e && e.message || e));
}
failed = results.some((r) => !r.ok);
fs.writeFileSync(path.join(tmp, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed (${dev ? 'electron .' : exe}); details in ${path.join(tmp, 'results.json')}`);
process.exit(failed ? 1 : 0);
