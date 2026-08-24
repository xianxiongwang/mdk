/**
 * Turning a battery report into the text a human reads.
 *
 * Here rather than in bin/ for the reason bin/ says at the top of src/args.js: it has top-level
 * await and process.exit, so nothing there can be imported by a test. Rendering was the largest
 * piece of logic living in it — six sections deciding what to show, in what order, and when to
 * stay quiet — and none of it was reachable. It is pure text in, text out, so it is also the
 * cheapest part of the runner to get wrong without noticing.
 *
 * Colour is injected. A report piped to a file or read by another tool should not be carrying
 * escape codes, so plain is the default and the CLI passes its own palette in.
 */

const PLAIN = {
  bold: (s) => s,
  dim: (s) => s,
  good: (s) => s,
  warn: (s) => s,
  bad: (s) => s
}

/** One line per case as it finishes, plus why it failed. */
export function formatResult (result, { paint = PLAIN } = {}) {
  const lines = [`  ${result.ok ? paint.good('PASS') : paint.warn('FAIL')} ${paint.dim(result.id)} ${result.question}`]
  if (result.ok) return lines[0]

  if (!result.checks.route) lines.push(`       route    : ${result.routed} ${paint.dim(`(wanted ${result.expected.join(' | ')})`)}`)
  if (!result.checks.answer) lines.push(`       answer   : ${String(result.answer ?? '').replace(/\s+/g, ' ').slice(0, 100)} ${paint.dim(`(wanted ${result.pattern})`)}`)
  if (!result.checks.approval) lines.push('       approval : the write was not gated')
  for (const v of result.violations ?? []) lines.push(`       contract : ${v}`)
  if (result.error) lines.push(`       error    : ${result.error}`)
  return lines.join('\n')
}

/**
 * The summary printed once the run is over.
 *
 * @param {object} report          what runBattery returned
 * @param {object} [opts.paint]    colour functions; plain text by default
 * @returns {string}
 */
export function formatReport (report, { paint = PLAIN } = {}) {
  const { passed, runs, failed, flaky = [], byCheck = {}, byTool = {}, byTag = {}, misroutes = {}, skipped = [] } = report
  const out = []

  // A battery that quietly shrank against this fleet would read as a cleaner pass than it is.
  if (skipped.length) {
    out.push('', `  ${paint.warn(`${skipped.length} case${skipped.length > 1 ? 's' : ''} this fleet cannot express:`)} ${paint.dim(skipped.map((s) => s.id).join(', '))}`)
  }

  const pct = runs ? Math.round((passed / runs) * 100) : 0
  out.push('', `  ${passed}/${runs} passed (${pct}%)${failed ? ` · ${failed} failed` : ''}`)

  const broken = Object.entries(byCheck).filter(([, n]) => n > 0)
  if (broken.length) out.push(`  ${paint.dim(`by check: ${broken.map(([k, n]) => `${k} ${n}`).join(' · ')}`)}`)

  // Per tool, since a tool at 60% and one at 100% do not need the same response — one needs its
  // routing metadata reworked, the other needs leaving alone. Keyed on the tool each case is
  // about, not every tool it would have accepted. Worst first, because that is what to act on.
  if (Object.keys(byTool).length) {
    out.push('', `  ${paint.bold('by tool')} ${paint.dim('(cases the tool owns)')}`)
    for (const [name, s] of Object.entries(byTool).sort((a, b) => a[1].rate - b[1].rate)) {
      const shade = s.rate >= 90 ? paint.good : s.rate >= 70 ? paint.warn : paint.bad
      out.push(`    ${shade(`${String(s.rate).padStart(3)}%`)} ${name.padEnd(16)} ${paint.dim(`${s.passed}/${s.runs}`)}`)
    }
  }

  // Only tags with enough cases to mean something: a tag with two cases swings fifty points on
  // one result, and reading that as a weakness sends someone tuning noise.
  const weakTags = Object.entries(byTag)
    .filter(([, s]) => s.rate < 80 && s.runs >= 3)
    .sort((a, b) => a[1].rate - b[1].rate)
  if (weakTags.length) {
    out.push('', `  ${paint.bold('weakest question styles')}`)
    for (const [t, s] of weakTags.slice(0, 8)) {
      out.push(`    ${paint.warn(`${String(s.rate).padStart(3)}%`)} ${t.padEnd(16)} ${paint.dim(`${s.passed}/${s.runs}`)}`)
    }
  }

  // Where misroutes landed: one tool absorbing them is a magnet, and that is a contract problem
  // rather than a per-question wording problem.
  const magnets = Object.entries(misroutes).sort((a, b) => b[1] - a[1])
  if (magnets.length) out.push('', `  ${paint.dim(`misroutes landed on: ${magnets.map(([k, n]) => `${k} ${n}`).join(' · ')}`)}`)

  // Unstable routing passes a single-rep run and fails in front of an operator.
  if (flaky.length) {
    out.push(`  ${paint.warn(`unstable across reps (${flaky.length}): ${flaky.slice(0, 12).join(', ')}${flaky.length > 12 ? '…' : ''}`)}`)
  }

  return out.join('\n')
}
