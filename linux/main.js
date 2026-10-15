const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require("electron");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { createMpris } = require("./mpris");
const updater = require("./updater");

const HOME = "https://getmuse.eu/pc";
const BG = "#0a0a0b";
const VER = require("./package.json").version;
const TITLE = "Muse Desktop Version " + VER;
const DESIGN_W = 1280;
const DESIGN_H = 820;

let win = null;
let tray = null;
let quitting = false;
let mpris = null;

function ensureDbusSession() {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) return;
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const socks = [
      process.env.XDG_RUNTIME_DIR && path.join(process.env.XDG_RUNTIME_DIR, "bus"),
      uid != null ? `/run/user/${uid}/bus` : "",
    ].filter(Boolean);
    for (const sock of socks) {
      if (fs.existsSync(sock)) {
        process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=" + sock;
        return;
      }
    }
  } catch { /* no session bus */ }
}
ensureDbusSession();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.setName("Muse");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "MediaSessionService,HardwareMediaKeyHandling");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

function chatFile() {
  const dir = path.join(app.getPath("userData"), "musely");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "chat.json");
}

function readHistory() {
  try {
    const text = fs.readFileSync(chatFile(), "utf8").trim();
    if (!text.startsWith("[")) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function onHost(raw, sender) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "musely-load") {
    sender.send("muse-host", JSON.stringify({
      type: "musely-chat",
      history: readHistory(),
    }));
    return;
  }
  if (msg.type === "musely-save" && Array.isArray(msg.history)) {
    const text = JSON.stringify(msg.history);
    if (text.length > 1_500_000) return;
    try { fs.writeFileSync(chatFile(), text); } catch { /* disk full — chat still lives in the page */ }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: DESIGN_W,
    height: DESIGN_H,
    minWidth: 560,
    minHeight: 360,
    useContentSize: true,
    title: TITLE,
    backgroundColor: BG,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.webContents.setBackgroundThrottling(false);
  win.setMenu(null);
  win.setMenuBarVisibility(false);
  try { win.webContents.setVisualZoomLevelLimits(1, 1); } catch { /* */ }

  let fitTimer = null;
  const fitViewport = () => {
    if (!win || win.isDestroyed()) return;
    const [cw, ch] = win.getContentSize();
    if (cw < 8 || ch < 8) return;
    const z = Math.min(cw / DESIGN_W, ch / DESIGN_H);
    const clamped = Math.round(Math.max(0.4, Math.min(1.8, z)) * 100) / 100;
    try {
      if (Math.abs(win.webContents.getZoomFactor() - clamped) < 0.009) return;
      win.webContents.setZoomFactor(clamped);
    } catch { /* */ }
  };
  const scheduleFit = () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitViewport, 40);
  };
  win.on("resize", scheduleFit);
  win.webContents.on("did-finish-load", fitViewport);
  win.webContents.on("did-navigate", fitViewport);

  win.on("page-title-updated", (event) => {
    event.preventDefault();
    if (win && !win.isDestroyed() && win.getTitle() !== TITLE) win.setTitle(TITLE);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    let host = "";
    try { host = new URL(url).hostname; } catch { return; }
    if (host === "getmuse.eu" || host.endsWith(".getmuse.eu")) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const blocked = input.key === "F12"
      || (input.control && ["r", "f", "g", "p", "u", "l", "h", "j"].includes(key))
      || (input.control && input.shift && key === "r");
    if (blocked) event.preventDefault();
  });

  win.on("close", (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    win.hide();
  });

  win.once("ready-to-show", () => {
    fitViewport();
    win.show();
  });

  let recoverTries = 0;
  const recoverHome = () => {
    if (!win || win.isDestroyed() || recoverTries >= 8) return;
    recoverTries += 1;
    const wait = Math.min(12000, 1200 * recoverTries);
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.loadURL(HOME);
    }, wait);
  };
  win.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMain) => {
    if (!isMain) return;
    recoverHome();
  });
  win.webContents.on("did-finish-load", () => {
    win.webContents.executeJavaScript(
      "document.title + ' ' + (document.body && document.body.innerText || '').slice(0, 240)"
    ).then((text) => {
      const s = String(text || "");
      const down = /bad gateway|error code 50[234]|host error/i.test(s)
        && /cloudflare|getmuse/i.test(s);
      if (down) recoverHome();
      else recoverTries = 0;
    }).catch(() => {});
  });

  win.loadURL(HOME);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
  tray = new Tray(icon.resize({ width: 24, height: 24 }));
  tray.setToolTip("Muse");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Muse", click: () => reveal() },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => reveal());
}

function reveal() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.on("second-instance", () => reveal());

function sendMpris(type, value) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("mpris-cmd", { type, value });
}

function artDir() {
  const dir = path.join(app.getPath("temp"), "muse-mpris");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function artFileUrl(id) {
  const safe = String(id || "track").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
  return path.join(artDir(), safe + ".jpg");
}

function toFileUrl(file) {
  return "file://" + String(file).replace(/\\/g, "/");
}

function downloadArt(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Muse/1.0",
        Accept: "image/*",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadArt(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("art " + res.statusCode));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => resolve(dest));
      out.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("art timeout"));
    });
  });
}

let artJob = "";
function cacheArt(state) {
  const remote = state && /^https?:\/\//i.test(state.art || "") ? state.art : "";
  const id = state && state.id;
  if (!remote || !id) return;
  const job = id + "\n" + remote;
  if (job === artJob) return;
  artJob = job;
  const dest = artFileUrl(id);
  downloadArt(remote, dest).then(() => {
    if (artJob !== job || !mpris) return;
    mpris.update(Object.assign({}, state, { art: toFileUrl(dest) }));
  }).catch(() => {});
}

app.whenReady().then(() => {
  ipcMain.on("musely-seed", (event) => { event.returnValue = readHistory(); });
  ipcMain.on("muse-host", (event, raw) => onHost(raw, event.sender));
  let lastTip = "";
  ipcMain.on("mpris-state", (_event, state) => {
    if (mpris) mpris.update(state);
    try { cacheArt(state); } catch { /* art is optional */ }
    if (!tray) return;
    let tip = TITLE;
    if (state && state.title && !state.stopped) {
      tip = (state.playing ? `${TITLE} · ${state.title}` : `${TITLE} · paused`).slice(0, 120);
    }
    if (tip === lastTip) return;
    lastTip = tip;
    try { tray.setToolTip(tip); } catch { /* */ }
  });

  mpris = createMpris({
    raise: () => reveal(),
    quit: () => { quitting = true; app.quit(); },
    send: sendMpris,
  });

  try { createTray(); } catch { tray = null; }
  createWindow();

  let updatePageReady = false;
  let lastUpdateP = 0.04;
  const sendUpdateProgress = (p) => {
    lastUpdateP = p;
    if (!updatePageReady || !win || win.isDestroyed()) return;
    const n = Number(p);
    win.webContents.executeJavaScript(
      "window.__museSetProgress && window.__museSetProgress(" + (Number.isFinite(n) ? n : 0) + ")"
    ).catch(() => {});
  };
  const showUpdateScreen = (version) => {
    if (!win || win.isDestroyed()) return;
    updatePageReady = false;
    lastUpdateP = 0.04;
    win.webContents.once("did-finish-load", () => {
      updatePageReady = true;
      sendUpdateProgress(lastUpdateP);
    });
    win.loadFile(path.join(__dirname, "update.html"), { query: { v: String(version || "") } });
  };

  updater.arm({
    begin: (ver) => { try { showUpdateScreen(ver); } catch { /* */ } },
    progress: (p) => { try { sendUpdateProgress(p); } catch { /* */ } },
    fail: () => {
      updatePageReady = false;
      if (win && !win.isDestroyed()) win.loadURL(HOME);
    },
    apply: () => { quitting = true; app.quit(); },
  });
});

app.on("before-quit", () => {
  quitting = true;
  if (mpris) {
    try { mpris.destroy(); } catch { /* */ }
    mpris = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
