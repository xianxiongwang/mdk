'use strict'

const { z } = require('zod')
const mdkClient = require('../lib/client')
const { powerModesFor, json } = require('../lib/site')

const DEVICE_ATTRS = ['telemetry', 'state', 'capabilities', 'power_modes']

module.exports = {
  schema: {
    ref: z.string().meta({ 'x-mdk-ref': 'device' }).describe('A device id taken from a previous result.'),
    attr: z.enum(DEVICE_ATTRS).default('telemetry').describe('Which aspect of the device to read.')
  },
  handler: async ({ ref, attr }) => {
    if (attr === 'capabilities') {
      return json({ summary: `Capabilities of ${ref}.`, deviceId: ref, capabilities: await mdkClient.getCapabilities(ref) })
    }
    if (attr === 'state') {
      return json({ summary: `State of ${ref}.`, deviceId: ref, state: await mdkClient.pullState(ref) })
    }
    if (attr === 'power_modes') {
      const modes = await powerModesFor(ref)
      return json({
        summary: modes.supportedPowerModes
          ? `${ref} supports ${modes.supportedPowerModes.join(', ')}.`
          : `${ref} does not report power modes.`,
        ...modes
      })
    }
    const telemetry = await mdkClient.pullTelemetry(ref, 'metrics')
    return json({ summary: `Live readings for ${ref}.`, deviceId: ref, telemetry })
  }
}
