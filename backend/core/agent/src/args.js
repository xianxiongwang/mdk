// Kept out of bin/, which has top-level await and process.exit and so cannot be imported by
// any test — logic living there is unreachable rather than merely uncovered.

/**
 * Parse `--flag value` pairs. A flag with no value, or one followed by another flag, is `true`
 * rather than swallowing the next flag as its value.
 *
 * @param {string[]} argv
 * @returns {Record<string, string|true>}
 */
export function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = (next == null || next.startsWith('--')) ? true : argv[++i]
  }
  return out
}

// Flags that select what runs or where output goes. Checked as a set rather than one at a
// time: guarding them individually is how --tag was added without one and silently ran the
// whole battery instead of the subset asked for.
const VALUE_FLAGS = ['only', 'tag', 'out']

/**
 * Validate the `--eval` flags and return them normalised.
 *
 * @param {Record<string, string|true>} args
 * @returns {{reps: number, concurrency: number, only: string|null, tag: string|null, out: string|null}}
 * @throws {TypeError} on any malformed flag, so the CLI can report it before connecting to
 *   anything — waiting on a model load to then reject a typo costs a minute per attempt.
 */
export function evalOptions (args = {}) {
  // `true` is what a flag with no value parses to, and Number(true) is 1 — so a bare --reps
  // would validate as "one repetition" rather than being reported as the typo it is.
  const count = (name) => {
    const raw = args[name]
    if (raw === undefined) return 1
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new TypeError(`--${name} needs a value`)
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`--${name} must be a positive integer, got "${raw}"`)
    return value
  }
  const reps = count('reps')
  const concurrency = count('concurrency')
  // Empty counts as missing. A script passing --only "$FILTER" with FILTER unset would
  // otherwise select nothing to filter on and quietly run the whole battery.
  for (const name of VALUE_FLAGS) {
    const raw = args[name]
    if (raw === undefined) continue
    if (typeof raw !== 'string' || !raw.trim()) throw new TypeError(`--${name} needs a value`)
  }
  return {
    reps,
    concurrency,
    only: typeof args.only === 'string' ? args.only : null,
    tag: typeof args.tag === 'string' ? args.tag : null,
    out: typeof args.out === 'string' ? args.out : null
  }
}
