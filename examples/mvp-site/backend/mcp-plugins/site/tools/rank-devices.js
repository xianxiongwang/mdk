'use strict'

const { z } = require('zod')
const mdkClient = require('../lib/client')
const { AXIS, collectDevices, matches, plural, readMetric, mapInBatches, json } = require('../lib/site')

module.exports = {
  schema: {
    family: z.enum(AXIS.family).default('all').describe('Device family to include.'),
    metric: z.enum(AXIS.metric).default('power').describe('The metric to order by.'),
    order: z.enum(AXIS.order).default('desc').describe('desc for the highest first, asc for the lowest.'),
    limit: z.number().int().min(1).max(50).default(5).describe('How many to return.')
  },
  handler: async ({ family, metric, order, limit }) => {
    const rows = collectDevices(await mdkClient.getStatus()).filter((r) => matches(r, family, 'all'))
    const readings = await mapInBatches(rows, async (row) => {
      try {
        return { row, value: readMetric(await mdkClient.pullTelemetry(row.deviceId, 'metrics'), metric) }
      } catch {
        return { row, value: null }
      }
    })
    const scored = readings.filter((r) => r.value !== null)
    scored.sort((a, b) => (order === 'asc' ? a.value - b.value : b.value - a.value))
    const top = scored.slice(0, limit).map(({ row, value }) => ({ deviceId: row.deviceId, family: row.family, [metric]: value }))
    const unavailable = readings.length - scored.length
    return json({
      summary: top.length
        ? `${order === 'asc' ? 'Lowest' : 'Highest'} ${metric}: ${top.map((d) => `${d.deviceId} (${d[metric]})`).join(', ')}.` +
          (unavailable ? ` ${unavailable} of ${readings.length} did not report.` : '')
        : `No ${plural(family, 0)} reported ${metric}${unavailable ? ` (${unavailable} did not report)` : ''}.`,
      metric,
      order,
      devices: top,
      unavailable
    })
  }
}
