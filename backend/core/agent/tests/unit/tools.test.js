import test from 'brittle'
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { VERB, ENTITY, AXIS, CAPABILITY, AGENT_META_KEY, agentMeta, validateTool, admitTools, renderTools, TOOL_CONTRACT_VERSION } from '../../src/tools.js'

const compliant = (over = {}) => ({
  name: 'count_devices',
  description: 'How many devices, by family and state.',
  inputSchema: {
    type: 'object',
    properties: {
      family: { type: 'string', enum: AXIS.family, default: 'all' },
      state: { type: 'string', enum: AXIS.state, default: 'all' }
    }
  },
  annotations: { readOnlyHint: true },
  _meta: {
    [AGENT_META_KEY]: {
      enabled: true,
      answers: 'How many devices, by family and state.',
      useWhen: ['how many miners', 'number of offline devices'],
      notFor: ['listing them (use list_devices)'],
      returns: 'a count with a one-line summary',
      minCapability: CAPABILITY.SMALL,
      contract: TOOL_CONTRACT_VERSION
    }
  },
  ...over
})

test('the taxonomy is a closed set', (t) => {
  t.alike(Object.values(VERB).sort(), ['act', 'count', 'diagnose', 'get', 'list', 'rank', 'summarize'])
  t.alike(Object.values(ENTITY).sort(), ['device', 'pool', 'site', 'worker'])
  t.ok(Object.isFrozen(VERB) && Object.isFrozen(ENTITY) && Object.isFrozen(AXIS))
})

test('a compliant tool validates', (t) => {
  const { ok, errors } = validateTool(compliant())
  t.ok(ok, `expected no errors, got: ${errors.join(' | ')}`)
})

test('a name outside the verb_entity taxonomy is rejected', (t) => {
  for (const name of ['get_status', 'pull_telemetry', 'countDevices', 'count_gizmos']) {
    t.absent(validateTool(compliant({ name })).ok, `${name} rejected`)
  }
})

test('free-text parameters are rejected — this is where values get invented', (t) => {
  const freeText = compliant({
    inputSchema: { type: 'object', properties: { query: { type: 'string', default: 'metrics' } } }
  })
  const { ok, errors } = validateTool(freeText)
  t.absent(ok)
  t.ok(errors.some((e) => e.includes('never free text')))
})

test('an id reference is allowed, since the model copies it from context', (t) => {
  const byRef = compliant({
    name: 'get_device',
    inputSchema: {
      type: 'object',
      required: ['ref'],
      properties: { ref: { type: 'string', 'x-mdk-ref': 'device' } }
    }
  })
  t.ok(validateTool(byRef).ok)
})

test('a malformed required list cannot mask a parameter as required', (t) => {
  // A bare string spreads into its characters, so "r" would look required and skip its default.
  const stringRequired = compliant({
    inputSchema: {
      type: 'object',
      required: 'ref',
      properties: { r: { type: 'string', 'x-mdk-ref': 'device' } }
    }
  })
  t.ok(validateTool(stringRequired).errors.some((e) => e.includes('needs a default')))
})

test('an inverted integer range is rejected rather than rendered', (t) => {
  const inverted = compliant({
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 50, maximum: 10, default: 5 } }
    }
  })
  t.absent(validateTool(inverted).ok, 'a range the model cannot satisfy never reaches the prompt')
})

test('optional parameters must carry a default', (t) => {
  const noDefault = compliant({
    inputSchema: { type: 'object', properties: { family: { type: 'string', enum: AXIS.family } } }
  })
  t.ok(validateTool(noDefault).errors.some((e) => e.includes('needs a default')))
})

test('mutability must be declared, and act_* must declare a write', (t) => {
  t.ok(validateTool(compliant({ annotations: {} }))
    .errors.some((e) => e.includes('readOnlyHint')), 'undeclared mutability rejected')

  const actAsRead = compliant({ name: 'act_device', annotations: { readOnlyHint: true } })
  t.ok(validateTool(actAsRead).errors.some((e) => e.includes('readOnlyHint: false')))
})

test('routing metadata is required — the model routes on it', (t) => {
  const thin = compliant()
  thin._meta[AGENT_META_KEY] = { enabled: true, answers: 'x', useWhen: ['only one'], returns: 'y' }
  t.absent(validateTool(thin).ok, 'useWhen needs at least two phrasings')
})

test('a tool that does not declare its capability floor is rejected, not defaulted', (t) => {
  const undeclared = compliant()
  delete undeclared._meta[AGENT_META_KEY].minCapability

  t.absent(validateTool(undeclared).ok, 'an undeclared floor is a contract violation')
  t.is(admitTools([undeclared]).admitted.length, 0, 'and the tool is withheld from every model')
})

test('admitTools hides non-compliant and not-enabled tools, with a reason', (t) => {
  const legacy = { name: 'get_status', description: 'raw dump', inputSchema: { properties: {} } }
  const { admitted, skipped } = admitTools([compliant(), legacy])
  t.is(admitted.length, 1)
  t.is(admitted[0].name, 'count_devices')
  t.is(skipped.length, 1)
  t.is(skipped[0].reason, 'not agent-enabled')
})

// An unrecognised capability ranks as undefined, and every comparison against it is false, so a
// silent fallback would admit tools the running model cannot use.
test('admitTools rejects an unrecognised capability rather than admitting everything', (t) => {
  const needsMid = compliant({ name: 'diagnose_site' })
  needsMid._meta[AGENT_META_KEY].minCapability = CAPABILITY.MID

  let threw = false
  try { admitTools([needsMid], { capability: 'enormous' }) } catch { threw = true }
  t.ok(threw, 'a capability outside the set is a caller error, not a wider gate')
})

test('an enum value containing the render separator is rejected', (t) => {
  const ambiguous = compliant({
    inputSchema: { type: 'object', properties: { p: { type: 'string', enum: ['a|b', 'c'], default: 'c' } } }
  })
  t.absent(validateTool(ambiguous).ok, '"a|b" would read to the model as two separate values')
})

test('admitTools withholds tools that need a stronger model', (t) => {
  const needsMid = compliant({ name: 'diagnose_site' })
  needsMid._meta[AGENT_META_KEY].minCapability = CAPABILITY.MID

  t.is(admitTools([needsMid], { capability: CAPABILITY.SMALL }).admitted.length, 0, 'hidden from a small model')
  t.is(admitTools([needsMid], { capability: CAPABILITY.MID }).admitted.length, 1, 'shown to a mid model')
})

test('a tool omitting an optional field validates, admits, and renders', (t) => {
  const noNotFor = compliant()
  delete noNotFor._meta[AGENT_META_KEY].notFor

  const { ok, meta } = validateTool(noNotFor)
  t.ok(ok, 'notFor is optional')
  t.alike(meta.notFor, [], 'the parsed meta carries the schema default')

  const { admitted } = admitTools([noNotFor])
  t.is(admitted.length, 1, 'and the tool is admitted')
  t.alike(agentMeta(admitted[0]).notFor, [], 'admission attaches the parsed meta, not the raw block')

  const block = renderTools(admitted)
  t.ok(block.includes('count_devices'), 'renders')
  t.absent(block.includes('not for'), 'omitting the line rather than printing an empty one')
})

test('renderTools requires admitted input', (t) => {
  let err = null
  try { renderTools([{ name: 'legacy_tool' }]) } catch (e) { err = e }
  t.ok(err, 'a tool that never passed admission throws rather than rendering a broken block')
  // Naming the tool and the contract matters: the accidental version of this throw read
  // "cannot read properties of undefined", which sent the last caller looking in the wrong file.
  t.ok(err.message.includes('legacy_tool'), 'the error names the offending tool')
  t.ok(err.message.includes(AGENT_META_KEY), 'and the contract it failed')
})

test('renderTools rejects a tool that carries the meta block but was never admitted', (t) => {
  // notFor is optional for the author and defaulted by admitTools, so a raw tool that omits
  // it reaches renderTools with the block present and the field absent.
  const raw = compliant()
  delete raw._meta[AGENT_META_KEY].notFor
  let err = null
  try { renderTools([raw]) } catch (e) { err = e }
  t.ok(err, 'an unadmitted tool throws even though it declares the contract')
  t.ok(err.message.includes('count_devices'), 'and still names it')
})

test('a param the validator rejects is never rendered as a placeholder', (t) => {
  for (const [label, spec] of [
    ['free text', { type: 'string' }],
    ['integer without bounds', { type: 'integer' }],
    ['boolean', { type: 'boolean' }]
  ]) {
    const tool = compliant({
      inputSchema: { type: 'object', required: ['p'], properties: { p: spec } }
    })
    t.absent(validateTool(tool).ok, `${label} is rejected`)

    let rendered = null
    try { rendered = renderTools([tool]) } catch { /* expected */ }
    t.is(rendered, null, `${label} throws rather than rendering a placeholder`)
  }
})

test('renderTools prints enum values verbatim so they cannot be paraphrased', (t) => {
  const block = renderTools([compliant()])
  t.ok(block.includes('count_devices — How many devices'))
  t.ok(block.includes('family=[miner|container|powermeter|sensor|pool|all]="all"'), 'enum values and default rendered')
  t.ok(block.includes('use when : "how many miners"'))
  t.ok(block.includes('not for  : listing them (use list_devices)'))
  t.ok(block.includes('returns  : a count with a one-line summary'))
})

// Pins the SDK behaviour the carrier choice depends on, so an upgrade that moves it fails here
// rather than by silently emptying the tool list.
test('the contract survives the MCP client, which annotations would not have', (t) => {
  const wire = JSON.parse(JSON.stringify(compliant()))
  const received = ToolSchema.parse(wire)

  t.ok(validateTool(received).ok, 'a compliant tool is still compliant after the round trip')
  t.ok(received._meta[AGENT_META_KEY], 'the carrier survives')
  t.is(received.annotations.readOnlyHint, true, 'declared MCP hints survive')
  t.alike(received.inputSchema.properties.family.enum, AXIS.family, 'enum values survive')

  const viaAnnotations = ToolSchema.parse({ ...wire, annotations: { readOnlyHint: true, [AGENT_META_KEY]: { enabled: true } } })
  t.absent(viaAnnotations.annotations[AGENT_META_KEY], 'annotations is stripped — do not carry the contract there')
})

test('agentMeta reads the contract, and is undefined when a tool carries none', (t) => {
  t.alike(agentMeta(compliant()), compliant()._meta[AGENT_META_KEY], 'reads the block back')
  t.is(agentMeta({ name: 'legacy_tool' }), undefined, 'a tool with no _meta is not an error')
  t.is(agentMeta(undefined), undefined, 'nor is a missing tool')
})
