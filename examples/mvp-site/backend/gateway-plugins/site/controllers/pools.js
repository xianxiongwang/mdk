'use strict'

const path = require('path')

const deploy = require(path.join(__dirname, '..', '..', '..', '..', 'config', 'site.deploy.json'))

// whatsminer API limit
const MAX_POOLS = 3

const validatePools = (pools) => {
  if (!Array.isArray(pools) || !pools.length || pools.length > MAX_POOLS) {
    throw new Error('ERR_INVALID_POOLS')
  }
  for (const pool of pools) {
    if (!pool || typeof pool.url !== 'string' || !pool.url ||
      typeof pool.worker_name !== 'string' || !pool.worker_name) {
      throw new Error('ERR_INVALID_POOLS')
    }
  }
}

// setupPools via mdkClient → Kernel → miner. Body pools win; otherwise the
// site default from site.deploy.json worker.pools is applied.
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

  const pools = (req.body && req.body.pools) || deploy.worker.pools
  validatePools(pools)

  const params = { pools }
  if (req.body && req.body.appendId === false) params.appendId = false

  const result = await mdkClient.sendCommand(deviceId, 'setupPools', params)

  return {
    deviceId,
    command: 'setupPools',
    pools: pools.map((p) => p.url),
    commandId: result && result.commandId,
    status: (result && result.status) || 'UNKNOWN'
  }
}
