#!/usr/bin/env node
// CLI wrapper around the programmatic `installSkills()` (see index.mjs).
//
//   node src/install.mjs [--client cursor|claude|all] [--target <project-root>]
//
// The project root defaults to the enclosing git repo of cwd, so this works
// both inside the monorepo and when consumed from npm.

import fs from 'node:fs'
import path from 'node:path'
import { installSkills } from './index.mjs'

function parseArgs (argv) {
  const args = { client: 'all', target: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.client = argv[++i]
    else if (argv[i] === '--target') args.target = argv[++i]
  }
  return args
}

function findProjectRoot (startDir) {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}

const { client, target } = parseArgs(process.argv.slice(2))
const projectRoot = target ? path.resolve(process.cwd(), target) : findProjectRoot(process.cwd())

try {
  const { skills, installed } = installSkills({ client, target: projectRoot })
  for (const { dir } of installed) {
    console.log(`installed ${skills.length} skill(s) -> ${path.relative(process.cwd(), dir) || '.'}`)
  }
  console.log('done — installed skill dirs are generated artifacts; keep them gitignored')
} catch (err) {
  console.error(`ERR_INSTALL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
