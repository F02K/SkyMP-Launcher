'use strict'

const http = require('http')
const https = require('https')

class BackendApi {
  constructor(baseUrl, apiBasePath = '/api/v2') {
    this.baseUrl = String(baseUrl).replace(/\/$/, '')
    this.v2Url = `${this.baseUrl}${apiBasePath}`
  }

  url(path) { return `${this.v2Url}${path}` }
  clientDownloadUrl() { return this.url('/launcher/client/download') }

  async news() { return (await this.request('/launcher/news')).items || [] }
  async status() { return this.request('/launcher/status') }
  async servers() { return (await this.request('/launcher/servers')).items || [] }
  async serverInfo(session) {
    const headers = session ? { 'x-session': session } : {}
    return this.request('/launcher/servers/default', headers)
  }
  async metrics() { return this.request('/launcher/metrics') }
  async mods() { return (await this.request('/launcher/mods')).items || [] }
  async clientVersion() { return this.request('/launcher/client/version') }
  discordStartUrl(state) { return this.url(`/auth/discord/start?state=${encodeURIComponent(state)}`) }
  async discordStatus(state) {
    const data = await this.request(`/auth/discord/status?state=${encodeURIComponent(state)}`)
    return {
      token: data.session,
      masterApiId: data.profileId,
      discordUsername: data.user && data.user.username,
      discordAvatar: data.user && data.user.avatar,
    }
  }

  request(path, headers = {}) {
    const url = this.url(path)
    return new Promise((resolve, reject) => {
      const transport = url.startsWith('https:') ? https : http
      const request = transport.get(url, { headers }, response => {
        let body = ''
        response.on('data', chunk => { body += chunk })
        response.on('end', () => {
          let value
          try { value = JSON.parse(body) }
          catch { return reject(Object.assign(new Error(`Invalid JSON from backend (${response.statusCode})`), { statusCode: response.statusCode })) }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const message = value?.error?.message || value?.error || `HTTP ${response.statusCode}`
            return reject(Object.assign(new Error(message), { statusCode: response.statusCode, body: value }))
          }
          resolve(value)
        })
      })
      request.on('error', reject)
      request.setTimeout(10_000, () => request.destroy(new Error('Backend request timed out')))
    })
  }
}

module.exports = { BackendApi }
