'use strict'

const fs = require('fs')
const path = require('path')
const Module = require('module')

const PRIVATE_EXTENSIONS = new Set(['.js', '.cjs'])

/**
 * Private module registry for one plugin load — the interception mechanism
 * behind the ambient context modules ('@tetherto/mdk-worker/device' for worker
 * instances, and the gateway/MCP equivalents).
 *
 * Files under `dir` get their own registry, so module-level state (a client
 * constructed at load time, say) belongs to this context alone. `node_modules`
 * and `node:` builtins keep resolving through the shared cache — `debug` and
 * `node:sqlite` are process singletons, not per-context copies.
 *
 * Isolation rests on Node's Module internals (the pattern proxyquire and
 * friends use): a Module per in-package file, compiled by hand, with `require`
 * routed back here so in-package requests stay private.
 *
 * createModuleContext({ dir, ambient, label }) -> { root, size, resolve, load }.
 * `ambient` maps specifiers to values; both the bare and `.js` spellings are
 * intercepted before resolution, so a plugin does not need the host package
 * installed to require its context. `label` names the synthetic entry parent
 * in Node's require stack when a resolution fails.
 */
function createModuleContext (opts) {
  const { dir, ambient, label } = opts || {}
  if (typeof dir !== 'string' || !dir) throw new Error('ERR_MODULE_CONTEXT_DIR_REQUIRED')

  const requests = new Map()
  for (const [specifier, value] of Object.entries(ambient || {})) {
    requests.set(specifier, value)
    requests.set(`${specifier}.js`, value)
  }

  // Realpath because Node resolves modules through symlinks: a package reached
  // via a workspace link would otherwise look out-of-package and lose isolation.
  const root = _realpath(path.resolve(dir))
  const registry = new Map()

  const isPrivate = (file) => {
    if (!PRIVATE_EXTENSIONS.has(path.extname(file))) return false
    const rel = path.relative(root, file)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
    return !rel.split(path.sep).includes('node_modules')
  }

  const requireFrom = (parent, request) => {
    if (requests.has(request)) return requests.get(request)
    if (Module.isBuiltin(request)) return Module._load(request, parent, false)

    const file = Module._resolveFilename(request, parent, false)
    if (!isPrivate(file)) return Module._load(request, parent, false)
    return loadPrivate(file, parent)
  }

  const loadPrivate = (file, parent) => {
    const cached = registry.get(file)
    if (cached) return cached.exports

    const mod = new Module(file, parent)
    mod.filename = file
    mod.paths = Module._nodeModulePaths(path.dirname(file))
    mod.require = (request) => requireFrom(mod, request)
    // Registered before compiling so a require cycle inside the package sees a
    // partial exports object instead of recursing, as the shared loader does.
    registry.set(file, mod)
    try {
      mod._compile(fs.readFileSync(file, 'utf8'), file)
    } catch (err) {
      registry.delete(file)
      throw err
    }
    mod.loaded = true
    return mod.exports
  }

  // Synthetic parent for the context's entry files: it carries the package's
  // node_modules paths, and names the context in Node's require stack when a
  // resolution fails.
  const entryParent = new Module(path.join(root, label || '[mdk-module-context]'), null)
  entryParent.filename = entryParent.id
  entryParent.paths = Module._nodeModulePaths(root)

  return {
    root,
    get size () { return registry.size },
    resolve: (request) => Module._resolveFilename(request, entryParent, false),
    load: (request) => requireFrom(entryParent, request)
  }
}

function _realpath (dir) {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}

module.exports = { createModuleContext }
