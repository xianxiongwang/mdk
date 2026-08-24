'use strict'

// Single-device write/action submit through the Gateway (Client → Gateway →
// Kernel accept), mirroring mdkClient.sendCommand but reachable over HTTP so
// the harness can measure the write path with the Gateway in the loop, not
// just the Client-bypasses-Gateway path sendCommand exercises directly.
//
// `services` is a test-only seam: a real gateway route call always passes
// just `req`, so this falls through to the plugin's own ambient client
// (lib/client.js, lazily required so this file stays requirable outside a
// plugin load — see @tetherto/mdk-gateway/plugin). Tests pass `{ mdkClient }`
// directly instead of loading the plugin.
module.exports = async function deviceAction (req, services) {
  const mdkClient = services === undefined ? require('../lib/client') : services.mdkClient
  if (!mdkClient) throw new Error('ERR_MDK_CLIENT_UNAVAILABLE')

  const deviceId = req.params.id
  const { action, params } = req.body || {}
  if (!action) throw new Error('ERR_ACTION_REQUIRED')

  const result = await mdkClient.sendCommand(deviceId, action, params || {})
  return { deviceId, action, result }
}
