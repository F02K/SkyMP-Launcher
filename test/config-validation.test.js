'use strict'

const assert = require('node:assert/strict')
const path = require('path')
const test = require('node:test')
const config = require('../launcher.config.json')
const { getPublishConfig, validateConfig } = require('../src/config-validation')

const projectRoot = path.join(__dirname, '..')

test('default launcher configuration is valid', () => {
  assert.deepEqual(validateConfig(config, { projectRoot }), [])
})

test('generic update configuration becomes an electron-builder provider', () => {
  assert.deepEqual(getPublishConfig(config), [{ provider: 'generic', url: config.updates.url }])
})

test('a fork cannot publish updates from a different GitHub repository', () => {
  const forkConfig = structuredClone(config)
  forkConfig.updates = {
    provider: 'github',
    owner: 'F02K',
    repo: 'Frostfall-Launcher',
    checkIntervalMinutes: 240,
  }
  const errors = validateConfig(forkConfig, {
    projectRoot,
    release: true,
    repository: 'someone/their-launcher',
  })
  assert.match(errors.join('\n'), /does not match build repository/)
})

test('disabled updates do not create publish configuration', () => {
  const disabled = structuredClone(config)
  disabled.updates = { provider: 'disabled', checkIntervalMinutes: 240 }
  assert.equal(getPublishConfig(disabled), undefined)
})
