'use strict'

const { id } = require('@tetherto/mdk-worker/device')
const client = require('../client')
const db = require('../db')

module.exports = async (params) => {
  // The site UI's modes are low|normal|high; firmware v3 calls low "eco".
  // Translating vendor-agnostic modes to firmware terms is the adapter's job.
  const mode = params.mode === 'low' ? 'eco' : params.mode
  const result = await client.setPowerMode(mode)
  db.recordCommand(id, 'setPowerMode', params, result)
  return result
}
