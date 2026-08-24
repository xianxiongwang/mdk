#!/usr/bin/env bash
# This script relies on bash-only syntax (arrays). If it's invoked as
# `sh install-packages.sh`, $0 may still be bash (e.g. macOS /bin/sh is bash
# in POSIX-compat mode), which sets BASH_VERSION but still behaves
# differently - so check the posix option itself, not just BASH_VERSION,
# and re-exec under plain bash instead of failing.
if [ -z "${BASH_VERSION:-}" ] || shopt -qo posix; then
  exec bash "$0" "$@"
fi
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

REPO_ROOT="$(cd "$ROOT/../.." && pwd)"

MODE="${1:-install}"
PACKAGES=(agent client gateway kernel mcp mdk mdk-worker plugins)

# Packages that are members of the repo-root npm `workspaces` resolve their
# sibling @tetherto/mdk-* deps (e.g. mdk-client) via semver ranges, not
# file: links, so `npm install --prefix <pkg>` can no longer install them in
# isolation - npm would try (and fail) to fetch those siblings from the
# registry. Workspace members must be installed once from the repo root,
# which hoists and links them together. Only genuinely standalone packages
# (not listed in the root workspaces) still install via --prefix.
is_workspace_member () {
  local rel="$1"
  node -e '
    const fs = require("fs")
    const root = process.argv[1]
    const dir = process.argv[2].replace(/\/+$/, "")
    let ws = []
    try { ws = JSON.parse(fs.readFileSync(root + "/package.json", "utf8")).workspaces || [] } catch (_) {}
    if (Array.isArray(ws.packages)) ws = ws.packages
    const norm = (s) => String(s).replace(/\/+$/, "")
    const member = ws.some((w) => {
      w = norm(w)
      if (w === dir) return true
      if (w.endsWith("/**")) { const b = w.slice(0, -3); return dir === b || dir.startsWith(b + "/") }
      if (w.endsWith("/*"))  { const b = w.slice(0, -2); return dir.startsWith(b + "/") && !dir.slice(b.length + 1).includes("/") }
      return false
    })
    process.exit(member ? 0 : 1)
  ' "$REPO_ROOT" "$rel"
}

run_root_install () {
  echo "[mdk-core] -> repo root (workspace members hoisted here)"
  if [ "$MODE" = "ci" ] && [ -f "$REPO_ROOT/package-lock.json" ]; then
    (cd "$REPO_ROOT" && npm ci)
  else
    (cd "$REPO_ROOT" && npm install)
  fi
}

run_npm_prefix () {
  local dir="$1"
  if [ "$MODE" = "ci" ] && [ -f "$dir/package-lock.json" ]; then
    npm ci --prefix "$dir"
  else
    npm install --prefix "$dir"
  fi
}

echo "[mdk-core] Installing dependencies (${MODE}) under ${ROOT}..."

needs_root_install=false
for pkg in "${PACKAGES[@]}"; do
  if [ -f "$pkg/package.json" ] && is_workspace_member "backend/core/$pkg"; then
    needs_root_install=true
    break
  fi
done

if [ "$needs_root_install" = true ]; then
  run_root_install
fi

for pkg in "${PACKAGES[@]}"; do
  if [ -f "$pkg/package.json" ] && ! is_workspace_member "backend/core/$pkg"; then
    echo "[mdk-core] -> ${pkg}/ (standalone)"
    run_npm_prefix "$pkg"
  fi
done

if [ -f package.json ]; then
  echo "[mdk-core] -> ./ (root, standalone)"
  run_npm_prefix "."
fi

echo "[mdk-core] Done."
