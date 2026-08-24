'use strict'

// Single-device Gateway round trip (Gateway → Kernel → Worker → Gateway) —
// the same telemetry.pull fleet-summary.js fans out per device, but for
// exactly one, so the benchmark harness can time a lone device read through
// the Gateway instead of only ever seeing the aggregate.
//
// `services` is a test-only seam: a real gateway route call always passes
// just `req`, so this falls through to the plugin's own ambient client
// (lib/client.js, lazily required so this file stays requirable outside a
// plugin load — see @tetherto/mdk-gateway/plugin). Tests pass `{ mdkClient }`
// directly instead of loading the plugin.
module.exports = async function deviceTelemetry (req, services) {
  const mdkClient = services === undefined ? require('../lib/client') : services.mdkClient
  if (!mdkClient) throw new Error('ERR_MDK_CLIENT_UNAVAILABLE')

  const deviceId = req.params.id
  const res = await mdkClient.pullTelemetry(deviceId, 'metrics')
  return { deviceId, metrics: res?.metrics || null }
}
