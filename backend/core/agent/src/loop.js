import { generateText, streamText } from 'ai'
import { DEFAULT_LIMITS, requiresApproval } from './constants.js'
import { EVENT } from './events.js'
import { renderTools, renderCoverage, RESULT, validateToolResult, agentMeta, verbOf } from './tools.js'

/**
 * Run one prompt-based tool turn, yielding the typed event stream (see docs/CONTRACT.md).
 *
 * qvac serve ignores the OpenAI `tools` parameter, so tools are described in the prompt and
 * the model's JSON reply is parsed here. Each step the model returns either a tool call or a
 * plain-text answer; tool calls run against the MCP server and their result is fed back,
 * until an answer arrives or maxSteps is reached.
 */
export async function * runToolLoop ({ model, system, messages, tools, mcp, notCovered, maxSteps = DEFAULT_LIMITS.maxSteps, maxOutputTokens = DEFAULT_LIMITS.maxOutputTokens }) {
  const toolSystem = buildToolSystem(system, tools, { notCovered })
  const toolByName = new Map((tools ?? []).map((t) => [t.name, t])) // for readOnlyHint lookup
  const convo = messages.map((m) => ({ ...m })) // working copy we can append tool turns to
  let repairs = 0 // bounded retries when the model emits malformed tool-call JSON

  for (let step = 0; step < maxSteps; step++) {
    // Stream the model, but withhold output until the first non-whitespace character.
    // A tool call is emitted as a bare JSON object (our prompt says reply with ONLY the
    // object), so it starts with "{": we buffer that silently and parse it when complete.
    // Anything else is a prose answer for the operator, which we stream live token by
    // token — so a long answer flows instead of freezing until it's fully generated.
    let text = ''
    let decided = false
    let streamedProse = false
    try {
      const result = streamText({ model, system: toolSystem, messages: convo, maxOutputTokens, maxRetries: 2 })
      for await (const part of result.fullStream) {
        if (part.type === 'error') { yield { type: EVENT.ERROR, error: String(part.error) }; return }
        if (part.type !== 'text-delta') continue
        const t = part.text ?? part.delta ?? ''
        if (!t) continue
        text += t
        if (!decided) {
          const lead = text.replace(/^\s+/, '')
          if (!lead) continue // still only leading whitespace — keep waiting
          decided = true
          streamedProse = lead[0] !== '{'
          if (streamedProse) yield { type: EVENT.TOKEN, text: lead } // flush what we buffered
        } else if (streamedProse) {
          yield { type: EVENT.TOKEN, text: t }
        }
      }
    } catch (err) {
      yield { type: EVENT.ERROR, error: String(err?.message ?? err) }
      return
    }

    // Prose answer — already streamed to the operator. Done.
    if (streamedProse) {
      yield { type: EVENT.DONE, text: text.trim() }
      return
    }

    const call = parseToolCall(text)

    // It tried to call a tool but the JSON was unparseable → ask for a repair instead of
    // printing raw JSON at the operator. Bounded, so it can't spin.
    if (!call && looksLikeToolAttempt(text) && repairs < 2) {
      repairs++
      convo.push({ role: 'assistant', content: text })
      convo.push({ role: 'user', content: 'That was not valid JSON. Reply with ONLY a valid JSON object like {"tool":"<name>","args":{...}}, or with a plain-text answer.' })
      continue
    }

    // Started like a tool call but never parsed (malformed, repairs spent) → answer anyway.
    if (!call) {
      yield * answerOperator(text)
      return
    }

    // Tool call → announce it.
    yield { type: EVENT.TOOL_CALL, name: call.tool, args: call.args }

    // Approval gate — FAILS SAFE: any tool that is not known to be read-only requires
    // explicit human approval (see requiresApproval). We yield a pending_approval event
    // and read the decision back in (consumer passes it via .next(decision)).
    if (requiresApproval(call.tool, toolByName.get(call.tool))) {
      const approved = yield { type: EVENT.PENDING_APPROVAL, name: call.tool, args: call.args }
      if (!approved) {
        yield { type: EVENT.TOOL_RESULT, name: call.tool, text: '(rejected by operator — not executed)' }
        convo.push({ role: 'assistant', content: text })
        convo.push({ role: 'user', content: `The operator REJECTED the ${call.tool} action, so it did NOT run. Do not retry it. Briefly acknowledge and stop.` })
        continue
      }
    }

    // Execute against the MCP server and feed the result back.
    let result
    let failed = false
    // Carried on the event as well as folded into the text: enforcing a breach makes it look
    // like any other failed call, and a report that cannot tell the two apart stops counting
    // the thing it exists to count.
    let violation = null
    try {
      const r = await mcp.callTool(call.tool, call.args)
      result = r.text
      failed = r.isError
      if (!failed) {
        violation = contractViolation(toolByName.get(call.tool), result)
        if (violation) {
          result = `The ${call.tool} result did not satisfy its contract: ${violation}`
          failed = true
        }
      }
    } catch (err) {
      result = `Error: ${String(err?.message ?? err)}`
      failed = true
    }
    yield { type: EVENT.TOOL_RESULT, name: call.tool, text: result, isError: failed, ...(violation ? { contractViolation: violation } : {}) }

    // Verbatim, not JSON.stringify(call): the server's KV cache keys on the conversation,
    // so re-serializing the same call misses it and re-prefills. See
    // tests/unit/tool-history.test.js.
    convo.push({ role: 'assistant', content: text })
    if (failed) {
      // Never let a raw infrastructure error reach the operator. Coach the model to
      // translate it: say what is unavailable, in fleet terms, and stop.
      convo.push({
        role: 'user',
        content: `The ${call.tool} call FAILED with an internal error (${result.slice(0, 120)}). ` +
          'Tell the operator in ONE plain sentence that this live data is unavailable right now ' +
          'and they can retry shortly. Do NOT repeat the raw error code. Do not call the same tool again.'
      })
    } else {
      convo.push({ role: 'user', content: `Result of ${call.tool}:\n${result}\n\nUse this to answer the operator, or call another tool.` })
    }
  }

  // Ran out of steps — ask once more for a plain answer with what we have.
  let final
  try {
    const { text } = await generateText({ model, system: toolSystem, messages: convo, maxOutputTokens, maxRetries: 1 })
    final = text
  } catch (err) {
    yield { type: EVENT.ERROR, error: String(err?.message ?? err) }
    return // error is terminal — do not also emit done (contract invariant 1)
  }
  yield * answerOperator(final)
}

// Shown instead of model output that is not prose. The operator must never see JSON, and
// never hears about tools — only that their request did not land.
const UNSPEAKABLE_FALLBACK = 'Sorry, I could not complete that request — please try again.'

// The single gate for text destined for the operator: emit it only if it is prose, then
// close the turn with the one terminal event the contract allows (invariant 1).
function * answerOperator (text) {
  const trimmed = (text ?? '').trim()
  const out = isOperatorProse(trimmed) ? trimmed : UNSPEAKABLE_FALLBACK
  yield { type: EVENT.TOKEN, text: out }
  yield { type: EVENT.DONE, text: out }
}

// Prose is what the streaming path already streams live: non-empty, not opening a JSON
// object, and not a half-formed tool call.
function isOperatorProse (text) {
  return text.length > 0 && text[0] !== '{' && !looksLikeToolAttempt(text)
}

// The stable prompt prefix for a session: charter + tool block. Note this prefix alone
// buys no KV reuse — the server keys its cache on the whole conversation, not the prefix.
export function buildToolSystem (system, tools, { notCovered } = {}) {
  if (!tools || !tools.length) return system
  // An empty boundary renders nothing, so the block disappears rather than leaving a stray gap.
  const coverage = renderCoverage(tools, { notCovered })
  return [
    system,
    '',
    'You can call tools to get live data about the mining fleet. Available tools:',
    '',
    renderTools(tools),
    ...(coverage ? ['', coverage] : []),
    '',
    'To call a tool, reply with ONLY a JSON object and nothing else:',
    '{"tool": "<tool_name>", "args": { ... }}',
    '',
    'Where a parameter lists allowed values in [brackets], use one of those values exactly as',
    'written — never a synonym or a paraphrase. Where it shows an id, copy an id you have seen.',
    '',
    'When you have enough information, reply with a short plain-text answer for the',
    'operator (no JSON). Never invent fleet data — only use what the tools return.'
  ].join('\n')
}

// Extract the first BALANCED {...} object. A greedy regex would run to the last "}" and
// choke on the stray braces small models like to emit (e.g. `{"tool":...}}}`). (exported for tests)
export function extractJsonObject (text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

// A valid tool call is a balanced JSON object with a string `tool`. (exported for tests)
export function parseToolCall (text) {
  const raw = extractJsonObject(text)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args ?? {} }
  } catch {}
  return null
}

/**
 * Why this tool's JSON result breaks the contract it declared, or null if it does not.
 *
 * Judged only for tools declaring agent metadata, so a server predating this taxonomy still
 * works. (exported for tests)
 */
export function contractViolation (tool, text) {
  if (!agentMeta(tool)) return null
  if (!RESULT[verbOf(tool.name)]) return null

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return null // not JSON, so not a contract this agent can judge
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

  const { ok, errors } = validateToolResult(tool.name, payload)
  return ok ? null : errors.join('; ')
}

// Did the model clearly *try* to call a tool but emit something unparseable?
function looksLikeToolAttempt (text) {
  return /"\s*tool\s*"\s*:/.test(text)
}
