// What the operator actually reads after a run. This lived in bin/ and so could not be tested
// at all; the risk it carries is that a run looks cleaner than it was.

import test from 'brittle'
import { formatReport, formatResult } from '../../src/report.js'

const report = (over = {}) => ({
  passed: 8,
  runs: 10,
  failed: 2,
  flaky: [],
  byCheck: { route: 1, answer: 1, approval: 0, contract: 0 },
  byTool: {
    count_devices: { passed: 5, runs: 5, rate: 100 },
    list_devices: { passed: 3, runs: 5, rate: 60 }
  },
  byTag: {},
  misroutes: {},
  skipped: [],
  ...over
})

test('the headline is the pass rate, and a clean run says nothing more', (t) => {
  const out = formatReport(report({ failed: 0, passed: 10, byCheck: {} }))
  t.ok(out.includes('10/10 passed (100%)'))
  t.absent(/failed/.test(out), 'no failure line when nothing failed')
  t.absent(/unstable/.test(out))
  t.absent(/misroutes/.test(out))
})

// The reason this file exists: a shrinking battery must never read as a cleaner pass.
test('cases the fleet could not express are named, not quietly dropped', (t) => {
  const out = formatReport(report({ skipped: [{ id: 'list-pools', reason: 'no pools' }] }))
  t.ok(/1 case this fleet cannot express/.test(out))
  t.ok(out.includes('list-pools'), 'and named, so it can be checked')
})

test('tools are listed worst first, because that is what to act on', (t) => {
  const out = formatReport(report())
  t.ok(out.indexOf('list_devices') < out.indexOf('count_devices'), '60% before 100%')
})

// A tag with two cases swings fifty points on one result; reading that as a weakness sends
// someone tuning noise.
test('a weak tag is only reported when it has enough cases to mean something', (t) => {
  const thin = formatReport(report({ byTag: { casing: { passed: 0, runs: 2, rate: 0 } } }))
  t.absent(/weakest question styles/.test(thin), 'two cases is not a signal')

  const real = formatReport(report({ byTag: { decline: { passed: 4, runs: 10, rate: 40 } } }))
  t.ok(/weakest question styles/.test(real))
  t.ok(real.includes('decline'))

  const strong = formatReport(report({ byTag: { count: { passed: 10, runs: 10, rate: 100 } } }))
  t.absent(/weakest question styles/.test(strong), 'nor is a tag that is doing fine')
})

test('flaky cases and misroute magnets are surfaced', (t) => {
  const out = formatReport(report({ flaky: ['rank-hottest'], misroutes: { summarize_site: 4, act_device: 1 } }))
  t.ok(/unstable across reps \(1\): rank-hottest/.test(out))
  t.ok(out.indexOf('summarize_site 4') < out.indexOf('act_device 1'), 'the magnet comes first')
})

// Piped to a file or read by another tool, the report must not carry escape codes.
test('plain by default, coloured only when a palette is given', (t) => {
  t.absent(formatReport(report()).includes(String.fromCharCode(27)), 'no ANSI unless asked for')

  const painted = formatReport(report(), { paint: { bold: (s) => `<b>${s}</b>`, dim: (s) => s, good: (s) => s, warn: (s) => s, bad: (s) => s } })
  t.ok(painted.includes('<b>by tool</b>'), 'and the palette is used where it was asked for')
})

test('a failing case says which checks failed and nothing else', (t) => {
  const line = formatResult({
    ok: false,
    id: 'list-offline',
    question: 'which devices are offline?',
    checks: { route: false, answer: true, approval: true, contract: true },
    routed: 'summarize_site',
    expected: ['list_devices'],
    violations: [],
    answer: 'container-1'
  })

  t.ok(/route {4}: summarize_site/.test(line))
  t.ok(/wanted list_devices/.test(line))
  t.absent(/answer {3}:/.test(line), 'a check that passed is not reported as a failure')
  t.absent(/approval/.test(line))
})

test('a passing case is one line', (t) => {
  const line = formatResult({ ok: true, id: 'count-miners', question: 'how many miners?', checks: {} })
  t.is(line.split('\n').length, 1)
  t.ok(line.includes('PASS'))
  t.ok(line.includes('count-miners'))
})
