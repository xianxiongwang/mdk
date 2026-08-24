'use strict'

const mdkClient = require('./client')

// The vocabularies the agent tool contract defines. Duplicated rather than
// imported: this plugin is CJS and the contract ships as ESM.
const AXIS = {
  family: ['miner', 'container', 'powermeter', 'sensor', 'pool', 'all'],
  state: ['all', 'online', 'offline', 'error'],
  metric: ['hashrate', 'power', 'temperature', 'efficiency', 'uptime'],
  order: ['desc', 'asc']
}

// Device ids here are UUIDs, so the owning worker's id is the family signal.
const WORKER_FAMILY = [
  { test: /powermeter|power-meter|satec|meter/i, family: 'powermeter' },
  { test: /pool/i, family: 'pool' },
  { test: /sensor|temperature/i, family: 'sensor' },
  { test: /container/i, family: 'container' },
  { test: /miner/i, family: 'miner' }
]
function classifyWorker (workerId) {
  const match = WORKER_FAMILY.find((e) => e.test.test(workerId))
  return match ? match.family : 'other'
}

// One row per device, with readiness expressed in the contract's state vocabulary.
function collectDevices (status) {
  const rows = []
  for (const w of (status?.workers ?? [])) {
    const state = w.state === 'READY' ? 'online' : 'offline'
    for (const id of (w.deviceIds ?? [])) {
      rows.push({ deviceId: id, family: classifyWorker(w.workerId), state, worker: w.workerId })
    }
  }
  return rows
}

const matches = (row, family, state) =>
  (family === 'all' || row.family === family) && (state === 'all' || row.state === state)

const plural = (family, n) => `${family === 'all' ? 'device' : family}${n === 1 ? '' : 's'}`

const METRIC_FIELDS = {
  hashrate: ['hashrate_avg', 'hashrate_rt', 'hashrate'],
  power: ['power', 'active_power'],
  temperature: ['temperature'],
  efficiency: ['efficiency'],
  uptime: ['uptime']
}
function readMetric (telemetry, metric) {
  const metrics = telemetry?.metrics ?? telemetry ?? {}
  for (const field of METRIC_FIELDS[metric]) {
    if (typeof metrics[field] === 'number') return metrics[field]
  }
  return null
}

// Fan out in bounded batches — one Promise.all over the whole fleet would
// open that many HRPC calls at once.
const TELEMETRY_CONCURRENCY = 8
async function mapInBatches (items, fn) {
  const results = []
  for (let i = 0; i < items.length; i += TELEMETRY_CONCURRENCY) {
    results.push(...await Promise.all(items.slice(i, i + TELEMETRY_CONCURRENCY).map(fn)))
  }
  return results
}

// Keyed by contract metadata.brand — the owning worker's contract is the
// only power-mode signal for a UUID device id.
const POWER_MODES_BY_BRAND = {
  Whatsminer: ['low', 'normal', 'high', 'sleep'],
  Antminer: ['sleep', 'normal'],
  Avalon: ['normal', 'high', 'sleep']
}
async function powerModesFor (deviceId) {
  const cfg = await mdkClient.pullTelemetry(deviceId, { type: 'config' }).catch(() => null)
  const brand = cfg?.config?.contract?.brand
  const modes = brand ? POWER_MODES_BY_BRAND[brand] : null
  return modes
    ? { deviceId, brand, supportedPowerModes: modes }
    : { deviceId, supportedPowerModes: null, reason: 'device type not recognised' }
}

const json = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] })

module.exports = { AXIS, classifyWorker, collectDevices, matches, plural, readMetric, mapInBatches, powerModesFor, json }
