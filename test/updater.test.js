'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { LauncherUpdater } = require('../src/updater')

class FakeUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit('checking-for-update')
    return { updateInfo: { version: '1.2.0' } }
  }

  quitAndInstall() {
    this.installed = true
  }
}

function makeUpdater(overrides = {}) {
  const fake = new FakeUpdater()
  const updater = new LauncherUpdater({
    app: { isPackaged: true, getVersion: () => '1.1.1' },
    config: { updates: { provider: 'generic', checkIntervalMinutes: 240 } },
    autoUpdater: fake,
    log: () => {},
    platform: 'win32',
    environment: {},
    ...overrides,
  })
  return { fake, updater }
}

test('development builds stay disabled', () => {
  const { updater } = makeUpdater({ app: { isPackaged: false, getVersion: () => '1.1.1' } })
  assert.equal(updater.start().status, 'disabled')
})

test('non-AppImage Linux packages use their package manager', () => {
  const { updater } = makeUpdater({ platform: 'linux', environment: {} })
  assert.match(updater.start().message, /package manager/)
})

test('download progress and ready state are exposed', () => {
  const { fake, updater } = makeUpdater()
  updater.start()
  fake.emit('update-available', { version: '1.2.0' })
  fake.emit('download-progress', { percent: 42.4 })
  assert.equal(updater.getState().status, 'downloading')
  assert.equal(updater.getState().percent, 42.4)
  fake.emit('update-downloaded', { version: '1.2.0' })
  assert.equal(updater.getState().status, 'ready')
  assert.equal(updater.getState().canInstall, true)
  assert.equal(updater.install(), true)
  assert.equal(fake.installed, true)
})

test('updater errors remain a non-throwing state', () => {
  const { fake, updater } = makeUpdater()
  updater.start()
  fake.emit('error', new Error('network unavailable'))
  assert.equal(updater.getState().status, 'error')
  assert.match(updater.getState().message, /network unavailable/)
})
