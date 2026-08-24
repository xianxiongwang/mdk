// Whether an id in an answer was relayed or made up. Getting this wrong in the flattering
// direction — reporting a clean zero for something never measured — is the one failure this
// harness must not have, so every "cannot tell" path is asserted here rather than assumed.

import test from 'brittle'
import { fleetIds, idShape, analyse } from '../../src/ids.js'
import { AXIS } from '../../src/tools.js'

const listing = (byFamily) => ({
  callTool: async (_name, { family }) => {
    const entry = byFamily[family] ?? { items: [], total: 0 }
    return { text: JSON.stringify(entry) }
  }
})

const ids = (...names) => ({ items: names.map((deviceId) => ({ deviceId })), total: names.length })

// ── fleetIds ─────────────────────────────────────────────────────────────────

test('every family the contract defines is asked for', async (t) => {
  const asked = []
  const mcp = {
    callTool: async (_name, { family }) => {
      asked.push(family)
      return { text: JSON.stringify(ids()) }
    }
  }
  await fleetIds(mcp)

  // Restating this list instead of reading AXIS is how a new family silently drops out of the
  // id set while the set still calls itself complete — and its real devices then read as
  // fabrications.
  t.alike(asked.sort(), AXIS.family.filter((f) => f !== 'all').sort(), 'read from the contract, not restated')
})

test('ids are collected across families', async (t) => {
  const { ids: known, complete } = await fleetIds(listing({
    miner: ids('antminer-0', 'avalon-1'),
    container: ids('container-1')
  }))
  t.alike([...known].sort(), ['antminer-0', 'avalon-1', 'container-1'])
  t.is(complete, true)
})

// list_devices names at most `limit` and reports the true count separately.
test('a family with more devices than the tool will name makes the set incomplete', async (t) => {
  const { ids: known, complete } = await fleetIds(listing({
    miner: { items: [{ deviceId: 'antminer-0' }], total: 80 }
  }))
  t.is(complete, false, 'the set is a prefix, and says so')
  t.is(known.size, 1, 'what did come back is still kept')
})

// A family we could not read is a family whose ids we do not hold — which is the same problem.
test('an unreadable family makes the set incomplete rather than looking whole', async (t) => {
  const { complete } = await fleetIds({ callTool: async () => ({ text: 'not json at all' }) })
  t.is(complete, false)
})

// ── idShape ──────────────────────────────────────────────────────────────────

test('the shape generalises past the ids it was built from', (t) => {
  const shape = idShape(new Set(['antminer-0', 'container-1']))
  // The whole point: catch an id the fleet does not have.
  t.alike('antminer-9 is down'.match(shape), ['antminer-9'])
  t.alike('container-1 and antminer-0'.match(shape), ['container-1', 'antminer-0'])
})

// Ten of the demo fleet's twenty-six ids are of this form — container-antspace,
// site-satec-powermeter, f2pool-worker — and the hardcoded pattern this replaced matched none of
// them, so a third of the fleet was invisible to the fabrication check.
test('ids without a trailing number are still recognised, just not generalised', (t) => {
  const shape = idShape(new Set(['container-antspace', 'f2pool-worker']))
  t.alike('container-antspace is down'.match(shape), ['container-antspace'])
  t.alike('f2pool-worker is down'.match(shape), ['f2pool-worker'])
})

test('a mixed fleet keeps both halves', (t) => {
  const shape = idShape(new Set(['antminer-0', 'container-antspace']))
  t.alike('antminer-0 and container-antspace'.match(shape), ['antminer-0', 'container-antspace'], 'the real ones')
  t.alike('antminer-99 is hot'.match(shape), ['antminer-99'], 'and a number this fleet does not have')
})

// Over-matching is the same lie in the other direction: prose reported as a device.
test('ordinary prose is not mistaken for an id', (t) => {
  const shape = idShape(new Set(['container-antspace', 'antminer-0']))
  t.is('container-level metrics look fine'.match(shape), null)
  t.is('the antminer fleet is healthy'.match(shape), null)
})

test('an empty fleet has no shape at all', (t) => {
  t.is(idShape(new Set()), null)
})

test('a longer id wins over a shorter one that is a prefix of it', (t) => {
  const shape = idShape(new Set(['site-1', 'site-sensor-2']))
  t.alike('site-sensor-2 is warm'.match(shape), ['site-sensor-2'], 'not matched as site-…')
})

test('a prefix with regex punctuation is escaped, not interpreted', (t) => {
  const shape = idShape(new Set(['rack.a-1']))
  t.ok(shape, 'it still builds')
  t.alike('rack.a-2 is down'.match(shape), ['rack.a-2'])
  t.is('rackXa-2 is down'.match(shape), null, 'the dot is a dot')
})

// ── analyse ──────────────────────────────────────────────────────────────────

const known = new Set(['antminer-0', 'antminer-1'])
const shape = idShape(known)

test('an id the tools never returned is unsupported', (t) => {
  const out = analyse('antminer-1 is offline', ['antminer-0 is online'], { known, shape, complete: true })
  t.alike(out.unsupportedIds, ['antminer-1'])
  t.alike(out.inventedIds, [], 'but it is a real device')
})

test('an id the fleet does not have is invented', (t) => {
  const out = analyse('antminer-7 is offline', [''], { known, shape, complete: true })
  t.alike(out.inventedIds, ['antminer-7'])
})

// null and [] mean opposite things: "not measured" and "measured, none found".
test('fabrication is not scored when it could not be judged', (t) => {
  t.is(analyse('antminer-7 is hot', [''], { known, shape, complete: false }).inventedIds, null,
    'a partial fleet cannot call anything invented')
  t.is(analyse('rack-alpha is hot', [''], { known, shape: null, complete: true }).inventedIds, null,
    'nor can naming the shape does not model')

  // The other half must keep working: what the tools did not supply is still knowable.
  const out = analyse('antminer-7 is hot', [''], { known, shape, complete: false })
  t.alike(out.unsupportedIds, ['antminer-7'], 'unsupported is judged from this turn alone')
})

test('an answer naming nothing yields empty, not null', (t) => {
  const out = analyse('There are 15 miners.', [''], { known, shape, complete: true })
  t.alike(out.unsupportedIds, [])
  t.alike(out.inventedIds, [])
})

test('capitalisation does not turn a real device into a fabrication', (t) => {
  const fleet = new Set(['container-1', 'antminer-0'])
  const shape = idShape(fleet)

  const out = analyse('Container-1 is offline.', ['container-1 is offline'], { known: fleet, shape, complete: true })
  t.alike(out.inventedIds, [], 'a real device, whatever the case')
  t.alike(out.unsupportedIds, [], 'and the tools did supply it')

  const fake = analyse('Antminer-99 is hot.', ['antminer-0 is fine'], { known: fleet, shape, complete: true })
  t.alike(fake.inventedIds, ['Antminer-99'], 'an invented id is still invented')
  t.alike(fake.unsupportedIds, ['Antminer-99'], 'and still unsupported')
})

test('the same id in two casings is reported once', (t) => {
  const fleet = new Set(['antminer-0'])
  const shape = idShape(fleet)
  const out = analyse('antminer-9 and Antminer-9 are hot', [''], { known: fleet, shape, complete: true })
  t.is(out.inventedIds.length, 1, 'one device, not two')
})
