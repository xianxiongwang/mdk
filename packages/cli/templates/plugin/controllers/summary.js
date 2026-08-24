'use strict'

// A read-only aggregation endpoint: it asks the Kernel (through the injected MDK
// client) for the fleet and returns a small summary. Replace this with your own
// aggregation, grounded in the telemetry channels your workers expose.
//
// Contract: `async (req, services) => result`. The return value is sent as JSON
// (HTTP 200). Throw `Error('ERR_...')` to return a 400.
module.exports = async function summary (req, services) {
  const { mdkClient } = services

  // The Gateway can boot before the Kernel connects. Report that instead of
  // failing so the route is always callable.
  if (!mdkClient) {
    return { ok: true, kernelConnected: false, workerCount: 0, deviceCount: 0, workers: [] }
  }

  const resp = await mdkClient.listWorkers()
  const workers = (resp && resp.workers) || []
  const deviceCount = workers.reduce((n, w) => n + ((w.deviceIds && w.deviceIds.length) || 0), 0)

  return {
    ok: true,
    kernelConnected: true,
    workerCount: workers.length,
    deviceCount,
    workers: workers.map((w) => ({ workerId: w.workerId, devices: (w.deviceIds || []).length }))
  }
}
