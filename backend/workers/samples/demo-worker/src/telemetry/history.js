'use strict'

const { id } = require('@tetherto/mdk-worker/device')
const db = require('../db')

// Served from the worker's own SQLite store; the device is not contacted.
module.exports = async (params) => {
  const limit = Number(params && params.limit) || 10
  return db.recentSamples(id, limit)
}
