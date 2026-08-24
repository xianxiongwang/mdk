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
    const qualifier = state === 'all' ? '' : ` ${state}`
    return json({ summary: `${rows.length}${qualifier} ${plural(family, rows.length)}.`, count: rows.length, family, state })
  }
}
