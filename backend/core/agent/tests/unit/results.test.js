import test from 'brittle'
import { VERB, RESULT, NOT_COVERED, VERB_FLOOR, CAPABILITY, TOOL_CONTRACT_VERSION, renderCoverage, validateTool, validateToolResult, admitTools } from '../../src/tools.js'

test('the contract is versioned, so a consumer can pin it', (t) => {
  t.is(TOOL_CONTRACT_VERSION, 'v2')
})

test('every verb declares a result shape, and every shape carries a summary', (t) => {
  for (const verb of Object.values(VERB)) {
    t.ok(RESULT[verb], `${verb} has a result contract`)
    t.is(RESULT[verb].summary, 'text', `${verb} returns a speakable summary`)
    t.ok(Object.isFrozen(RESULT[verb]), `${verb} shape is frozen`)
  }
})

test('a conforming result of each verb validates', (t) => {
  const good = {
    count_devices: { summary: '15 miners.', count: 15 },
    list_devices: { summary: 'a, b', count: 2, total: 2, items: [{ deviceId: 'a' }, { deviceId: 'b' }] },
    get_device: { summary: 'x', ref: 'antminer-1', attr: 'telemetry', value: { power: 3 } },
    rank_devices: { summary: 'x', metric: 'power', order: 'desc', items: [{ deviceId: 'a', power: 3 }], unavailable: 0 },
    summarize_site: { summary: 'x', totals: { devices: { total: 1 } } },
    diagnose_site: { summary: 'x', findings: [] },
    act_device: { summary: 'x', ref: 'antminer-1', action: 'reboot', outcome: 'ok' }
  }
  for (const [name, payload] of Object.entries(good)) {
    const { ok, errors } = validateToolResult(name, payload)
    t.ok(ok, `${name}: ${errors.join(' | ')}`)
  }
})

test('a missing or mistyped field is reported per field', (t) => {
  t.ok(validateToolResult('count_devices', { summary: 'x' }).errors.some((e) => e.includes('missing "count"')))
  t.ok(validateToolResult('count_devices', { summary: 'x', count: '15' }).errors.some((e) => e.includes('must be count')))
  t.ok(validateToolResult('count_devices', { summary: '  ', count: 1 }).errors.some((e) => e.includes('must be text')),
    'a blank summary is not a summary — the model would speak nothing')
  t.ok(validateToolResult('count_devices', { summary: 'x', count: -1 }).errors.some((e) => e.includes('must be count')))
})

// The model reads one of the two and speaks it, so disagreement is a wrong answer with a
// well-formed payload — the failure this check exists for.
test('a list whose count disagrees with its items is rejected', (t) => {
  const { ok, errors } = validateToolResult('list_devices', {
    summary: '3 devices', count: 3, items: [{ deviceId: 'a' }]
  })
  t.absent(ok)
  t.ok(errors.some((e) => e.includes('disagrees')))
})

test('a ranked item must carry the metric it was ranked by', (t) => {
  const { ok, errors } = validateToolResult('rank_devices', {
    summary: 'x', metric: 'power', order: 'asc', items: [{ deviceId: 'a' }], unavailable: 0
  })
  t.absent(ok)
  t.ok(errors.some((e) => e.includes('power')))
})

// The positive half of the tool block says where to route; without a negative half the prompt
// cannot express declining at all, and each tool absorbs the questions that sound like its
// topic but that it cannot answer.
// diagnose asks the model to reason from evidence to a cause, which no result shape hands it
// ready-made. On a 4B those questions scored 0/4, every failure a confident wrong answer.
test('a diagnose tool cannot be published to a small model, whatever it declares', (t) => {
  t.is(VERB_FLOOR.diagnose, CAPABILITY.MID)

  const diagnose = (minCapability) => ({
    name: 'diagnose_device',
    description: 'Why a device is in the state it is in.',
    inputSchema: { type: 'object', required: ['ref'], properties: { ref: { type: 'string', 'x-mdk-ref': 'device' } } },
    annotations: { readOnlyHint: true },
    _meta: {
      'x-mdk-agent': {
        enabled: true,
        answers: 'Why a device is in the state it is in.',
        useWhen: ['why did antminer-3 go down', 'what is wrong with that miner'],
        returns: 'findings with a one-line summary',
        minCapability,
        contract: TOOL_CONTRACT_VERSION
      }
    }
  })

  const declaredSmall = validateTool(diagnose(CAPABILITY.SMALL))
  t.absent(declaredSmall.ok, 'declaring small does not opt out of the verb floor')
  t.ok(declaredSmall.errors.some((e) => e.includes('needs minCapability "mid"')))

  t.ok(validateTool(diagnose(CAPABILITY.MID)).ok, 'mid satisfies the floor')
  t.ok(validateTool(diagnose(CAPABILITY.LARGE)).ok, 'and so does anything above it')

  // The floor is a property of the verb; the other verbs stay usable by a small model.
  t.is(admitTools([diagnose(CAPABILITY.MID)], { capability: CAPABILITY.SMALL }).admitted.length, 0)
  t.is(admitTools([diagnose(CAPABILITY.MID)], { capability: CAPABILITY.MID }).admitted.length, 1)
})

test('the coverage block states the gap and the behaviour it wants', (t) => {
  const block = renderCoverage([])

  for (const line of NOT_COVERED) t.ok(block.includes(line), `states: ${line.slice(0, 30)}…`)
  t.ok(/call NO tool at all/i.test(block), 'and names the correct behaviour, not just the gap')
})

// NOT_COVERED describes the six MDK demo tools, not a law of the taxonomy. A tool set that
// answers about cost or history must be able to say so — otherwise the block instructs the
// model to decline questions its own tools can answer, which is worse than no block.
test('the boundary is a default a consumer can replace or drop', (t) => {
  const mine = renderCoverage([], { notCovered: ['anything about pool payouts'] })
  t.ok(mine.includes('pool payouts'))
  t.absent(mine.includes(NOT_COVERED[0]), 'the default is replaced, not appended to')

  t.is(renderCoverage([], { notCovered: [] }), '', 'an empty boundary renders nothing at all')
  t.ok(renderCoverage([]).includes(NOT_COVERED[0]), 'and omitting the option keeps the default')
})

test('a replaced boundary still collects what the tools declare', (t) => {
  const tool = { _meta: { 'x-mdk-agent': { outOfScope: ['rack layout'] } } }
  const block = renderCoverage([tool], { notCovered: ['pool payouts'] })

  t.ok(block.includes('pool payouts') && block.includes('rack layout'))
  t.absent(block.includes(NOT_COVERED[0]))
})

test('a tool may declare exclusions of its own, merged and deduplicated', (t) => {
  const withScope = (outOfScope) => ({
    _meta: { 'x-mdk-agent': { outOfScope } }
  })
  const block = renderCoverage([withScope(['pool payout details']), withScope(['pool payout details', 'rack layout'])])

  t.is(block.match(/pool payout details/g).length, 1, 'two tools naming the same gap state it once')
  t.ok(block.includes('rack layout'))
  t.ok(block.includes(NOT_COVERED[0]), 'declared exclusions add to the standing ones rather than replacing them')
})

test('an unknown verb and a non-object payload are rejected, not assumed valid', (t) => {
  t.absent(validateToolResult('frobnicate_device', { summary: 'x' }).ok)
  t.absent(validateToolResult('count_devices', null).ok)
  t.absent(validateToolResult('count_devices', [1, 2]).ok)
  t.absent(validateToolResult(undefined, {}).ok)
})

test('a tool authored against another contract is withheld, and says so', (t) => {
  const tool = (contract) => ({
    name: 'count_devices',
    description: 'x',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    _meta: {
      'x-mdk-agent': {
        enabled: true,
        answers: 'x',
        useWhen: ['a', 'b'],
        returns: 'x',
        minCapability: 'small',
        ...(contract ? { contract } : {})
      }
    }
  })

  t.is(admitTools([tool(TOOL_CONTRACT_VERSION)]).admitted.length, 1, 'declaring the current contract is admitted')

  // The default is the version the field was introduced at, not the current one. Tracking the
  // current version would read a tool written before versioning as speaking the newest
  // contract — the case the gate exists to withhold.
  const unversioned = admitTools([tool()])
  t.is(unversioned.admitted.length, 0, 'a tool declaring no version is not assumed to be current')
  t.ok(/authored against contract v1, this agent speaks v2/.test(unversioned.skipped[0]?.reason ?? ''))

  const future = admitTools([tool('v9')])
  t.is(future.admitted.length, 0, 'nor is one from a contract this agent does not speak')
  t.ok(/authored against contract v9, this agent speaks v2/.test(future.skipped[0]?.reason ?? ''))
})

test('a list result must say how many matched, not only how many it named', (t) => {
  const list = (over) => validateToolResult('list_devices', { summary: 'x', count: 1, total: 1, items: [{ a: 1 }], ...over })

  t.ok(list({}).ok)
  t.ok(list({ total: undefined }).errors.some((e) => e.includes('missing "total"')), 'total is part of the verb')
  t.ok(list({ count: 1, total: 0 }).errors.some((e) => e.includes('exceeds total')), 'naming more than matched is incoherent')
  t.ok(list({ count: 1, total: 80 }).ok, 'but naming fewer is exactly what a limit does')
})

test('the list example in TOOLS.md satisfies the contract it documents', async (t) => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const doc = readFileSync(fileURLToPath(new URL('../../docs/TOOLS.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1])
  const listExample = blocks.map((b) => { try { return JSON.parse(b) } catch { return null } })
    .find((p) => p && Array.isArray(p.items) && p.count !== undefined && p.total !== undefined)

  t.ok(listExample, 'the page still carries a list example')
  const { ok, errors } = validateToolResult('list_devices', listExample)
  t.ok(ok, `the documented example must validate: ${errors.join(' ; ')}`)
})
