'use strict'

const path = require('path')
const debug = require('debug')('mdk:worker:instance-loader')
const { createModuleContext } = require('./module-context')

const SECTIONS = ['telemetry', 'commands']

// Builtin telemetry entries synthesized into every instance rather than
// loaded from a contract-declared handler file. Registered only when the
// plugin's own contract did not already declare a channel of the same name
// (see createInstance below) — a real plugin handler always wins. Each
// closes over this instance's own frozen `device`, so calling it is genuine
// per-device dispatch (`entry.instance.telemetry.get('health')(...)`), not a
// runtime-level shortcut: it proves the addressed device's own instance
// answered, the same way any real handler would.
const BUILTIN_TELEMETRY = {
  health: (device) => () => ({
    status: 'OK',
    id: device.id,
    opts: device.opts,
    env: device.env,
    config: device.config,
    workerId: device.workerId
  })
}

/**
 * Instantiate a directory-loaded Worker Plugin for one device.
 *
 * The plugin's own files get a private module registry (see module-context.js),
 * so everything they do at load time (construct a client, open a store) happens
 * once per device and their module-level state is that device's.
 *
 * createInstance({ dir, entries, device }) -> { telemetry: Map, commands: Map }
 * of plain (params) functions. `entries` is loadContract().entries; `device` is
 * what the plugin sees as '@tetherto/mdk-worker/device'. Per handlers HLD §3
 * this aborts rather than degrades: a handler module that is missing, throws at
 * load or does not export a function fails here, naming the device.
 *
 * `instance.telemetry` also always carries the builtin entries in
 * BUILTIN_TELEMETRY (e.g. `health`) unless the contract declared a real
 * channel of the same name — see BUILTIN_TELEMETRY above.
 */
function createInstance (opts) {
  const { dir, entries, device } = opts || {}
  if (typeof dir !== 'string' || !dir) throw new Error('ERR_INSTANCE_DIR_REQUIRED')
  if (!entries || typeof entries !== 'object') throw new Error('ERR_INSTANCE_ENTRIES_REQUIRED')
  if (!device || typeof device !== 'object') throw new Error('ERR_INSTANCE_DEVICE_REQUIRED')
  if (typeof device.id !== 'string' || !device.id) throw new Error('ERR_INSTANCE_DEVICE_ID_REQUIRED')

  // WorkerRuntimeV2 always sets device.logger (a debug() instance); a device
  // built by hand (contract-level tests, say) may omit it, so default to a
  // no-op rather than let a handler's unconditional logger(...) call throw.
  const ambientDevice = device.logger ? device : { ...device, logger: _noopLogger }

  const context = createModuleContext({
    dir,
    ambient: { '@tetherto/mdk-worker/device': ambientDevice },
    label: `[mdk-instance:${device.id}]`
  })

  const instance = { telemetry: new Map(), commands: new Map() }
  for (const section of SECTIONS) {
    for (const [name, handler] of _pairs(entries[section])) {
      const where = `${device.id}: ${section}.${name}: ${handler}`
      const request = path.resolve(context.root, handler)

      let file
      try {
        file = context.resolve(request)
      } catch (err) {
        throw new Error(`ERR_INSTANCE_HANDLER_NOT_FOUND: ${where}`)
      }

      let fn
      try {
        fn = context.load(file)
      } catch (err) {
        throw new Error(`ERR_INSTANCE_HANDLER_LOAD_FAILED: ${where}: ${err.message}`, { cause: err })
      }
      if (typeof fn !== 'function') throw new Error(`ERR_INSTANCE_HANDLER_NOT_FUNCTION: ${where}`)

      instance[section].set(name, fn)
    }
  }

  for (const [name, build] of Object.entries(BUILTIN_TELEMETRY)) {
    if (instance.telemetry.has(name)) continue
    instance.telemetry.set(name, build(device))
  }

  debug('instance ready for %s (%d private modules)', device.id, context.size)
  return instance
}

// loadContract() hands over Maps; plain objects are accepted so a test can
// build a section by hand.
function _pairs (section) {
  if (!section) return []
  return section instanceof Map ? section : Object.entries(section)
}

function _noopLogger () {}

module.exports = { createInstance }
