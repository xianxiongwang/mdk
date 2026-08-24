import { z } from 'zod'

/**
 * The agent event contract — the typed stream every turn produces and every consumer reads
 * (CLI in-process, gateway over SSE, UI store). The zod schema below is the single
 * definition: it validates at runtime and types consumers via z.infer.
 *
 * See docs/CONTRACT.md for the shapes, ordering invariants and the wire envelope.
 */

// Bump only on a breaking change; new event types are additive (consumers ignore unknown types).
export const CONTRACT_VERSION = 'v1'

// Reference these constants, never the raw strings, so a typo is a reference error.
export const EVENT = Object.freeze({
  TOKEN: 'token',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  PENDING_APPROVAL: 'pending_approval',
  ERROR: 'error',
  DONE: 'done'
})

// A frozen Set still allows .add()/.delete(), so expose has() only for real immutability.
const terminalTypes = new Set([EVENT.DONE, EVENT.ERROR])
export const TERMINAL_EVENTS = Object.freeze({ has: (t) => terminalTypes.has(t), size: terminalTypes.size })

export function isTerminal (ev) {
  return !!ev && typeof ev === 'object' && TERMINAL_EVENTS.has(ev.type)
}

// One schema per event; the discriminated union on `type` is the contract. Objects are
// non-strict, so an event carrying the gateway's wire envelope still validates.
const argsObject = z.record(z.unknown())

const TokenEvent = z.object({ type: z.literal(EVENT.TOKEN), text: z.string() })
const ToolCallEvent = z.object({ type: z.literal(EVENT.TOOL_CALL), name: z.string(), args: argsObject })
const ToolResultEvent = z.object({ type: z.literal(EVENT.TOOL_RESULT), name: z.string(), text: z.string(), isError: z.boolean().optional() })
const PendingApprovalEvent = z.object({ type: z.literal(EVENT.PENDING_APPROVAL), name: z.string(), args: argsObject })
const ErrorEvent = z.object({ type: z.literal(EVENT.ERROR), error: z.string() })
const DoneEvent = z.object({ type: z.literal(EVENT.DONE), text: z.string().optional(), usage: z.record(z.unknown()).optional() })

export const AgentEventSchema = z.discriminatedUnion('type', [
  TokenEvent, ToolCallEvent, ToolResultEvent, PendingApprovalEvent, ErrorEvent, DoneEvent
])

/** @typedef {import('zod').infer<typeof AgentEventSchema>} AgentEvent */

// False for unknown or malformed events — consumers should ignore those, not throw.
export function isAgentEvent (ev) {
  return AgentEventSchema.safeParse(ev).success
}
