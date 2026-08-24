// Freeze tests for the event contract (src/events.js). These pin the shape of the typed
// stream: the canonical events below are exactly what loop.js and session.js emit, so if a
// shape drifts, isAgentEvent() and these tests break. See CONTRACT.md.

import test from 'brittle'
import {
  EVENT, CONTRACT_VERSION, TERMINAL_EVENTS, isTerminal, isAgentEvent
} from '../../src/events.js'

// One canonical example of every event the agent emits (loop.js + session.js), including
// the two tool_result variants and the three done variants.
const CANONICAL = [
  { type: EVENT.TOKEN, text: 'hi' },
  { type: EVENT.TOOL_CALL, name: 'count_devices', args: { family: 'miner' } },
  { type: EVENT.TOOL_RESULT, name: 'count_devices', text: '{"summary":"15"}', isError: false },
  { type: EVENT.TOOL_RESULT, name: 'act_device', text: '(rejected by operator — not executed)' }, // no isError
  { type: EVENT.PENDING_APPROVAL, name: 'act_device', args: { ref: 'antminer-3', action: 'reboot' } },
  { type: EVENT.ERROR, error: 'model server unreachable' },
  { type: EVENT.DONE, text: '15 miners.' },
  { type: EVENT.DONE, usage: { totalTokens: 42 }, text: '15 miners.' },
  { type: EVENT.DONE } // bare terminal
]

test('the contract exposes exactly the six frozen event types', (t) => {
  t.alike(
    Object.values(EVENT).sort(),
    ['done', 'error', 'pending_approval', 'token', 'tool_call', 'tool_result'],
    'event set is frozen — adding one is a deliberate, breaking-aware change'
  )
  t.ok(Object.isFrozen(EVENT), 'EVENT is frozen — no accidental mutation at runtime')
  t.is(typeof CONTRACT_VERSION, 'string')
})

test('isAgentEvent accepts every canonical event the agent emits', (t) => {
  for (const ev of CANONICAL) t.ok(isAgentEvent(ev), `${ev.type} accepted`)
})

test('isAgentEvent rejects malformed and unknown events', (t) => {
  t.absent(isAgentEvent(null))
  t.absent(isAgentEvent({}), 'no type')
  t.absent(isAgentEvent({ type: 'nope' }), 'unknown type')
  t.absent(isAgentEvent({ type: EVENT.TOKEN }), 'token without text')
  t.absent(isAgentEvent({ type: EVENT.TOKEN, text: 5 }), 'token text not a string')
  t.absent(isAgentEvent({ type: EVENT.TOOL_CALL, name: 'x' }), 'tool_call without args')
  t.absent(isAgentEvent({ type: EVENT.TOOL_CALL, name: 'x', args: [] }), 'args must be an object, not an array')
  t.absent(isAgentEvent({ type: EVENT.TOOL_RESULT, name: 'x', text: 't', isError: 'yes' }), 'isError not a boolean')
  t.absent(isAgentEvent({ type: EVENT.ERROR }), 'error without error string')
})

test('terminal events are done and error only', (t) => {
  t.ok(TERMINAL_EVENTS.has(EVENT.DONE))
  t.ok(TERMINAL_EVENTS.has(EVENT.ERROR))
  t.is(TERMINAL_EVENTS.size, 2)
  t.ok(isTerminal({ type: EVENT.DONE }))
  t.ok(isTerminal({ type: EVENT.ERROR, error: 'x' }))
  t.absent(isTerminal({ type: EVENT.TOKEN, text: 'x' }))
  t.absent(isTerminal(null))
})
