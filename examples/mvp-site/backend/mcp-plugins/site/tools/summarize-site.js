'use strict'

const mdkClient = require('../lib/client')
const { collectDevices, json } = require('../lib/site')

module.exports = {
  schema: {},
  handler: async () => {
    const status = await mdkClient.getStatus()
    const workers = status?.workers ?? []
    const rows = collectDevices(status)
    const offline = rows.filter((r) => r.state === 'offline')
    const readyWorkers = workers.filter((w) => w.state === 'READY').length
    const byFamily = {}
    for (const r of rows) {
      byFamily[r.family] ??= { total: 0, online: 0 }
      byFamily[r.family].total++
      if (r.state === 'online') byFamily[r.family].online++
    }
    return json({
      summary: `${rows.length} devices across ${workers.length} workers — ${rows.length - offline.length} online, ${offline.length} offline` +
        (offline.length ? ` (${offline.map((r) => r.deviceId).join(', ')})` : '') + '.',
      workers: { total: workers.length, online: readyWorkers, offline: workers.length - readyWorkers },
      devices: { total: rows.length, online: rows.length - offline.length, offline: offline.length, byFamily }
    })
  }
}
