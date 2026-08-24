#!/usr/bin/env node
// CLI wrapper around the programmatic `assemble()` (see index.mjs).
import { assemble } from './index.mjs'

try {
  const { files, version } = assemble()
  console.log(`assembled ${files} file(s) (mdk ${version}) -> dist/skills`)
} catch (err) {
  console.error(`ERR_ASSEMBLE: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
