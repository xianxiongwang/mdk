// The selection logic decides what gets deleted off a real disk, so the tests that matter
// are the ones proving it does not over-select.

import test from 'brittle'
import { mkdtemp, mkdir, writeFile, utimes, readdir, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCache, selectExpired, evict, sweep, parseDuration, DEFAULT_TTL } from '../../src/cache-reaper.js'

// {root}/{hash(history)}/{modelId}/{hash(system + toolNames)}.bin
async function fixture (conversations) {
  const root = await mkdtemp(join(tmpdir(), 'kv-cache-'))
  for (const { name, bytes, ageMs } of conversations) {
    const dir = join(root, name, 'model-hash')
    await mkdir(dir, { recursive: true })
    const when = new Date(Date.now() - ageMs)
    if (bytes > 0) {
      const file = join(dir, 'config-hash.bin')
      await writeFile(file, Buffer.alloc(bytes))
      await utimes(file, when, when)
    } else {
      // An empty entry carries its age on the directory itself — set it after mkdir, since
      // creating the child updates the parent's mtime.
      await utimes(join(root, name), when, when)
    }
  }
  return root
}

const HOUR = 36e5

// Parsing decides how much gets deleted, so it lives here rather than in the bin, where a
// module with top-level await and process.exit cannot be imported by a test at all.
test('parseDuration reads every suffix, and minutes when there is none', (t) => {
  t.is(parseDuration('45s'), 45e3)
  t.is(parseDuration('90m'), 90 * 6e4)
  t.is(parseDuration('24h'), 24 * HOUR)
  t.is(parseDuration('7d'), 7 * 864e5)
  t.is(parseDuration('30'), 30 * 6e4, 'a bare number means minutes')
  t.is(parseDuration('1.5h'), 1.5 * HOUR, 'fractions are allowed')
  t.is(parseDuration(' 24h '), 24 * HOUR, 'surrounding space is tolerated')
  t.is(parseDuration(DEFAULT_TTL), 24 * HOUR, 'the shipped default parses')
})

test('parseDuration throws rather than returning NaN', (t) => {
  // A NaN ttl reaches sweep, which rejects it — but only because it checks. Anything that
  // silently returned NaN here would be a sweep that deletes on an undefined comparison.
  const rejected = (value) => {
    try {
      parseDuration(value)
      return false
    } catch (err) {
      return /invalid duration/.test(err.message)
    }
  }
  for (const bad of ['', 'soon', '24 h', '24hh', '-5m', 'h', '1e3s', null, undefined]) {
    t.ok(rejected(bad), `rejects ${JSON.stringify(bad)}`)
  }
})

test('readCache reports size and age per conversation, and flags empty ones', async (t) => {
  const root = await fixture([
    { name: 'old', bytes: 2048, ageMs: 48 * HOUR },
    { name: 'fresh', bytes: 1024, ageMs: 1 * HOUR },
    { name: 'never-completed', bytes: 0, ageMs: 0 }
  ])
  const entries = await readCache(root)
  t.is(entries.length, 3)

  const by = Object.fromEntries(entries.map((e) => [e.path.split(/[\\/]/).pop(), e]))
  t.is(by.old.bytes, 2048)
  t.is(by.fresh.bytes, 1024)
  t.is(by['never-completed'].bytes, 0, 'a turn that never completed wrote no blob')
  t.is(by['never-completed'].empty, true)
  t.is(by.old.empty, false)
})

test('readCache returns empty for a root that does not exist', async (t) => {
  // The reaper may run before the server has ever cached anything — that is not an error.
  t.alike(await readCache(join(tmpdir(), 'kv-cache-does-not-exist-9f3a')), [])
})

test('selectExpired takes entries past the TTL and leaves fresh ones alone', async (t) => {
  const root = await fixture([
    { name: 'old', bytes: 2048, ageMs: 48 * HOUR },
    { name: 'fresh', bytes: 1024, ageMs: 1 * HOUR }
  ])
  const expired = selectExpired(await readCache(root), { ttlMs: 24 * HOUR })
  t.is(expired.length, 1)
  t.ok(expired[0].path.endsWith('old'), 'only the stale conversation was selected')
})

// The server creates a conversation's directory before writing the blob, so "empty" and "not
// written yet" look identical on disk. Only age separates them, and deleting the second one
// takes a live turn with it.
test('selectExpired leaves a new empty directory alone and takes an old one', async (t) => {
  const root = await fixture([
    { name: 'in-flight', bytes: 0, ageMs: 0 },
    { name: 'aborted', bytes: 0, ageMs: 2 * HOUR }
  ])
  const entries = await readCache(root)
  const expired = selectExpired(entries, { ttlMs: 24 * HOUR, emptyGraceMs: 5 * 60e3 })

  t.is(expired.length, 1)
  t.ok(expired[0].path.endsWith('aborted'), 'the turn still being written is not evicted')
})

// Without the directory's own timestamp an empty entry has mtime 0, which reads as 1970 and is
// therefore older than every TTL — the grace window would never protect anything.
test('an empty entry takes its age from the directory, not from a missing file', async (t) => {
  const root = await fixture([{ name: 'in-flight', bytes: 0, ageMs: 0 }])
  const [entry] = await readCache(root)

  t.is(entry.empty, true)
  t.ok(entry.mtime > Date.now() - 60e3, 'dated now, not at the epoch')
})

// An entry we failed to size is not an entry we know to be stale. Selection is tested directly
// here because provoking a read failure depends on filesystem permissions being enforced.
test('selectExpired never takes an entry it could not measure', async (t) => {
  const unreadable = { path: '/x/unreadable', bytes: 0, mtime: 0, empty: true, unmeasurable: true }
  const stale = { path: '/x/stale', bytes: 4096, mtime: Date.now() - 48 * HOUR, empty: false, unmeasurable: false }

  const expired = selectExpired([unreadable, stale], { ttlMs: 24 * HOUR })
  t.is(expired.length, 1)
  t.is(expired[0].path, '/x/stale', 'a permission problem must not read as an aborted turn')
})

test('readCache flags an entry whose files cannot be read rather than sizing it at zero', async (t) => {
  const root = await fixture([{ name: 'locked', bytes: 512, ageMs: 1 * HOUR }])
  await chmod(join(root, 'locked', 'model-hash'), 0o000)
  const [entry] = await readCache(root)
  await chmod(join(root, 'locked', 'model-hash'), 0o700)

  if (!entry.unmeasurable) {
    t.pass('filesystem does not enforce the permission — nothing to assert')
    return
  }
  t.is(entry.bytes, 0, 'it sizes at zero, which is exactly why the flag is needed')
  t.absent(selectExpired([entry], { ttlMs: 24 * HOUR }).length, 'and that zero never becomes a deletion')
})

test('selectExpired keeps everything when nothing has aged out', async (t) => {
  const root = await fixture([
    { name: 'a', bytes: 512, ageMs: 1 * HOUR },
    { name: 'b', bytes: 512, ageMs: 2 * HOUR }
  ])
  t.alike(selectExpired(await readCache(root), { ttlMs: 24 * HOUR }), [])
})

test('selectExpired uses the injected clock, not the wall clock', async (t) => {
  const root = await fixture([{ name: 'a', bytes: 512, ageMs: 1 * HOUR }])
  const entries = await readCache(root)
  t.is(selectExpired(entries, { ttlMs: 24 * HOUR }).length, 0)
  // Same entries, a clock two days later — now it is stale.
  t.is(selectExpired(entries, { ttlMs: 24 * HOUR, now: Date.now() + 48 * HOUR }).length, 1)
})

test('evict removes the selected directories and reports what it freed', async (t) => {
  const root = await fixture([
    { name: 'old', bytes: 2048, ageMs: 48 * HOUR },
    { name: 'fresh', bytes: 1024, ageMs: 1 * HOUR }
  ])
  const result = await evict(selectExpired(await readCache(root), { ttlMs: 24 * HOUR }))
  t.is(result.removed, 1)
  t.is(result.bytes, 2048)
  t.is(result.failed, 0)
  t.alike((await readdir(root)).sort(), ['fresh'], 'the fresh conversation is still on disk')
})

test('dryRun reports the same numbers but deletes nothing', async (t) => {
  const root = await fixture([{ name: 'old', bytes: 2048, ageMs: 48 * HOUR }])
  const result = await sweep({ root, ttlMs: 24 * HOUR, dryRun: true })
  t.is(result.removed, 1)
  t.is(result.bytes, 2048)
  t.alike(await readdir(root), ['old'], 'nothing was actually removed')
})

// The server reclaims entries while a sweep is in flight, and rm with force succeeds on a path
// that is already gone — counting those as removed would report bytes nothing freed.
test('evict reports an entry the server already reclaimed as vanished, not removed', async (t) => {
  const root = await fixture([{ name: 'gone', bytes: 4096, ageMs: 48 * HOUR }])
  const expired = selectExpired(await readCache(root), { ttlMs: 24 * HOUR })
  await rm(join(root, 'gone'), { recursive: true, force: true })

  const result = await evict(expired)
  t.is(result.vanished, 1)
  t.is(result.removed, 0)
  t.is(result.bytes, 0, 'no bytes are claimed for a directory that was already gone')
  t.is(result.failed, 0, 'and it is not an error')
})

// Reporting an unreachable entry as vanished retires it from every future sweep while it is
// still on disk — the same conflation the measurement had, one function further on.
test('evict counts an unreachable entry as failed, not as one the server reclaimed', async (t) => {
  const root = await fixture([{ name: 'locked', bytes: 512, ageMs: 48 * HOUR }])
  const expired = selectExpired(await readCache(root), { ttlMs: 24 * HOUR })
  await chmod(root, 0o000)

  const result = await evict(expired)
  await chmod(root, 0o700)

  if (result.removed === 1) {
    t.pass('filesystem does not enforce the permission — nothing to assert')
    return
  }
  t.is(result.vanished, 0, 'the entry is still on disk, so nothing reclaimed it')
  t.is(result.failed, 1, 'it is our failure to reach it, and it stays eligible next sweep')
})

test('readCache ignores stray files at the cache root', async (t) => {
  const root = await fixture([{ name: 'a', bytes: 512, ageMs: 1 * HOUR }])
  await writeFile(join(root, 'not-a-conversation.txt'), 'x')
  const entries = await readCache(root)
  t.is(entries.length, 1)
  t.ok(entries[0].path.endsWith('a'))
})

test('evict counts a failed removal and keeps going', async (t) => {
  const root = await fixture([
    { name: 'blocked', bytes: 512, ageMs: 48 * HOUR },
    { name: 'fine', bytes: 512, ageMs: 48 * HOUR }
  ])
  const expired = selectExpired(await readCache(root), { ttlMs: 24 * HOUR })
  // A directory that cannot be traversed makes rm fail. Skipped where the test runs as a
  // user that ignores permission bits (root, and Windows filesystems).
  await chmod(join(root, 'blocked'), 0o500)
  const result = await evict(expired)
  await chmod(join(root, 'blocked'), 0o700)
  if (result.failed === 0) {
    t.pass('filesystem does not enforce the permission — nothing to assert')
    return
  }
  t.is(result.failed, 1)
  t.is(result.removed, 1, 'the other entry was still removed')
})

test('sweep rejects a missing or negative ttl instead of sweeping only empties', async (t) => {
  const root = await fixture([{ name: 'old', bytes: 512, ageMs: 48 * HOUR }])
  const rejects = async (opts) => {
    try {
      await sweep({ root, ...opts })
      return null
    } catch (err) {
      return err
    }
  }
  t.ok(/ttlMs/.test((await rejects({}))?.message ?? ''), 'a missing ttl throws')
  t.ok(/ttlMs/.test((await rejects({ ttlMs: -1 }))?.message ?? ''), 'a negative ttl throws')
  t.alike(await readdir(root), ['old'], 'nothing was removed')
})

test('sweep reports scanned, freed and kept totals', async (t) => {
  const root = await fixture([
    { name: 'old', bytes: 2048, ageMs: 48 * HOUR },
    { name: 'fresh', bytes: 1024, ageMs: 1 * HOUR }
  ])
  const result = await sweep({ root, ttlMs: 24 * HOUR })
  t.is(result.scanned, 2)
  t.is(result.totalBytes, 3072)
  t.is(result.bytes, 2048)
  t.is(result.keptBytes, 1024)
})
