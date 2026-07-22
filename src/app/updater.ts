import type { App } from "electron";
import { autoUpdater } from "electron-updater";
import type { LauncherConfig } from "./config.js";

export class LauncherUpdater {
  private autoUpdater: any;
  private state: any;
  private started = false;
  constructor(
    private options: {
      app: App;
      config: LauncherConfig;
      emit: (state: any) => void;
      log: any;
    },
  ) {
    this.state = {
      status: "disabled",
      currentVersion: options.app.getVersion(),
      availableVersion: null,
      percent: null,
      message: "",
      canInstall: false,
    };
  }
  getState() {
    return { ...this.state };
  }
  private set(patch: any) {
    this.state = { ...this.state, ...patch };
    this.options.emit(this.getState());
    return this.getState();
  }
  start() {
    if (this.started) return this.getState();
    this.started = true;
    const { app, config } = this.options;
    if (!app.isPackaged || config.updates.provider === "disabled")
      return this.set({
        status: "disabled",
        message: "Automatic updates are disabled for this build.",
      });
    if (process.platform === "linux" && !process.env.APPIMAGE)
      return this.set({
        status: "disabled",
        message: "Use the package manager to update this Linux installation.",
      });
    if (!["win32", "linux"].includes(process.platform))
      return this.set({
        status: "disabled",
        message: "Automatic updates are unavailable on this platform.",
      });
    this.autoUpdater = autoUpdater;
    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.on("checking-for-update", () =>
      this.set({ status: "checking", message: "Checking for updates…" }),
    );
    this.autoUpdater.on("update-available", (info: any) =>
      this.set({
        status: "available",
        availableVersion: info.version,
        percent: 0,
        message: `Update ${info.version} is available.`,
      }),
    );
    this.autoUpdater.on("update-not-available", () =>
      this.set({
        status: "current",
        message: "The launcher is up to date.",
        percent: null,
      }),
    );
    this.autoUpdater.on("download-progress", (value: any) =>
      this.set({
        status: "downloading",
        percent: value.percent,
        message: `Downloading update… ${Math.round(value.percent)}%`,
      }),
    );
    this.autoUpdater.on("update-downloaded", (info: any) =>
      this.set({
        status: "ready",
        availableVersion: info.version,
        percent: 100,
        canInstall: true,
        message: "Update ready. Restart to install.",
      }),
    );
    this.autoUpdater.on("error", (error: Error) => {
      this.options.log.error("[updater]", error);
      this.set({
        status: "error",
        message: `Update failed: ${error.message}`,
        canInstall: false,
      });
    });
    setTimeout(() => void this.check(), 3000).unref();
    setInterval(
      () => void this.check(),
      config.updates.checkIntervalMinutes * 60_000,
    ).unref();
    return this.set({
      status: "current",
      message: "Automatic updates are enabled.",
    });
  }
  async check() {
    if (!this.autoUpdater) return this.getState();
    try {
      await this.autoUpdater.checkForUpdates();
    } catch {
      /* event updates state */
    }
    return this.getState();
  }
  install() {
    if (!this.autoUpdater || !this.state.canInstall) return false;
    this.autoUpdater.quitAndInstall(false, true);
    return true;
  }
}
