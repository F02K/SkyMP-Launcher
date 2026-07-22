'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { BackendApi } = require('../src/backend-api')

async function fixture(run) {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, session: req.headers['x-session'] })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/custom/launcher/news') return res.end(JSON.stringify({ items: [{ title: 'News' }], total: 1 }))
    if (req.url === '/custom/launcher/servers') return res.end(JSON.stringify({ items: [{ key: 'default' }], total: 1 }))
    if (req.url === '/custom/launcher/servers/default') return res.end(JSON.stringify({ name: 'Server' }))
    if (req.url.startsWith('/custom/auth/discord/status')) return res.end(JSON.stringify({ session: 'token', profileId: 7, user: { username: 'User', avatar: null } }))
    res.statusCode = 404
    res.end(JSON.stringify({ error: { code: 'notFound', message: 'Missing' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(new BackendApi(`http://127.0.0.1:${server.address().port}`, '/custom'), requests)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('central backend client consumes v2 collections and forwards sessions', async () => {
  await fixture(async (api, requests) => {
    assert.deepEqual(await api.news(), [{ title: 'News' }])
    assert.deepEqual(await api.servers(), [{ key: 'default' }])
    assert.deepEqual(await api.serverInfo('play-session'), { name: 'Server' })
    assert.equal(requests.at(-1).session, 'play-session')
    assert.deepEqual(await api.discordStatus('a state'), {
      token: 'token', masterApiId: 7, discordUsername: 'User', discordAvatar: null,
    })
    assert.match(requests.at(-1).url, /state=a%20state/)
  })
})

test('central backend client exposes structured backend errors', async () => {
  await fixture(async api => {
    await assert.rejects(() => api.request('/missing'), error => {
      assert.equal(error.statusCode, 404)
      assert.equal(error.message, 'Missing')
      return true
    })
  })
})
