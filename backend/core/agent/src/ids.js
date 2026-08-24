import { AXIS } from './tools.js'

/**
 * Reading the fleet's device ids, and deciding whether an id in an answer was relayed or made up.
 *
 * In src/ rather than beside the runner that uses it because a `.mjs` script with top-level
 * await cannot be imported by a test: the logic would never appear as a coverage gap and would
 * never be covered. Everything here is judgement about what counts as a fabrication, which is
 * the one number this harness must not get wrong in the flattering direction.
 */

// Every family the contract defines, minus the wildcard. Read from AXIS rather than restated:
// a family added there and missed here would leave that family's devices out of the id set
// while `complete` still said the set was whole — and their real ids would then be reported as
// fabrications.
const FAMILIES = AXIS.family.filter((family) => family !== 'all')

/**
 * Every device id the fleet has, and whether that set is the whole of it.
 *
 * Asked family by family because list_devices names at most `limit` per call and reports the
 * true match count separately. A set that is only a prefix cannot be used to call anything a
 * fabrication — ids beyond it are real — so the caller is told, rather than left to assume.
 *
 * @returns {Promise<{ids: Set<string>, complete: boolean}>}
 */
export async function fleetIds (mcp) {
  const ids = new Set()
  let complete = true
  for (const family of FAMILIES) {
    const { text } = await mcp.callTool('list_devices', { family, state: 'all' })
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      // A family we could not read is a family whose ids we do not hold.
      complete = false
      continue
    }
    for (const item of payload.items ?? []) {
      const id = item.deviceId ?? item.id
      if (id) ids.add(id)
    }
    if (Number.isFinite(payload.total) && payload.total > (payload.items?.length ?? 0)) complete = false
  }
  return { ids, complete }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What an id looks like on this site, derived from the ids just read.
 *
 * Two halves, because they answer different questions. Every known id is matched literally,
 * which is what makes `unsupportedIds` — did this turn's tools supply the id it named? —
 * answerable for the whole fleet. On top of that, each numeric family generalises to any number,
 * so `antminer-99` is recognised as id-shaped on a site that has only `antminer-0..4`. That is
 * the shape a fabrication almost always takes: a real prefix with a number that does not exist.
 *
 * Deliberately not generalised further. A pattern like `container-<anything>` would also swallow
 * ordinary prose — "container-level metrics" — and report it as a device the fleet does not
 * have, which is the same lie in the other direction. An invented id of a non-numeric form is
 * therefore missed; that is a known limit, and it is the safe side to be wrong on.
 *
 * Checked against the ids it came from before being returned: a construction that cannot
 * recognise the ids it was built from does not model this site's naming, and null is returned
 * instead. Null means "no id can be recognised", which a caller must never read as "no ids were
 * invented" — a confident zero is worse than admitting we cannot tell.
 *
 * @returns {RegExp|null} global-flagged, for `String.match`
 */
export function idShape (known) {
  const ids = [...known].filter(Boolean)
  if (!ids.length) return null

  // Prefixes of the ids that do end in a number, so those families generalise.
  const numericPrefixes = [...new Set(
    ids.filter((id) => /-?\d+$/.test(id)).map((id) => id.replace(/-?\d+$/, '')).filter(Boolean)
  )]

  const alternatives = [
    // Longest first: `site-sensor-2` must not be matched as `site-…`, and a literal id must win
    // over a shorter prefix that is a substring of it.
    ...ids.sort((a, b) => b.length - a.length).map(escape),
    ...numericPrefixes.sort((a, b) => b.length - a.length).map((p) => `${escape(p)}-?\\d+`)
  ]

  const source = `\\b(?:${alternatives.join('|')})\\b`
  // Probed without the global flag: `test` on a global regex advances lastIndex between calls.
  const probe = new RegExp(source, 'i')
  if (!ids.every((id) => probe.test(id))) return null

  return new RegExp(source, 'gi')
}

/**
 * Which ids in an answer were not supplied by this turn's tools, and which the fleet does not
 * have at all.
 *
 * `inventedIds` is null when it could not be judged — an incomplete fleet, or naming this
 * shape does not model. Null rather than an empty array, because the two mean opposite things
 * and a caller that treats them alike reports a clean run it never measured.
 */
export function analyse (answer, toolTexts, { known, shape, complete }) {
  const seen = shape ? (String(answer).match(shape) ?? []) : []
  const supplied = toolTexts.join('\n').toLowerCase()
  const fleet = new Set([...known].map((id) => id.toLowerCase()))
  const scorable = complete && shape !== null
  const distinct = [...new Map(seen.map((id) => [id.toLowerCase(), id])).values()]
  return {
    // Named an id this turn's tools never returned: either invented, or carried over from
    // earlier context, which the charter forbids for fleet state.
    unsupportedIds: distinct.filter((id) => !supplied.includes(id.toLowerCase())),
    inventedIds: scorable ? distinct.filter((id) => !fleet.has(id.toLowerCase())) : null
  }
}
