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
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { config } from "./config.js";
import { BackendApi } from "./backend.js";
import { DirectoryApi, DirectoryError, joinCodeFromUrl } from "./directory.js";
import { SettingsService } from "./settings.js";
import { InstallerService } from "./installer.js";
import { ModpackService, assertManagedRoot } from "./modpack.js";
import type { BridgeEvent } from "./bridge.js";
import { sha256File } from "./manifest.js";
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
app.setAsDefaultProtocolClient("skymp");
if (process.env.E2E_USER_DATA)
  app.setPath("userData", process.env.E2E_USER_DATA);
if (process.env.E2E === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-sandbox");
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: SettingsService;
let installer: InstallerService;
let modpack: ModpackService;
let latestPreflight: PreflightReport | null = null;
let dashboardController: AbortController | null = null;
let pendingJoinCode = process.argv.map(joinCodeFromUrl).find(Boolean) || null;
const log = initializeLogger();
const directory = new DirectoryApi(config.directory);
function backendFor(server = settings?.activeServer()) {
  if (!server?.backendUrl)
    throw new Error("Selected Directory server has no operator backend URL.");
  return new BackendApi(server.backendUrl);
}
async function applyJoinCode(code: string) {
  if (!settings) return;
  try {
    const joined = await directory.resolveJoin(code);
    settings.addPrivateServer(joined, code);
    win?.reload();
  } catch (error) {
    log.warn("Private server join failed", error);
  }
}
function receiveDeepLink(value: string) {
  const code = joinCodeFromUrl(value);
  if (!code) return;
  pendingJoinCode = code;
  if (settings) void applyJoinCode(code);
}
app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveDeepLink(url);
});
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

async function downloadNexusFile(
  event: BridgeEvent,
  signal: AbortSignal,
): Promise<string> {
  if (!event.url || !event.sha256 || !/^[a-f0-9]{64}$/i.test(event.sha256))
    throw new Error("Bridge supplied an invalid manual download request.");
  const isNexusUrl = (value: string) => {
    try {
      const target = new URL(value);
      return (
        target.protocol === "https:" &&
        (target.hostname === "nexusmods.com" ||
          target.hostname.endsWith(".nexusmods.com"))
      );
    } catch {
      return false;
    }
  };
  if (!isNexusUrl(event.url))
    throw new Error("Manual downloads are restricted to Nexus Mods.");
  const fileName = path.basename(event.fileName || "nexus-download.bin");
  const destination = path.join(
    app.getPath("userData"),
    "downloads",
    "nexus",
    fileName,
  );
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const browser = new BrowserWindow({
    parent: win || undefined,
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  browser.webContents.setWindowOpenHandler(({ url }) => {
    if (isNexusUrl(url)) void browser.loadURL(url);
    return { action: "deny" };
  });
  browser.webContents.on("will-navigate", (navigationEvent, url) => {
    if (!isNexusUrl(url)) navigationEvent.preventDefault();
  });
  browser.webContents.on("will-redirect", (navigationEvent, url) => {
    if (!isNexusUrl(url)) navigationEvent.preventDefault();
  });
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      browser.webContents.session.removeListener("will-download", onDownload);
      signal.removeEventListener("abort", onAbort);
      if (!browser.isDestroyed()) browser.close();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error("Manual download cancelled."));
    const onDownload = (
      _downloadEvent: Electron.Event,
      item: Electron.DownloadItem,
    ) => {
      item.setSavePath(destination);
      item.once("done", async (_event, state) => {
        if (state !== "completed")
          return fail(new Error(`Nexus download ${state}.`));
        try {
          const stat = await fs.promises.stat(destination);
          if (event.size && stat.size !== event.size)
            throw new Error("Manual Nexus download has the wrong size.");
          if ((await sha256File(destination)) !== event.sha256!.toLowerCase())
            throw new Error(
              "Manual Nexus download failed Wabbajack hash verification.",
            );
          settled = true;
          cleanup();
          resolve(destination);
        } catch (error) {
          fail(error as Error);
        }
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    browser.webContents.session.on("will-download", onDownload);
    browser.once("closed", () => {
      if (!settled) fail(new Error("Manual Nexus download window was closed."));
    });
    void browser.loadURL(event.url!).catch(fail);
  });
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
    modpack?.runtimeRoot() || "",
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

function writeClientSettings() {
  const root = modpack.runtimeRoot();
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
    launchMode: "directory-managed",
    "server-ip": server.address,
    "server-port": Number(server.port),
    profileId: settings.serverProfileId(server.key),
  };
  const profileId = settings.serverProfileId(server.key);
  const session = settings.getServerSession(server.key);
  if (profileId == null || !session)
    throw new Error("Launcher-managed server session is unavailable.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
  const target = authFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `//${JSON.stringify({ session, profileId })}`, {
    mode: 0o600,
  });
}

async function enrichPreflight(
  report: PreflightReport,
): Promise<PreflightReport> {
  const modpackReport = await modpack.preflight();
  report.checks.unshift(...modpackReport.checks);
  report.downloadBytes = Math.max(
    report.downloadBytes,
    modpackReport.downloadBytes,
  );
  report.offline ||= modpackReport.offline;
  report.repairable ||= modpackReport.repairable;
  report.ready = !report.checks.some(
    (check) => check.status === "error" || check.status === "repairable",
  );
  return report;
}

async function authorizeForPlay() {
  const server = settings.activeServer();
  if (!server) throw new Error("Select a server first.");
  if (!server.listed)
    throw new Error("This server is no longer listed and cannot be started.");
  const directorySession = settings.getDirectorySession();
  if (!directorySession) throw new Error("Discord login is required.");
  const signedGrant = await directory.playGrant(server.key, directorySession);
  const exchange = await backendFor(server).exchangeDirectoryGrant(signedGrant);
  if (!exchange?.session || !Number.isInteger(exchange.profileId))
    throw new Error("Backend returned an invalid game session.");
  settings.setServerSession(server.key, exchange.session, exchange.profileId);
  const info = await backendFor(server).serverInfo(
    server.key,
    exchange.session,
  );
  if (!info?.access?.allowed)
    throw new Error(info?.access?.reason || "Server access was denied.");
  if (!info?.capabilities?.clientDistribution)
    throw new Error(
      "This backend does not provide the required client distribution capability.",
    );
  if (config.modpack.enabled && !info?.capabilities?.modpack)
    throw new Error(
      "This backend does not provide the required modpack capability.",
    );
  return info;
}

async function launchGame() {
  const root = modpack.root();
  const server = settings.activeServer();
  if (!root || !server) throw new Error("Skyrim path and server are required.");
  writeClientSettings();
  const exe = path.join(root, "ModOrganizer.exe");
  if (!fs.existsSync(exe))
    throw new Error("Managed ModOrganizer.exe is missing.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ["-p", "Frostfall", "run", "-e", "SKSE"], {
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
    const servers = await directory.servers();
    settings.applyDirectoryCatalog(servers);
    const sessionToken = settings.getDirectorySession();
    if (sessionToken) {
      try {
        const session = await directory.session(sessionToken);
        settings.store.set("discordUser", {
          username: session.user.username,
          tag: session.user.username,
          avatar: session.user.avatar || null,
        });
      } catch {
        settings.clearDirectorySession();
        settings.store.set("discordUser", null);
      }
    }
    await Promise.all(
      settings.privateJoinEntries().map(async ({ code }) => {
        try {
          settings.addPrivateServer(
            await directory.resolveJoin(code),
            code,
            false,
          );
        } catch (error) {
          log.warn("Private server revalidation failed", error);
        }
      }),
    );
  } catch (error) {
    log.warn("Using cached server list", error);
    settings.markDirectoryUnavailable((error as Error).message);
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
    settings.selectServer(key);
    return settings.publicSettings();
  });
  handle("server:toggleFavorite", async (_event, value) => {
    const key = serverKeySchema.parse(value);
    if (
      !settings.store.get("cachedServers").some((server) => server.key === key)
    )
      throw new Error("Unknown server.");
    settings.toggleFavorite(key);
    return settings.publicSettings();
  });
  handle("server:browser", () => {
    dashboardController?.abort();
    settings.showServerBrowser();
    return settings.publicSettings();
  });
  handle("dialog:openFolder", async (_event, kind) => {
    const result = await dialog.showOpenDialog(win!, {
      title:
        kind === "modpack"
          ? "Select the server modpack folder"
          : "Select Skyrim installation",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle("skyrim:detect", async () => {
    const found = await detectSkyrim();
    return { found: Boolean(found), path: found };
  });
  handle("modpack:status", () => modpack.status());
  handle("modpack:nexusLogin", () => modpack.login());
  handle("modpack:selectLocation", async () => {
    const server = settings.activeServer();
    const skyrim = settings.store.get("skyrimPath");
    if (!server || !skyrim)
      throw new Error("Select Skyrim and a server first.");
    const result = await dialog.showOpenDialog(win!, {
      title: "Select the managed server modpack folder",
      defaultPath: modpack.root(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0])
      settings.setModpackPath(
        server.key,
        assertManagedRoot(result.filePaths[0], skyrim, server.key),
      );
    return settings.publicSettings();
  });
  handle("dashboard:load", async () => {
    dashboardController?.abort();
    dashboardController = new AbortController();
    const server = settings.activeServer();
    if (!server) return { error: "No server selected." };
    const signal = dashboardController.signal;
    const session = settings.getServerSession(server.key);
    const backend = backendFor(server);
    const [status, infoResult] = await Promise.allSettled([
      backend.status(server.key, signal),
      backend.serverInfo(server.key, session, signal),
    ]);
    const info = infoResult.status === "fulfilled" ? infoResult.value : null;
    const capabilities = info?.capabilities || {
      authentication: "directory-discord",
      news: false,
      mods: false,
      metrics: false,
      clientDistribution: false,
      modpack: false,
    };
    const [news, mods, metrics] = await Promise.allSettled([
      capabilities.news
        ? backend.news(server.key, signal)
        : Promise.resolve([]),
      capabilities.mods
        ? backend.mods(server.key, signal)
        : Promise.resolve([]),
      capabilities.metrics
        ? backend.metrics(server.key, signal)
        : Promise.resolve(null),
    ]);
    return {
      server,
      status: status.status === "fulfilled" ? status.value : null,
      info,
      capabilities,
      news: news.status === "fulfilled" ? news.value : [],
      mods: mods.status === "fulfilled" ? mods.value : [],
      metrics: metrics.status === "fulfilled" ? metrics.value : null,
    };
  });
  handle("discord:login", async () => {
    const flow = await directory.authStart();
    await shell.openExternal(flow.authorizationUrl);
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const data = await directory.authStatus(flow.flowId, flow.pollToken);
        if (data?.status !== "complete" || !data.sessionToken) continue;
        settings.setDirectorySession(data.sessionToken);
        const user = {
          username: data.user?.username || "Discord user",
          tag: data.user?.username,
          avatar: data.user?.avatar || null,
        };
        settings.store.set("discordUser", user);
        return { success: true, user };
      } catch (error: any) {
        log.warn("Directory Discord polling failed", error);
      }
    }
    return { success: false, error: "Discord login timed out." };
  });
  handle("discord:logout", async () => {
    const token = settings.getDirectorySession();
    if (token)
      await directory
        .revokeSession(token)
        .catch((error) => log.warn("Directory logout failed", error));
    settings.clearDirectorySession();
    settings.store.set("encryptedServerSessions", {});
    settings.store.set("serverProfileIds", {});
    settings.store.set("discordUser", null);
    removeAuthFile();
  });
  handle("play:preflight", async () => {
    latestPreflight = await enrichPreflight(await installer.preflight());
    return latestPreflight;
  });
  handle("install:repair", async () => {
    try {
      await modpack.install();
      await installer.repair();
      latestPreflight = await enrichPreflight(await installer.preflight());
      return { success: latestPreflight.ready };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  handle("install:cancel", async () => {
    const [client, pack] = await Promise.all([
      Promise.resolve(installer.cancel()),
      modpack.cancel(),
    ]);
    return client || pack;
  });
  handle("play:start", async () => {
    try {
      await authorizeForPlay();
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
      const directoryError = error instanceof DirectoryError ? error : null;
      return {
        success: false,
        error: (error as Error).message,
        errorCode: directoryError?.body?.error?.code,
        inviteUrl: directoryError?.body?.error?.inviteUrl,
      };
    }
  });
  handle("diagnostics:export", () =>
    exportDiagnostics(settings, log, latestPreflight),
  );
  handle("external:open", async (_event, value) => {
    const url = externalUrlSchema.parse(value);
    const host = new URL(url).hostname.toLowerCase();
    const configured = new Set([
      new URL(config.directory.url).hostname,
      ...settings.store
        .get("cachedServers")
        .map((server) => server.backendUrl)
        .filter(Boolean)
        .map((value) => new URL(value!).hostname),
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
      if (pendingJoinCode) await applyJoinCode(pendingJoinCode);
      modpack = new ModpackService({
        enabled: config.modpack.enabled,
        backend: () => backendFor(),
        settings,
        publicKey: config.security.clientManifestPublicKey,
        bridge: config.modpack.bridge,
        wabbajack: config.modpack.wabbajack,
        maxArchiveBytes: config.modpack.maxArchiveBytes,
        toolsDir: path.join(app.getPath("userData"), "tools"),
        cacheDir: path.join(app.getPath("userData"), "modpack-cache"),
        emit: (state) => send("install:state", state),
        openAuth: async (url) => {
          await shell.openExternal(url);
        },
        manualDownload: downloadNexusFile,
        log,
      });
      installer = new InstallerService({
        backend: () => backendFor(),
        settings,
        installRoot: () => modpack.runtimeRoot(),
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
      app.on("second-instance", (_event, argv) => {
        for (const argument of argv) receiveDeepLink(argument);
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
  modpack?.close();
});
app.on("window-all-closed", () => {
  if (
    process.platform !== "darwin" &&
    settings?.store.get("closeBehavior") !== "tray"
  )
    app.quit();
});
