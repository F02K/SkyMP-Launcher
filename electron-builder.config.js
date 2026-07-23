'use strict'

const config = require('./launcher.config.json')
const { getPublishConfig, validateConfig } = require('./src/config-validation')

const errors = validateConfig(config, { projectRoot: __dirname })
if (errors.length > 0) throw new Error(`Invalid launcher.config.json:\n- ${errors.join('\n- ')}`)

module.exports = {
  appId: config.app.appId,
  productName: config.app.productName,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  electronUpdaterCompatibility: '>=2.16',
  directories: { output: 'dist' },
  files: [
    'app-dist/**/*',
    'assets/**/*',
    'launcher.config.json',
    'package.json',
  ],
  publish: getPublishConfig(config),
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: config.branding.icons.windows,
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: config.branding.icons.linux,
    category: 'Game',
  },
  mac: {
    target: ['dmg'],
    icon: config.branding.icons.mac,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: config.branding.icons.windows,
    uninstallerIcon: config.branding.icons.windows,
  },
}
