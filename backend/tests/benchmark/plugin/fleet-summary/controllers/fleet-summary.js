'use strict'

// The only place aggregation happens: fan out per-device telemetry pulls via
// mdk-client and combine. Workers are structurally single-device.
// hashrate_avg (not hashrate_rt) is the one hashrate field every worker
// family this harness uses (Whatsminer/Antminer/Avalon) actually exposes —
// see lib/constants.js's WORKER_REGISTRY.
//
// `services` is a test-only seam: a real gateway route call always passes
// just `req`, so this falls through to the plugin's own ambient client
// (lib/client.js, lazily required so this file stays requirable outside a
// plugin load — see @tetherto/mdk-gateway/plugin). Tests pass `{ mdkClient }`
// directly instead of loading the plugin.
module.exports = async function fleetSummary (req, services) {
  const mdkClient = services === undefined ? require('../lib/client') : services.mdkClient
  if (!mdkClient) throw new Error('ERR_MDK_CLIENT_UNAVAILABLE')

  const workersResp = await mdkClient.listWorkers()
  const deviceIds = (workersResp?.workers || []).flatMap(w => w.deviceIds || [])

  const results = await Promise.allSettled(deviceIds.map(async (deviceId) => {
    const res = await mdkClient.pullTelemetry(deviceId, 'metrics')
    return { deviceId, metrics: res?.metrics || null }
  }))

  const devices = []
  let totalHashrateThs = 0
  let totalPowerW = 0
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.metrics) continue
    const { deviceId, metrics } = r.value
    devices.push({ deviceId, hashrateThs: metrics.hashrate_avg, powerW: metrics.power })
    totalHashrateThs += Number(metrics.hashrate_avg) || 0
    totalPowerW += Number(metrics.power) || 0
  }

  return { deviceCount: devices.length, totalHashrateThs, totalPowerW, devices }
}
