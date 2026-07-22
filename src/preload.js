const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Public launcher identity and branding (never contains secrets)
  getAppConfig: () => ipcRenderer.invoke('app:getConfig'),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // User settings (skyrimPath, username, activeServerIndex)
  loadSettings: ()     => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),

  // OS folder picker
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // API calls proxied through main (keeps CSP clean, uses config.js values)
  fetchStatus:     () => ipcRenderer.invoke('api:status'),
  fetchNews:       () => ipcRenderer.invoke('api:news'),
  fetchServerInfo: () => ipcRenderer.invoke('api:serverinfo'),
  fetchMetrics:    () => ipcRenderer.invoke('api:metrics'),
  fetchModlist:    () => ipcRenderer.invoke('api:modlist'),
  fetchServers:    () => ipcRenderer.invoke('api:servers'),

  // Discord OAuth
  discordLogin:   () => ipcRenderer.invoke('discord:login'),
  discordLogout:  () => ipcRenderer.invoke('discord:logout'),
  discordGetUser: () => ipcRenderer.invoke('discord:getUser'),

  // Launcher updates (checkUpdate is retained for older renderer code)
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  getUpdateState: () => ipcRenderer.invoke('updates:getState'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: (cb) => {
    const listener = (_e, state) => cb(state)
    ipcRenderer.on('updates:state', listener)
    return () => ipcRenderer.removeListener('updates:state', listener)
  },

  // Open external URL in default browser (http/https only)
  openExternal: (url) => ipcRenderer.send('open:external', url),

  // SKSE launch
  launchSkse: () => ipcRenderer.invoke('launch:skse'),

  // File install
  startInstall: (mode) => ipcRenderer.send('install:start', mode),
  onInstallProgress: (cb) =>
    ipcRenderer.on('install:progress', (_e, data) => cb(data)),
  onInstallComplete: (cb) =>
    ipcRenderer.on('install:complete',  (_e, data) => cb(data)),
  removeInstallListeners: () => {
    ipcRenderer.removeAllListeners('install:progress')
    ipcRenderer.removeAllListeners('install:complete')
  },

  // Vortex integration
  vortexDetect: () => ipcRenderer.invoke('vortex:detect'),
})
