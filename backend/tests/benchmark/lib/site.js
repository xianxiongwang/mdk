'use strict'

// Shared boot primitives for the capacity/metrics benchmark harness — device
// seeding, Kernel/Worker boot, mock miner servers. config/benchmark.config.json
// is the single source of truth for topology (ports, discovery mode, which
// worker types/models/device counts to run); this module just wires it up.
// The device set isn't a fixed devices.json — it's generated per profile
// from a `workers` spec ([{ type, model, devices, simulateMocks }]) so the
// same code sizes every sweep.

const path = require('path')
const fs = require('fs')
const debug = require('debug')('mdk:benchmark:site')
const { getKernel, startGateway } = require('@tetherto/mdk-core')
const { publishWorkerKey, keysDir } = require('@tetherto/mdk-core/lib/local-discovery')
const { WORKER_REGISTRY, ALERT_INDUCTION, ALLOW_DUPLICATE_IPS, MOCK_PORT_RANGE, HOST, DISCOVERY, ROOT, KERNEL_DEFAULTS, GATEWAY_PLUGIN_DIR } = require('./constants')

const benchmarkDir = path.join(__dirname, '..')
const config = require(path.join(benchmarkDir, 'config', 'benchmark.config.json'))

function loadConfig () {
  return config
}

// Root data dir is namespaced per profile id so concurrent/sequential runs
// never share a Hyperbee store or worker-keys dir.
function profileRoot (profileId) {
  return path.join(benchmarkDir, ROOT, profileId)
}

function validateWorkerSpec ({ type, model }) {
  const entry = WORKER_REGISTRY[type]
  if (!entry) throw new Error(`ERR_UNSUPPORTED_WORKER_TYPE: ${type} (supported: ${Object.keys(WORKER_REGISTRY).join(', ')})`)
  if (!entry.models.includes(model)) throw new Error(`ERR_UNSUPPORTED_MODEL: ${model} for ${type} (supported: ${entry.models.join(', ')})`)
}

// scenarios/benchmark.js sweeps this entry's device count from
// ceiling.startDeviceCount up to ceiling.maxDeviceCount in
// ceiling.stepDeviceCount increments — start/step must fall inside
// [1, maxDeviceCount] or the sweep would start past its own ceiling or never
// move. maxDeviceCount: 0 is a sentinel for "uncapped" — the sweep keeps
// raising this entry's device count until a step goes red instead of
// stopping at a fixed ceiling, so start/step then only need to be >= 1.
// Only allowed when it's the only entry in config.workers: every entry now
// runs simultaneously and sweeps the Cartesian product of every entry's
// range, and an unbounded dimension can't be combined into a finite product.
function validateCeilingSpec ({ type, ceiling }, { allowUncapped }) {
  if (!ceiling) throw new Error(`ERR_MISSING_CEILING: workers[] entry for ${type} needs a ceiling: { startDeviceCount, stepDeviceCount, maxDeviceCount }`)
  const { startDeviceCount, stepDeviceCount, maxDeviceCount } = ceiling
  if (!Number.isInteger(maxDeviceCount) || maxDeviceCount < 0) {
    throw new Error(`ERR_INVALID_CEILING_MAX: ${type} ceiling.maxDeviceCount (${maxDeviceCount}) must be a non-negative integer (0 = uncapped, sweep until a step goes red)`)
  }
  if (maxDeviceCount === 0 && !allowUncapped) {
    throw new Error(`ERR_UNCAPPED_CEILING_WITH_MULTIPLE_WORKERS: ${type} ceiling.maxDeviceCount can only be 0 (uncapped) when it's the only entry in config.workers — with more than one entry, every ceiling.maxDeviceCount must be a positive integer so the Cartesian product of device counts stays finite`)
  }
  const upperBound = maxDeviceCount === 0 ? Infinity : maxDeviceCount
  if (!Number.isInteger(startDeviceCount) || startDeviceCount < 1 || startDeviceCount > upperBound) {
    throw new Error(`ERR_INVALID_CEILING_START: ${type} ceiling.startDeviceCount (${startDeviceCount}) must be an integer >= 1${maxDeviceCount === 0 ? '' : ` and <= maxDeviceCount (${maxDeviceCount})`}`)
  }
  if (!Number.isInteger(stepDeviceCount) || stepDeviceCount < 1 || stepDeviceCount > upperBound) {
    throw new Error(`ERR_INVALID_CEILING_STEP: ${type} ceiling.stepDeviceCount (${stepDeviceCount}) must be an integer >= 1${maxDeviceCount === 0 ? '' : ` and <= maxDeviceCount (${maxDeviceCount})`}`)
  }
}

for (const spec of config.workers) {
  validateWorkerSpec(spec)
  validateCeilingSpec(spec, { allowUncapped: config.workers.length === 1 })
}

// --- device seeding ------------------------------------------------------

function pickPort (usedPorts) {
  const { min, max } = MOCK_PORT_RANGE
  let port
  do { port = min + Math.floor(Math.random() * (max - min)) } while (usedPorts.has(port))
  usedPorts.add(port)
  return port
}

// Builds one worker (and its devices) per entry in `workerSpecs`
// ([{ type, model, devices, simulateMocks }]) — every device under a worker
// shares that worker's own randomly picked, run-unique mock port (one mock
// server per worker, not one per device) and the auth password the target
// worker type's mock defaults to. Also reserves a Gateway HTTP port from the
// same pool, so it can never collide with a worker's mock port.
//
// `usedPorts` can be passed in (and is mutated) so two device plans that
// will run concurrently on the same host — e.g. a real profile and its
// zero-device baseline — never pick colliding ports.
function makeDevicePlan ({ workers: workerSpecs, workerIdPrefix = 'bench-worker', usedPorts = new Set() }) {
  const devices = []

  const workers = workerSpecs.map((spec, w) => {
    validateWorkerSpec(spec)
    const { defaultPassword } = WORKER_REGISTRY[spec.type]
    const simulateMocks = spec.simulateMocks !== false
    const port = pickPort(usedPorts)

    const workerDevices = Array.from({ length: spec.devices }, (_, i) => {
      const device = {
        type: spec.type,
        model: spec.model,
        simulateMocks,
        info: { serialNum: `BENCH-${w}-${String(i + 1).padStart(5, '0')}`, container: 'bench-rack' },
        opts: {
          address: HOST,
          port,
          password: defaultPassword
        }
      }
      devices.push(device)
      return device
    })

    return { workerId: `${workerIdPrefix}-${w}`, type: spec.type, model: spec.model, port, password: defaultPassword, simulateMocks, devices: workerDevices }
  })

  const gatewayPort = pickPort(usedPorts)

  return { devices, workers, gatewayPort }
}

function devicePlanPath (root) {
  return path.join(root, 'device-plan.json')
}

function saveDevicePlan (root, devicePlan) {
  fs.writeFileSync(devicePlanPath(root), JSON.stringify(devicePlan))
}

function loadDevicePlan (root) {
  return JSON.parse(fs.readFileSync(devicePlanPath(root), 'utf8'))
}

// --- mock device servers ---------------------------------------------------

function mockHandles (mocks) {
  const ready = Promise.all(mocks.map((m) => m.ready))
  const close = () => { for (const m of mocks) { try { m.exit() } catch {} } }
  return { mocks, ready, close }
}

// One mock server per worker (not per device) — every device under a
// worker dials the same address:port, so they all hit this single server.
// Only `port`/`type`/`password` are needed per entry: `type` is the model
// (the same key `createServer` itself expects), and the worker family that
// owns that model is looked up in WORKER_REGISTRY rather than passed in,
// since model names never collide across families.
function findWorkerFamilyByModel (model) {
  const family = Object.keys(WORKER_REGISTRY).find((type) => WORKER_REGISTRY[type].models.includes(model))
  if (!family) throw new Error(`ERR_UNSUPPORTED_MODEL: no worker type in WORKER_REGISTRY supports model ${model}`)
  return family
}

function startMocks (specs) {
  return mockHandles(specs.map(({ port, type, password }) => {
    const family = findWorkerFamilyByModel(type)
    return WORKER_REGISTRY[family].mock.createServer({ port, host: HOST, type, password })
  }))
}

// --- Kernel + worker boot ------------------------------------------------------

// `mode`: 'local' (register the worker by the RPC key it publishes to the
// shared dir) or 'dht' (Hyperswarm topic; `topic` pins it).
async function bootKernel ({ root, topic, mode = DISCOVERY } = {}) {
  const opts = {
    root,
    storeDir: path.join(root, 'kernel-db'),
    telemetryPullMs: KERNEL_DEFAULTS.telemetryPullMs,
    healthPingMs: KERNEL_DEFAULTS.healthPingMs
  }
  if (mode === 'local') {
    opts.discovery = { mode: 'local' }
  } else {
    opts.topicFile = path.join(root, '.dht-topic')
    if (topic) opts.topic = topic
  }
  return getKernel(opts)
}

// With an in-process kernel handle, register directly and chain cleanup onto
// it; without one (split/multi-process mode), publish the RPC key to the
// shared local-discovery dir and bind SIGINT/SIGTERM.
async function registerWorker (handle, workerId, { kernel, root, mode }) {
  const rpcKey = handle.runtime.getPublicKey().toString('hex')
  if (kernel) {
    await kernel.registerWorker(handle.runtime.getPublicKey())
    if (Array.isArray(kernel._cleanup)) kernel._cleanup.push(() => handle.stop())
  } else {
    if (mode === 'local') publishWorkerKey(keysDir(root), workerId, rpcKey)
    const stop = () => { handle.stop().finally(() => process.exit(0)) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
}

function workerStoreDir (root, workerId) {
  const storeDir = path.join(root, 'workers', workerId, 'store')
  fs.mkdirSync(storeDir, { recursive: true })
  return storeDir
}

// `conf` is deliberately just allowDuplicateIPs plus alert induction —
// every other operating parameter (snap/store intervals, timeouts, ...) is
// left unset so the worker always boots on its own package defaults, never
// a benchmark-tuned override. Alert thresholds are the one exception (see
// ALERT_INDUCTION in lib/constants.js): without them AlertsService never
// evaluates anything, so the alerts path would stay permanently unmeasured
// rather than just soak-bound like everything else that needs a real wait.
async function bootWorker ({ workerId, type, model, kernel, kernelTopic, root, mode = DISCOVERY, devices }) {
  const { startWorker } = WORKER_REGISTRY[type]
  const induction = ALERT_INDUCTION[type]
  const deviceType = induction ? `miner-${induction.devicePrefix}-${model}` : null
  const handle = await startWorker({
    workerId,
    model,
    storeDir: workerStoreDir(root, workerId),
    conf: {
      allowDuplicateIPs: ALLOW_DUPLICATE_IPS,
      // thing.miner: {} isn't policy, it's a guard — AlertsService's base
      // pool-mismatch checks read ctx.thingConf.pools where ctx.thingConf is
      // this same thing.miner sub-object; left undefined, that access
      // throws inside the checked block and gets swallowed as a fake
      // "alert" (the exact TypeError message as its description). An empty
      // object makes `.pools` just undefined, so those checks correctly
      // no-op instead of misreporting as real alerts.
      ...(induction ? { thing: { alerts: { [deviceType]: induction.alerts }, miner: {} } } : {})
    },
    kernelTopic: (!kernel && mode !== 'local') ? kernelTopic : null,
    seedDevices: devices
  })

  await registerWorker(handle, workerId, { kernel, root, mode })
  debug('worker %s (%s/%s) up: %d devices', workerId, type, model, handle.services.provisioning.listDeviceIds().length)
  return handle
}

// Boots the one Gateway every profile run carries, loaded with the
// harness's own generic fleet-summary plugin (GATEWAY_PLUGIN_DIR) — never a
// site-specific plugin, so the harness stays device-family agnostic.
// noAuth: true since this is a throwaway benchmark instance, never a real
// deployment. env: 'test' is required (not just tmpdir) — startGateway's
// underlying corestore only honors an explicit tmpdir when env==='test';
// otherwise every Gateway process, across every profile, shares one
// CWD-relative corestore path and any two whose lifetimes overlap in time
// (e.g. two profile runs started close together) hit an FD lock collision.
async function bootGateway ({ root, port, kernelKey }) {
  const gatewayRoot = path.join(root, 'gateway')
  fs.mkdirSync(gatewayRoot, { recursive: true })
  return startGateway({
    noAuth: true,
    env: 'test',
    kernelKey,
    port,
    root: gatewayRoot,
    tmpdir: gatewayRoot,
    extraPluginDirs: [GATEWAY_PLUGIN_DIR]
  })
}

module.exports = {
  benchmarkDir,
  config,
  HOST,
  DISCOVERY,
  loadConfig,
  profileRoot,
  makeDevicePlan,
  saveDevicePlan,
  loadDevicePlan,
  startMocks,
  bootKernel,
  bootWorker,
  bootGateway,
  registerWorker,
  workerStoreDir
}
