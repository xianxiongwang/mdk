'use strict'

const { DatabaseSync } = require('node:sqlite')
const { opts } = require('@tetherto/mdk-worker/device')

// The worker's own persistence — a plain SQLite file, no MDK stores. Bound
// directly to this device's own dbPath, the same way client.js binds to its
// connection opts: the runtime loads this module fresh into a private
// registry per device, so two devices pointed at the same dbPath still get a
// connection each rather than a shared handle.
const db = new DatabaseSync(opts.dbPath)
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    hashrate_ths REAL,
    power_w REAL,
    board_temp_c REAL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    command TEXT NOT NULL,
    params TEXT,
    result TEXT
  );
  CREATE INDEX IF NOT EXISTS telemetry_device_ts ON telemetry (device_id, ts);
`)

const insertSample = db.prepare(
  'INSERT INTO telemetry (device_id, ts, hashrate_ths, power_w, board_temp_c) VALUES (?, ?, ?, ?, ?)')
const insertCommand = db.prepare(
  'INSERT INTO commands (device_id, ts, command, params, result) VALUES (?, ?, ?, ?, ?)')
const selectSamples = db.prepare(
  'SELECT ts, hashrate_ths, power_w, board_temp_c FROM telemetry WHERE device_id = ? ORDER BY ts DESC LIMIT ?')
const selectCommands = db.prepare(
  'SELECT ts, command, params, result FROM commands WHERE device_id = ? ORDER BY ts DESC LIMIT ?')

module.exports = {
  recordSample (deviceId, summary) {
    insertSample.run(deviceId, Date.now(), summary.hashrate_ths, summary.power_w, summary.board_temp_c)
  },
  recordCommand (deviceId, command, params, result) {
    insertCommand.run(deviceId, Date.now(), command, JSON.stringify(params || {}), JSON.stringify(result || {}))
  },
  recentSamples (deviceId, limit) {
    return selectSamples.all(deviceId, limit)
  },
  recentCommands (deviceId, limit) {
    return selectCommands.all(deviceId, limit).map((row) => ({
      ...row, params: JSON.parse(row.params), result: JSON.parse(row.result)
    }))
  },
  close () {
    db.close()
  }
}
