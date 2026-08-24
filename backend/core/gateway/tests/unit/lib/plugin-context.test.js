'use strict'

const test = require('brittle')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { loadPlugin } = require('../../../workers/lib/plugin-loader')

const FIXTURES_DIR = path.join(os.tmpdir(), 'mdk-plugin-context-test-' + Date.now())

function writeFixture (dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
}

// The authored-plugin layout under test: a controller that reads the ambient
// context module and a lib/client.js that binds plugin-level state at module
// scope, the way a real plugin builds its mdk client.
function writeContextPlugin (dir, marker) {
  writeFixture(dir, {
    'mdk-plugin.json': {
      name: `@example/${marker}`,
      version: '1.0.0',
      routes: [{ id: 'ctx.probe', method: 'GET', path: '/ctx/probe', handler: './controllers/probe.js', auth: false }]
    },
    'lib/client.js': [
      '\'use strict\'',
      'const { config, logger } = require(\'@tetherto/mdk-gateway/plugin\')',
      'logger(\'client built for %s\', config.kernelKey)',
      'let calls = 0',
      'module.exports = { kernelKey: config.kernelKey, bootstrap: config.kernelBootstrap, count: () => ++calls }'
    ].join('\n'),
    'controllers/probe.js': [
      '\'use strict\'',
      'const { config } = require(\'@tetherto/mdk-gateway/plugin\')',
      'const client = require(\'../lib/client\')',
      'module.exports = async function (req) {',
      '  return {',
      '    direct: { kernelKey: config.kernelKey, frozen: Object.isFrozen(config) },',
      '    viaClient: { kernelKey: client.kernelKey, bootstrap: client.bootstrap },',
      '    calls: client.count()',
      '  }',
      '}'
    ].join('\n')
  })
}

function makeContext (kernelKey) {
  return Object.freeze({
    config: Object.freeze({ kernelKey, kernelBootstrap: 'dht://boot' }),
    logger: () => {},
    dataProxy: {}
  })
}

test('handler and its lib/client.js both see the frozen ambient context', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'one')
  writeContextPlugin(dir, 'mdk-plugin-one')

  const plugin = loadPlugin(dir, makeContext('key-one'))
  const out = await plugin.routes[0]._handler({ params: {}, query: {}, body: {}, headers: {} })

  t.is(out.direct.kernelKey, 'key-one', 'controller read config from the ambient module')
  t.is(out.direct.frozen, true, 'config arrives frozen')
  t.is(out.viaClient.kernelKey, 'key-one', 'lib/client.js read the same config')
  t.is(out.viaClient.bootstrap, 'dht://boot', 'kernelBootstrap came through')
})

test('two plugins get private module registries — no state or context leaks', async (t) => {
  const dirA = path.join(FIXTURES_DIR, 'a')
  const dirB = path.join(FIXTURES_DIR, 'b')
  writeContextPlugin(dirA, 'mdk-plugin-a')
  writeContextPlugin(dirB, 'mdk-plugin-b')

  const a = loadPlugin(dirA, makeContext('key-a'))
  const b = loadPlugin(dirB, makeContext('key-b'))

  const outA = await a.routes[0]._handler({ query: {} })
  const outB = await b.routes[0]._handler({ query: {} })

  t.is(outA.direct.kernelKey, 'key-a', 'plugin a sees its own context')
  t.is(outB.direct.kernelKey, 'key-b', 'plugin b sees its own context')

  // client.js keeps a module-scope counter; each plugin's registry has its own.
  t.is(outA.calls, 1, 'plugin a client state starts fresh')
  t.is(outB.calls, 1, 'plugin b client state is not shared with a')

  const outA2 = await a.routes[0]._handler({ query: {} })
  t.is(outA2.calls, 2, 'plugin a client state persists across requests')
})

test('the same plugin dir loaded twice gets fresh module state per load', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'twice')
  writeContextPlugin(dir, 'mdk-plugin-twice')

  const first = loadPlugin(dir, makeContext('key-1'))
  const second = loadPlugin(dir, makeContext('key-2'))

  const out1 = await first.routes[0]._handler({ query: {} })
  const out2 = await second.routes[0]._handler({ query: {} })

  t.is(out1.direct.kernelKey, 'key-1', 'first load bound to its context')
  t.is(out2.direct.kernelKey, 'key-2', 'second load bound to the new context')
  t.is(out2.calls, 1, 'second load did not inherit the first load\'s client state')
})

test('the ambient stub throws ERR_NO_PLUGIN_CONTEXT outside a plugin load', (t) => {
  t.exception(
    () => require('../../../plugin'),
    /ERR_NO_PLUGIN_CONTEXT/,
    'requiring @tetherto/mdk-gateway/plugin directly names the missing context'
  )
})
