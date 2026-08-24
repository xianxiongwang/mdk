'use strict'

const test = require('brittle')
const path = require('path')
const os = require('os')
const fs = require('fs')
const WrkServerHttp = require('../../../workers/http.node.wrk')

const FIXTURES_DIR = path.join(os.tmpdir(), 'mdk-register-plugin-test-' + Date.now())

function writeFixture (dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
}

// registerPlugin is the per-dir unit the ctx.extraPluginDirs boot loop invokes once
// per extra plugin package. Exercised here via prototype.call to avoid booting the
// full worker (facilities, httpd). It must load the manifest and load each route's
// handler through a per-plugin module context whose ambient
// '@tetherto/mdk-gateway/plugin' resolves to the frozen context.

function makeFakeWrk () {
  return {
    _plugins: [],
    conf: { site: { name: 'test-site' } },
    ctx: { kernelKey: 'a'.repeat(64), kernelBootstrap: null }
  }
}

test('registerPlugin - loads an extra plugin dir and registers its routes', (t) => {
  const dir = path.join(FIXTURES_DIR, 'site')
  writeFixture(dir, {
    'mdk-plugin.json': {
      name: '@example/mdk-plugin-site',
      version: '1.0.0',
      routes: [{ id: 'site.devices', method: 'GET', path: '/site/devices', handler: './controllers/devices.js', auth: false }]
    },
    'controllers/devices.js': '\'use strict\'\nmodule.exports = async function (req) { return { devices: [] } }'
  })

  const wrk = makeFakeWrk()
  WrkServerHttp.prototype.registerPlugin.call(wrk, dir)

  t.is(wrk._plugins.length, 1, 'plugin registered')
  t.is(wrk._plugins[0].manifest.name, '@example/mdk-plugin-site')
  t.is(wrk._plugins[0].routes[0].id, 'site.devices')
  t.is(typeof wrk._plugins[0].routes[0]._handler, 'function', 'handler loaded')
})

test('registerPlugin - handler reads the frozen ambient context', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'ctx')
  writeFixture(dir, {
    'mdk-plugin.json': {
      name: '@example/mdk-plugin-ctx',
      version: '1.0.0',
      routes: [{ id: 'ctx.echo', method: 'GET', path: '/ctx/echo', handler: './controllers/echo.js', auth: false }]
    },
    'controllers/echo.js': [
      '\'use strict\'',
      'const { config } = require(\'@tetherto/mdk-gateway/plugin\')',
      'module.exports = async function (req) {',
      '  return { kernelKey: config.kernelKey, site: config.site, frozen: Object.isFrozen(config) }',
      '}'
    ].join('\n')
  })

  const wrk = makeFakeWrk()
  WrkServerHttp.prototype.registerPlugin.call(wrk, dir)

  const out = await wrk._plugins[0].routes[0]._handler({ params: {}, query: {}, body: {}, headers: {} })
  t.is(out.kernelKey, 'a'.repeat(64), 'config.kernelKey came from ctx')
  t.alike(out.site, { name: 'test-site' }, 'gateway conf spread into config')
  t.is(out.frozen, true, 'config arrives frozen')
})

test('registerPlugin - per-plugin config reaches the ambient context', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'per-plugin-conf')
  writeFixture(dir, {
    'mdk-plugin.json': {
      name: '@example/mdk-plugin-conf',
      version: '1.0.0',
      routes: [{ id: 'conf.echo', method: 'GET', path: '/conf/echo', handler: './controllers/echo.js', auth: false }]
    },
    'controllers/echo.js': [
      '\'use strict\'',
      'const { config } = require(\'@tetherto/mdk-gateway/plugin\')',
      'module.exports = async function () { return { agent: config.agent, site: config.site } }'
    ].join('\n')
  })

  const wrk = makeFakeWrk()
  WrkServerHttp.prototype.registerPlugin.call(wrk, dir, { agent: { provider: { kind: 'qvac' } } })

  const out = await wrk._plugins[0].routes[0]._handler({ params: {}, query: {}, body: {}, headers: {} })
  t.alike(out.agent, { provider: { kind: 'qvac' } }, 'plugin config block visible in config')
  t.alike(out.site, { name: 'test-site' }, 'gateway conf still underneath')
})

test('registerPlugin - multiple extra dirs accumulate in order', (t) => {
  const a = path.join(FIXTURES_DIR, 'a')
  const b = path.join(FIXTURES_DIR, 'b')
  writeFixture(a, {
    'mdk-plugin.json': { name: '@example/a', version: '1.0.0', routes: [{ id: 'a.x', method: 'GET', path: '/a', handler: './c.js', auth: false }] },
    'c.js': '\'use strict\'\nmodule.exports = async () => ({})'
  })
  writeFixture(b, {
    'mdk-plugin.json': { name: '@example/b', version: '1.0.0', routes: [{ id: 'b.x', method: 'GET', path: '/b', handler: './c.js', auth: false }] },
    'c.js': '\'use strict\'\nmodule.exports = async () => ({})'
  })

  const wrk = makeFakeWrk()
  for (const dir of [a, b]) WrkServerHttp.prototype.registerPlugin.call(wrk, dir)

  t.is(wrk._plugins.length, 2, 'both extra plugins registered')
  t.is(wrk._plugins[0].manifest.name, '@example/a')
  t.is(wrk._plugins[1].manifest.name, '@example/b')
})
