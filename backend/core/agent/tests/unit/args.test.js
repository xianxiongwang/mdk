import test from 'brittle'
import { parseArgs, evalOptions } from '../../src/args.js'

test('parseArgs reads values and does not swallow the next flag', (t) => {
  t.alike(parseArgs(['--model', 'qwen3-4b', '--eval']), { model: 'qwen3-4b', eval: true })
  t.alike(parseArgs(['--tag', '--reps', '2']), { tag: true, reps: '2' }, 'a flag is never another flag\'s value')
  t.alike(parseArgs(['--tag']), { tag: true }, 'a trailing flag has no value')
  t.alike(parseArgs([]), {})
  t.alike(parseArgs(['stray', '--only', 'rank-']), { only: 'rank-' }, 'positional arguments are ignored')
})

// A flag whose value is missing parses as `true`. Falling back to null instead of rejecting it
// ran the whole 259-case battery in place of the subset asked for — twenty minutes reporting a
// number for questions nobody selected.
test('a value flag given without a value is rejected, not ignored', (t) => {
  for (const name of ['only', 'tag', 'out']) {
    let message = null
    try {
      evalOptions({ [name]: true })
    } catch (err) {
      message = err.message
    }
    t.is(message, `--${name} needs a value`, `--${name} is checked`)
  }
})

// The realistic trigger is a script passing --only "$FILTER" with FILTER unset. An empty
// filter matches every id, so it selects everything — the same outcome as the missing value
// this guard exists to catch.
test('an empty or blank value is treated as missing, not as a filter', (t) => {
  for (const name of ['only', 'tag', 'out']) {
    for (const value of ['', '   ']) {
      let message = null
      try {
        evalOptions({ [name]: value })
      } catch (err) {
        message = err.message
      }
      t.is(message, `--${name} needs a value`, `--${name} ${JSON.stringify(value)} is rejected`)
    }
  }
})

test('evalOptions normalises what runs and where it goes', (t) => {
  t.alike(evalOptions({}), { reps: 1, concurrency: 1, only: null, tag: null, out: null })
  t.alike(evalOptions({ reps: '3', concurrency: '6', tag: 'rank', only: 'decline-', out: 'r.json' }),
    { reps: 3, concurrency: 6, only: 'decline-', tag: 'rank', out: 'r.json' })
})

test('evalOptions rejects counts that would run nothing or make no sense', (t) => {
  const rejects = (args) => {
    try {
      evalOptions(args)
      return null
    } catch (err) {
      return err.message
    }
  }
  t.ok(/--reps/.test(rejects({ reps: '0' })))
  t.ok(/--reps/.test(rejects({ reps: '1.5' })))
  t.ok(/--reps/.test(rejects({ reps: 'many' })))
  t.ok(/--reps/.test(rejects({ reps: true })), 'a bare --reps is a missing value too')
  t.ok(/--concurrency/.test(rejects({ concurrency: '0' })))
  t.ok(/--concurrency/.test(rejects({ concurrency: '-2' })))
})
