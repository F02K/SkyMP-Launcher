'use strict'

const path = require('path')
const rawConfig = require('../launcher.config.json')
const { validateConfig } = require('./config-validation')

const projectRoot = path.join(__dirname, '..')
const errors = validateConfig(rawConfig, { projectRoot })
if (errors.length > 0) {
  throw new Error(`Invalid launcher.config.json:\n- ${errors.join('\n- ')}`)
}

const config = {
  ...rawConfig,
  backend: {
    ...rawConfig.backend,
    apiUrl: String(process.env.API_URL || rawConfig.backend.apiUrl).replace(/\/$/, ''),
  },
}

config.apiUrl = config.backend.apiUrl
const { icons: _privateBuildIcons, ...publicBranding } = config.branding
config.public = Object.freeze({
  app: Object.freeze({ ...config.app }),
  links: Object.freeze({ ...config.links }),
  branding: Object.freeze(publicBranding),
  updates: Object.freeze({ provider: config.updates.provider }),
})

module.exports = Object.freeze(config)
