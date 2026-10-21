// Глина for Windows and Linux: one window that opens the offline single-file app (app/glina.html).
// The app never needs the network, so every request that is not a local file is blocked.
'use strict';
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_FILE = path.join(__dirname, 'app', 'glina.html');
const APP_URL = pathToFileURL(APP_FILE).href;
const ICON = path.join(__dirname, 'app', 'icon.png');

// Pen pressure needs no extra switches in Electron 44 (Chromium 152):
//   Windows: pen input arrives through Windows Ink (WM_POINTER), Chromium's default.
//   Linux X11: XInput2; a device with "Abs Pressure"/"Abs X" valuators (wacom or libinput driver) is a pen.
//   Linux Wayland: tablet-unstable-v2 (in Chromium since 140). Since Electron 38 --ozone-platform=auto is the
//   default, so in a Wayland session the app is a native Wayland client; the old --ozone-platform-hint=auto
//   switch is not needed. Start with --ozone-platform=x11 to force XWayland instead.
// WebGL is required: if the GPU is blocklisted or missing (old drivers, virtual machines), allow Chromium's
// software renderer. It is called "unsafe" because of untrusted web pages; this window only shows our own file.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#121519', title: 'Глина', icon: ICON, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());   // keep the window title "Глина"
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // stay on the app file (a dropped file or a link would otherwise replace the app)
  const stayHome = (e, url) => { if (url.split('#')[0] !== APP_URL) e.preventDefault(); };
  wc.on('will-navigate', stayHome);
  wc.on('will-redirect', stayHome);
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.on('closed', () => { win = null; });
  win.loadFile(APP_FILE);
}

function secureSession(ses) {
  // No spell checker. Clearing its languages also stops the Hunspell dictionary download that Chromium
  // otherwise starts on Linux at the first launch (it bypasses webRequest).
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  // offline by design: only the local file and in-memory data (blob:, data:) may load
  ses.webRequest.onBeforeRequest((details, callback) => {
    const local = /^(file|blob|data|devtools):/i.test(details.url);
    if (!local) console.warn('Глина: blocked network request', details.url);
    callback({ cancel: !local });
  });
  // export (OBJ/STL) arrives as a download: ask where to save it, starting in Documents
  ses.on('will-download', (event, item, wc) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    const filters = ext ? [{ name: `${ext.toUpperCase()} файл`, extensions: [ext] }, { name: 'Всички файлове', extensions: ['*'] }] : [];
    const target = dialog.showSaveDialogSync(BrowserWindow.fromWebContents(wc) || win, {
      title: 'Запазване на модела', defaultPath: path.join(app.getPath('documents'), name), filters,
    });
    if (!target) { item.cancel(); return; }
    item.setSavePath(target);
    item.once('done', (e, state) => {
      if (state === 'interrupted') dialog.showErrorBox('Глина', `Файлът не можа да се запише:\n${target}`);
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();   // already running: the first instance comes to the front (see 'second-instance')
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  Menu.setApplicationMenu(null);   // no menu bar (this also removes reload and dev-tools shortcuts)
  app.whenReady().then(() => {
    secureSession(session.defaultSession);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
