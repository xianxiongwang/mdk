#!/usr/bin/env node
'use strict'

// Thin wrapper around linkinator: scopes the crawl to git-tracked Markdown only,
// not a raw filesystem glob. A `**/*.md` glob also picks up gitignored files
// physically sitting in a maintainer's working directory (personal scratch notes,
// local checklists) — files CI never sees, since its checkout starts clean.
// Checking them locally produces false positives (and false SFW-blocked hosts)
// that don't reflect anything in the actual doc corpus.
//
// Also runs check-directory-links.mjs as a second, independent subprocess:
// it verifies linkinator.config.json's directory-shaped skip entries still
// resolve to a real directory, closing a gap linkinator itself can't (it
// can't tell "exists, no index file" apart from "doesn't exist", so a
// skip-listed directory that's later renamed or deleted would otherwise keep
// silently "passing" forever). Both checks must pass for `npm run link-check`
// to succeed, in both modes below. See docs/reference/maintainers/linters.md
// for policy and rationale.
//
// Optionally accepts an explicit list of .md files as CLI args
// (`npm run link-check -- foo.md bar.md`) to scope the linkinator crawl to
// just those files — this is what the PR workflow job passes in (the files
// changed in the diff), so a PR check never crawls the whole repo. With no
// args (the nightly job, and the default local run), every tracked .md file
// is crawled. check-directory-links.mjs always runs in full either way — it
// isn't a per-file crawl, just a handful of `git ls-files` checks against
// linkinator.config.json's skip list, so there's no "scoped" version of it
// and no cost to running it in full every time.

import { execFileSync, spawnSync } from 'node:child_process'

const REPO_ROOT = process.cwd()

const allFiles = execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

if (allFiles.length === 0) {
  console.error('No tracked Markdown files found.')
  process.exit(1)
}

const requested = process.argv.slice(2)
let files = allFiles

if (requested.length > 0) {
  const allFilesSet = new Set(allFiles)
  files = requested.filter((f) => allFilesSet.has(f))

  // README.md is always included as a server-root anchor: linkinator roots
  // its local server at the common ancestor of its inputs, so a scoped list
  // of only deep files (e.g. docs/reference/.../x.md) would root the server
  // inside that subtree and report every `../`-escaping relative link as a
  // false 404. Including a repo-root file pins the server root to the repo
  // root; it only adds README's own links to the scan, not a full-tree crawl.
  if (!files.includes('README.md') && allFilesSet.has('README.md')) {
    files = ['README.md', ...files]
  }
}

// Spawned before the empty-scope check below so it always runs in full, per
// the comment block above — a PR that ends up with nothing left to crawl
// (no tracked README.md to anchor a scoped list, today only a hypothetical)
// must not report success without it.
const directoryLinksResult = spawnSync(
  'node',
  ['scripts/check-directory-links.mjs'],
  { cwd: REPO_ROOT, stdio: 'inherit' }
)
const directoryLinksOk = (directoryLinksResult.status ?? 1) === 0

if (requested.length > 0 && files.length === 0) {
  console.log('No changed markdown files to check.')
  process.exit(directoryLinksOk ? 0 : 1)
}

const result = spawnSync(
  'npx',
  ['--yes', 'linkinator@^7.6.0', '--config', 'linkinator.config.json', ...files],
  { cwd: REPO_ROOT, stdio: 'inherit' }
)

const linkinatorOk = (result.status ?? 1) === 0
process.exit(directoryLinksOk && linkinatorOk ? 0 : 1)
