import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { config } from "./config.js";
import { BackendApi } from "./backend.js";
import { SettingsService } from "./settings.js";
import { InstallerService } from "./installer.js";
import { detectSkyrim, validateSkyrim } from "./discovery.js";
import { exportDiagnostics } from "./diagnostics.js";
import { initializeLogger } from "./logger.js";
import {
  externalUrlSchema,
  serverKeySchema,
  settingsPatchSchema,
} from "./schemas.js";
import { LauncherUpdater } from "./updater.js";
import type { PreflightReport } from "./types.js";

if (!app.isPackaged) dotenv.config();
app.setName(config.app.productName);
if (process.env.E2E_USER_DATA)
  app.setPath("userData", process.env.E2E_USER_DATA);
if (process.env.E2E === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-sandbox");
}
const loadModule = createRequire(__filename);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: SettingsService;
let installer: InstallerService;
let latestPreflight: PreflightReport | null = null;
let dashboardController: AbortController | null = null;
const log = initializeLogger();
const backend = new BackendApi(
  config.backend.apiUrl,
  config.backend.apiBasePath,
);
const updater = new LauncherUpdater({
  app,
  config,
  emit: (state) => send("updates:state", state),
  log,
});

function send(channel: string, value: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (
    !win ||
    event.sender.id !== win.webContents.id ||
    (event.senderFrame?.url && !event.senderFrame.url.startsWith("file:"))
  )
    throw new Error("Untrusted IPC sender");
}
function handle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any,
) {
  ipcMain.handle(channel, (event, ...args) => {
    trusted(event);
    return handler(event, ...args);
  });
}

function createWindow() {
  win = new BrowserWindow({
    title: config.app.productName,
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: "#080503",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const rendererUrl = pathToFileURL(
    path.join(__dirname, "renderer", "index.html"),
  ).href;
  win.webContents.once("did-finish-load", () => {
    win?.webContents.on("will-navigate", (event, url) => {
      if (url !== rendererUrl) event.preventDefault();
    });
  });
  win.loadURL(rendererUrl);
  win.once("ready-to-show", () => win?.show());
  win.on("close", (event) => {
    if (!quitting && settings?.store.get("closeBehavior") === "tray") {
      event.preventDefault();
      win?.hide();
    }
  });
  if (process.argv.includes("--dev"))
    win.webContents.openDevTools({ mode: "detach" });
}

function ensureTray() {
  if (tray || process.platform !== "win32") return;
  tray = new Tray(
    nativeImage.createFromPath(
      path.join(app.getAppPath(), config.branding.icons.windows),
    ),
  );
  tray.setToolTip(config.app.productName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open launcher",
        click: () => {
          win?.show();
          win?.focus();
        },
      },
      { label: "Check for updates", click: () => void updater.check() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    win?.show();
    win?.focus();
  });
}

function authFile(): string {
  return path.join(
    settings.store.get("skyrimPath") || "",
    "Data",
    "Platform",
    "PluginsNoLoad",
    "auth-data-no-load.js",
  );
}
function removeAuthFile() {
  try {
    fs.rmSync(authFile(), { force: true });
  } catch {
    /* best effort */
  }
}

function writeClientSettings(serverInfo: any) {
  const root = settings.store.get("skyrimPath");
  const server = settings.activeServer();
  if (!root || !server) throw new Error("Skyrim path or server is missing.");
  const destination = path.join(
    root,
    "Data",
    "Platform",
    "Plugins",
    "skymp5-client-settings.txt",
  );
  const value: any = {
    "server-ip": server.address,
    "server-port": Number(server.port),
    master: serverInfo?.masterUrl || "",
    "server-master-key": serverInfo?.masterKey || null,
  };
  const profileId = settings.store.get("gameProfileId");
  if (serverInfo?.offlineMode) {
    if (profileId == null) throw new Error("Discord profile is unavailable.");
    value.gameData = { profileId };
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
  const session = settings.getSession();
  if (!serverInfo?.offlineMode && session && profileId != null) {
    const target = authFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `//${JSON.stringify({ session, masterApiId: profileId })}`,
      { mode: 0o600 },
    );
  }
}

async function enrichPreflight(
  report: PreflightReport,
): Promise<PreflightReport> {
  const server = settings.activeServer();
  if (!server) return report;
  try {
    const mods = await backend.mods(server.key);
    const nexusMods = mods.filter(
      (mod: any) => mod.enabled && mod.source === "nexus" && mod.nexusId,
    );
    const requiredNexus = nexusMods.filter((mod: any) => mod.required);
    if (requiredNexus.length && !settings.store.get("vortexEnabled"))
      report.checks.push({
        id: "mods",
        status: "error",
        message: `${requiredNexus.length} required Nexus mod(s) need Vortex integration.`,
      });
    else if (requiredNexus.length) {
      const vortex = loadModule(
        path.join(app.getAppPath(), "src", "vortex.js"),
      );
      const profile = vortex.autoDetectProfile();
      const missing = nexusMods.filter(
        (mod: any) =>
          !vortex.findEnabledModByNexusId(Number(mod.nexusId), profile?.id),
      );
      const requiredMissing = missing.filter((mod: any) => mod.required);
      const optionalMissing = missing.filter((mod: any) => !mod.required);
      report.checks.push(
        requiredMissing.length
          ? {
              id: "mods",
              status: "error",
              message: `${requiredMissing.length} required Vortex mod(s) are missing or disabled.`,
            }
          : {
              id: "mods",
              status: "ok",
              message: "Required Vortex mods are enabled.",
            },
      );
      if (optionalMissing.length)
        report.checks.push({
          id: "optional-mods",
          status: "warning",
          message: `${optionalMissing.length} optional Vortex mod(s) are missing or disabled.`,
        });
    }
  } catch {
    report.checks.push({
      id: "mods",
      status: "warning",
      message: "Mod status could not be checked.",
    });
  }
  report.ready = !report.checks.some(
    (check) => check.status === "error" || check.status === "repairable",
  );
  return report;
}

async function launchGame() {
  const root = settings.store.get("skyrimPath");
  const server = settings.activeServer();
  if (!root || !server) throw new Error("Skyrim path and server are required.");
  let info: any;
  try {
    info = await backend.serverInfo(server.key, settings.getSession());
  } catch (error) {
    log.warn("Server info unavailable; using cached-safe defaults", error);
    info = {};
  }
  writeClientSettings(info);
  if (settings.store.get("vortexEnabled")) {
    const vortexPath = settings.store.get("vortexPath");
    if (!vortexPath || !fs.existsSync(vortexPath))
      throw new Error("Vortex.exe was not found.");
    spawn(vortexPath, ["--start-minimized"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const exe = path.join(root, "skse64_loader.exe");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, [], {
      detached: true,
      stdio: "ignore",
      cwd: root,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  const behavior = settings.store.get("afterLaunch");
  if (behavior === "minimize") win?.minimize();
  if (behavior === "close") win?.close();
}

async function loadSettings() {
  try {
    const servers = await backend.servers();
    if (servers.length) settings.setServers(servers);
  } catch (error) {
    log.warn("Using cached server list", error);
  }
  return settings.publicSettings();
}

function registerIpc() {
  ipcMain.on("window:minimize", (event) => {
    trusted(event);
    win?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    trusted(event);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on("window:close", (event) => {
    trusted(event);
    win?.close();
  });
  handle("app:getConfig", () => config.public);
  handle("settings:load", loadSettings);
  handle("settings:save", async (_event, input) => {
    const patch = settingsPatchSchema.parse(input);
    if (
      patch.skyrimPath !== undefined &&
      patch.skyrimPath &&
      !validateSkyrim(patch.skyrimPath)
    )
      throw new Error(
        "Selected folder is not a valid Skyrim Special Edition installation.",
      );
    const allowed = [
      "skyrimPath",
      "activeServerKey",
      "vortexPath",
      "vortexEnabled",
      "locale",
      "onboardingVersion",
      "launchAtLogin",
      "closeBehavior",
      "afterLaunch",
      "reduceMotion",
    ] as const;
    for (const key of allowed)
      if (patch[key] !== undefined)
        settings.store.set(key as any, patch[key] as any);
    if (patch.launchAtLogin !== undefined)
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    if (patch.closeBehavior === "tray") ensureTray();
    return settings.publicSettings();
  });
  handle("server:select", async (_event, value) => {
    const key = serverKeySchema.parse(value);
    if (
      !settings.store.get("cachedServers").some((server) => server.key === key)
    )
      throw new Error("Unknown server.");
    dashboardController?.abort();
    settings.store.set("activeServerKey", key);
    return settings.publicSettings();
  });
  handle("dialog:openFolder", async (_event, kind) => {
    const result = await dialog.showOpenDialog(win!, {
      title:
        kind === "vortex" ? "Select Vortex.exe" : "Select Skyrim installation",
      properties: kind === "vortex" ? ["openFile"] : ["openDirectory"],
      filters:
        kind === "vortex"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : undefined,
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle("skyrim:detect", async () => {
    const found = await detectSkyrim();
    return { found: Boolean(found), path: found };
  });
  handle("vortex:detect", () => {
    const vortex = loadModule(path.join(app.getAppPath(), "src", "vortex.js"));
    const found = vortex.findVortexExe() || "";
    return { found: Boolean(found), path: found };
  });
  handle("vortex:sync", async () => {
    const server = settings.activeServer();
    const vortexPath = settings.store.get("vortexPath");
    if (!server || !vortexPath || !fs.existsSync(vortexPath))
      return { success: false, error: "Vortex is not configured." };
    const mods = await backend.mods(server.key);
    const collection = mods.find((mod: any) => mod.source === "collection");
    spawn(vortexPath, ["--game", "skyrimse"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (collection?.collectionSlug && collection?.revisionId)
      await shell.openExternal(
        `nxm://skyrimspecialedition/collections/${collection.collectionSlug}/revisions/${collection.revisionId}`,
      );
    else if (collection?.collectionSlug)
      await shell.openExternal(
        `https://www.nexusmods.com/skyrimspecialedition/collections/${collection.collectionSlug}`,
      );
    else {
      const first = mods.find(
        (mod: any) => mod.required && mod.source === "nexus" && mod.nexusId,
      );
      if (first)
        await shell.openExternal(
          `https://www.nexusmods.com/skyrimspecialedition/mods/${first.nexusId}`,
        );
    }
    return { success: true };
  });
  handle("dashboard:load", async () => {
    dashboardController?.abort();
    dashboardController = new AbortController();
    const server = settings.activeServer();
    if (!server) return { error: "No server selected." };
    const signal = dashboardController.signal;
    const session = settings.getSession();
    const [status, info, news, mods, metrics] = await Promise.allSettled([
      backend.status(server.key, signal),
      backend.serverInfo(server.key, session, signal),
      backend.news(server.key, signal),
      backend.mods(server.key, signal),
      backend.metrics(server.key, signal),
    ]);
    return {
      server,
      status: status.status === "fulfilled" ? status.value : null,
      info: info.status === "fulfilled" ? info.value : null,
      news: news.status === "fulfilled" ? news.value : [],
      mods: mods.status === "fulfilled" ? mods.value : [],
      metrics: metrics.status === "fulfilled" ? metrics.value : null,
    };
  });
  handle("discord:login", async () => {
    const state = crypto.randomBytes(24).toString("hex");
    await shell.openExternal(backend.discordStartUrl(state));
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const data = await backend.discordStatus(state);
        if (!data?.session) continue;
        settings.setSession(data.session);
        settings.store.set("gameProfileId", data.profileId);
        const user = {
          username: data.user?.username || `Player ${data.profileId}`,
          tag: data.user?.username,
          avatar: data.user?.avatar || null,
        };
        settings.store.set("discordUser", user);
        return { success: true, user };
      } catch (error: any) {
        if (error.statusCode !== 404 && error.statusCode !== 202)
          log.warn("Discord polling failed", error);
      }
    }
    return { success: false, error: "Discord login timed out." };
  });
  handle("discord:logout", () => {
    settings.clearSession();
    settings.store.set("gameProfileId", null);
    settings.store.set("discordUser", null);
    removeAuthFile();
  });
  handle("play:preflight", async () => {
    latestPreflight = await enrichPreflight(await installer.preflight());
    return latestPreflight;
  });
  handle("install:repair", async () => {
    try {
      await installer.repair();
      latestPreflight = await enrichPreflight(await installer.preflight());
      return { success: latestPreflight.ready };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  handle("install:cancel", () => installer.cancel());
  handle("play:start", async () => {
    try {
      latestPreflight = await enrichPreflight(await installer.preflight());
      if (!latestPreflight.ready)
        return {
          success: false,
          needsRepair: latestPreflight.repairable,
          preflight: latestPreflight,
          error: "Preflight checks failed.",
        };
      await launchGame();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  handle("diagnostics:export", () =>
    exportDiagnostics(settings, log, latestPreflight),
  );
  handle("external:open", async (_event, value) => {
    const url = externalUrlSchema.parse(value);
    const host = new URL(url).hostname.toLowerCase();
    const configured = new Set([
      new URL(config.backend.apiUrl).hostname,
      ...config.security.externalHosts,
      ...Object.values(config.links)
        .filter(Boolean)
        .map((item: any) => new URL(item).hostname),
    ]);
    if (!configured.has(host)) {
      const answer = await dialog.showMessageBox(win!, {
        type: "question",
        buttons: ["Cancel", "Open"],
        defaultId: 0,
        cancelId: 0,
        title: "Open external website?",
        message: host,
        detail: "This website is outside the configured launcher hosts.",
      });
      if (answer.response !== 1) return false;
    }
    await shell.openExternal(url);
    return true;
  });
  handle("updates:getState", () => updater.getState());
  handle("updates:check", () => updater.check());
  handle("updates:install", () => updater.install());
}

if (gotLock)
  app
    .whenReady()
    .then(async () => {
      settings = new SettingsService();
      installer = new InstallerService({
        backend,
        settings,
        publicKey: config.security.clientManifestPublicKey,
        maxBytes: config.behavior.maxClientPackageBytes,
        downloadsDir: path.join(app.getPath("userData"), "downloads"),
        emit: (state) => send("install:state", state),
        log,
      });
      registerIpc();
      createWindow();
      if (settings.store.get("closeBehavior") === "tray") ensureTray();
      updater.start();
      app.on("activate", () => {
        if (!win) createWindow();
        else win.show();
      });
      app.on("second-instance", () => {
        win?.show();
        win?.focus();
      });
    })
    .catch((error) => {
      log.error("Startup failed", error);
      app.quit();
    });

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception", error);
  settings?.store.set("lastCrash", new Date().toISOString());
});
process.on("unhandledRejection", (error) => {
  log.error("Unhandled rejection", error);
  settings?.store.set("lastCrash", new Date().toISOString());
});
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  if (
    process.platform !== "darwin" &&
    settings?.store.get("closeBehavior") !== "tray"
  )
    app.quit();
});
