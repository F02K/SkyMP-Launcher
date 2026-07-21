'use strict'

const DEFAULT_STATE = Object.freeze({
  status: 'disabled',
  currentVersion: '',
  availableVersion: null,
  percent: null,
  message: '',
  canInstall: false,
})

function cleanError(error) {
  const message = error?.message || String(error || 'Unknown update error')
  return message.replace(/\s+/g, ' ').trim().slice(0, 300)
}

class LauncherUpdater {
  constructor(options) {
    this.app = options.app
    this.config = options.config
    this.send = options.send || (() => {})
    this.log = options.log || console.log
    this.platform = options.platform || process.platform
    this.environment = options.environment || process.env
    this.autoUpdater = options.autoUpdater || null
    this.started = false
    this.checkPromise = null
    this.timers = []
    this.state = {
      ...DEFAULT_STATE,
      currentVersion: this.app.getVersion(),
      message: 'Automatic updates are not initialized.',
    }
  }

  getState() {
    return { ...this.state }
  }

  setState(patch) {
    this.state = { ...this.state, ...patch }
    this.send('updates:state', this.getState())
    return this.getState()
  }

  getDisabledReason() {
    if (!this.app.isPackaged) return 'Automatic updates are disabled in development builds.'
    if (this.config.updates.provider === 'disabled') return 'Automatic updates are disabled for this build.'
    if (this.platform !== 'win32' && this.platform !== 'linux') {
      return 'Automatic updates are not supported on this platform.'
    }
    if (this.platform === 'linux' && !this.environment.APPIMAGE) {
      return 'Install updates for this Linux package with your package manager.'
    }
    return null
  }

  start() {
    if (this.started) return this.getState()
    this.started = true

    const disabledReason = this.getDisabledReason()
    if (disabledReason) return this.setState({ status: 'disabled', message: disabledReason })

    if (!this.autoUpdater) this.autoUpdater = require('electron-updater').autoUpdater
    this.autoUpdater.autoDownload = true
    this.autoUpdater.autoInstallOnAppQuit = true
    this.autoUpdater.allowPrerelease = false

    this.autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', percent: null, message: 'Checking for updates…' })
    })
    this.autoUpdater.on('update-available', info => {
      this.setState({
        status: 'available',
        availableVersion: info?.version || null,
        percent: 0,
        message: `Update ${info?.version || ''} is available.`,
      })
    })
    this.autoUpdater.on('update-not-available', info => {
      this.setState({
        status: 'current',
        availableVersion: info?.version || null,
        percent: null,
        message: 'The launcher is up to date.',
      })
    })
    this.autoUpdater.on('download-progress', progress => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0))
      this.setState({
        status: 'downloading',
        percent,
        message: `Downloading update… ${Math.round(percent)}%`,
      })
    })
    this.autoUpdater.on('update-downloaded', info => {
      this.setState({
        status: 'ready',
        availableVersion: info?.version || this.state.availableVersion,
        percent: 100,
        message: 'Update downloaded. Restart to install it.',
        canInstall: true,
      })
    })
    this.autoUpdater.on('error', error => {
      this.log('[updater] error:', cleanError(error))
      this.setState({
        status: 'error',
        percent: null,
        message: `Update check failed: ${cleanError(error)}`,
        canInstall: false,
      })
    })

    const initialTimer = setTimeout(() => this.check().catch(() => {}), 3000)
    initialTimer.unref?.()
    const intervalMs = this.config.updates.checkIntervalMinutes * 60 * 1000
    const interval = setInterval(() => this.check().catch(() => {}), intervalMs)
    interval.unref?.()
    this.timers.push(initialTimer, interval)

    return this.setState({ status: 'current', message: 'Automatic updates are enabled.' })
  }

  async check() {
    const disabledReason = this.getDisabledReason()
    if (disabledReason) return this.setState({ status: 'disabled', message: disabledReason })
    if (!this.started) this.start()
    if (this.checkPromise || this.state.status === 'downloading' || this.state.status === 'ready') {
      return this.getState()
    }

    this.checkPromise = this.autoUpdater.checkForUpdates()
    try {
      await this.checkPromise
    } catch (error) {
      this.log('[updater] check failed:', cleanError(error))
      if (this.state.status !== 'error') {
        this.setState({ status: 'error', message: `Update check failed: ${cleanError(error)}` })
      }
    } finally {
      this.checkPromise = null
    }
    return this.getState()
  }

  install() {
    if (!this.autoUpdater || !this.state.canInstall) return false
    this.autoUpdater.quitAndInstall(false, true)
    return true
  }
}

module.exports = { DEFAULT_STATE, LauncherUpdater, cleanError }
