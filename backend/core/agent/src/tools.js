import { z } from 'zod'

/**
 * The tool authoring contract: what a tool must look like for a small model to route to it
 * reliably, and the renderer that turns compliant tools into the prompt block it reads.
 *
 * See docs/TOOLS.md for the authoring guide.
 */

// Bump only on a breaking change to the descriptor or result contract. Consumers that author
// tools against this package pin it, so a widened vocabulary stays additive.
//
// v2 made `total` required on a list result: a v1 server returning summary/count/items has
// every list call rejected by the result check, which is a named skip rather than a tool that
// looks admitted and fails on use.
export const TOOL_CONTRACT_VERSION = 'v2'

// What a tool that declares no version is taken to speak: the version the field was introduced
// at, not whatever the current one happens to be. Tracking the current version would read every
// tool authored before versioning as speaking the newest contract — the case the gate exists to
// withhold.
const UNVERSIONED_CONTRACT = 'v1'

// The verb also fixes the result shape, so the model learns one expectation per verb.
export const VERB = Object.freeze({
  COUNT: 'count',
  LIST: 'list',
  GET: 'get',
  RANK: 'rank',
  SUMMARIZE: 'summarize',
  DIAGNOSE: 'diagnose',
  ACT: 'act'
})

// Device family and the like are parameters rather than entities, so the tool count stays
// bounded by verbs x entities instead of growing with the question space.
export const ENTITY = Object.freeze({
  SITE: 'site', DEVICE: 'device', WORKER: 'worker', POOL: 'pool'
})

// Shared across tools so the model learns each vocabulary once.
export const AXIS = Object.freeze({
  family: ['miner', 'container', 'powermeter', 'sensor', 'pool', 'all'],
  state: ['all', 'online', 'offline', 'error'],
  metric: ['hashrate', 'power', 'temperature', 'efficiency', 'uptime'],
  order: ['desc', 'asc']
})

/**
 * What each verb must return. The verb is the model's only expectation about the payload, so
 * the fields are named per verb and not per entity — `list_workers` and `list_devices` return
 * the same shape, and the model learns it once.
 *
 * `summary` is on every verb and is the sentence the model speaks verbatim; the remaining
 * fields exist so a consumer that is not a model (the gateway, a test) can read the answer
 * without parsing prose.
 */
export const RESULT = Object.freeze({
  [VERB.COUNT]: Object.freeze({ summary: 'text', count: 'count' }),
  [VERB.LIST]: Object.freeze({ summary: 'text', count: 'count', total: 'count', items: 'array' }),
  // One value under one key. Keying the value by the attribute asked for would make the model
  // guess which field to read, which is the routing problem again, one level down.
  [VERB.GET]: Object.freeze({ summary: 'text', ref: 'text', attr: 'text', value: 'any' }),
  [VERB.RANK]: Object.freeze({ summary: 'text', metric: 'text', order: 'text', items: 'array', unavailable: 'count' }),
  [VERB.SUMMARIZE]: Object.freeze({ summary: 'text', totals: 'object' }),
  [VERB.DIAGNOSE]: Object.freeze({ summary: 'text', findings: 'array' }),
  [VERB.ACT]: Object.freeze({ summary: 'text', ref: 'text', action: 'text', outcome: 'text' })
})

const KIND = {
  text: (v) => typeof v === 'string' && v.trim().length > 0,
  count: (v) => Number.isInteger(v) && v >= 0,
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  any: () => true
}

/**
 * The verb a tool name declares. Read by the result contract, the capability floor and the
 * loop's result check alike, so the naming convention lives in one place.
 */
export function verbOf (name) {
  return String(name ?? '').split('_')[0]
}

/**
 * Validate a tool's result payload against the contract for its verb. Never throws.
 *
 * Shape alone is not enough: a `list` whose `count` disagrees with `items` gives the model two
 * different answers to the same question, and it speaks the one that is wrong.
 */
export function validateToolResult (name, payload) {
  const verb = verbOf(name)
  const shape = RESULT[verb]
  if (!shape) return { ok: false, errors: [`no result contract for verb "${verb}" in "${name}"`] }
  if (!KIND.object(payload)) return { ok: false, errors: ['result must be a JSON object'] }

  const errors = []
  for (const [field, kind] of Object.entries(shape)) {
    if (payload[field] === undefined) errors.push(`missing "${field}" (${kind})`)
    else if (!KIND[kind](payload[field])) errors.push(`"${field}" must be ${kind}`)
  }
  if (verb === VERB.LIST && KIND.array(payload.items) && KIND.count(payload.count) &&
      payload.count !== payload.items.length) {
    errors.push(`count (${payload.count}) disagrees with items (${payload.items.length})`)
  }
  if (verb === VERB.LIST && KIND.count(payload.count) && KIND.count(payload.total) &&
      payload.count > payload.total) {
    errors.push(`count (${payload.count}) exceeds total (${payload.total})`)
  }
  if (verb === VERB.RANK && KIND.array(payload.items) && payload.items.some((i) => !KIND.object(i) || i[payload.metric] === undefined)) {
    errors.push(`every ranked item must carry its "${payload.metric}" value`)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * The default boundary for a fleet tool set that reports present state — what the six MDK demo
 * tools do not answer. It is a default, not a law: replace it with `notCovered` when your tools
 * cover more, and pass `[]` to drop the block entirely.
 *
 * Some boundary is needed because `useWhen` is a positive index only. With nothing to route
 * away from, each tool absorbs the questions that merely sound like its topic — "is it under
 * warranty" reaches get_device because it names a device, "email the team" reaches act_device
 * because it is an action. Both are refusals, not routes. Measured on a 4B, stating this took
 * questions no tool covers from 60% to 86%.
 *
 * Keep it true of the tools actually admitted. A line here that contradicts a tool in the list
 * is worse than no line at all: the model is told to decline a question it can answer.
 */
export const NOT_COVERED = Object.freeze([
  'the past, history, or how anything has changed over time',
  'forecasts, predictions, or what will happen next',
  'costs, prices, power bills, revenue or profitability',
  'people, shifts, scheduling, notifications, messages or orders',
  'purchase, warranty, ownership, firmware choice or anything not reported by the hardware',
  'anything outside this site, including other sites and the wider network'
])

export const CAPABILITY = Object.freeze({ SMALL: 'small', MID: 'mid', LARGE: 'large' })
const CAPABILITY_RANK = { small: 0, mid: 1, large: 2 }

/**
 * Floors that belong to the verb itself, whatever a tool declares.
 *
 * Most verbs are routing and relaying: the tool computes, the model repeats. `diagnose` is not
 * — it asks the model to reason from evidence to a cause, which no result shape can hand it
 * ready-made. Measured on a 4B, questions of that shape scored 0/4, and every failure was a
 * confident wrong answer rather than a refusal, which is the worst outcome the contract has.
 *
 * A tool cannot opt out by declaring a lower floor; validateTool rejects that.
 */
export const VERB_FLOOR = Object.freeze({ [VERB.DIAGNOSE]: CAPABILITY.MID })

// Collection verbs read in the plural (count_devices), single-item verbs in the singular.
const NAME_PATTERN = new RegExp(`^(${Object.values(VERB).join('|')})_(${Object.values(ENTITY).join('|')})s?$`)

// Not `annotations`: the MCP SDK parses that with a closed schema, so a client strips keys it
// does not know. `_meta` is an open record and survives. `readOnlyHint` stays in annotations,
// being a declared MCP field.
export const AGENT_META_KEY = 'x-mdk-agent'

export const agentMeta = (tool) => tool?._meta?.[AGENT_META_KEY]

// `useWhen` is the routing index: the model matches the operator's words against these.
export const AgentMetaSchema = z.object({
  enabled: z.literal(true),
  answers: z.string().min(1),
  useWhen: z.array(z.string().min(1)).min(2).max(6),
  notFor: z.array(z.string()).default([]),
  // Exclusions specific to this tool, merged into the shared boundary block. `notFor` points
  // at a sibling tool; this says no tool here answers that at all.
  outOfScope: z.array(z.string()).default([]),
  returns: z.string().min(1),
  // Never defaulted: an undeclared floor would fall through to the weakest model.
  minCapability: z.enum([CAPABILITY.SMALL, CAPABILITY.MID, CAPABILITY.LARGE]),
  contract: z.string().min(1).default(UNVERSIONED_CONTRACT)
})

/**
 * Validate a tool descriptor. Never throws, so one bad tool cannot take down the rest.
 *
 * `meta` is the parsed block with defaults applied — read that, not the raw `_meta`, or an
 * omitted optional field arrives undefined.
 */
export function validateTool (tool) {
  const errors = []
  const name = tool?.name
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    errors.push(`name must be <verb>_<entity>, e.g. count_devices (verbs: ${Object.values(VERB).join('|')}; entities: ${Object.values(ENTITY).join('|')})`)
  }
  if (!tool?.description) errors.push('description is required — the model routes on it')

  const parsed = AgentMetaSchema.safeParse(agentMeta(tool))
  if (!parsed.success) {
    errors.push(`_meta["${AGENT_META_KEY}"] invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`)
  }

  // A verb with an inherent floor outranks whatever the author declared, so a reasoning tool
  // cannot be published to a model that will answer it confidently and wrongly.
  const floor = VERB_FLOOR[verbOf(name)]
  if (floor && parsed.success && CAPABILITY_RANK[parsed.data.minCapability] < CAPABILITY_RANK[floor]) {
    errors.push(`a ${verbOf(name)}_* tool needs minCapability "${floor}" or higher, not "${parsed.data.minCapability}"`)
  }

  // Declared, so the approval gate keys off the tool rather than a hardcoded name list.
  const hints = tool?.annotations ?? {}
  if (typeof hints.readOnlyHint !== 'boolean') errors.push('annotations.readOnlyHint must be declared true or false')
  if (name?.startsWith(`${VERB.ACT}_`) && hints.readOnlyHint !== false) {
    errors.push('an act_* tool must declare readOnlyHint: false')
  }

  errors.push(...validateParams(tool?.inputSchema))
  return { ok: errors.length === 0, errors, meta: parsed.success ? parsed.data : undefined }
}

// Free text is where a small model invents a value, so a param must be one of three closed
// kinds. Shared with the renderer, which must agree on what is renderable.
function classifyParam (spec) {
  if (Array.isArray(spec?.enum) && spec.enum.length > 0) return 'enum'
  if (spec?.type === 'integer' && Number.isFinite(spec.minimum) && Number.isFinite(spec.maximum) &&
      spec.minimum <= spec.maximum) return 'int'
  if (spec?.type === 'string' && typeof spec['x-mdk-ref'] === 'string') return 'ref'
  return null
}

function validateParams (inputSchema) {
  const errors = []
  const props = inputSchema?.properties ?? {}
  // Only an array is a required list. A bare string would spread into its characters and mask
  // a single-letter parameter as required, skipping its default check.
  const required = new Set(Array.isArray(inputSchema?.required) ? inputSchema.required : [])
  for (const [param, spec] of Object.entries(props)) {
    const kind = classifyParam(spec)
    if (!kind) {
      errors.push(`param "${param}" must be an enum, a bounded integer, or an id reference (x-mdk-ref) — never free text`)
    }
    // Enum values render separated by "|", so one containing it would read as two values.
    if (kind === 'enum' && spec.enum.some((v) => String(v).includes('|'))) {
      errors.push(`param "${param}" has an enum value containing "|", which the prompt cannot render unambiguously`)
    }
    if (!required.has(param) && spec?.default === undefined) {
      errors.push(`optional param "${param}" needs a default`)
    }
  }
  return errors
}

/**
 * Split tools into the ones this model may see and the ones it may not, each skip carrying a
 * reason. A tool whose capability floor exceeds the model is withheld rather than misused.
 */
export function admitTools (tools = [], { capability = CAPABILITY.SMALL } = {}) {
  // An unrecognised capability would rank as undefined, and every comparison against it is
  // false — the floor check would pass for all tools and admit ones this model cannot use.
  if (!(capability in CAPABILITY_RANK)) {
    throw new Error(`admitTools: unknown capability "${capability}" (expected ${Object.values(CAPABILITY).join(', ')})`)
  }
  const admitted = []
  const skipped = []
  for (const tool of tools) {
    if (agentMeta(tool)?.enabled !== true) {
      skipped.push({ name: tool?.name, reason: 'not agent-enabled' })
      continue
    }
    const { ok, errors, meta } = validateTool(tool)
    if (!ok) {
      skipped.push({ name: tool?.name, reason: errors[0] })
      continue
    }
    if (meta.contract !== TOOL_CONTRACT_VERSION) {
      skipped.push({ name: tool.name, reason: `authored against contract ${meta.contract}, this agent speaks ${TOOL_CONTRACT_VERSION}` })
      continue
    }
    if (CAPABILITY_RANK[meta.minCapability] > CAPABILITY_RANK[capability]) {
      skipped.push({ name: tool.name, reason: `needs a ${meta.minCapability} model` })
      continue
    }
    // The parsed meta, so the renderer sees schema defaults rather than undefined.
    admitted.push({ ...tool, _meta: { ...tool._meta, [AGENT_META_KEY]: meta } })
  }
  return { admitted, skipped }
}

/**
 * Render admitted tools as the prompt block. Every tool renders in the same shape, since the
 * repetition itself aids routing, and enum values print verbatim so the model copies them.
 *
 * Input must be admitTools().admitted; anything else throws.
 */
export function renderTools (tools = []) {
  return tools.map((tool) => {
    const meta = agentMeta(tool)
    // Carrying the block is not enough: notFor is defaulted by admitTools, not by the author.
    if (!meta || !Array.isArray(meta.useWhen) || !Array.isArray(meta.notFor)) {
      throw new TypeError(`renderTools: "${tool?.name ?? tool}" is not an admitted tool (_meta["${AGENT_META_KEY}"] missing or not normalized) — pass admitTools().admitted`)
    }
    const lines = [`${tool.name} — ${meta.answers}`]
    lines.push(`  use when : ${meta.useWhen.map((u) => `"${u}"`).join(', ')}`)
    if (meta.notFor.length) lines.push(`  not for  : ${meta.notFor.join('; ')}`)
    const params = renderParams(tool.inputSchema)
    if (params) lines.push(`  params   : ${params}`)
    lines.push(`  returns  : ${meta.returns}`)
    return lines.join('\n')
  }).join('\n')
}

/**
 * The coverage boundary for a tool set: the standing exclusions plus anything the admitted
 * tools declare in `outOfScope`.
 *
 * This is the negative half of the tool block. The positive half (each tool's `useWhen`) tells
 * the model where to route; without this it has nothing to route *away* from, and declining
 * becomes the one behaviour the prompt cannot express.
 */
export function renderCoverage (tools = [], { notCovered = NOT_COVERED } = {}) {
  const declared = tools.flatMap((tool) => agentMeta(tool)?.outOfScope ?? [])
  // Deduped across both sources, not just within the declared ones: a tool that restates a
  // standing exclusion would otherwise have it printed twice, and a prompt that repeats itself
  // reads to a small model as emphasis it was never meant to carry.
  const lines = [...new Set([...notCovered, ...declared])]
  if (!lines.length) return ''
  return [
    'NONE of these tools answers questions about:',
    ...lines.map((line) => `  - ${line}`),
    'For any of those, call NO tool at all. Say plainly that you do not have that ability, and',
    'offer the closest thing you can do. Calling a tool that cannot answer is worse than saying no.'
  ].join('\n')
}

function renderParams (inputSchema) {
  const props = inputSchema?.properties ?? {}
  return Object.entries(props).map(([param, spec]) => {
    const kind = classifyParam(spec)
    let type
    if (kind === 'enum') type = `[${spec.enum.join('|')}]`
    else if (kind === 'int') type = `<int ${spec.minimum}..${spec.maximum}>`
    else if (kind === 'ref') type = `<${spec['x-mdk-ref']} id>`
    // A placeholder here would read to the model as a value to copy.
    else throw new Error(`renderTools: param "${param}" is not admissible; render only admitTools().admitted`)
    return `${param}=${type}${spec.default !== undefined ? `=${JSON.stringify(spec.default)}` : ''}`
  }).join(', ')
}
