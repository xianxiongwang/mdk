import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EVENT } from './events.js'
import { VERB, validateToolResult } from './tools.js'

/**
 * The eval battery: the questions an operator actually asks, each pinned to the tool that
 * should answer it and to what the answer must contain.
 *
 * A run scores four independent things, because they fail independently:
 *   routing  — did the model pick the right tool for the words used?
 *   answer   — did it relay the right value?
 *   contract — did the tool return the shape its verb promises? (see RESULT in tools.js)
 *   approval — was a write gated before it ran?
 *
 * Questions live in eval/battery.json, not here: they are data, they grow constantly, and
 * authoring one should not require reading JavaScript. Expectations are written in the small
 * grammar below and resolved against the live fleet at run time, so the battery travels to
 * any MDK site instead of encoding one demo's inventory.
 */

// The route recorded when the model called nothing — an expectation in its own right, since
// declining is the correct answer to a question no tool covers.
export const NO_TOOL = '(none)'

export const BATTERY_PATH = fileURLToPath(new URL('../eval/battery.json', import.meta.url))

/**
 * The ways a model says it will not answer.
 *
 * Too narrow marks a correct refusal wrong: "that information is not available" is a good
 * decline, and an early version scored it a failure — which would have sent someone tuning a
 * charter that was working.
 *
 * Too broad is worse, because it hides fabrication. A bare `is not` / `isn't` / `not have`
 * matches any confident negative statement, so "we are not profitable at the current price" —
 * an invented answer to a question no tool covers — scored as a model correctly declining.
 * The tool-call check catches most of those, but an answer made up with no tool call passed
 * both gates and counted as a pass.
 *
 * So: refusal is claimed in the first person, or stated as unavailability. A negative sentence
 * about the fleet is neither.
 */
const DECLINED = new RegExp([
  // claimed in the first person — "I do not have that", "we can't do that"
  '\\b(?:i|we)\\s+(?:do not|don\'t|cannot|can\'t|have no|am unable|are unable|am not able|are not able)\\b',
  // bare modal refusals — "cannot help with that", "unable to answer"
  '\\bcannot\\b', '\\bcan\'t\\b', '\\bunable\\b',
  // stated as unavailability rather than as refusal
  '\\bno tool\\b', '\\bnot available\\b', '\\bunavailable\\b', '\\bis\\s?n\'t available\\b',
  '\\bno (?:data|information|record|way|access)\\b',
  '\\bonly have\\b'
].join('|'), 'i')

/**
 * A case this fleet cannot express — it asks about a value the site does not report. That is a
 * property of the site, not a mistake in the battery, so a run skips the case and names it
 * rather than aborting. An author error (an unknown expectation form) still throws.
 */
const PROBE_UNAVAILABLE = 'PROBE_UNAVAILABLE'
function unavailable (message) {
  const err = new Error(message)
  err.code = PROBE_UNAVAILABLE
  return err
}

/**
 * Compile one expectation into a predicate against the probed fleet.
 *
 * The grammar is deliberately small; every form resolves to a fact about the site under test
 * rather than a literal, so a case cannot silently encode this demo's inventory:
 *
 *   { "number": "miners" }        the answer states truth.miners
 *   { "anyId": "offlineIds" }     the answer names at least one of those ids
 *   { "allIds": "offlineIds" }    the answer names every one of them
 *   { "any": ["sleep","normal"] } any of these words, case-insensitive
 *   { "pattern": "\\d" }          a raw regular expression, for shapes the above cannot say
 *                                 (add "flags" to override the default "i")
 *   { "declined": true }          the model refused rather than answered
 *   { "anyOf": [ … ] }            at least one branch holds
 *   { "allOf": [ … ] }            every branch holds
 *   { "ifEmpty": "offlineIds", "then": …, "else": … }
 *                                 one expectation or the other, decided by the fleet — a yes/no
 *                                 question has two right answers and `anyOf` would accept both
 */
export function compileExpect (expr, truth, where = 'expect') {
  const pred = (test, describe) => ({ test, describe, toString: () => describe })

  if (!expr || typeof expr !== 'object') throw new Error(`${where}: expectation must be an object`)

  if (expr.anyOf || expr.allOf) {
    const branches = (expr.anyOf ?? expr.allOf).map((e, i) => compileExpect(e, truth, `${where}[${i}]`))
    if (!branches.length) throw new Error(`${where}: anyOf/allOf needs at least one branch`)
    const combine = expr.anyOf ? 'some' : 'every'
    return pred((a) => branches[combine]((b) => b.test(a)), `${expr.anyOf ? 'anyOf' : 'allOf'}(${branches.join(', ')})`)
  }

  if (expr.ifEmpty !== undefined) {
    const ids = truth[expr.ifEmpty]
    if (!Array.isArray(ids)) throw unavailable(`${where}: "${expr.ifEmpty}" is not a probed id list`)
    const short = truth.partial?.[expr.ifEmpty]
    if (short) throw unavailable(`${where}: "${expr.ifEmpty}" is only ${short.shown} of ${short.total}, so empty cannot be told from truncated`)
    if (!expr.then || !expr.else) throw new Error(`${where}: "ifEmpty" needs both "then" and "else"`)
    const whenEmpty = compileExpect(expr.then, truth, `${where}.then`)
    const whenNot = compileExpect(expr.else, truth, `${where}.else`)
    return ids.length === 0 ? whenEmpty : whenNot
  }

  if (expr.number !== undefined) {
    const value = truth[expr.number]
    if (typeof value !== 'number') throw unavailable(`${where}: "${expr.number}" is not a probed number`)
    return pred((a) => new RegExp(`\\b${value}\\b`).test(a), `number ${expr.number}=${value}`)
  }

  if (expr.anyId !== undefined || expr.allIds !== undefined) {
    const key = expr.anyId ?? expr.allIds
    const ids = truth[key]
    if (!Array.isArray(ids)) throw unavailable(`${where}: "${key}" is not a probed id list`)
    // Only a prefix of the fleet came back, so this list cannot decide the question either way:
    // "names all of them" is unanswerable, and "names one of them" fails on a correct answer
    // that happens to name a device beyond the prefix.
    const short = truth.partial?.[key]
    if (short) throw unavailable(`${where}: "${key}" is only ${short.shown} of ${short.total} on this fleet`)
    // An empty list would make "name one of them" vacuously true or impossible; say so instead.
    if (!ids.length) return pred(() => true, `${key} is empty on this fleet`)
    const combine = expr.anyId !== undefined ? 'some' : 'every'
    return pred(
      (a) => ids[combine]((id) => a.toLowerCase().includes(id.toLowerCase())),
      `${expr.anyId !== undefined ? 'anyId' : 'allIds'} ${key}=[${ids.join(',')}]`
    )
  }

  if (expr.any !== undefined) {
    if (!Array.isArray(expr.any) || !expr.any.length) throw new Error(`${where}: "any" needs a non-empty array`)
    const rx = new RegExp(expr.any.map((s) => {
      const value = String(s)
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return `${/^\w/.test(value) ? '\\b' : ''}${escaped}${/\w$/.test(value) ? '\\b' : ''}`
    }).join('|'), 'i')
    return pred((a) => rx.test(a), `any(${expr.any.join('|')})`)
  }

  if (expr.pattern !== undefined) {
    const rx = new RegExp(expr.pattern, expr.flags ?? 'i')
    return pred((a) => rx.test(a), `/${expr.pattern}/`)
  }

  if (expr.declined === true) return pred((a) => DECLINED.test(a), 'a refusal')

  throw new Error(`${where}: unrecognised expectation ${JSON.stringify(expr)}`)
}

/**
 * Find a `{placeholder}` left in an expectation.
 *
 * A placeholder is named; a regex quantifier is numeric. Matching `{\w+}` conflated them, so
 * `{"pattern": "\\d{2}"}` read as a stray placeholder and killed the whole run at startup over a
 * legitimate expectation. Requiring the braces to wrap a name keeps the guard — including inside
 * a `pattern`, where a real `{sampleMiner}` is just as wrong — while leaving `{2}` alone.
 *
 * @returns {string|null} the placeholder name, or null
 */
const PLACEHOLDER = /\{([A-Za-z_]\w*)\}/

function placeholderIn (value) {
  if (typeof value === 'string') return PLACEHOLDER.exec(value)?.[1] ?? null
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) {
      const found = placeholderIn(inner)
      if (found) return found
    }
  }
  return null
}

/**
 * Read and validate the battery. A malformed case fails here rather than scoring as a model
 * failure halfway through a run.
 */
export function loadBattery (path = BATTERY_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const cases = parsed.cases
  if (!Array.isArray(cases) || !cases.length) throw new Error(`${path}: "cases" must be a non-empty array`)

  const seen = new Set()
  for (const c of cases) {
    if (!c.id || typeof c.id !== 'string') throw new Error(`battery: every case needs a string id (near ${JSON.stringify(c).slice(0, 80)})`)
    if (seen.has(c.id)) throw new Error(`battery: duplicate case id "${c.id}"`)
    seen.add(c.id)
    if (!c.q || typeof c.q !== 'string') throw new Error(`battery[${c.id}]: needs a question`)
    if (c.tool === undefined) throw new Error(`battery[${c.id}]: needs a tool (or null to require a refusal)`)
    for (const name of toolsOf(c)) {
      if (name !== NO_TOOL && !/^[a-z]+_[a-z]+$/.test(name)) throw new Error(`battery[${c.id}]: "${name}" is not a taxonomy name`)
    }
    if (!c.expect) throw new Error(`battery[${c.id}]: needs an expectation`)
    if (c.tags !== undefined && !Array.isArray(c.tags)) throw new Error(`battery[${c.id}]: tags must be an array`)
    // Placeholders are substituted in the question only. One left in an expectation matches its
    // own braces and quietly weakens the case instead of failing it.
    const stray = placeholderIn(c.expect)
    if (stray) {
      throw new Error(`battery[${c.id}]: expectations cannot use placeholders like {${stray}} — use anyId/allIds against a probed list`)
    }
  }
  return cases
}

// null in JSON means "no tool should be called"; NO_TOOL is the runtime spelling of that. It is
// allowed inside the array too, for questions where both answering and declining are defensible
// — writing that down beats pretending there is one right route.
function toolsOf (testCase) {
  const declared = testCase.tool === null ? [null] : [].concat(testCase.tool)
  return declared.map((name) => (name === null ? NO_TOOL : name))
}

// The tool the question is actually about. Later entries are leniency in scoring — a route we
// will not fail — and crediting them too would let a tool bank the pass rate of cases another
// tool answered.
const primaryOf = (testCase) => toolsOf(testCase)[0]

/**
 * Read the fleet's current shape through the tools themselves, so every expectation is a fact
 * about the site under test.
 */
export async function probeTruth (mcp) {
  // The probe reads through the same contract the battery scores against, so a server that
  // does not satisfy it is named here rather than surfacing later as a TypeError on a field
  // the tool never returned.
  const read = async (name, args) => {
    const { text, isError } = await mcp.callTool(name, args)
    if (isError) throw new Error(`probe: ${name} returned an error: ${text}`)
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`probe: ${name} did not return JSON`)
    }
    const { ok, errors } = validateToolResult(name, payload)
    if (!ok) throw new Error(`probe: ${name} does not satisfy the result contract — ${errors.join('; ')}`)
    return payload
  }

  const site = await read('summarize_site', {})
  const counts = {}
  for (const family of ['miner', 'container', 'powermeter', 'sensor', 'pool']) {
    counts[family] = (await read('count_devices', { family, state: 'all' })).count
  }
  const offline = await read('list_devices', { family: 'all', state: 'offline' })
  const minerList = await read('list_devices', { family: 'miner', state: 'all' })
  const minersDown = await read('list_devices', { family: 'miner', state: 'offline' })
  const idOf = (i) => i.deviceId ?? i.id

  // list_devices names at most `limit` devices and reports the true match count separately, so
  // on a fleet larger than that these lists are a prefix rather than the set. Checking an answer
  // against a prefix scores a correct answer wrong the moment it names a device we never saw —
  // the harness reporting a failure it invented. Record which lists are short of the fleet and
  // let the cases that depend on them be set aside by name.
  const partial = {}
  for (const [key, list] of [['offlineIds', offline], ['minerIds', minerList], ['minerOfflineIds', minersDown]]) {
    if (Number.isFinite(list.total) && list.total > list.items.length) {
      partial[key] = { shown: list.items.length, total: list.total }
    }
  }

  const truth = {
    workers: site.totals?.workers?.total,
    workersOnline: site.totals?.workers?.online,
    workersOffline: site.totals?.workers?.offline,
    devices: site.totals?.devices?.total,
    devicesOnline: site.totals?.devices?.online,
    devicesOffline: site.totals?.devices?.offline,
    miners: counts.miner,
    containers: counts.container,
    powermeters: counts.powermeter,
    sensors: counts.sensor,
    pools: counts.pool,
    offlineIds: offline.items.map(idOf),
    minerIds: minerList.items.map(idOf),
    minerOfflineIds: minersDown.items.map(idOf),
    minersOffline: minersDown.total ?? minersDown.count,
    partial
  }
  // Many cases name a device, so the battery cannot run against a fleet with none.
  if (!truth.minerIds.length) throw new Error('probe: the site reports no miners; the battery needs at least one')
  truth.sampleMiner = truth.minerIds[0]
  truth.otherMiner = truth.minerIds[1] ?? truth.minerIds[0]
  return truth
}

/**
 * The cases a run will cover. Exported so the CLI can report the count without restating the
 * filter: two copies would let the header promise a different number than the run delivers.
 *
 * `null` means no filter. An empty string is not treated as one — it would match every id via
 * `includes('')`, which is the opposite of what a caller passing an unset variable wants, and
 * the CLI rejects it before it gets here.
 */
export function selectCases (cases = [], { only = null, tag = null } = {}) {
  return cases.filter((c) =>
    (only == null || c.id.includes(only)) &&
    (tag == null || (c.tags ?? []).includes(tag)))
}

/**
 * Admitted tools that no case exercises. A tool with no case is untested by construction, and
 * the battery drifts silently as the tool set grows — so a run reports this rather than
 * quietly scoring a smaller surface than the agent exposes.
 */
export function coverageGaps (tools = [], cases = loadBattery()) {
  const covered = new Set(cases.flatMap(toolsOf))
  return tools.map((t) => t.name).filter((name) => !covered.has(name))
}

function checkResultContract (ev) {
  // The loop enforces the contract itself and reports the breach as a failed call, so the
  // reason arrives here rather than the payload — without it the report would score every
  // enforced violation as zero violations.
  if (ev.contractViolation) return [`${ev.name}: ${ev.contractViolation}`]
  if (ev.isError) return [] // a tool reporting a failure is not a contract breach
  let payload
  try {
    payload = JSON.parse(ev.text)
  } catch {
    return [`${ev.name}: result is not JSON`]
  }
  const { ok, errors } = validateToolResult(ev.name, payload)
  return ok ? [] : errors.map((e) => `${ev.name}: ${e}`)
}

// Approvals are always rejected: an eval must never leave a write behind on the fleet it
// measures. The case still scores whether the gate fired.
async function runOnce (agent, question) {
  const session = await agent.createSession()
  const calls = []
  const violations = []
  let approvals = 0
  let answer = ''
  let error = null
  // A rejected approval still emits a tool_result, carrying the notice that nothing ran. The
  // tool produced no payload, so there is nothing to validate — scoring it would fail every
  // write case for a gate that worked.
  let rejected = false

  const iter = session.send(question)
  let sent
  for (;;) {
    const { value: ev, done } = await iter.next(sent)
    sent = undefined
    if (done) break
    if (ev.type === EVENT.TOOL_CALL) calls.push({ name: ev.name, args: ev.args })
    else if (ev.type === EVENT.TOKEN) answer += ev.text
    else if (ev.type === EVENT.ERROR) error = ev.error
    else if (ev.type === EVENT.TOOL_RESULT) {
      if (rejected) rejected = false
      else violations.push(...checkResultContract(ev))
    } else if (ev.type === EVENT.PENDING_APPROVAL) {
      approvals++
      rejected = true
      sent = false
    }
  }
  // The battery never resumes a session, so keeping the record only holds a full run's history
  // in memory for as long as the run lasts — nothing expires inside twenty minutes at a
  // thirty-minute TTL.
  await agent.store?.delete(session.id)
  return { calls, answer: answer.trim(), violations, approvals, error }
}

function score (testCase, truth, run) {
  const expected = toolsOf(testCase)
  const routed = run.calls[0]?.name ?? NO_TOOL
  const pattern = compileExpect(testCase.expect, truth, `battery[${testCase.id}]`)

  // The gate is the only thing standing between a model and an unapproved write, so it is
  // checked whenever a write was attempted — not only when a case remembered to ask. Left
  // opt-in, a regression that stopped gating would pass every case that did not opt in.
  const attemptedWrite = run.calls.some((c) => String(c.name).startsWith(`${VERB.ACT}_`))

  const checks = {
    route: expected.includes(routed),
    answer: pattern.test(run.answer),
    approval: (testCase.approval || attemptedWrite) ? run.approvals > 0 : true,
    contract: run.violations.length === 0
  }
  return { routed, pattern: pattern.describe, checks, ok: !run.error && Object.values(checks).every(Boolean) }
}

// Per tool and per tag, so a report says which part of the surface is weak rather than only
// how many cases failed. A tool at 60% and one at 100% do not need the same response.
//
// `keyOf` returns the buckets a run counts towards. Each run adds at most one to any bucket:
// a tool's rate must mean "cases this tool owns", not "cases it was one acceptable answer to".
function breakdown (results, keyOf) {
  const acc = {}
  for (const r of results) {
    for (const k of new Set(keyOf(r))) {
      acc[k] ??= { runs: 0, passed: 0 }
      acc[k].runs++
      if (r.ok) acc[k].passed++
    }
  }
  for (const v of Object.values(acc)) v.rate = Math.round((v.passed / v.runs) * 100)
  return acc
}

/**
 * Run the battery against a live agent and return a report.
 *
 * `onResult` is called with each scored run as it finishes, so a caller can stream progress;
 * the returned report is the artifact worth keeping.
 */
export async function runBattery ({ agent, mcp, cases = null, reps = 1, only = null, tag = null, concurrency = 1, onResult = () => {} } = {}) {
  if (!agent) throw new Error('runBattery needs an agent')
  if (!mcp) throw new Error('runBattery needs an mcp connection to probe the fleet')
  if (!Number.isFinite(concurrency) || concurrency < 1) throw new Error(`runBattery: concurrency must be at least 1, got ${concurrency}`)

  const all = cases ?? loadBattery()
  const truth = await probeTruth(mcp)
  const selected = selectCases(all, { only, tag })
  if (!selected.length) throw new Error(`no battery case matches ${only ? `"${only}"` : ''}${tag ? ` tag "${tag}"` : ''}`)

  // Every expectation compiles before the first question runs, so a typo in the battery is a
  // startup error rather than a model failure discovered forty minutes in. A case this fleet
  // cannot express is set aside and named — the battery is meant to travel to sites that do
  // not report everything the demo does.
  const skipped = []
  const runnable = selected.filter((c) => {
    try {
      compileExpect(c.expect, truth, `battery[${c.id}]`)
      return true
    } catch (err) {
      if (err.code !== PROBE_UNAVAILABLE) throw err
      skipped.push({ id: c.id, reason: err.message })
      return false
    }
  })
  if (!runnable.length) throw new Error(`no battery case can run against this fleet (${skipped.length} skipped)`)

  // Every run is an independent session, so the only reason to go one at a time is to keep the
  // model server unloaded. Batching preserves output order regardless of completion order — a
  // report read by a human should not shuffle between runs.
  const work = runnable.flatMap((testCase) => {
    const question = testCase.q.replace(/\{(\w+)\}/g, (_, key) => {
      if (truth[key] === undefined) throw new Error(`battery[${testCase.id}]: "{${key}}" is not a probed value`)
      return truth[key]
    })
    return Array.from({ length: reps }, (_, i) => ({ testCase, question, rep: i + 1 }))
  })

  // A pool rather than fixed batches. Batching made every worker wait for the slowest question
  // in its group before the next group started, and the slowest are the fan-out ones — on a
  // twenty-minute run that idles most of the slots most of the time. Workers take the next index
  // as they finish and write into its slot, so all of them stay busy.
  const results = new Array(work.length)
  const width = Math.min(Math.max(1, Math.floor(concurrency)), work.length)
  let next = 0

  const scoreOne = async ({ testCase, question, rep }) => {
    const run = await runOnce(agent, question)
    return {
      id: testCase.id,
      question,
      rep,
      expected: toolsOf(testCase),
      primary: primaryOf(testCase),
      tags: testCase.tags ?? [],
      ...score(testCase, truth, run),
      ...run
    }
  }

  // Reporting stays in index order even though completion order is not: a report read by a
  // human should not shuffle between runs. `emitted` is the high-water mark of what has been
  // announced, so a slot that finishes early waits its turn to be spoken.
  let emitted = 0
  const drain = () => {
    while (emitted < results.length && results[emitted] !== undefined) onResult(results[emitted++])
  }

  await Promise.all(Array.from({ length: width }, async () => {
    while (true) {
      const index = next++
      if (index >= work.length) return
      results[index] = await scoreOne(work[index])
      drain()
    }
  }))

  const failed = results.filter((r) => !r.ok)
  return {
    truth,
    reps,
    cases: runnable.length,
    // Named rather than silently dropped: a shrinking battery must not read as a passing one.
    skipped,
    runs: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    // A case that passes on one rep and fails on another is the interesting signal: the routing
    // is not stable, which a single-rep run would have reported as a clean pass.
    flaky: [...new Set(failed.map((r) => r.id))].filter((id) => results.some((r) => r.id === id && r.ok)),
    byCheck: ['route', 'answer', 'approval', 'contract'].reduce((acc, check) => {
      acc[check] = results.filter((r) => r.checks[check] === false).length
      return acc
    }, {}),
    byTool: breakdown(results, (r) => [r.primary]),
    byTag: breakdown(results, (r) => r.tags),
    // Where misroutes actually went, which is what tells you a tool is acting as a magnet.
    misroutes: failed.filter((r) => !r.checks.route)
      .reduce((acc, r) => { acc[r.routed] = (acc[r.routed] ?? 0) + 1; return acc }, {}),
    results
  }
}
