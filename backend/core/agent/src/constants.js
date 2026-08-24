import { VERB } from './tools.js'

export const DEFAULT_LIMITS = { maxSteps: 4, maxOutputTokens: 512 }

/**
 * Where the pieces listen when nothing says otherwise — the local QVAC server and the demo's
 * MCP endpoint.
 *
 * Here rather than at each use because these were written out in six files: the flag default,
 * the error that hints at the flag, and both eval runners. Literals that mean the same thing in
 * several places do not stay the same, and the one that drifts is found by someone debugging
 * why a runner cannot reach a server everything else can.
 */
export const DEFAULT_ENDPOINTS = Object.freeze({
  model: 'http://127.0.0.1:11500/v1',
  mcp: 'http://127.0.0.1:3008/mcp'
})

// Read verbs, for servers that do not annotate their tools. Derived from the taxonomy rather
// than a list of names, which would go stale the moment a tool is renamed.
const READ_VERBS = Object.values(VERB).filter((v) => v !== VERB.ACT)

/**
 * Does this tool call need explicit human approval?
 *
 * Fails safe: gated unless known read-only, either by the server's readOnlyHint or by a read
 * verb in the name, so a new, renamed or unrecognised write tool is never executed silently.
 * `tool` is the MCP tool descriptor and may be undefined.
 */
export function requiresApproval (name, tool) {
  const hint = tool && tool.annotations ? tool.annotations.readOnlyHint : undefined
  if (hint === true) return false // server says read-only
  if (hint === false) return true // server says it writes
  return !READ_VERBS.some((verb) => String(name).startsWith(`${verb}_`))
}
