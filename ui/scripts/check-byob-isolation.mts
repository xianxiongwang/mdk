/**
 * Gate: the "bring your own backend" demo must stay free of MDK's data layer.
 *
 * That page is the standing proof that MDK's components work against an
 * arbitrary API. The proof is only worth something if the page never quietly
 * starts importing a mining hook, a query factory, or the preset — which is
 * exactly the kind of drift a reviewer does not notice. So it is checked rather
 * than asserted in prose.
 *
 * The page may import components and types from `@tetherto/mdk-react-devkit`
 * (that is the point) and `@tanstack/react-query` (a consumer's own fetching).
 * Everything under `@tetherto/mdk-react-adapter` and
 * `@tetherto/mdk-ui-foundation` is forbidden.
 *
 * Run via `npm run check:byob` (included in `fullcheck`).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const DEMO_DIR = 'apps/catalog/src/pages/bring-your-own-backend'

/** Import specifiers that would invalidate the proof. */
const FORBIDDEN = [
  '@tetherto/mdk-react-adapter',
  '@tetherto/mdk-ui-foundation',
]

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })

const violations: Array<{ file: string, specifier: string }> = []
let filesChecked = 0

for (const file of walk(DEMO_DIR)) {
  filesChecked += 1
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    if (FORBIDDEN.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`))) {
      violations.push({ file: relative(process.cwd(), file), specifier })
    }
  }
}

if (filesChecked === 0) {
  console.error(
    `✗ check:byob found no files under ${DEMO_DIR}.\n`
    + '  The bring-your-own-backend demo is the proof that MDK is backend-agnostic.\n'
    + '  If it moved, update this script; if it was deleted, that is a deliberate\n'
    + '  decision that should be visible in review.',
  )
  process.exit(1)
}

if (violations.length > 0) {
  console.error('✗ the bring-your-own-backend demo reaches into MDK\'s data layer:\n')
  for (const { file, specifier } of violations) {
    console.error(`  ${file}\n    imports ${specifier}`)
  }
  console.error(
    '\n  This page exists to prove a consumer needs none of it. Map the response in\n'
    + '  fleet-adapter.ts instead, or — if a component genuinely cannot be fed\n'
    + '  without MDK\'s data layer — that is the finding, and the component\'s prop\n'
    + '  contract is what should change.',
  )
  process.exit(1)
}

console.log(
  `✓ bring-your-own-backend: ${filesChecked} files, no imports from `
  + `${FORBIDDEN.join(' or ')}`,
)
