'use strict'

const { opts, env, config, logger } = require('@tetherto/mdk-worker/device')

// The "vendor SDK" for the firmware v3 HTTP JSON API. Plain device I/O — no
// MDK concepts, no base classes. This is all a plugin author writes to talk
// to their own firmware.
//
// The runtime loads this module fresh into a private registry per device, so
// binding directly to the ambient device module here — rather than exporting
// a `createClient(opts)` factory for a caller to invoke — already yields one
// client per device with no extra plumbing.
logger('config received: opts=%o env=%o config=%o', opts, env, config)

const base = `http://${opts.host || '127.0.0.1'}:${opts.port}`
const auth = env.DEVICE_TOKEN ? { authorization: `Bearer ${env.DEVICE_TOKEN}` } : {}

const call = async (path, callOpts) => {
  const res = await fetch(base + path, { ...callOpts, headers: { ...auth, ...(callOpts && callOpts.headers) } })
  const body = await res.json()
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `ERR_DEVICE_CALL_FAILED: ${res.status}`)
  }
  return body
}

const command = (cmd, args) => call('/api/v3/command', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ cmd, ...args })
})

module.exports = {
  getSummary: () => call('/api/v3/summary'),
  reboot: () => command('reboot'),
  setPowerMode: (mode) => command('set-power-mode', { mode })
}
