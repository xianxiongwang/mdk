'use strict'

// Dependency check run by start.js / cli.js before any cross-package require.
// The repo is federated (no root workspaces): each backend package has its own
// node_modules, and the UI imports built repo-root ui/packages/*.

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..')

// The packages start.js / cli.js reach into (see backend/site.js).
const BACKEND_PACKAGES = [
  'backend/core/mdk',
  'backend/core/client',
  'backend/core/gateway',
  'backend/workers/miners/whatsminer',
  'backend/workers/miners/antminer',
  'backend/workers/miners/avalon',
  'backend/workers/containers/antspace',
  'backend/workers/containers/bitdeer',
  'backend/workers/power-meter/abb',
  'backend/workers/power-meter/satec',
  'backend/workers/power-meter/schneider',
  'backend/workers/minerpools/ocean',
  'backend/workers/minerpools/f2pool',
  'backend/workers/temperature/seneca'
]

const SETUP_HINT = 'run "npm run setup" in examples/full-site once to install and build everything'

// Backend packages are root npm workspaces — `npm install` hoists their deps
// into the repo-root node_modules rather than a per-package node_modules, and
// symlinks the package itself in there under its package name. So "installed"
// means either a local node_modules (non-hoisted case) or a resolvable
// workspace symlink pointing back at the package.
function isBackendPkgInstalled (pkg) {
  const pkgDir = path.join(REPO_ROOT, pkg)
  if (fs.existsSync(path.join(pkgDir, 'node_modules'))) return true
  try {
    const { name } = require(path.join(pkgDir, 'package.json'))
    const linkPath = path.join(REPO_ROOT, 'node_modules', ...name.split('/'))
    if (!fs.existsSync(linkPath)) return false
    return fs.realpathSync(linkPath) === fs.realpathSync(pkgDir)
  } catch {
    return false
  }
}

function missingBackendDeps () {
  return BACKEND_PACKAGES
    .filter((pkg) => !isBackendPkgInstalled(pkg))
    .map((pkg) => `${pkg} — not installed`)
}

function missingUiDeps () {
  const missing = []
  if (!fs.existsSync(path.join(__dirname, 'ui', 'node_modules'))) {
    missing.push('examples/full-site/ui — not installed')
  }
  // The example UI imports @tetherto/mdk-* from ui/packages/*, which export
  // from dist/ — they must be built, not just installed.
  if (!fs.existsSync(path.join(REPO_ROOT, 'ui', 'packages', 'ui-foundation', 'dist'))) {
    missing.push('ui/packages (devkit) — not built')
  }
  return missing
}

function checkDeps ({ ui = false } = {}) {
  const missing = missingBackendDeps()
  if (ui) missing.push(...missingUiDeps())
  if (missing.length === 0) return

  console.error('\n  Dependencies are missing — the example cannot boot:\n')
  for (const item of missing) console.error('    - %s', item)
  console.error('\n  To fix, %s.\n', SETUP_HINT)
  process.exit(1)
}

module.exports = { checkDeps, missingBackendDeps, missingUiDeps, SETUP_HINT }
