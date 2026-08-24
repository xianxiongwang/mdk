'use strict'

const device = require('@tetherto/mdk-worker/device')
const debugModule = require('debug')

// Module-level state: bumped once per call. Because instance-loader gives
// each device its own private copy of this file, this counter is that
// device's alone — the other instance's calls never touch it.
let calls = 0

module.exports = async () => {
  calls += 1
  return {
    id: device.id,
    opts: device.opts,
    env: device.env,
    calls,
    debugModule
  }
}
