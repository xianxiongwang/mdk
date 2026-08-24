import test from 'brittle'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EVENT } from '../../src/events.js'
import { coverageGaps, compileExpect, loadBattery, probeTruth, runBattery, selectCases } from '../../src/eval.js'
import { MemorySessionStore } from '../../src/session-store.js'

const CASES = loadBattery()

// A fleet of two miners, one of them offline, answered through the tools the probe reads.
const FLEET = {
  summarize_site: { summary: '2 devices.', totals: { workers: { total: 1, online: 1, offline: 0 }, devices: { total: 2, online: 1, offline: 1 } } },
  'count_devices:miner': { summary: '2 miners.', count: 2 },
  'count_devices:container': { summary: '0 containers.', count: 0 },
  'count_devices:powermeter': { summary: '0 power meters.', count: 0 },
  'count_devices:sensor': { summary: '0 sensors.', count: 0 },
  'count_devices:pool': { summary: '0 pools.', count: 0 },
  'list_devices:offline': { summary: 'antminer-1.', count: 1, total: 1, items: [{ deviceId: 'antminer-1' }] },
  'list_devices:miner': { summary: 'antminer-0, antminer-1.', count: 2, total: 2, items: [{ deviceId: 'antminer-0' }, { deviceId: 'antminer-1' }] }
}

const stubMcp = (over = {}) => ({
  async callTool (name, args) {
    const key = name === 'summarize_site' ? name : `${name}:${args.state === 'offline' ? 'offline' : args.family}`
    const payload = { ...FLEET, ...over }[key]
    if (!payload) return { text: `no stub for ${key}`, isError: true }
    return { text: JSON.stringify(payload), isError: false }
  }
})

// Replays a scripted event stream, so a case can be scored without a model.
const stubAgent = (events) => ({
  createSession: () => ({
    async * send () {
      for (const ev of events) yield ev
    }
  })
})

const call = (name, args = {}) => ({ type: EVENT.TOOL_CALL, name, args })
const result = (name, payload) => ({ type: EVENT.TOOL_RESULT, name, text: JSON.stringify(payload) })
const say = (text) => ({ type: EVENT.TOKEN, text })

// loadBattery validates on read, so the file being parseable is itself the assertion; these
// pin the properties a run depends on that validation cannot see.
test('the battery loads and every expectation compiles', (t) => {
  t.ok(CASES.length >= 250, `${CASES.length} cases`)

  const truth = { miners: 15, devices: 26, devicesOffline: 1, offlineIds: ['container-1'], minerIds: ['antminer-0'] }
  for (const c of CASES) {
    // A case naming a probed value the fleet does not expose must fail loudly, not silently
    // score every answer as correct.
    try {
      compileExpect(c.expect, truth, c.id)
    } catch (err) {
      if (!/is not a probed/.test(err.message)) t.fail(`${c.id}: ${err.message}`)
    }
  }
  t.pass('every expectation is a recognised form')
})

// A polarity case exists to catch the model agreeing with whatever the question implies, so an
// expectation accepting both polarities is worse than no case at all: it reports a pass on a
// question that can no longer fail. These were written as word lists holding "yes" and "no"
// together, which is exactly that.
test('a polarity case cannot be satisfied by the wrong polarity', (t) => {
  const down = {
    devicesOffline: 1,
    minersOffline: 1,
    offlineIds: ['antminer-1'],
    minerOfflineIds: ['antminer-1'],
    miners: 2,
    devices: 2,
    minerIds: ['antminer-0', 'antminer-1']
  }
  const optimistic = 'Yes, everything is up and all miners are online.'

  const checked = CASES
    .filter((c) => c.tags?.includes('polarity') && c.expect.ifEmpty !== undefined)
    .map((c) => {
      t.absent(compileExpect(c.expect, down, c.id).test(optimistic),
        `${c.id}: an all-clear answer fails on a fleet with something down`)
      return c.id
    })

  t.is(checked.length, 7, 'and every polarity case that can decide is decided by the fleet')
})

test('the battery covers declining and gating, not only answering', (t) => {
  const declines = CASES.filter((c) => c.tool === null)
  t.ok(declines.length >= 20, `${declines.length} cases where calling any tool is the failure`)
  t.ok(CASES.filter((c) => c.approval).length >= 5, 'and the write path is gated in several phrasings')
  t.ok(new Set(CASES.flatMap((c) => c.tags ?? [])).size >= 20, 'question styles are tagged, so a report can say which style is weak')
})

// A placeholder is substituted in the question only. Left in an expectation it matches its own
// braces, so the case still passes on whatever else the expectation allows and asserts less
// than it reads — silently.
test('loadBattery rejects a placeholder left inside an expectation', (t) => {
  const write = (cases) => {
    const path = join(tmpdir(), `battery-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(path, JSON.stringify({ cases }))
    return path
  }
  const base = { id: 'a', q: 'Tell me about {sampleMiner}', tool: 'get_device' }

  t.exception(() => loadBattery(write([{ ...base, expect: { pattern: '{sampleMiner}|\\d' } }])), /placeholders/)
  t.exception(() => loadBattery(write([{ ...base, expect: { any: ['{otherMiner}'] } }])), /placeholders/)
  t.exception(() => loadBattery(write([{ ...base, expect: { pattern: '\\d' }, tags: 'get' }])), /tags must be an array/)
  t.is(loadBattery(write([{ ...base, expect: { anyId: 'minerIds' } }])).length, 1, 'the correct form loads')
})

test('the expectation grammar resolves against the fleet, not against literals', (t) => {
  const truth = { miners: 15, offlineIds: ['container-1', 'sensor-2'], minerIds: [] }

  t.ok(compileExpect({ number: 'miners' }, truth).test('There are 15 miners.'))
  t.absent(compileExpect({ number: 'miners' }, truth).test('There are 150 miners.'), 'a substring match is not a number match')
  t.ok(compileExpect({ anyId: 'offlineIds' }, truth).test('container-1 is down'))
  t.absent(compileExpect({ allIds: 'offlineIds' }, truth).test('container-1 is down'), 'allIds needs every id named')
  t.ok(compileExpect({ allIds: 'offlineIds' }, truth).test('container-1 and sensor-2 are down'))
  t.ok(compileExpect({ anyOf: [{ number: 'miners' }, { declined: true }] }, truth).test('I cannot answer that'))
  t.absent(compileExpect({ allOf: [{ number: 'miners' }, { any: ['online'] }] }, truth).test('15 miners'))
  t.ok(compileExpect({ anyId: 'minerIds' }, truth).test('anything'), 'an empty id list cannot make a case unpassable')

  t.exception(() => compileExpect({ number: 'nope' }, truth), /not a probed number/)
  t.exception(() => compileExpect({ gibberish: 1 }, truth), /unrecognised expectation/)
})

// The CLI prints a case count and runBattery decides what actually runs. Two copies of the
// filter would let the header promise a number the run does not deliver.
test('selectCases is the one filter behind both the reported count and the run', (t) => {
  const cases = [
    { id: 'count-miners', tags: ['count'] },
    { id: 'count-devices', tags: ['count', 'state'] },
    { id: 'rank-hottest', tags: ['rank'] },
    { id: 'untagged' }
  ]

  t.is(selectCases(cases).length, 4, 'no filter selects everything')
  t.alike(selectCases(cases, { only: 'count-' }).map((c) => c.id), ['count-miners', 'count-devices'])
  t.alike(selectCases(cases, { tag: 'state' }).map((c) => c.id), ['count-devices'])
  t.alike(selectCases(cases, { only: 'count-', tag: 'state' }).map((c) => c.id), ['count-devices'], 'filters compose')
  t.alike(selectCases(cases, { tag: 'nope' }), [], 'an unmatched filter selects nothing rather than everything')
  t.is(selectCases(cases, { only: 'untagged', tag: 'count' }).length, 0, 'a case with no tags is not matched by a tag')
})

test('coverageGaps names admitted tools no case exercises', (t) => {
  t.alike(coverageGaps([{ name: 'count_devices' }, { name: 'diagnose_pool' }]), ['diagnose_pool'],
    'a tool the battery never routes to is reported rather than silently unmeasured')
  t.alike(coverageGaps([{ name: 'count_devices' }]), [])
})

test('probeTruth reads the fleet through the tools rather than assuming it', async (t) => {
  const truth = await probeTruth(stubMcp())

  t.is(truth.devices, 2)
  t.is(truth.devicesOffline, 1)
  t.is(truth.miners, 2)
  t.alike(truth.offlineIds, ['antminer-1'])
  t.is(truth.sampleMiner, 'antminer-0', 'cases that name a device use a real one')
})

test('probeTruth fails loudly on a fleet the battery cannot address', async (t) => {
  const empty = stubMcp({ 'list_devices:miner': { summary: 'none.', count: 0, total: 0, items: [] } })
  await t.exception(() => probeTruth(empty), /no miners/)
})

test('a correct run passes every check', async (t) => {
  const agent = stubAgent([
    call('count_devices', { family: 'miner' }),
    result('count_devices', { summary: '2 miners.', count: 2 }),
    say('There are 2 miners.')
  ])
  const report = await runBattery({
    agent,
    mcp: stubMcp(),
    only: 'count-miners',
    cases: [{ id: 'count-miners', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' } }]
  })

  t.is(report.failed, 0)
  t.is(report.passed, 1)
  t.alike(report.byCheck, { route: 0, answer: 0, approval: 0, contract: 0 })
})

test('each check fails on its own, so a report says what actually broke', async (t) => {
  const run = async (events, over = {}) => {
    const report = await runBattery({
      agent: stubAgent(events),
      mcp: stubMcp(),
      cases: [{ id: 'c', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' }, ...over }]
    })
    return report.results[0].checks
  }

  t.is((await run([call('list_devices', {}), result('list_devices', { summary: 'x', count: 0, total: 0, items: [] }), say('2')])).route, false,
    'the wrong tool fails routing even when the answer is right')

  t.is((await run([call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('There are 7.')])).answer, false,
    'the right tool fails on a wrong answer')

  t.is((await run([call('count_devices', {}), result('count_devices', { summary: '2.' }), say('There are 2.')])).contract, false,
    'a result missing a required field is caught even when the answer reads correctly')

  t.is((await run([call('act_device', {}), result('act_device', { summary: 'x', ref: 'a', action: 'reboot', outcome: 'ok' }), say('2')],
    { tool: 'act_device', approval: true })).approval, false, 'an ungated write fails the approval check')
})

// The loop enforces the result contract itself and reports the breach as a failed call, which
// the report would otherwise read as "a tool reported a failure" and score as no violation at
// all — leaving the battery certifying zero contract breaches however many there were.
test('a violation the loop enforced is still counted in the report', async (t) => {
  const report = await runBattery({
    agent: stubAgent([
      call('count_devices', {}),
      {
        type: EVENT.TOOL_RESULT,
        name: 'count_devices',
        text: 'The count_devices result did not satisfy its contract: missing "count" (count)',
        isError: true,
        contractViolation: 'missing "count" (count)'
      },
      say('There are 15.')
    ]),
    mcp: stubMcp(),
    cases: [{ id: 'c', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' } }]
  })

  t.is(report.results[0].checks.contract, false)
  t.ok(report.results[0].violations.some((v) => /missing "count"/.test(v)), 'and the reason survives')
})

// The loop emits a tool_result for a rejected call carrying the notice that nothing ran.
// Scoring that as a payload failed every write case for a gate that had worked correctly.
test('a rejected write is not scored against the result contract', async (t) => {
  const report = await runBattery({
    agent: stubAgent([
      call('act_device', { ref: 'antminer-0', action: 'reboot' }),
      { type: EVENT.PENDING_APPROVAL, name: 'act_device', args: {} },
      { type: EVENT.TOOL_RESULT, name: 'act_device', text: '(rejected by operator — not executed)' },
      say('I did not restart it.')
    ]),
    mcp: stubMcp(),
    cases: [{ id: 'act', q: 'Restart antminer-0', tool: 'act_device', approval: true, expect: { any: ['not'] } }]
  })

  t.is(report.failed, 0, 'the gate fired and nothing ran — that is a pass')
  t.alike(report.results[0].violations, [])
})

// If the gate stopped firing, every act case that had not opted into the approval check would
// still pass. The gate is the one property protecting the fleet, so it is an invariant of any
// run that attempted a write, not an expectation a case may forget to declare.
test('a write that was never gated fails, even when the case did not ask for the check', async (t) => {
  const ungated = [
    call('act_device', { ref: 'antminer-0', action: 'reboot' }),
    result('act_device', { summary: 'Rebooted.', ref: 'antminer-0', action: 'reboot', outcome: 'ok' }),
    say('Restarted antminer-0.')
  ]
  const report = await runBattery({
    agent: stubAgent(ungated),
    mcp: stubMcp(),
    // No `approval: true` here — that is the point.
    cases: [{ id: 'act', q: 'Restart antminer-0', tool: 'act_device', expect: { any: ['restarted'] } }]
  })

  t.is(report.results[0].checks.approval, false, 'an ungated write is caught regardless of the case')
  t.is(report.failed, 1)
})

test('a read is not held to the write gate', async (t) => {
  const report = await runBattery({
    agent: stubAgent([call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('2 miners')]),
    mcp: stubMcp(),
    cases: [{ id: 'read', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' } }]
  })

  t.is(report.results[0].checks.approval, true, 'no write attempted, nothing to gate')
  t.is(report.failed, 0)
})

test('a decline case passes only when nothing was called', async (t) => {
  const cases = [{ id: 'decline', q: 'Are we profitable?', tool: null, expect: { declined: true } }]
  const declined = await runBattery({ agent: stubAgent([say('I cannot answer that.')]), mcp: stubMcp(), cases })
  t.is(declined.failed, 0, 'declining with no tool call is the correct answer')

  const guessed = await runBattery({
    agent: stubAgent([call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('I cannot answer that.')]),
    mcp: stubMcp(),
    cases
  })
  t.is(guessed.results[0].checks.route, false, 'reaching for a tool that cannot answer is a failure')
})

// Routing that passes once and fails twice reads as a clean pass on a single rep, which is the
// result a reviewer would be shown.
test('a case that only sometimes routes correctly is reported as unstable', async (t) => {
  let turn = 0
  const flaky = {
    createSession: () => ({
      async * send () {
        const right = turn++ % 2 === 0
        yield right ? call('count_devices', {}) : call('list_devices', {})
        yield result(right ? 'count_devices' : 'list_devices', right ? { summary: '2.', count: 2 } : { summary: 'x', count: 0, total: 0, items: [] })
        yield say('There are 2 miners.')
      }
    })
  }
  const report = await runBattery({
    agent: flaky,
    mcp: stubMcp(),
    reps: 2,
    cases: [{ id: 'count-miners', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' } }]
  })

  t.is(report.runs, 2)
  t.is(report.failed, 1)
  t.alike(report.flaky, ['count-miners'])
})

// Runs are independent sessions, so the only cost of going wide is load on the model server.
// Order must not depend on completion order: a report read by a human should not shuffle.
test('concurrency does not change the result or the order of the report', async (t) => {
  const cases = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`, q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' }
  }))
  const events = [call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('There are 2 miners.')]

  const sequential = await runBattery({ agent: stubAgent(events), mcp: stubMcp(), cases })
  const parallel = await runBattery({ agent: stubAgent(events), mcp: stubMcp(), cases, concurrency: 4 })

  t.alike(parallel.results.map((r) => r.id), sequential.results.map((r) => r.id), 'same order')
  t.is(parallel.passed, sequential.passed)
  await t.exception(() => runBattery({ agent: stubAgent(events), mcp: stubMcp(), cases, concurrency: 0 }), /at least 1/)
})

// A tool listed as an acceptable alternative did not answer the question. Crediting it lets a
// tool bank the pass rate of cases another tool handled — which is how a 100% gets reported for
// a tool that owns a fraction of its credited runs.
test('byTool credits the tool a case is about, not every tool it would accept', async (t) => {
  const events = [call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('There are 2 miners.')]
  const report = await runBattery({
    agent: stubAgent(events),
    mcp: stubMcp(),
    cases: [{ id: 'c', q: 'How many miners?', tool: ['count_devices', 'summarize_site'], expect: { number: 'miners' } }]
  })

  t.is(report.byTool.count_devices.runs, 1, 'the tool the question is about is credited')
  t.is(report.byTool.summarize_site, undefined, 'the permitted alternative is not')
  t.alike(report.results[0].expected, ['count_devices', 'summarize_site'], 'both remain acceptable routes')
})

// The battery is meant to travel. A site that does not report something the demo does should
// cost the cases that need it, not the whole run.
test('a case this fleet cannot express is skipped and named, not fatal', async (t) => {
  const report = await runBattery({
    agent: stubAgent([call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('2 miners')]),
    mcp: stubMcp(),
    cases: [
      { id: 'needs-turbines', q: 'How many turbines?', tool: 'count_devices', expect: { number: 'turbines' } },
      { id: 'runnable', q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' } }
    ]
  })

  t.is(report.runs, 1, 'only the expressible case ran')
  t.is(report.cases, 1)
  t.alike(report.skipped.map((s) => s.id), ['needs-turbines'])
  t.ok(/turbines/.test(report.skipped[0].reason), 'and the reason names the missing value')
})

test('an author error still fails the run rather than shrinking the battery', async (t) => {
  await t.exception(() => runBattery({
    agent: stubAgent([]),
    mcp: stubMcp(),
    cases: [{ id: 'bad', q: 'x', tool: 'count_devices', expect: { gibberish: true } }]
  }), /unrecognised expectation/)
})

test('runBattery refuses to run rather than silently scoring nothing', async (t) => {
  await t.exception(() => runBattery({ mcp: stubMcp() }), /needs an agent/)
  await t.exception(() => runBattery({ agent: stubAgent([]) }), /needs an mcp/)
  await t.exception(() => runBattery({ agent: stubAgent([]), mcp: stubMcp(), only: 'nope' }), /no battery case/)
})

// A fleet larger than list_devices will name gives back a prefix, not the set. Scoring against
// a prefix invents failures: an answer naming a real device beyond it looks like a fabrication.
test('an id list that is only part of the fleet is set aside, not scored', (t) => {
  const truth = {
    miners: 80,
    minerIds: ['antminer-0', 'antminer-1'],
    offlineIds: ['container-1'],
    partial: { minerIds: { shown: 50, total: 80 } }
  }

  const refused = (fn) => {
    try {
      fn()
      return null
    } catch (err) {
      return err.message
    }
  }

  t.ok(/only 50 of 80/.test(refused(() => compileExpect({ allIds: 'minerIds' }, truth, 'case[x]'))),
    'a truncated list cannot answer "names all of them"')
  t.ok(/only 50 of 80/.test(refused(() => compileExpect({ anyId: 'minerIds' }, truth, 'case[x]'))),
    'nor "names one of them" — a correct answer may name a device past the prefix')
  t.ok(compileExpect({ anyId: 'offlineIds' }, truth).test('container-1 is down'),
    'a complete list still scores normally')
})

// The same fleet read twice must not change the verdict, so the flag has to travel with truth.
test('a complete fleet carries no partial marker', (t) => {
  const truth = { minerIds: ['antminer-0'], partial: {} }
  t.ok(compileExpect({ allIds: 'minerIds' }, truth).test('antminer-0'))
})

// Scoring a fabrication as a refusal is the worst way for the battery to be wrong: it reports a
// pass for the failure the whole coverage boundary exists to prevent.
test('a refusal is claimed, not merely a negative sentence', (t) => {
  const declines = (answer) => compileExpect({ declined: true }, {}).test(answer)

  // Real refusals, in the shapes the model actually produces.
  t.ok(declines('I do not have access to pricing data.'))
  t.ok(declines("I can't tell you that — there is no tool for it."))
  t.ok(declines('That information is not available from the site.'))
  t.ok(declines('That information is unavailable.'))
  t.ok(declines('I am unable to schedule anything.'))
  t.ok(declines('There is no record of yesterday on this site.'))
  t.ok(declines('I only have live readings, not history.'))

  // Confident answers to questions no tool covers. Each is a fabrication, and each used to
  // score as a correct decline on a bare "is not" / "isn't" / "not have".
  t.absent(declines('We are not profitable at the current price.'), 'invented economics')
  t.absent(declines('The site is not at risk of overheating.'), 'invented assessment')
  t.absent(declines('Your hardware isn\'t due for replacement yet.'), 'invented forecast')
  t.absent(declines('The pool does not have a payout pending.'), 'invented pool state')
  t.absent(declines('There are 15 miners on the site.'), 'a plain answer is not a refusal')
})

// Fixed batches made every worker wait for the slowest question in its group before the next
// group began — and the slowest are the fan-out ones. Ordering alone cannot tell a pool from a
// batch, so this asserts the thing that differs: work continues past the slow one.
test('a slow question does not stall the workers behind it', async (t) => {
  const cases = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`, q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' }
  }))
  const events = [call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('There are 2 miners.')]

  let started = 0
  let startedWhileSlowRan = 0
  let slowDone = false
  const slowAgent = {
    createSession: () => ({
      async * send () {
        const mine = started++
        if (!slowDone) startedWhileSlowRan = started
        // The first question takes a while; the rest return at once.
        if (mine === 0) {
          await new Promise((resolve) => setTimeout(resolve, 60))
          slowDone = true
        }
        for (const ev of events) yield ev
      }
    })
  }

  const seen = []
  const report = await runBattery({
    agent: slowAgent,
    mcp: stubMcp(),
    cases,
    concurrency: 2,
    onResult: (r) => seen.push(r.id)
  })

  t.is(report.runs, 6, 'every case still ran')
  t.alike(seen, ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], 'and was reported in case order, not completion order')
  // With two fixed batches of two, only c1 could start alongside c0. A pool keeps the free
  // worker moving through the rest.
  t.ok(startedWhileSlowRan > 2, `the free worker carried on (${startedWhileSlowRan} started while c0 ran)`)
})

// The battery never resumes a session, so a full run would otherwise hold every case's history
// in memory for its whole duration — nothing expires inside twenty minutes at a thirty-minute TTL.
test('a battery run does not leave its sessions behind', async (t) => {
  const cases = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`, q: 'How many miners?', tool: 'count_devices', expect: { number: 'miners' }
  }))
  const events = [call('count_devices', {}), result('count_devices', { summary: '2.', count: 2 }), say('There are 2 miners.')]

  const store = new MemorySessionStore()
  let created = 0
  const agent = {
    ...stubAgent(events),
    store,
    createSession: async () => {
      const record = await store.create({ userId: 'eval' })
      created++
      return { ...stubAgent(events).createSession(), id: record.id }
    }
  }

  const report = await runBattery({ agent, mcp: stubMcp(), cases })

  t.is(report.runs, 5)
  t.is(created, 5, 'a session per case')
  t.is(store.records.size, 0, 'and none of them left behind')
})

test('any matches whole words, not fragments of longer ones', (t) => {
  const p = compileExpect({ any: ['no', 'none', 'zero', '0'] }, {})

  t.absent(p.test("I don't know"), 'not inside "know"')
  t.absent(p.test('There are 10 miners down'), 'not inside "10"')
  t.absent(p.test('All 20 are fine'), 'nor "20"')
  t.ok(p.test('No miners are down'), 'but the word itself still matches')
  t.ok(p.test('none of them'))
  t.ok(p.test('0 miners are offline'), 'and a standalone digit does')
})

test('any keeps values that begin or end on punctuation usable', (t) => {
  t.ok(compileExpect({ any: ['(none)'] }, {}).test('the answer was (none) today'))
  t.ok(compileExpect({ any: ['n/a'] }, {}).test('reported n/a'))
})

test('a regex quantifier is not mistaken for a placeholder', (t) => {
  const write = (expect) => {
    const path = join(tmpdir(), `battery-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(path, JSON.stringify({ cases: [{ id: 'a', q: 'How many?', tool: 'count_devices', expect }] }))
    return path
  }

  t.is(loadBattery(write({ pattern: '[0-9]{2}' })).length, 1, 'two digits is a quantifier')
  t.is(loadBattery(write({ pattern: '[0-9]{1,3}' })).length, 1, 'so is a range')
  t.exception(() => loadBattery(write({ pattern: '{sampleMiner}|[0-9]' })), /placeholders/,
    'but a named placeholder is still caught, even inside a pattern')
  t.exception(() => loadBattery(write({ any: ['{otherMiner}'] })), /placeholders/)
})

test('an id matches whatever case the model wrote it in', (t) => {
  const truth = { minerIds: ['antminer-1', 'avalon-0'], partial: {} }

  t.ok(compileExpect({ anyId: 'minerIds' }, truth).test('antminer-1 is offline'))
  t.ok(compileExpect({ anyId: 'minerIds' }, truth).test('Antminer-1 is offline.'), 'sentence case')
  t.ok(compileExpect({ allIds: 'minerIds' }, truth).test('ANTMINER-1 and Avalon-0 are down'))
  t.absent(compileExpect({ anyId: 'minerIds' }, truth).test('antminer-9 is offline'), 'a different id still fails')
})

test('ifEmpty picks the expectation the fleet calls for', (t) => {
  const expect = {
    ifEmpty: 'minerOfflineIds',
    then: { any: ['none', 'no miners'] },
    else: { anyId: 'minerOfflineIds' }
  }
  const healthy = { minerOfflineIds: [], partial: {} }
  const broken = { minerOfflineIds: ['antminer-3'], partial: {} }

  t.ok(compileExpect(expect, healthy).test('none are down'))
  t.absent(compileExpect(expect, healthy).test('antminer-3 is down'), 'naming a miner on a healthy fleet is wrong')

  t.absent(compileExpect(expect, broken).test('none are down'), 'and denying an outage is wrong')
  t.ok(compileExpect(expect, broken).test('antminer-3 is down'))
})

test('ifEmpty refuses to guess when the list is truncated', (t) => {
  const truth = { minerOfflineIds: ['a'], partial: { minerOfflineIds: { shown: 50, total: 80 } } }
  const expect = { ifEmpty: 'minerOfflineIds', then: { any: ['none'] }, else: { anyId: 'minerOfflineIds' } }

  try {
    compileExpect(expect, truth, 'case[x]')
    t.fail('should have been set aside')
  } catch (err) {
    t.ok(/empty cannot be told from truncated/.test(err.message))
  }
})

test('ifEmpty needs both branches', (t) => {
  const truth = { offlineIds: [], partial: {} }
  try {
    compileExpect({ ifEmpty: 'offlineIds', then: { any: ['x'] } }, truth, 'case[x]')
    t.fail('should have thrown')
  } catch (err) {
    t.ok(/needs both "then" and "else"/.test(err.message))
  }
})

test('ifEmpty validates the branch this fleet does not take', (t) => {
  const healthy = { minerOfflineIds: [], partial: {} }
  const broken = { minerOfflineIds: ['antminer-3'], partial: {} }
  const typo = { ifEmpty: 'minerOfflineIds', then: { any: ['none'] }, else: { nonsense: 'x' } }

  for (const [name, truth] of [['healthy', healthy], ['broken', broken]]) {
    try {
      compileExpect(typo, truth, 'case[x]')
      t.fail(`the bad branch went unnoticed on a ${name} fleet`)
    } catch (err) {
      t.ok(/unrecognised expectation/.test(err.message), `caught on a ${name} fleet`)
    }
  }
})
