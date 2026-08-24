// Programmatic entry point for @tetherto/mdk-skill.
//
// Consumers (e.g. the MDK CLI) import this module and call `installSkills()`
// to copy the assembled Agent Skills into a project's client directories.
// When published to npm the package ships a prebuilt `dist/skills/`; inside
// the monorepo the skills are assembled on demand from the source artifacts.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const PKG_DIR = path.dirname(SRC_DIR)
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..')
const DIST = path.join(PKG_DIR, 'dist', 'skills')

const SKILL_MD_MAX_LINES = 500

export const CLIENT_DIRS = {
  cursor: ['.cursor', 'skills'],
  claude: ['.claude', 'skills']
}

// Flat sibling skills — clients discover <skills-dir>/<name>/SKILL.md one
// level deep, so nested sub-skills would never trigger.
const REQUIRED = [
  'mdk/SKILL.md',
  'mdk/references/architecture.md',
  'mdk/references/package-index.md',
  'mdk/references/protocol.md',
  'mdk/references/glossary.md',
  'mdk/references/mdk-contract.schema.json',
  'mdk-gateway-plugin/SKILL.md',
  'mdk-ui-component/SKILL.md',
  'mdk-ui-component/references/ui-registry.json',
  'mdk-deployment/SKILL.md',
  'mdk-worker-plugin/SKILL.md',
  'mdk-worker-plugin/references/mdk-contract.schema.json',
  'mdk-worker-plugin/references/contract-authoring.md',
  'mdk-worker-plugin/references/worker-base-api.md',
  'mdk-worker-plugin/references/device-families.md',
  'mdk-worker-plugin/references/local-testing.md',
  'mdk-worker-plugin/assets/mdk-contract.template.json',
  'mdk-worker-plugin/assets/worker-template/mdk-contract.json',
  'mdk-worker-plugin/assets/worker-template/src/client.js',
  'mdk-worker-plugin/assets/worker-template/mock/server.js',
  'mdk-worker-plugin/assets/worker-template/smoke.config.js',
  'mdk-worker-plugin/scripts/validate-contract.mjs',
  'mdk-worker-plugin/scripts/worker-smoke.mjs'
]

function copyEntry (entry) {
  const src = path.resolve(REPO_ROOT, entry.source)
  const dest = path.resolve(DIST, entry.dest)
  if (!fs.existsSync(src)) throw new Error(`source missing: ${entry.source}`)

  const excluded = new Set(entry.exclude || [])
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => !excluded.has(path.basename(from))
  })
}

function walk (dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function injectVersion (files, version) {
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const body = fs.readFileSync(file, 'utf8')
    if (!body.includes('{{MDK_VERSION}}')) continue
    fs.writeFileSync(file, body.replaceAll('{{MDK_VERSION}}', version))
  }
}

function check (files) {
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(DIST, rel))) throw new Error(`required artifact missing after assembly: ${rel}`)
  }
  for (const file of files) {
    if (path.basename(file) !== 'SKILL.md') continue
    const lines = fs.readFileSync(file, 'utf8').split('\n').length
    if (lines > SKILL_MD_MAX_LINES) {
      throw new Error(`${path.relative(DIST, file)} is ${lines} lines (budget ${SKILL_MD_MAX_LINES}) — move content to references/`)
    }
  }
}

/** True when the source map and repo root are available to assemble from. */
export function canAssemble () {
  return (
    fs.existsSync(path.join(SRC_DIR, 'sources.map.json')) &&
    fs.existsSync(path.join(REPO_ROOT, 'package.json'))
  )
}

/** True when `dist/skills/` already holds at least one assembled skill. */
export function isAssembled () {
  try {
    return fs.existsSync(DIST) && fs.readdirSync(DIST).length > 0
  } catch {
    return false
  }
}

/**
 * Assemble the skill suite from source artifacts into `dist/skills/`.
 * Only usable inside the monorepo (or the published package's own tree).
 * Returns the number of files assembled and the MDK version stamped in.
 */
export function assemble () {
  const map = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'sources.map.json'), 'utf8'))
  const mdkVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version

  fs.rmSync(DIST, { recursive: true, force: true })
  fs.mkdirSync(DIST, { recursive: true })

  for (const entry of map.entries) copyEntry(entry)

  const files = walk(DIST)
  injectVersion(files, mdkVersion)
  check(files)

  return { files: files.length, version: mdkVersion }
}

/**
 * Install the assembled skills into a project's client skills directories.
 *
 * @param {object} [options]
 * @param {'cursor'|'claude'|'all'} [options.client='all']
 * @param {string} [options.target=process.cwd()] Project root to install into.
 * @param {boolean} [options.assembleIfMissing=true] Assemble first if `dist/skills/` is empty.
 * @returns {{ skills: string[], installed: Array<{ client: string, dir: string }> }}
 */
export function installSkills ({ client = 'all', target = process.cwd(), assembleIfMissing = true } = {}) {
  const clients = client === 'all' ? Object.keys(CLIENT_DIRS) : [client]
  for (const c of clients) {
    if (!CLIENT_DIRS[c]) throw new Error(`unknown client '${client}' — use cursor | claude | all`)
  }

  if (!isAssembled()) {
    if (assembleIfMissing && canAssemble()) assemble()
    else throw new Error(`no assembled skills found at ${DIST} — run \`npm run assemble\` in @tetherto/mdk-skill`)
  }

  const skills = fs.readdirSync(DIST, { withFileTypes: true }).filter((e) => e.isDirectory())
  if (!skills.length) throw new Error(`no skills found in ${DIST}`)

  const projectRoot = path.resolve(target)
  const installed = []
  for (const c of clients) {
    const targetDir = path.join(projectRoot, ...CLIENT_DIRS[c])
    fs.mkdirSync(targetDir, { recursive: true })
    for (const skill of skills) {
      fs.rmSync(path.join(targetDir, skill.name), { recursive: true, force: true })
      fs.cpSync(path.join(DIST, skill.name), path.join(targetDir, skill.name), { recursive: true })
    }
    installed.push({ client: c, dir: targetDir })
  }

  return { skills: skills.map((s) => s.name), installed }
}
