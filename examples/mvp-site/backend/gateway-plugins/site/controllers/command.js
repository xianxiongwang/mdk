'use strict'

// The real Whatsminer setPowerMode accepts low | normal | high (sleep would
// power the miner down, so it is excluded from the demo action).
const POWER_MODES = ['low', 'normal', 'high']

// Live miner action: round-trips setPowerMode through mdkClient → Kernel → miner.
// The command must be an allowed capability (validated by the Kernel dispatcher
// against the worker's exported contract); the new mode shows up on the next
// telemetry poll.
//
// `ctx` is a test-only seam: a real gateway route call always passes just
// `req`, so this falls through to the plugin's own ambient client
// (lib/client.js, lazily required so this file stays requirable outside a
// plugin load — see @tetherto/mdk-gateway/plugin). Tests pass `{ mdkClient }`
// directly instead of loading the plugin.
module.exports = async (req, ctx) => {
  const mdkClient = ctx === undefined ? require('../lib/client') : ctx.mdkClient
  if (!mdkClient) throw new Error('ERR_MDK_CLIENT_UNAVAILABLE')

  const deviceId = req.params && req.params.deviceId
  if (!deviceId) throw new Error('ERR_DEVICE_ID_REQUIRED')

  const mode = req.body && req.body.mode
  if (!POWER_MODES.includes(mode)) throw new Error('ERR_INVALID_POWER_MODE')

  const result = await mdkClient.sendCommand(deviceId, 'setPowerMode', { mode })

  return {
    deviceId,
    command: 'setPowerMode',
    mode,
    commandId: result && result.commandId,
    status: (result && result.status) || 'UNKNOWN'
  }
}
