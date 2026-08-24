'use strict'

const os = require('os')
const path = require('path')
const fs = require('fs')
const WorkerRuntimeV2 = require('@tetherto/mdk-worker/lib/worker-runtime-v2')
const demoMock = require('@tetherto/mdk-worker-demo/mock/server')

const WORKER_DIR = path.dirname(require.resolve('@tetherto/mdk-worker-demo/package.json'))

// This is the "caller": the demo-worker package is a directory-loaded Worker
// Plugin (mdk-contract.json + src/ handlers) — it never touches WorkerRuntime
// itself. Hosting it (pointing WorkerRuntimeV2 at the package directory,
// owning process lifecycle) is entirely this caller's job. WorkerRuntimeV2
// builds one plugin instance per device itself, so the caller's only
// remaining job is process lifecycle: booting the firmware mocks, starting
// the runtime, and polling telemetry via runtime.handleRequest — no sampler
// loop, no SQLite handle, no plugin module of its own.
//
// seedDevices uses the same { id, opts } shape as the other worker seeds;
// opts is this plugin's own config ({ host, port }).
async function startDemoWorker ({ workerId, storeDir, kernelTopic, seedDevices }) {
  fs.mkdirSync(storeDir, { recursive: true })
  const dbPath = path.join(storeDir, 'demo-worker.db')

  const devices = (seedDevices || []).map((d) => ({
    deviceId: d.id,
    config: { ...d.opts, dbPath }
  }))
  const deviceIds = devices.map((d) => d.deviceId)

  const runtime = new WorkerRuntimeV2(WORKER_DIR, {
    workerId,
    kernelTopic: kernelTopic || null,
    devices,
    storeDir,
    env: { DEVICE_TOKEN: process.env.WM_V3_TOKEN || '' }
  })
  await runtime.start()

  return {
    runtime,
    dbPath,
    deviceIds,
    seeded: 0,
    async stop () {
      await runtime.stop()
    }
  }
}

// Manual runner: boots real firmware v3 mocks, hosts the demo-worker plugin
// on WorkerRuntimeV2 against them (via startDemoWorker above), and polls
// telemetry on an interval.

const READ_ITV_MS = 3000
const MOCKS = [
  { id: 'v3-0', port: 18080, serial: 'WM3-DEMO-0', hashrateThs: 200, powerW: 3500 },
  { id: 'v3-1', port: 18081, serial: 'WM3-DEMO-1', hashrateThs: 180, powerW: 3300 }
]

function envelope (deviceId, action, payload) {
  return {
    id: `req-${deviceId}-${Date.now()}`,
    version: '0.1.0',
    type: 'request',
    action,
    sender: 'demo-worker-caller:run',
    target: null,
    deviceId,
    timestamp: Date.now(),
    payload
  }
}

async function readDevice (runtime, deviceId) {
  const metricsRes = await runtime.handleRequest(envelope(deviceId, 'telemetry.pull', { query: { type: 'metrics' } }))
  const historyRes = await runtime.handleRequest(envelope(deviceId, 'telemetry.pull', { query: { type: 'history', limit: 3 } }))
  const m = metricsRes.payload.metrics
  const history = historyRes.payload.value
  console.log(
    `[${new Date().toISOString()}] ${deviceId} ` +
    `hashrate=${m.hashrate_rt.toFixed(1)}THs power=${m.power.toFixed(0)}W ` +
    `temp=${m.temperature.toFixed(1)}C mode=${m.power_mode} history_rows=${history.length}`
  )
}

async function main () {
  const root = path.join(os.tmpdir(), `demo-worker-run-${process.pid}`)
  fs.rmSync(root, { recursive: true, force: true })

  const mocks = MOCKS.map((d) => demoMock.createServer({
    host: '127.0.0.1', port: d.port, serial: d.serial, hashrateThs: d.hashrateThs, powerW: d.powerW
  }))

  const handle = await startDemoWorker({
    workerId: 'demo-worker-run',
    storeDir: path.join(root, 'store'),
    seedDevices: MOCKS.map((d) => ({ id: d.id, opts: { host: '127.0.0.1', port: d.port } }))
  })

  console.log(`demo-worker running (workerId=demo-worker-run, devices=${handle.deviceIds.join(', ')})`)
  console.log(`reading every ${READ_ITV_MS}ms — Ctrl+C to stop\n`)

  const reader = setInterval(() => {
    for (const deviceId of handle.deviceIds) {
      readDevice(handle.runtime, deviceId).catch((err) => {
        console.error(`[${deviceId}] read error: ${err.message}`)
      })
    }
  }, READ_ITV_MS)

  const shutdown = async () => {
    clearInterval(reader)
    await handle.stop()
    for (const mock of mocks) mock.exit()
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

module.exports = { startDemoWorker }

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
