'use strict'

const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')

const WorkerRuntimeV2 = require('../../lib/worker-runtime-v2')
const { ACTIONS, MESSAGE_TYPES, PROTOCOL_VERSION } = require('../../../kernel/lib/protocol/actions')

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'contract-worker')

const DEVICES = [
  { deviceId: 'cw-a', config: { label: 'device-a' } },
  { deviceId: 'cw-b', config: { label: 'device-b' } }
]

// Mirrors worker-runtime.test.js's own convention: call _openContexts()
// directly rather than start(), so the test never touches real HRPC/DHT
// networking.
async function createRuntime (dir = FIXTURE_DIR, opts = {}) {
  const runtime = new WorkerRuntimeV2(dir, { workerId: 'cw-rack-1', devices: DEVICES, ...opts })
  await runtime._openContexts()
  return runtime
}

function req (action, payload = {}, deviceId = null) {
  return {
    id: 'req-1',
    version: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.REQUEST,
    action,
    sender: 'kernel:kernel:test',
    target: null,
    deviceId,
    timestamp: Date.now(),
    payload
  }
}

function pullStatus (runtime, deviceId) {
  return runtime.handleRequest(req(ACTIONS.TELEMETRY_PULL, { query: { type: 'status' } }, deviceId))
}

function pullHealth (runtime, deviceId) {
  return runtime.handleRequest(req(ACTIONS.TELEMETRY_PULL, { query: { type: 'health' } }, deviceId))
}

function runEcho (runtime, deviceId, value) {
  return runtime.handleRequest(req(ACTIONS.COMMAND_REQUEST, {
    commandId: `cmd-${deviceId}`,
    command: 'echo',
    params: { value }
  }, deviceId))
}

// Builds a throwaway directory-loaded plugin on disk for the negative-path
// tests: WorkerRuntimeV2 takes a directory, so an in-memory contract (the
// technique plugin-loader.test.js uses for its own negative cases) is not an
// option here — the file has to actually exist for loadContract/createInstance
// to resolve and (for the bad-handler case) require it.
function writeTempPlugin (t, { contract, handlerSource, files }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdk-worker-v2-test-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))

  if (contract) fs.writeFileSync(path.join(dir, 'mdk-contract.json'), JSON.stringify(contract, null, 2))
  if (handlerSource) {
    fs.mkdirSync(path.join(dir, 'src', 'commands'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'commands', 'broken.js'), handlerSource)
  }
  // `files`: { 'relative/path.js': source } — for fixtures that need a
  // handler at an arbitrary path (e.g. a plugin-declared src/telemetry/health.js).
  for (const [rel, source] of Object.entries(files || {})) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, source)
  }
  return dir
}

function badHandlerContract () {
  return {
    metadata: {
      provider: 'test',
      deviceFamily: 'sensor',
      brand: 'BrokenFixture',
      modelsSupported: ['BR-1'],
      overview: 'Throwaway contract whose command handler does not export a function.'
    },
    capabilities: {
      telemetry: [],
      commands: [{ name: 'broken', handler: 'src/commands/broken.js', params: [] }],
      health: { supportedStates: ['OK'] },
      errors: {}
    }
  }
}

function zeroTelemetryContract () {
  return {
    metadata: {
      provider: 'test',
      deviceFamily: 'sensor',
      brand: 'ZeroTelemetryFixture',
      modelsSupported: ['ZT-1'],
      overview: 'Contract declaring zero telemetry channels of its own, to prove the builtin `health` entry is genuinely synthesized onto entry.instance.telemetry rather than answered from runtime-level bookkeeping.'
    },
    capabilities: {
      telemetry: [],
      commands: [],
      health: { supportedStates: ['OK'] },
      errors: {}
    }
  }
}

function customHealthContract () {
  return {
    metadata: {
      provider: 'test',
      deviceFamily: 'sensor',
      brand: 'CustomHealthFixture',
      modelsSupported: ['CH-1'],
      overview: 'Contract that declares its own "health" telemetry channel — a real plugin handler must win over the builtin auto-injected one.'
    },
    capabilities: {
      telemetry: [{ name: 'health', handler: 'src/telemetry/health.js', description: 'Plugin-declared health channel.' }],
      commands: [],
      health: { supportedStates: ['OK'] },
      errors: {}
    }
  }
}

test('constructor requires a directory', (t) => {
  t.exception(() => new WorkerRuntimeV2(), /ERR_WORKER_DIR_REQUIRED/)
  t.exception(() => new WorkerRuntimeV2(''), /ERR_WORKER_DIR_REQUIRED/)
})

test('loads by directory and boots successfully', async (t) => {
  const runtime = await createRuntime()

  const state = await runtime.handleRequest(req(ACTIONS.STATE_PULL))
  t.alike(state.payload.state, {
    'cw-a': { status: 'online' },
    'cw-b': { status: 'online' }
  }, 'no connect-time probe: every declared device reports online')
})

test('capability response has handler paths stripped from the published contract', async (t) => {
  const runtime = await createRuntime()
  const res = await runtime.handleRequest(req(ACTIONS.CAPABILITY_REQUEST))

  t.is(res.action, ACTIONS.CAPABILITY_RESPONSE)
  const contract = res.payload.contract
  t.alike(contract.capabilities.telemetry.map((e) => e.name), ['status'])
  t.alike(contract.capabilities.commands.map((e) => e.name), ['echo'])
  for (const entry of [...contract.capabilities.telemetry, ...contract.capabilities.commands]) {
    t.is(entry.handler, undefined, `${entry.name} has no handler field`)
  }
})

test('each device sees its own device.id/opts and the shared frozen env', async (t) => {
  const runtime = await createRuntime(FIXTURE_DIR, { env: { TOKEN: 'shared-secret' } })

  const resA = await pullStatus(runtime, 'cw-a')
  const resB = await pullStatus(runtime, 'cw-b')

  t.is(resA.payload.value.id, 'cw-a')
  t.alike(resA.payload.value.opts, { label: 'device-a' })
  t.is(resB.payload.value.id, 'cw-b')
  t.alike(resB.payload.value.opts, { label: 'device-b' })

  // Shared env: same frozen object reference reaches every device.
  t.alike(resA.payload.value.env, { TOKEN: 'shared-secret' })
  t.is(resA.payload.value.env, resB.payload.value.env, 'both instances share the identical env object')
  t.ok(Object.isFrozen(resA.payload.value.env), 'env is frozen')

  // Commands see the same per-device values as telemetry.
  const cmdA = await runEcho(runtime, 'cw-a', 'hi-a')
  const cmdB = await runEcho(runtime, 'cw-b', 'hi-b')
  t.alike(cmdA.payload.result, { deviceId: 'cw-a', opts: { label: 'device-a' }, value: 'hi-a' })
  t.alike(cmdB.payload.result, { deviceId: 'cw-b', opts: { label: 'device-b' }, value: 'hi-b' })
})

test('module-level state in one instance is invisible to the other', async (t) => {
  const runtime = await createRuntime()

  const a1 = await pullStatus(runtime, 'cw-a')
  const a2 = await pullStatus(runtime, 'cw-a')
  t.is(a1.payload.value.calls, 1)
  t.is(a2.payload.value.calls, 2, 'cw-a\'s own module-level counter incremented')

  const b1 = await pullStatus(runtime, 'cw-b')
  t.is(b1.payload.value.calls, 1, 'cw-b has its own private copy of the handler module, unaffected by cw-a\'s calls')
})

test('a node_modules dependency is the same object across both instances and the process cache', async (t) => {
  const runtime = await createRuntime()

  const resA = await pullStatus(runtime, 'cw-a')
  const resB = await pullStatus(runtime, 'cw-b')

  t.is(resA.payload.value.debugModule, resB.payload.value.debugModule, 'both device instances share one debug module')
  t.is(resA.payload.value.debugModule, require('debug'), 'and it is the very same module the test process itself resolves')
})

test('requiring the ambient device module outside any instance throws ERR_NO_DEVICE_CONTEXT', (t) => {
  t.exception(() => require('../../device'), /ERR_NO_DEVICE_CONTEXT/)
})

// Regression coverage for the builtin per-device health check: this is what
// proves gateway→kernel→worker deviceId routing reaches that device's own
// running instance code — not just the runtime's own bookkeeping. `health`
// is registered as a plain shim in v1's own handler table (see the
// WorkerRuntimeV2 constructor), so it is dispatched exactly like any real
// contract-declared telemetry channel — no special casing, and the response
// comes back in v1's standard `_pullChannel` shape: `{ name, value }`. The
// fixture contract declares no `health` telemetry channel of its own — the
// builtin answers it anyway.
test('health query addressed to a deviceId returns exactly that device\'s own config, in the standard { name, value } channel shape', async (t) => {
  const runtime = await createRuntime(FIXTURE_DIR, { env: { TOKEN: 'shared-secret' } })

  const res = await pullHealth(runtime, 'cw-a')
  t.is(res.action, ACTIONS.TELEMETRY_RESPONSE)
  t.is(res.payload.deviceId, 'cw-a')
  t.is(res.payload.name, 'health', 'health dispatches through the exact same shape as any real named telemetry channel')
  t.is(res.payload.value.status, 'OK')
  t.is(res.payload.value.id, 'cw-a')
  t.alike(res.payload.value.opts, { label: 'device-a' })
  t.alike(res.payload.value.env, { TOKEN: 'shared-secret' })
  t.is(res.payload.value.workerId, 'cw-rack-1')
})

test('health query is not shadowed by (and does not require) a contract-declared channel', async (t) => {
  const runtime = await createRuntime()
  const contract = (await runtime.handleRequest(req(ACTIONS.CAPABILITY_REQUEST))).payload.contract
  t.absent(contract.capabilities.telemetry.some((e) => e.name === 'health'), 'fixture contract declares no "health" channel')

  const res = await pullHealth(runtime, 'cw-b')
  t.is(res.payload.value.id, 'cw-b')
})

test('the health shim resolves to a genuine function on entry.instance.telemetry, auto-injected even when the contract declares zero telemetry channels', async (t) => {
  const dir = writeTempPlugin(t, { contract: zeroTelemetryContract() })
  const runtime = new WorkerRuntimeV2(dir, {
    workerId: 'zt-rack',
    devices: [{ deviceId: 'zt-a', config: { label: 'zt-device-a' } }]
  })
  await runtime._openContexts()

  const entry = runtime._devices.get('zt-a')
  t.ok(entry.instance.telemetry.has('health'), 'health is registered directly on the instance, not on runtime bookkeeping')
  t.is(entry.instance.telemetry.size, 1, 'the contract declared no telemetry channels of its own')
  t.ok(runtime._plugin.handlers.telemetry.has('health'), 'and a shim for it is registered in v1\'s own handler table, same as any real channel')

  // Calling the instance entry directly, with no runtime/envelope involved at
  // all, proves it is a real per-instance function closed over this device.
  const direct = await entry.instance.telemetry.get('health')()
  t.is(direct.id, 'zt-a')
  t.alike(direct.opts, { label: 'zt-device-a' })

  // The same result reached through the normal TELEMETRY_PULL dispatch path
  // — v1's own _pullChannel, with zero special-casing in WorkerRuntimeV2.
  const res = await pullHealth(runtime, 'zt-a')
  t.is(res.payload.name, 'health')
  t.is(res.payload.value.id, 'zt-a')
  t.alike(res.payload.value.opts, { label: 'zt-device-a' })
})

test('a plugin-declared "health" telemetry channel wins over the builtin auto-injected one', async (t) => {
  const dir = writeTempPlugin(t, {
    contract: customHealthContract(),
    files: { 'src/telemetry/health.js': "'use strict'\n\nmodule.exports = async () => ({ custom: true })\n" }
  })
  const runtime = new WorkerRuntimeV2(dir, { workerId: 'ch-rack', devices: [{ deviceId: 'ch-a', config: {} }] })
  await runtime._openContexts()

  const entry = runtime._devices.get('ch-a')
  const direct = await entry.instance.telemetry.get('health')()
  t.alike(direct, { custom: true }, 'the plugin\'s own handler is registered on the instance, not the builtin one')

  // The constructor's own .has() guard must not have clobbered the shim the
  // normal contract-loading path already installed for this declared channel.
  const res = await pullHealth(runtime, 'ch-a')
  t.is(res.payload.name, 'health')
  t.alike(res.payload.value, { custom: true }, 'TELEMETRY_PULL type=health dispatches to the plugin\'s own handler')
})

test('health query on multiple devices returns distinct configs with no cross-device leakage', async (t) => {
  const many = [
    { deviceId: 'cw-a', config: { label: 'device-a', port: 18080 } },
    { deviceId: 'cw-b', config: { label: 'device-b', port: 18081 } },
    { deviceId: 'cw-c', config: { label: 'device-c', port: 18082 } }
  ]
  const runtime = await createRuntime(FIXTURE_DIR, { devices: many })

  const results = {}
  for (const { deviceId } of many) {
    results[deviceId] = (await pullHealth(runtime, deviceId)).payload.value
  }

  for (const { deviceId, config } of many) {
    t.is(results[deviceId].id, deviceId, `${deviceId} health reports its own id`)
    t.alike(results[deviceId].opts, config, `${deviceId} health reports its own opts`)
  }

  // No two devices' opts are the same object or value — proves the runtime
  // resolved the addressed device's own entry each time, never a sibling's.
  t.not(results['cw-a'].opts.port, results['cw-b'].opts.port)
  t.not(results['cw-b'].opts.port, results['cw-c'].opts.port)
  t.not(results['cw-a'].opts, results['cw-b'].opts)
})

test('health query for an unknown deviceId reports ERR_DEVICE_NOT_FOUND', async (t) => {
  const runtime = await createRuntime()
  const res = await pullHealth(runtime, 'cw-999')
  t.is(res.payload.error, 'ERR_DEVICE_NOT_FOUND: cw-999')
})

// health is now dispatched with zero special-casing, exactly like any real
// named telemetry channel — and a real channel requires a deviceId, so this
// is the correct (and expected) behavior, not a regression: there is no more
// bespoke "aggregate across every device" response for a deviceId-less
// health query. (Multi-device coverage lives in the per-deviceId-loop test
// above, mirroring how the live E2E check exercises it.)
test('health query without a deviceId reports ERR_DEVICE_ID_REQUIRED, exactly like any other named telemetry channel', async (t) => {
  const runtime = await createRuntime()
  const res = await runtime.handleRequest(req(ACTIONS.TELEMETRY_PULL, { query: { type: 'health' } }))
  t.is(res.payload.error, 'ERR_DEVICE_ID_REQUIRED: health')
})

// Documents the accepted side effect of registering `health` into the same
// handler table _collectMetrics() iterates for the default `type: 'metrics'`
// pull: every device's metrics aggregate now also carries a `health` key.
test('the default metrics pull now also includes a "health" key, since it shares the same handler table', async (t) => {
  const runtime = await createRuntime(FIXTURE_DIR, { env: { TOKEN: 'shared-secret' } })
  const res = await runtime.handleRequest(req(ACTIONS.TELEMETRY_PULL, { query: { type: 'metrics' } }, 'cw-a'))

  t.ok('health' in res.payload.metrics, 'the metrics aggregate now carries the builtin health entry too')
  t.is(res.payload.metrics.health.id, 'cw-a')
  t.alike(res.payload.metrics.health.opts, { label: 'device-a' })
  // The fixture's own declared channel is still present alongside it.
  t.ok('status' in res.payload.metrics, 'the plugin\'s own declared channel is unaffected')
})

test('a missing mdk-contract.json throws ERR_CONTRACT_NOT_FOUND when constructing WorkerRuntimeV2', (t) => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdk-worker-v2-empty-'))
  t.teardown(() => fs.rmSync(emptyDir, { recursive: true, force: true }))

  t.exception(
    () => new WorkerRuntimeV2(emptyDir, { workerId: 'w', devices: [{ deviceId: 'd1', config: {} }] }),
    /ERR_CONTRACT_NOT_FOUND/
  )
})

test('a handler that does not export a function throws ERR_INSTANCE_HANDLER_NOT_FUNCTION naming the device', async (t) => {
  const dir = writeTempPlugin(t, {
    contract: badHandlerContract(),
    handlerSource: "'use strict'\n\nmodule.exports = { notAFunction: true }\n"
  })

  // loadContract only resolves handler paths on disk without executing them,
  // so construction itself succeeds — the export-type check is createInstance's
  // job and only runs when the runtime actually opens a device context.
  const runtime = new WorkerRuntimeV2(dir, { workerId: 'w', devices: [{ deviceId: 'bad-device', config: {} }] })

  await t.exception(runtime._openContexts(), /ERR_INSTANCE_HANDLER_NOT_FUNCTION: bad-device: commands\.broken/)
})
