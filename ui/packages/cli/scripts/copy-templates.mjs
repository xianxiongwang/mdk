#!/usr/bin/env node
/**
 * Bundles the runnable examples into `dist/templates/` so `mdk-ui create` and
 * `mdk-ui add page` can scaffold from them.
 *
 * ⚠️ This script's inputs live OUTSIDE the turbo root (`examples/` is a sibling
 * of `ui/`), so no `inputs` glob in `ui/turbo.json` can reach them. Turbo would
 * therefore serve a cached CLI build after a template edit, leaving the bundled
 * copy stale — `add page` then scaffolds an old file that may not even compile.
 * That is why `@tetherto/mdk-ui-cli#build` sets `"cache": false`; do not
 * re-enable it without first giving turbo a way to see `examples/`.
 */
import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..') // ui/packages/cli
const REPO_ROOT = resolve(ROOT, '..', '..', '..')
const DIST_DIR = join(ROOT, 'dist')

// Local artifacts the runnable `mdk-ui-shell-template` example accrues on disk (it is a
// real app you can `npm run dev` in place) that must not ship in the CLI.
const EXCLUDES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.env',
  '.env.local',
  '.vite',
  'package-lock.json',
])
const isExcluded = (src) => {
  const base = src.split('/').pop()
  return EXCLUDES.has(base) || base.endsWith('.log') || base.endsWith('.tsbuildinfo')
}

// Everything the published CLI ships under dist/ so it stays self-contained:
//  - the app scaffolding templates (mdk-ui create), flattened under dist/templates/
//    regardless of their source root (runnable example vs bundled scaffold);
//  - the docs rendering-component templates (mdk-ui docs:build).
const COPIES = [
  // Runnable example, source of truth for the shell template. Filtered, and its
  // real `.gitignore` is renamed to `_gitignore` (npm strips a packed
  // `.gitignore`); `create`'s finalize step renames it back at scaffold time.
  {
    src: join(REPO_ROOT, 'examples', 'mdk-ui-shell-template'),
    dest: join(DIST_DIR, 'templates', 'mdk-ui-shell-template'),
    filter: true,
    gitignoreRename: true,
  },
  // Bundled, scaffold-only starter template (already ships `_gitignore`).
  { src: join(ROOT, 'templates', 'starter'), dest: join(DIST_DIR, 'templates', 'starter') },
  // Docs rendering-component templates.
  { src: join(ROOT, 'templates-docs'), dest: join(DIST_DIR, 'templates-docs') },
]

for (const { src, dest, filter, gitignoreRename } of COPIES) {
  if (!existsSync(src)) {
    console.warn(`No ${src} directory found — skipping copy.`)
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, {
    recursive: true,
    ...(filter ? { filter: (from) => !isExcluded(from) } : {}),
  })
  if (gitignoreRename) {
    const gitignore = join(dest, '.gitignore')
    if (existsSync(gitignore)) renameSync(gitignore, join(dest, '_gitignore'))
  }
  console.warn(`✓ Copied ${src} → ${dest}`)
}
