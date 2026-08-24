'use strict'

// Contract-level test: exercises the Worker Plugin (contract + handlers)
// directly through loadContract() + createInstance(), with no WorkerRuntime in
// the loop — demo-worker never depends on it. Hosting the plugin on
// WorkerRuntimeV2 (envelope dispatch, multi-device routing) is covered by the
// caller example's own tests, see
// examples/backend/demo-worker-caller/tests/unit/worker.test.js.

const test = require('brittle')
const os = require('os')
const path = require('path')
const net = require('net')
const { DatabaseSync } = require('node:sqlite')

const { loadContract, createInstance } = require('@tetherto/mdk-worker')
const demoMock = require('../../mock/server')

const PKG_DIR = path.join(__dirname, '..', '..')

// The instance's own db.js binds to the ambient device (like client.js) and
// lives in its private, per-device module registry, so it is not reachable
// from outside. The test observes what a handler wrote the way any external
// reader would: by opening the same SQLite file directly, exactly as two
// independent processes sharing one dbPath would. The instance under test
// always opens (and creates the tables in) dbPath first, so this connection
// only ever reads/writes a file that already has them.
function openTestDb (dbPath) {
  const db = new DatabaseSync(dbPath)
  const insertSample = db.prepare(
    'INSERT INTO telemetry (device_id, ts, hashrate_ths, power_w, board_temp_c) VALUES (?, ?, ?, ?, ?)')
  const selectCommands = db.prepare(
    'SELECT ts, command, params, result FROM commands WHERE device_id = ? ORDER BY ts DESC LIMIT ?')
  return {
    recordSample (deviceId, summary) {
      insertSample.run(deviceId, Date.now(), summary.hashrate_ths, summary.power_w, summary.board_temp_c)
    },
    recentCommands (deviceId, limit) {
      return selectCommands.all(deviceId, limit).map((row) => ({
        ...row, params: JSON.parse(row.params), result: JSON.parse(row.result)
      }))
    }
  }
}

function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

function tmpDbPath (tag) {
  return path.join(os.tmpdir(), `demo-worker-handlers-test-${tag}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.db`)
}

async function createDevice (t, opts = {}) {
  const port = opts.port || (await freePort())
  const mock = demoMock.createServer({ host: '127.0.0.1', port, serial: opts.serial || 'WM3-T1', hashrateThs: opts.hashrateThs, powerW: opts.powerW })
  t.teardown(() => mock.exit())

  const deviceId = opts.deviceId || 'v3-0'
  const dbPath = opts.dbPath || tmpDbPath(deviceId)
  const instance = createInstance({
    dir: PKG_DIR,
    entries: loadContract(PKG_DIR).entries,
    device: { id: deviceId, opts: { host: '127.0.0.1', port, dbPath }, env: {}, config: {} }
  })

  return { mock, instance, deviceId, dbPath }
}

test('directory-loaded plugin: every contract entry has a working handler module', (t) => {
  const loaded = loadContract(PKG_DIR)
  t.is(loaded.entries.telemetry.size, 5)
  t.is(loaded.entries.commands.size, 2)
  for (const entry of loaded.publishedContract.capabilities.telemetry) {
    t.is(entry.handler, undefined, `${entry.name} handler path stripped from published contract`)
  }

  // The boot rule now also proves out per instance: every resolved handler
  // path loads to a function once bound to a device.
  const instance = createInstance({
    dir: PKG_DIR,
    entries: loaded.entries,
    device: { id: 'v3-boot', opts: { host: '127.0.0.1', port: 1, dbPath: tmpDbPath('boot') }, env: {}, config: {} }
  })
  for (const fn of instance.telemetry.values()) t.is(typeof fn, 'function')
  for (const fn of instance.commands.values()) t.is(typeof fn, 'function')
})

test('a telemetry handler rejects when the device is unreachable', async (t) => {
  const port = await freePort()
  const dbPath = tmpDbPath('offline')
  // Nothing is listening on this port. With no boot-time connect probe, the
  // instance itself builds fine — the failure moves from boot to call time.
  const instance = createInstance({
    dir: PKG_DIR,
    entries: loadContract(PKG_DIR).entries,
    device: { id: 'v3-x', opts: { host: '127.0.0.1', port, dbPath }, env: {}, config: {} }
  })

  // fetch's connection-refused rejection is a TypeError, which plain
  // t.exception treats as an uncaught bug rather than an expected rejection.
  await t.exception.all(instance.telemetry.get('hashrate_rt')({}))
})

test('telemetry handlers translate the v3 firmware summary', async (t) => {
  const { instance } = await createDevice(t, { hashrateThs: 200, powerW: 3500 })

  const hashrate = await instance.telemetry.get('hashrate_rt')({})
  t.ok(hashrate > 190 && hashrate < 210, `hashrate_rt ${hashrate} TH/s`)

  const power = await instance.telemetry.get('power')({})
  t.ok(power > 3400 && power < 3600, `power ${power} W`)

  const temperature = await instance.telemetry.get('temperature')({})
  t.ok(typeof temperature === 'number', `temperature ${temperature} C`)

  const powerMode = await instance.telemetry.get('power_mode')({})
  t.is(powerMode, 'normal', 'power_mode defaults to normal')
})

test('setPowerMode command dispatches to the firmware and records a SQLite audit row', async (t) => {
  const { instance, mock, deviceId, dbPath } = await createDevice(t)

  const result = await instance.commands.get('setPowerMode')({ mode: 'eco' })
  t.is(result.power_mode, 'eco', 'firmware switched to eco')
  t.is(mock.state.powerMode, 'eco', 'mock state updated')

  const audit = openTestDb(dbPath).recentCommands(deviceId, 5)
  t.is(audit.length, 1, 'one audit row recorded')
  t.is(audit[0].command, 'setPowerMode')
  t.is(audit[0].params.mode, 'eco')

  // The site UI's low mode is translated to the firmware's eco.
  const alias = await instance.commands.get('setPowerMode')({ mode: 'low' })
  t.is(alias.power_mode, 'eco', 'low alias mapped onto the firmware eco mode')
})

test('reboot command records an audit row', async (t) => {
  const { instance, deviceId, dbPath } = await createDevice(t)

  const result = await instance.commands.get('reboot')({})
  t.is(result.rebooting, true)

  const audit = openTestDb(dbPath).recentCommands(deviceId, 5)
  t.is(audit.length, 1)
  t.is(audit[0].command, 'reboot')
})

test('history channel reads back rows written via the device\'s own db', async (t) => {
  const { instance, deviceId, dbPath } = await createDevice(t)

  // Nothing auto-samples anymore: the test calls db.recordSample itself,
  // exactly like the old test did via ctx.device.db.recordSample — but now
  // the db comes from the same dbPath the instance was built against.
  const db = openTestDb(dbPath)
  db.recordSample(deviceId, { hashrate_ths: 200, power_w: 3500, board_temp_c: 60 })
  db.recordSample(deviceId, { hashrate_ths: 202, power_w: 3510, board_temp_c: 61 })

  const rows = await instance.telemetry.get('history')({ limit: 1 })
  t.is(rows.length, 1, 'limit respected')
  t.ok(typeof rows[0].hashrate_ths === 'number' && typeof rows[0].power_w === 'number', 'row carries the sampled fields')
})

test('setPowerMode with an invalid mode surfaces ERR_BAD_POWER_MODE', async (t) => {
  const { instance } = await createDevice(t)

  await t.exception(instance.commands.get('setPowerMode')({ mode: 'ludicrous' }), /ERR_BAD_POWER_MODE/)
})

test('two devices sharing a dbPath keep independent audit trails and get distinct HTTP clients', async (t) => {
  const portA = await freePort()
  const portB = await freePort()
  const mockA = demoMock.createServer({ host: '127.0.0.1', port: portA, serial: 'WM3-A' })
  const mockB = demoMock.createServer({ host: '127.0.0.1', port: portB, serial: 'WM3-B' })
  t.teardown(() => { mockA.exit(); mockB.exit() })

  const dbPath = tmpDbPath('shared')
  const entries = loadContract(PKG_DIR).entries
  const instanceA = createInstance({
    dir: PKG_DIR,
    entries,
    device: { id: 'v3-a', opts: { host: '127.0.0.1', port: portA, dbPath }, env: {}, config: {} }
  })
  const instanceB = createInstance({
    dir: PKG_DIR,
    entries,
    device: { id: 'v3-b', opts: { host: '127.0.0.1', port: portB, dbPath }, env: {}, config: {} }
  })

  await instanceA.commands.get('setPowerMode')({ mode: 'eco' })

  // Distinct HTTP clients: createInstance built A and B against their own
  // opts.port, so A's command reached only its own firmware mock.
  t.is(mockA.state.powerMode, 'eco', 'device A firmware switched to eco')
  t.is(mockB.state.powerMode, 'normal', 'device B firmware untouched — createInstance isolation, not a shared client')

  const hashrateA = await instanceA.telemetry.get('hashrate_rt')({})
  const hashrateB = await instanceB.telemetry.get('hashrate_rt')({})
  t.ok(typeof hashrateA === 'number' && typeof hashrateB === 'number', 'both instances independently reach their own firmware mock')

  // Independent audit trails: each instance's db.recordCommand call landed
  // against its own deviceId in the shared SQLite file.
  const sharedDb = openTestDb(dbPath)
  t.is(sharedDb.recentCommands('v3-a', 5).length, 1, 'addressed device has one audit row')
  t.is(sharedDb.recentCommands('v3-b', 5).length, 0, 'sibling device unaffected')
})
