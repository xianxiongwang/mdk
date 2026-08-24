'use strict'

const { z } = require('zod')
const mdkClient = require('../lib/client')
const { powerModesFor, json } = require('../lib/site')

// The wire command names come from the worker contracts (reboot, setPowerMode);
// the agent-facing action vocabulary stays snake_case per the tool contract.
const COMMAND_BY_ACTION = { reboot: 'reboot', set_power_mode: 'setPowerMode' }

module.exports = {
  schema: {
    ref: z.string().meta({ 'x-mdk-ref': 'device' }).describe('A device id taken from a previous result.'),
    action: z.enum(['reboot', 'set_power_mode']).describe('The action to perform.'),
    mode: z.enum(['low', 'normal', 'high', 'sleep']).default('normal')
      .describe('The power mode to set. Ignored unless action is set_power_mode.')
  },
  handler: async ({ ref, action, mode }) => {
    // The enum is the union across families, so a mode valid for one device is
    // offered for all. Check it against this device before dispatching, or the
    // operator approves a write that fails at the hardware.
    if (action === 'set_power_mode') {
      const supported = (await powerModesFor(ref)).supportedPowerModes
      if (!supported) return json({ summary: `${ref} does not report power modes, so it cannot be set.`, deviceId: ref, action })
      if (!supported.includes(mode)) {
        return json({
          summary: `${ref} does not support "${mode}" — it accepts ${supported.join(', ')}.`,
          deviceId: ref,
          action,
          supportedPowerModes: supported
        })
      }
    }
    const params = action === 'set_power_mode' ? { mode } : {}
    const result = await mdkClient.sendCommand(ref, COMMAND_BY_ACTION[action], params)
    return json({
      summary: `${action === 'reboot' ? 'Reboot' : `Set power mode to ${mode}`} on ${ref}: ${result?.status ?? 'sent'}.`,
      deviceId: ref,
      action,
      result
    })
  }
}
