'use strict'

const { z } = require('zod')
const mdkClient = require('../lib/client')
const { AXIS, collectDevices, matches, plural, json } = require('../lib/site')

module.exports = {
  schema: {
    family: z.enum(AXIS.family).default('all').describe('Device family to include.'),
    state: z.enum(AXIS.state).default('all').describe('Readiness to include.')
  },
  handler: async ({ family, state }) => {
    const rows = collectDevices(await mdkClient.getStatus()).filter((r) => matches(r, family, state))
    return json({
      summary: rows.length
        ? `${rows.length} ${plural(family, rows.length)}: ${rows.map((r) => r.deviceId).join(', ')}.`
        : `No ${plural(family, 0)} match.`,
      count: rows.length,
      devices: rows
    })
  }
}
