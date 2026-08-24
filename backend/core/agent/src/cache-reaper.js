import { readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MEASURE_CONCURRENCY = 16

/** Where `qvac serve` writes its KV cache. No env var overrides it in the runtime. */
export const DEFAULT_CACHE_ROOT = join(homedir(), '.qvac', 'kv-cache')

export const DEFAULT_TTL = '24h'

/**
 * How long an empty entry is left alone. The server creates a conversation's directory before
 * it writes the blob, so a brand-new empty directory is as likely to be a turn in flight as an
 * aborted one — and deleting it mid-write takes a live conversation with it.
 */
export const DEFAULT_EMPTY_GRACE_MS = 5 * 60e3

const UNIT_MS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }

/**
 * Parse a duration like `30m`, `24h`, `7d`, `1.5h`. A bare number means minutes.
 *
 * @param {string|number} text
 * @returns {number} milliseconds
 * @throws {TypeError} on anything it cannot parse — callers decide whether that is fatal.
 */
export function parseDuration (text) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)?$/.exec(String(text).trim())
  if (!m) throw new TypeError(`invalid duration "${text}" (expected e.g. 30m, 24h, 7d)`)
  return Number(m[1]) * UNIT_MS[m[2] ?? 'm']
}

/**
 * One entry per cached conversation — a `{hash(history)}` directory under `root`.
 * Returns `[]` when `root` does not exist.
 *
 * @param {string} root
 * @returns {Promise<Array<{path: string, bytes: number, mtime: number, empty: boolean,
 *   unmeasurable: boolean}>>}
 */
export async function readCache (root) {
  let dirs
  try {
    dirs = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const paths = dirs.filter((d) => d.isDirectory()).map((d) => join(root, d.name))
  const entries = []
  for (let i = 0; i < paths.length; i += MEASURE_CONCURRENCY) {
    const batch = paths.slice(i, i + MEASURE_CONCURRENCY)
    const measured = await Promise.all(batch.map(async (path) => {
      const { bytes, mtime, unmeasurable } = await measure(path)
      return { path, bytes, mtime, empty: bytes === 0, unmeasurable }
    }))
    entries.push(...measured)
  }
  return entries
}

async function measure (dir) {
  let bytes = 0
  let mtime = 0
  let unmeasurable = false
  // ENOENT is the server reclaiming an entry mid-sweep, which is expected. Anything else —
  // a permission problem — means we could not size this entry, which is a different thing
  // from it being empty: treating the two alike evicts a live entry regardless of its TTL.
  const note = (err) => { if (err.code !== 'ENOENT') unmeasurable = true }

  const walk = async (d) => {
    let items
    try {
      items = await readdir(d, { withFileTypes: true })
    } catch (err) {
      note(err)
      return
    }
    for (const item of items) {
      const p = join(d, item.name)
      if (item.isDirectory()) { await walk(p); continue }
      if (!item.isFile()) continue
      try {
        const s = await stat(p)
        bytes += s.size
        mtime = Math.max(mtime, s.mtimeMs)
      } catch (err) {
        note(err)
      }
    }
  }
  await walk(dir)

  // An entry with no measurable blob still has an age — the directory's own timestamp. Without
  // this its mtime stays 0, which reads as 1970 and so is older than every possible TTL.
  if (mtime === 0) {
    try {
      mtime = (await stat(dir)).mtimeMs
    } catch (err) {
      note(err)
    }
  }
  return { bytes, mtime, unmeasurable }
}

/**
 * Entries past `ttlMs`, plus empty ones past `emptyGraceMs`. `mtime` is the last write, not the
 * last read: an idle but live conversation is evicted and re-prefills next turn.
 *
 * Two entries are deliberately never selected: one we could not measure, and one that is empty
 * but newer than the grace window. Both look identical to an aborted turn and are not.
 *
 * @param {Array<{bytes: number, mtime: number, empty: boolean, unmeasurable: boolean}>} entries
 * @param {{ttlMs: number, now?: number, emptyGraceMs?: number}} options
 */
export function selectExpired (entries, { ttlMs, now = Date.now(), emptyGraceMs = DEFAULT_EMPTY_GRACE_MS }) {
  return entries.filter((e) => {
    // We could not size it, so we cannot claim it is stale.
    if (e.unmeasurable) return false
    const age = now - e.mtime
    return e.empty ? age > emptyGraceMs : age > ttlMs
  })
}

/**
 * Delete the given entries, best-effort per entry.
 *
 * An entry the server already reclaimed counts as `vanished`, not `removed`: `rm` with
 * `force` succeeds on a path that is gone, which would otherwise report bytes we never freed.
 * An entry we cannot reach counts as `failed` — it is still on disk and still ours to retry.
 *
 * @returns {Promise<{removed: number, bytes: number, failed: number, vanished: number}>}
 */
export async function evict (entries, { dryRun = false } = {}) {
  let removed = 0
  let bytes = 0
  let failed = 0
  let vanished = 0
  for (const e of entries) {
    if (dryRun) { removed++; bytes += e.bytes; continue }
    try {
      await stat(e.path)
    } catch (err) {
      // Only a missing path means the server reclaimed it. Anything else is our failure to
      // reach the entry, and reporting that as vanished retires it from every future sweep
      // while it stays on disk.
      if (err.code === 'ENOENT') vanished++
      else failed++
      continue
    }
    try {
      await rm(e.path, { recursive: true, force: true })
      removed++
      bytes += e.bytes
    } catch {
      failed++
    }
  }
  return { removed, bytes, failed, vanished }
}

/**
 * Read, select and delete in one pass — the entry point a scheduled run calls.
 *
 * @param {object} options
 * @param {string} [options.root] cache root to sweep
 * @param {number} options.ttlMs evict entries untouched for longer than this
 * @param {boolean} [options.dryRun] select and report, delete nothing
 * @param {number} [options.now] injected clock, for tests
 * @param {number} [options.emptyGraceMs] how long an empty entry is left alone
 * @returns {Promise<{scanned: number, removed: number, bytes: number, failed: number,
 *   vanished: number, totalBytes: number, keptBytes: number}>}
 * @throws {TypeError} if `ttlMs` is missing or negative — callers must handle this, since a
 *   scheduled sweep that swallows it deletes nothing and reports success forever.
 */
export async function sweep ({ root = DEFAULT_CACHE_ROOT, ttlMs, dryRun = false, now = Date.now(), emptyGraceMs = DEFAULT_EMPTY_GRACE_MS }) {
  // Without this a missing ttlMs compares as NaN, which silently sweeps only empty dirs.
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new TypeError(`sweep needs a non-negative ttlMs, got ${ttlMs}`)
  const entries = await readCache(root)
  const result = await evict(selectExpired(entries, { ttlMs, now, emptyGraceMs }), { dryRun })
  const totalBytes = entries.reduce((n, e) => n + e.bytes, 0)
  return { ...result, scanned: entries.length, totalBytes, keptBytes: totalBytes - result.bytes }
}
