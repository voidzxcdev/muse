const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");
const { createMpris } = require("./mpris");
const updater = require("./updater");

const HOME = "https://getmuse.eu/pc";
const BG = "#0a0a0b";

let win = null;
let tray = null;
let quitting = false;
let mpris = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.setName("Muse");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "MediaSessionService");
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
    width: 1280,
    height: 820,
    minWidth: 1020,
    minHeight: 680,
    useContentSize: true,
    title: "Muse",
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

  const fit = () => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.setZoomFactor(1); } catch { /* */ }
  };
  win.webContents.on("did-finish-load", fit);
  win.on("resize", fit);

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

  win.once("ready-to-show", () => win.show());
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

app.whenReady().then(() => {
  ipcMain.on("musely-seed", (event) => { event.returnValue = readHistory(); });
  ipcMain.on("muse-host", (event, raw) => onHost(raw, event.sender));
  ipcMain.on("mpris-state", (_event, state) => {
    if (mpris) mpris.update(state);
    if (tray && state && state.title && !state.stopped) {
      const tip = state.playing ? `Muse · ${state.title}` : `Muse · paused`;
      try { tray.setToolTip(tip.slice(0, 120)); } catch { /* */ }
    } else if (tray) {
      try { tray.setToolTip("Muse"); } catch { /* */ }
    }
  });

  mpris = createMpris({
    raise: () => reveal(),
    quit: () => { quitting = true; app.quit(); },
    send: sendMpris,
  });

  try { createTray(); } catch { tray = null; }
  createWindow();
  updater.arm({
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
