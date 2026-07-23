import { contextBridge, ipcRenderer } from "electron";
import type { ElectronApi, InstallState } from "./types.js";

const api: ElectronApi = {
  getAppConfig: () => ipcRenderer.invoke("app:getConfig"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (data) => ipcRenderer.invoke("settings:save", data),
  selectServer: (key) => ipcRenderer.invoke("server:select", key),
  toggleFavorite: (key) => ipcRenderer.invoke("server:toggleFavorite", key),
  showServerBrowser: () => ipcRenderer.invoke("server:browser"),
  openFolder: (kind) => ipcRenderer.invoke("dialog:openFolder", kind),
  detectSkyrim: () => ipcRenderer.invoke("skyrim:detect"),
  modpackStatus: () => ipcRenderer.invoke("modpack:status"),
  nexusLogin: () => ipcRenderer.invoke("modpack:nexusLogin"),
  selectModpackLocation: () => ipcRenderer.invoke("modpack:selectLocation"),
  fetchDashboard: () => ipcRenderer.invoke("dashboard:load"),
  discordLogin: () => ipcRenderer.invoke("discord:login"),
  discordLogout: () => ipcRenderer.invoke("discord:logout"),
  preflight: () => ipcRenderer.invoke("play:preflight"),
  repair: () => ipcRenderer.invoke("install:repair"),
  cancelInstall: () => ipcRenderer.invoke("install:cancel"),
  play: () => ipcRenderer.invoke("play:start"),
  exportDiagnostics: () => ipcRenderer.invoke("diagnostics:export"),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  getUpdateState: () => ipcRenderer.invoke("updates:getState"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onInstallState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: InstallState) =>
      callback(state);
    ipcRenderer.on("install:state", listener);
    return () => ipcRenderer.removeListener("install:state", listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: any) =>
      callback(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
};

contextBridge.exposeInMainWorld("electronAPI", Object.freeze(api));
