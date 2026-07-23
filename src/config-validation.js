'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/
const PROVIDERS = new Set(['generic', 'github', 'disabled'])

function isWebUrl(value, { httpsOnly = false } = {}) {
  try {
    const url = new URL(value)
    if (httpsOnly) return url.protocol === 'https:'
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function validateAsset(asset, projectRoot, label, errors) {
  if (typeof asset !== 'string' || !asset.startsWith('assets/')) {
    errors.push(`${label} must be a path inside assets/`)
    return
  }

  const assetsRoot = path.resolve(projectRoot, 'assets')
  const resolved = path.resolve(projectRoot, asset)
  if (resolved !== assetsRoot && !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
    errors.push(`${label} must stay inside assets/`)
  } else if (!fs.existsSync(resolved)) {
    errors.push(`${label} does not exist: ${asset}`)
  }
}

function validateConfig(config, options = {}) {
  const projectRoot = options.projectRoot || path.join(__dirname, '..')
  const release = Boolean(options.release)
  const repository = options.repository || process.env.GITHUB_REPOSITORY || ''
  const errors = []

  if (!config || typeof config !== 'object') return ['configuration must be an object']

  if (!APP_ID_PATTERN.test(config.app?.appId || '')) {
    errors.push('app.appId must be a reverse-domain identifier')
  }
  for (const field of ['productName', 'shortName', 'description']) {
    if (typeof config.app?.[field] !== 'string' || !config.app[field].trim()) {
      errors.push(`app.${field} is required`)
    }
  }

  if (!isWebUrl(config.directory?.url || '', { httpsOnly: release })) {
    errors.push(`directory.url must be a valid ${release ? 'HTTPS' : 'http(s)'} URL`)
  }
  try {
    const key = config.directory?.publicKey || ''
    const publicKey = key.includes('BEGIN PUBLIC KEY')
      ? crypto.createPublicKey(key)
      : crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' })
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519')
  } catch {
    errors.push('directory.publicKey must be an Ed25519 PEM or base64 SPKI public key')
  }

  if (config.modpack?.enabled) {
    for (const name of ['bridge', 'wabbajack']) {
      const tool = config.modpack?.[name]
      if (!isWebUrl(tool?.url || '', { httpsOnly: true })) {
        errors.push(`modpack.${name}.url must be an HTTPS URL when enabled`)
      }
      if (!/^[a-f0-9]{64}$/i.test(tool?.sha256 || '') || /^0{64}$/.test(tool?.sha256 || '')) {
        errors.push(`modpack.${name}.sha256 must pin a non-zero SHA-256 when enabled`)
      }
    }
    if (config.modpack?.wabbajack?.version !== '4.2.1.4') {
      errors.push('modpack.wabbajack.version must be pinned to 4.2.1.4')
    }
    const maxModpackBytes = config.modpack?.maxArchiveBytes
    if (!Number.isInteger(maxModpackBytes) || maxModpackBytes < 1048576 || maxModpackBytes > 1099511627776) {
      errors.push('modpack.maxArchiveBytes must be between 1 MiB and 1 TiB')
    }
  }

  for (const field of ['website', 'discord', 'news']) {
    const value = config.links?.[field]
    if (typeof value !== 'string' || (value && !isWebUrl(value))) {
      errors.push(`links.${field} must be empty or an http(s) URL`)
    }
  }

  if (typeof config.branding?.emblem !== 'string' || !config.branding.emblem.trim()) {
    errors.push('branding.emblem is required')
  }
  if (typeof config.branding?.tagline !== 'string' || !config.branding.tagline.trim()) {
    errors.push('branding.tagline is required')
  }
  validateAsset(config.branding?.background, projectRoot, 'branding.background', errors)
  for (const platform of ['windows', 'linux', 'mac']) {
    validateAsset(config.branding?.icons?.[platform], projectRoot, `branding.icons.${platform}`, errors)
  }

  const provider = config.updates?.provider
  if (!PROVIDERS.has(provider)) {
    errors.push('updates.provider must be generic, github, or disabled')
  } else if (provider === 'generic') {
    if (!isWebUrl(config.updates.url || '', { httpsOnly: release })) {
      errors.push(`updates.url must be a valid ${release ? 'HTTPS' : 'http(s)'} URL for the generic provider`)
    }
  } else if (provider === 'github') {
    if (!config.updates.owner || !config.updates.repo) {
      errors.push('updates.owner and updates.repo are required for the github provider')
    } else if (release && repository) {
      const configured = `${config.updates.owner}/${config.updates.repo}`.toLowerCase()
      if (configured !== repository.toLowerCase()) {
        errors.push(`GitHub update source ${configured} does not match build repository ${repository.toLowerCase()}`)
      }
    }
  }

  const interval = config.updates?.checkIntervalMinutes
  if (!Number.isInteger(interval) || interval < 15 || interval > 10080) {
    errors.push('updates.checkIntervalMinutes must be an integer from 15 to 10080')
  }

  const publicKey = config.security?.clientManifestPublicKey || ''
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(publicKey)) {
    errors.push('security.clientManifestPublicKey must be an Ed25519 PEM public key')
  }
  if (!Array.isArray(config.security?.externalHosts) || config.security.externalHosts.some(host => typeof host !== 'string' || !host.trim())) {
    errors.push('security.externalHosts must be an array of host names')
  }
  if (!['en', 'de'].includes(config.behavior?.defaultLocale)) {
    errors.push('behavior.defaultLocale must be en or de')
  }
  const maxPackageBytes = config.behavior?.maxClientPackageBytes
  if (!Number.isInteger(maxPackageBytes) || maxPackageBytes < 1048576 || maxPackageBytes > 4294967296) {
    errors.push('behavior.maxClientPackageBytes must be between 1 MiB and 4 GiB')
  }

  return errors
}

function getPublishConfig(config) {
  if (config.updates.provider === 'generic') {
    return [{ provider: 'generic', url: config.updates.url }]
  }
  if (config.updates.provider === 'github') {
    return [{ provider: 'github', owner: config.updates.owner, repo: config.updates.repo }]
  }
  return undefined
}

module.exports = { getPublishConfig, isWebUrl, validateConfig }
