'use strict'

const fs = require('fs')
const path = require('path')
const { loadPlugin } = require('./plugin-loader')

const CONTRACT_FILE = 'mdk-contract.json'

/**
 * Load a Worker Plugin from a directory: <pkgDir>/mdk-contract.json is the
 * package's only index. Structural validation is plugin-loader's (same
 * ERR_PLUGIN_* errors for a missing metadata/capabilities object, a missing
 * handler field or a duplicate name), and every handler path is resolved on
 * disk — but never executed. A handler module reads its device from the
 * ambient '@tetherto/mdk-worker/device', which only exists inside an instance,
 * so requiring one here would either throw or bind the wrong device.
 *
 * Returns { dir, contract, publishedContract, entries }, where `entries` is
 * { telemetry: Map, commands: Map } of name -> resolved handler file: the input
 * createInstance() binds once per device.
 */
function loadContract (pkgDir) {
  if (typeof pkgDir !== 'string' || !pkgDir) throw new Error('ERR_CONTRACT_DIR_REQUIRED')

  const file = path.join(pkgDir, CONTRACT_FILE)
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`ERR_CONTRACT_NOT_FOUND: ${file}: ${err.message}`)
  }

  let contract
  try {
    contract = JSON.parse(raw)
  } catch (err) {
    throw new Error(`ERR_CONTRACT_INVALID_JSON: ${file}: ${err.message}`)
  }

  const entries = { telemetry: new Map(), commands: new Map() }
  const loaded = loadPlugin({
    contract,
    dir: pkgDir,
    // A directory-loaded plugin has no connect(): WorkerRuntimeV2 builds an
    // instance per device instead. Only present because v1's shape demands it.
    connect: _noConnect,
    loadHandler: (handlerFile, { section, name }) => {
      entries[section].set(name, require.resolve(handlerFile))
      return _unbound(section, name)
    }
  })

  return {
    dir: pkgDir,
    contract: loaded.contract,
    publishedContract: loaded.publishedContract,
    entries
  }
}

function _noConnect () {
  throw new Error('ERR_CONTRACT_NO_CONNECT')
}

// plugin-loader publishes a function per entry; a contract on its own has no
// process-wide handler to give it, so the placeholder fails loudly rather than
// silently standing in for a device-bound one.
function _unbound (section, name) {
  return () => {
    throw new Error(`ERR_HANDLER_NOT_BOUND: ${section}.${name}`)
  }
}

module.exports = { loadContract }
