import { randomUUID } from 'node:crypto'
import { streamText } from 'ai'
import { runToolLoop } from './loop.js'
import { DEFAULT_LIMITS } from './constants.js'
import { SESSION_GONE } from './session-store.js'
import { EVENT } from './events.js'

// The charter — the agent's standing instruction, sent to the model as the system
// prompt on every request. Five blocks, ordered most-stable first:
//   IDENTITY → HONESTY → GROUNDING → VOCABULARY → STYLE
// Routing knowledge (which tool for which question) does NOT live here — it lives in
// the tool descriptions, so it evolves with the tool set. Update policy: fix at the
// strongest layer first (tool code > schema > description > charter); every charter
// edit re-runs the eval battery; additions should pay for themselves by deletion.
const DEFAULT_SYSTEM = `You are the MDK operator assistant for a cryptocurrency mining site.
You answer the operator's questions with live fleet data from tools, and perform
approval-gated actions when asked.

HONESTY — what you do at your limits:
- If no tool covers the question, call nothing. Say plainly that you don't have that
  ability yet and offer the closest thing you can do — one sentence each.
- Never call a tool speculatively, hoping its result might happen to contain the answer.
- If a tool ran but its result lacks the answer, say what you checked and what was
  missing. Never estimate, infer, or invent a value.
- Do a thing or decline it — never announce that you are about to do it.
- If the message is not a question or instruction about the fleet — a greeting, thanks, or
  something you cannot make sense of — call no tool. Reply in one line and ask what they
  need. Never run a tool to fill the silence.

GROUNDING — where facts come from:
- Every fleet question a tool covers gets a tool call — even if an earlier answer in
  this conversation seems to cover it. Never answer fleet state from memory.
- Report only values present in the tool result. Never name an item the tool did not
  return.
- Use the tool that answers the question directly. Never count, filter, or classify a
  raw dump yourself when a tool returns the number or list itself. Only if no such
  tool exists may you count — and then list the items first and count what you listed.

MDK VOCABULARY — three different things, never mixed:
- WORKER: a process that manages a group of devices; ids end in "-worker". Not a device.
- DEVICE: a unit managed by a worker; ids never end in "-worker".
- MINER: a device of type miner ONLY (antminer-N, avalon-N, whatsminer-N). Containers,
  site sensors, powermeters and pools are devices too, but they are NOT miners.
- Worker count, device count and miner count are three different numbers. Asked for
  one, never report another.
- An unqualified "device" — or a general question like "is anything down?" — means ALL
  device types: use type "all". Narrow to a type only when the operator names it.
- "Up" means ready. "Down", "offline", "not up" mean NOT ready. If a result shows
  notReady > 0, then something IS down — name it. Never say everything is up while
  any notReady count is above zero.
- If a question could mean two different things and the answers would differ, take the
  widest reading and state your assumption in the answer. Ask a clarifying question
  only before a write action.

STYLE — the shape of the final answer:
- Facts and action results: ONE short plain sentence. No preamble, no "Here is…".
- List requests — asking which items exist or what there is (list, show, give me, name
  them, which ones, what devices do we have, what is there): output EVERY matching item,
  one per line, and nothing else. Never collapse a list into a count, and never answer
  with the state of one item when asked what exists.
- Never mention tools or how you got the answer — not even on failure. Speak in the
  operator's terms.`

/**
 * One conversation. Turns each user message into a streamed sequence of typed events (see
 * docs/CONTRACT.md), and keeps its history where the store puts it.
 *
 * With tools from an MCP server a turn runs the prompt-based tool loop; otherwise it is a
 * plain grounded chat. Either way a failed turn leaves no trace in history.
 *
 * `messages` is the working copy the model sees. It is written back to the store at the end of
 * every turn and replaced by what the store returns, so the store's cap is the real one — a
 * session that kept its own uncapped array would grow past it while the store looked bounded.
 */
export class Session {
  constructor ({ provider, system, limits = {}, userId = 'local', tools = [], mcp = null, notCovered, store = null, id, messages = [] } = {}) {
    if (!provider) throw new Error('Session needs a provider')
    this.provider = provider
    this.system = system ?? DEFAULT_SYSTEM
    this.limits = limits
    this.userId = userId
    this.tools = tools
    this.mcp = mcp
    // Undefined keeps the default boundary; an array replaces it, and [] drops the block.
    this.notCovered = notCovered
    this.store = store
    this.messages = messages
    // Unguessable: the id travels in URLs, and the counter it replaced collided across processes.
    this.id = id ?? randomUUID()
  }

  /**
   * Run one turn, streaming its events.
   *
   * The write is in a `finally` because a consumer is free to stop reading — a gateway request
   * whose client disconnects abandons the generator mid-stream, and the turn that did happen
   * would otherwise never reach the store. The turn generators settle history in a `finally` of
   * their own for the same reason, so what gets written is never a question with no answer.
   */
  async * send (text) {
    this.messages.push({ role: 'user', content: text })
    try {
      yield * (this.tools.length && this.mcp ? this.toolTurn() : this.chatTurn())
    } finally {
      await this.persist()
    }
  }

  /**
   * Write the turn back and adopt what came out, so the store's trim is what the next turn sends.
   *
   * A record the store no longer holds — SESSION_GONE — is not coming back, so the session
   * detaches and carries on in memory: the turn already happened, and failing after the fact
   * tells the operator nothing they can act on. Anything else is treated as transient — the store
   * stays attached so the next turn retries.
   *
   * @returns {Promise<boolean>} whether the write landed.
   */
  async persist () {
    if (!this.store) return true
    try {
      const saved = await this.store.save({ id: this.id, messages: this.messages })
      this.messages = saved.messages
      this.persistError = null
      return true
    } catch (err) {
      if (err?.code === SESSION_GONE || /does not exist|expired/i.test(String(err?.message))) this.store = null
      this.persistError = err
      return false
    }
  }

  // Tool-enabled turn: run the loop, forwarding any approval decision back into it
  // (a pending_approval event yields out; the consumer's .next(decision) flows back in),
  // and capture the final answer into history.
  async * toolTurn () {
    const loop = runToolLoop({
      model: this.provider.model(),
      system: this.system,
      messages: this.messages,
      tools: this.tools,
      mcp: this.mcp,
      notCovered: this.notCovered,
      maxSteps: this.limits.maxSteps ?? DEFAULT_LIMITS.maxSteps,
      maxOutputTokens: this.limits.maxOutputTokens ?? DEFAULT_LIMITS.maxOutputTokens
    })
    let answer = ''
    let errored = false
    let sent
    try {
      while (true) {
        const { value: ev, done } = await loop.next(sent)
        sent = undefined
        if (done) break
        if (ev.type === EVENT.TOKEN) answer += ev.text
        else if (ev.type === EVENT.ERROR) errored = true
        sent = yield ev // whatever the consumer passes to .next() (e.g. an approval bool)
      }
    } finally {
      // A failed turn — and one the consumer walked away from — leaves no trace: drop the
      // unanswered user message, so history never carries a prompt the agent did not answer.
      if (errored || !answer) this.messages.pop()
      else this.messages.push({ role: 'assistant', content: answer })
    }
  }

  // Plain chat turn (no tools): stream the model directly.
  async * chatTurn () {
    const result = streamText({
      model: this.provider.model(),
      system: this.system,
      messages: this.messages,
      maxOutputTokens: this.limits.maxOutputTokens ?? DEFAULT_LIMITS.maxOutputTokens,
      maxRetries: this.limits.maxRetries ?? 2
    })
    let assistant = ''
    let errored = false
    try {
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            const t = part.text ?? part.delta ?? ''
            assistant += t
            yield { type: EVENT.TOKEN, text: t }
          } else if (part.type === 'error') {
            // error is terminal — stop here so no done follows (contract invariant 1),
            // matching the tool loop's behaviour on a stream error.
            errored = true
            yield { type: EVENT.ERROR, error: String(part.error) }
            return
          }
        }
      } catch (err) {
        errored = true
        yield { type: EVENT.ERROR, error: String(err?.message ?? err) }
        return
      }
    } finally {
      if (errored || !assistant) this.messages.pop()
      else this.messages.push({ role: 'assistant', content: assistant })
    }
    const usage = await result.usage.catch(() => ({}))
    yield { type: EVENT.DONE, usage, text: assistant }
  }

  /**
   * Clear the conversation, in the store as well as here.
   *
   * Throws if the store refused the write. `send` swallows the same failure because its turn has
   * already happened, but a reset that resolves while the history survives is a lie the caller
   * acts on — and the conversation returns the moment it is resumed elsewhere.
   *
   * A record that is already gone is not a refusal: there is nothing left to clear, and the
   * caller asked for exactly the state they now have. Only a store still attached — one that
   * expects to be written to again — means the history survived the call.
   */
  async reset () {
    const previous = this.messages
    this.messages = []
    if (!(await this.persist()) && this.store) {
      this.messages = previous
      throw this.persistError
    }
  }
}
