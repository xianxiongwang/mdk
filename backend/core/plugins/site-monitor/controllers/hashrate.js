'use strict'

const mdkClient = require('../lib/client')

module.exports = async function hashrate (req) {
  const workersRes = await mdkClient.listWorkers()
  const workers = (workersRes && workersRes.workers) || []
  const ready = workers.filter(w => w.state === 'READY')

  const pulls = ready.flatMap(w =>
    (w.deviceIds || []).map(async (deviceId) => {
      const res = await mdkClient.pullTelemetry(deviceId, 'metrics')
      const stats = res && res.metrics && res.metrics.stats
      return {
        deviceId,
        workerId: w.workerId,
        hashrateMhs: (stats && stats.hashrate_mhs && stats.hashrate_mhs.avg) || 0,
        powerW: (stats && stats.power_w) || 0
      }
    })
  )

  const devices = await Promise.all(pulls)
  const totalHashrateMhs = devices.reduce((sum, d) => sum + d.hashrateMhs, 0)
  const totalPowerW = devices.reduce((sum, d) => sum + d.powerW, 0)

  return {
    totalHashrateMhs,
    totalPowerW,
    deviceCount: devices.length,
    devices,
    ts: Date.now()
  }
}
