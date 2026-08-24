'use strict'

const test = require('brittle')
const { buildPluginContext } = require('../../../workers/lib/plugin-gateway')

function makeWrk () {
  return {
    conf: { site: { name: 'test-site' }, ttl: 300 },
    ctx: { kernelKey: 'a'.repeat(64), kernelBootstrap: null }
  }
}

test('plugin context - request-time surface: config', (t) => {
  const wrk = makeWrk()
  const { context } = buildPluginContext(wrk, '/plugins/thing')

  t.is(context.config.kernelKey, 'a'.repeat(64), 'kernelKey from ctx')
  t.alike(context.config.site, { name: 'test-site' }, 'gateway conf spread into config')
  t.ok(Object.isFrozen(context.config), 'config frozen')
  t.ok(Object.isFrozen(context), 'context frozen')
})

test('plugin context - per-plugin config merges over the gateway conf', (t) => {
  const wrk = makeWrk()
  const { context } = buildPluginContext(wrk, '/plugins/thing', {
    ttl: 60,
    agent: { provider: { kind: 'qvac' } }
  })

  t.is(context.config.ttl, 60, 'plugin config wins over gateway conf')
  t.alike(context.config.agent, { provider: { kind: 'qvac' } }, 'plugin-only keys visible')
  t.alike(context.config.site, { name: 'test-site' }, 'gateway conf still spread underneath')
  t.ok(Object.isFrozen(context.config), 'config still frozen')
})
