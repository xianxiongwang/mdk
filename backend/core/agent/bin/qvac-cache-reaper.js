#!/usr/bin/env node
// Evict stale qvac KV-cache entries. Run this where `qvac serve` runs — the cache is the
// server's disk, which in the shared-inference shape is a different machine. See --help.

import process from 'node:process'
import { sweep, parseDuration, DEFAULT_CACHE_ROOT, DEFAULT_TTL, DEFAULT_EMPTY_GRACE_MS } from '../src/cache-reaper.js'

const argv = process.argv.slice(2)

// A flag given without a value used to return undefined and fall through to the default. For
// --dir that meant a typo swept the real cache root instead of the directory asked for.
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`--${name} needs a value`)
    process.exit(1)
  }
  return value
}
const has = (name) => argv.includes(`--${name}`)

if (has('help')) {
  console.log(`
  qvac-cache-reaper — delete stale ~/.qvac/kv-cache conversations

    --ttl <dur>       evict entries untouched for longer than this (default ${DEFAULT_TTL})
    --interval <dur>  sweep repeatedly instead of once
    --empty-grace <dur>  leave entries holding no data alone for this long, so a sweep
                      cannot delete a conversation the server is still writing
                      (default ${DEFAULT_EMPTY_GRACE_MS / 6e4}m)
    --dir <path>      cache root (default ${DEFAULT_CACHE_ROOT})
    --dry-run         report what would be deleted, delete nothing
    --quiet           only print when something was evicted
    --help

  Durations take s / m / h / d, e.g. 90m, 24h, 7d. A bare number means minutes.
`)
  process.exit(0)
}

function duration (text, what) {
  try {
    return parseDuration(text)
  } catch (err) {
    console.error(`${what}: ${err.message}`)
    process.exit(1)
  }
}

const ttlMs = duration(flag('ttl', DEFAULT_TTL), '--ttl')
const intervalMs = has('interval') ? duration(flag('interval'), '--interval') : null
// Left undefined unless asked for, so the default lives in one place rather than being
// restated here as a second literal.
const emptyGraceMs = has('empty-grace') ? duration(flag('empty-grace'), '--empty-grace') : undefined
const root = flag('dir', DEFAULT_CACHE_ROOT)
const dryRun = has('dry-run')
const quiet = has('quiet')

const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`

// A one-shot run is usually cron or a systemd timer, and both judge it by the exit code alone:
// a reaper that fails every night while reporting success lets the disk fill silently. In
// --interval mode the process stays up and retries, so a single failure is not terminal.
async function once () {
  const t0 = Date.now()
  let r
  try {
    r = await sweep({ root, ttlMs, dryRun, emptyGraceMs })
  } catch (err) {
    console.error(`sweep failed: ${err.message}`)
    if (!intervalMs) process.exitCode = 1
    return
  }
  if (r.failed > 0 && !intervalMs) process.exitCode = 1
  // Quiet hides an uneventful sweep, not a failing one: a silent non-zero exit leaves whoever
  // scheduled this with nothing to go on.
  if (quiet && r.removed === 0 && r.failed === 0) return
  const verb = dryRun ? 'would evict' : 'evicted'
  console.log(
    `${new Date().toISOString()}  scanned ${r.scanned}  ${verb} ${r.removed} (${gb(r.bytes)})  ` +
    `kept ${gb(r.keptBytes)}${r.vanished ? `  vanished ${r.vanished}` : ''}` +
    `${r.failed ? `  failed ${r.failed}` : ''}  ${Date.now() - t0}ms`
  )
}

await once()

if (intervalMs) {
  console.log(`sweeping every ${flag('interval')} — ctrl-c to stop`)
  // Chained rather than setInterval: a sweep can outrun a short interval, and overlapping
  // sweeps would scan and report concurrently.
  const tick = async () => {
    await once()
    setTimeout(tick, intervalMs)
  }
  setTimeout(tick, intervalMs)
}
