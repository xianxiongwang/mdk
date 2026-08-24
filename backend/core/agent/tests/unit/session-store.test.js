import test from 'brittle'
import { MemorySessionStore, SESSION_GONE, DEFAULT_TTL_MS, DEFAULT_MAX_MESSAGES } from '../../src/session-store.js'

// A clock we control, so expiry is tested without waiting for it.
function clockStore (opts = {}) {
  let t = 1_000_000
  const store = new MemorySessionStore({ now: () => t, ...opts })
  return { store, advance: (ms) => { t += ms } }
}

const msg = (role, content) => ({ role, content })

// t.exception does not reliably capture throws here, so failures are caught directly and
// asserted on the message.
async function rejection (fn) {
  return (await rejectionError(fn))?.message ?? null
}

async function rejectionError (fn) {
  try {
    await fn()
    return null
  } catch (err) {
    return err
  }
}

function thrown (fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err.message
  }
}

test('a new session is empty, owned, and identified unguessably', async (t) => {
  const store = new MemorySessionStore()
  const a = await store.create({ userId: 'alice', metadata: { title: 'Morning check' } })

  t.alike(a.messages, [])
  t.is(a.userId, 'alice')
  t.alike(a.metadata, { title: 'Morning check' })
  t.is(a.createdAt, a.updatedAt)

  // The id travels in URLs the operator can see, so a counter would let one user guess another's.
  t.ok(/^[0-9a-f-]{36}$/.test(a.id), 'a uuid, not a sequence')
  const b = await store.create({ userId: 'alice' })
  t.not(a.id, b.id)
})

test('create refuses a session with no owner', async (t) => {
  const store = new MemorySessionStore()
  t.ok(/needs a userId/.test(await rejection(() => store.create({}))))
  t.ok(/needs a userId/.test(await rejection(() => store.create({ userId: '  ' }))))
})

// The cheap implementation must not be more forgiving than the expensive one: over a network a
// caller gets a deserialised copy, so mutating it changes nothing until save().
test('records handed out are copies, not the stored object', async (t) => {
  const store = new MemorySessionStore()
  const created = await store.create({ userId: 'alice' })

  created.messages.push(msg('user', 'sneaky'))
  created.metadata.title = 'changed'
  const fetched = await store.get(created.id)

  t.alike(fetched.messages, [], 'pushing to a handed-out record did not reach the store')
  t.absent(fetched.metadata.title, 'nor did editing its metadata')

  const first = await store.get(created.id)
  first.messages.push(msg('user', 'also sneaky'))
  t.alike((await store.get(created.id)).messages, [], 'and get returns a fresh copy each time')
})

test('saving replaces the history and re-stamps the session', async (t) => {
  const { store, advance } = clockStore()
  const created = await store.create({ userId: 'alice' })

  advance(5000)
  const saved = await store.save({ ...created, messages: [msg('user', 'how many miners?'), msg('assistant', '15')] })

  t.is(saved.messages.length, 2)
  t.is(saved.createdAt, created.createdAt, 'creation time is fixed')
  t.ok(saved.updatedAt > created.updatedAt, 'and the write moves updatedAt')
  t.alike((await store.get(created.id)).messages.at(-1), msg('assistant', '15'))
})

test('ownership is set at creation and cannot be moved by a write', async (t) => {
  const store = new MemorySessionStore()
  const created = await store.create({ userId: 'alice' })

  const saved = await store.save({ ...created, userId: 'bob' })
  t.is(saved.userId, 'alice', 'a save cannot hand someone else the session')
  t.is((await store.get(created.id)).userId, 'alice')
})

test('an idle session expires, and an active one does not', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 30 * 60e3 })
  const created = await store.create({ userId: 'alice' })

  advance(29 * 60e3)
  t.ok(await store.get(created.id), 'still there just under the limit')

  // Any write resets the clock — a long conversation never dies under the operator.
  await store.save({ ...created, messages: [msg('user', 'still here')] })
  advance(29 * 60e3)
  t.ok(await store.get(created.id), 'the write pushed expiry out')

  advance(2 * 60e3)
  t.is(await store.get(created.id), null, 'idle past the limit, and gone')
})

// A caller should not have to tell "never existed" from "existed and expired".
test('get returns null for missing and expired alike', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  const created = await store.create({ userId: 'alice' })

  t.is(await store.get('no-such-id'), null)
  advance(2000)
  t.is(await store.get(created.id), null)
})

// Otherwise a session expires mid-conversation, the next message revives it, and the operator
// silently resumes a thread the system had already discarded.
test('saving an expired session fails rather than resurrecting it', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  const created = await store.create({ userId: 'alice' })
  advance(2000)

  t.ok(/expired/.test(await rejection(() => store.save({ ...created, messages: [msg('user', 'hello?')] }))))
  t.ok(/does not exist/.test(await rejection(() => store.save({ id: 'never-existed', messages: [] }))))
  t.ok(/needs a record with an id/.test(await rejection(() => store.save({ messages: [] }))))
})

// A caller cannot be asked to match on message text: an implementation that phrases its errors
// differently would get the retry path forever on a session that is never coming back.
test('a write to a session that is gone is refused by code, not by wording', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  const created = await store.create({ userId: 'alice' })

  const missing = await rejectionError(() => store.save({ id: 'never-existed', messages: [] }))
  t.is(missing.code, SESSION_GONE)

  advance(2000)
  const stale = await rejectionError(() => store.save({ ...created, messages: [] }))
  t.is(stale.code, SESSION_GONE)
})

test('history is capped, and the window never opens on an answer', async (t) => {
  const store = new MemorySessionStore({ maxMessages: 4 })
  const created = await store.create({ userId: 'alice' })

  const six = [
    msg('user', 'q1'), msg('assistant', 'a1'),
    msg('user', 'q2'), msg('assistant', 'a2'),
    msg('user', 'q3'), msg('assistant', 'a3')
  ]
  const saved = await store.save({ ...created, messages: six })

  t.is(saved.messages.length, 4, 'trimmed to the cap')
  t.alike(saved.messages.at(-1), msg('assistant', 'a3'), 'the newest survive')
  t.is(saved.messages[0].role, 'user', 'and it opens on a question')

  // Cutting mid-pair would leave a reply whose question is gone, which reads to the model as
  // something it said unprompted.
  const odd = await store.save({ ...created, messages: [...six, msg('user', 'q4')] })
  t.is(odd.messages[0].role, 'user')
})

test('listByUser returns only that user, only live, newest first', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 10_000 })
  const one = await store.create({ userId: 'alice' })
  advance(1000)
  const two = await store.create({ userId: 'alice' })
  await store.create({ userId: 'bob' })

  const alice = await store.listByUser('alice')
  t.alike(alice.map((s) => s.id), [two.id, one.id], 'most recently used first')
  t.is((await store.listByUser('bob')).length, 1, "and bob cannot see alice's")
  t.alike(await store.listByUser('nobody'), [])

  advance(20_000)
  t.alike(await store.listByUser('alice'), [], 'expired sessions are not listed')
})

test('delete removes it and reports whether there was anything to remove', async (t) => {
  const store = new MemorySessionStore()
  const created = await store.create({ userId: 'alice' })

  t.is(await store.delete(created.id), true)
  t.is(await store.get(created.id), null)
  t.is(await store.delete(created.id), false, 'deleting twice is not an error')
})

// Otherwise delete is an oracle for "this id was real" on a record get reports as never having
// existed, which is the distinction rule 3 exists to withhold.
test('deleting an expired session reports it the way get does', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  const created = await store.create({ userId: 'alice' })
  advance(2000)

  t.is(await store.delete(created.id), false)
})

// sweep only reclaims memory — get already refuses expired sessions — so the host owns the
// schedule. A store that started its own timer would be a leak nobody could clear.
test('sweep reclaims expired sessions and leaves live ones', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  await store.create({ userId: 'alice' })
  await store.create({ userId: 'bob' })
  advance(2000)
  const fresh = await store.create({ userId: 'carol' })

  t.is(await store.sweep(), 2)
  t.is(store.records.size, 1)
  t.ok(await store.get(fresh.id), 'the live one is untouched')
  t.is(await store.sweep(), 0, 'and a second sweep finds nothing')
})

test('the shipped defaults are the documented ones', (t) => {
  t.is(DEFAULT_TTL_MS, 30 * 60e3, '30 minutes idle')
  t.is(DEFAULT_MAX_MESSAGES, 200)

  const store = new MemorySessionStore()
  t.is(store.ttlMs, DEFAULT_TTL_MS)
  t.is(store.maxMessages, DEFAULT_MAX_MESSAGES)
})

test('a nonsensical configuration is refused at construction', (t) => {
  t.ok(/positive number/.test(thrown(() => new MemorySessionStore({ ttlMs: 0 }))))
  t.ok(/positive number/.test(thrown(() => new MemorySessionStore({ ttlMs: -1 }))))
  t.ok(/positive integer/.test(thrown(() => new MemorySessionStore({ maxMessages: 0 }))))
  t.ok(/positive integer/.test(thrown(() => new MemorySessionStore({ maxMessages: 1.5 }))))
})

// sweep() alone is not enough: a session nobody resumes is never read, so expiry-on-read frees
// nothing for the majority of records. A host that only ever creates sessions grew forever.
test('ordinary traffic reclaims expired records without anyone calling sweep', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000, sweepEvery: 5 })

  for (let i = 0; i < 4; i++) await store.create({ userId: 'alice' })
  t.is(store.records.size, 4, 'nothing reclaimed yet')

  advance(2000)
  await store.create({ userId: 'alice' }) // the fifth create triggers the sweep
  t.is(store.records.size, 1, 'the expired four are gone, the new one remains')
})

test('reclaiming is amortised, not on every write', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000, sweepEvery: 100 })
  for (let i = 0; i < 3; i++) await store.create({ userId: 'alice' })
  advance(2000)
  await store.create({ userId: 'alice' })

  // Correctness never depended on the sweep — get still refuses them — so paying O(n) per
  // create to keep the map tidy would be the wrong trade.
  t.is(store.records.size, 4, 'no scan on an ordinary create')
})

// Filtering without deleting left the memory it had just proved was dead.
test('listing a user also drops the expired records it walks past', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  await store.create({ userId: 'alice' })
  await store.create({ userId: 'bob' })
  advance(2000)
  const fresh = await store.create({ userId: 'alice' })

  t.is((await store.listByUser('alice')).length, 1, 'only the live one is listed')
  t.is(store.records.size, 1, "and the other two are gone, including bob's")
  t.is((await store.get(fresh.id)).id, fresh.id, 'the live one is untouched')
})

// A record is the fields the contract names. A persistent implementation would otherwise have to
// store columns nobody declared.
test('unknown fields handed to save are not persisted', async (t) => {
  const store = new MemorySessionStore()
  const created = await store.create({ userId: 'alice' })

  const saved = await store.save({ ...created, secret: 'x', id: created.id, messages: [] })
  t.absent(saved.secret, 'not returned')
  t.absent((await store.get(created.id)).secret, 'and not stored')
  t.alike(Object.keys(saved).sort(), ['createdAt', 'id', 'messages', 'metadata', 'updatedAt', 'userId'])
})

test('a caller mutating what it passed does not reach the store', async (t) => {
  const store = new MemorySessionStore()
  const metadata = { title: 'original' }
  const created = await store.create({ userId: 'alice', metadata })
  metadata.title = 'mutated'
  t.is((await store.get(created.id)).metadata.title, 'original')

  const message = { role: 'user', content: 'original' }
  await store.save({ id: created.id, messages: [message] })
  message.content = 'mutated'
  t.is((await store.get(created.id)).messages[0].content, 'original')
})

test('a session at exactly its ttl survives; the millisecond after does not', async (t) => {
  const { store, advance } = clockStore({ ttlMs: 1000 })
  const created = await store.create({ userId: 'alice' })

  advance(1000)
  t.ok(await store.get(created.id), 'the boundary belongs to the living')
  advance(1)
  t.is(await store.get(created.id), null)
})

test('omitting metadata leaves it alone; an empty object clears it', async (t) => {
  const store = new MemorySessionStore()
  const created = await store.create({ userId: 'alice', metadata: { title: 'Morning check' } })

  const untouched = await store.save({ id: created.id, messages: [] })
  t.alike(untouched.metadata, { title: 'Morning check' }, 'a write of history alone keeps it')

  const cleared = await store.save({ id: created.id, messages: [], metadata: {} })
  t.alike(cleared.metadata, {}, 'and it can be cleared deliberately')
})
