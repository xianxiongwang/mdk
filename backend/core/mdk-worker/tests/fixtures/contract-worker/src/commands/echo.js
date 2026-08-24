'use strict'

const device = require('@tetherto/mdk-worker/device')

module.exports = async (params) => ({
  deviceId: device.id,
  opts: device.opts,
  value: params && params.value
})
