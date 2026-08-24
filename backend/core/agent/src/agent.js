import { resolveProvider } from './provider.js'
import { connectMcp } from './mcp.js'
import { Session } from './session.js'
import { MemorySessionStore } from './session-store.js'
import { admitTools, CAPABILITY } from './tools.js'

/**
 * Create an agent — the sole public factory.
 *
 * The agent is long-lived and owns the shared provider connection and, when `config.mcp`
 * is given, the MCP tool connection. Sessions are cheap and per-conversation.
 *
 * Tools are admitted here and only here: every session and the prompt-cache warmup then share
 * one filtered, identically ordered list, which is what keeps their prompt prefix identical.
 *
 * Returns { provider, mcp, tools, skipped, store, waitReady, createSession, resumeSession, close }.
 */
export async function createAgent (config = {}) {
  if (!config.provider) throw new Error('createAgent: config.provider is required')

  const provider = await resolveProvider(config.provider)
  const limits = config.limits ?? {}
  const system = config.system
  const capability = config.capability ?? CAPABILITY.SMALL
  // The boundary the model is told its tools do not cross. Left undefined it is NOT_COVERED,
  // which describes a present-state fleet tool set; a tool set that covers more must say so,
  // or the prompt tells the model to decline questions its own tools answer.
  const notCovered = config.notCovered
  const store = config.store ?? new MemorySessionStore()

  // Without an MCP server the agent is a grounded chat; with one, sessions call fleet tools.
  let mcp = null
  let tools = []
  let skipped = []
  if (config.mcp?.url) {
    mcp = await connectMcp(config.mcp.url)
    ;({ admitted: tools, skipped } = admitTools(await mcp.listTools(), { capability }))
  }

  /**
   * Build a session around a store record.
   *
   * Identity is applied after the caller's options and cannot be overridden: a caller may still
   * vary the charter or the limits, but not bind a session to a record it does not own. One
   * function rather than two, so the rule cannot hold in one path and lapse in the other.
   */
  const sessionFrom = (record, opts = {}) => new Session({
    provider,
    system,
    limits,
    tools,
    mcp,
    notCovered,
    ...opts,
    store,
    id: record.id,
    userId: record.userId,
    messages: record.messages
  })

  return {
    provider,
    mcp,
    tools,
    skipped,

    waitReady (opts) {
      return provider.waitReady(opts)
    },

    store,

    /**
     * Start a conversation. Async because the store is asked for the record first, which over a
     * network is a round trip.
     */
    async createSession (opts = {}) {
      const { userId = 'local', metadata, ...rest } = opts
      return sessionFrom(await store.create({ userId, metadata }), rest)
    },

    /**
     * Pick a conversation back up by id.
     *
     * `userId` says who is asking and has no default: a session id travels in URLs an operator
     * can see, so an id alone is not authority to read the conversation behind it, and a default
     * is what a caller forgets. Returns null for never-existed, expired, and owned by somebody
     * else alike — distinguishing them would confirm the id exists.
     */
    async resumeSession (id, { userId, ...opts } = {}) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new TypeError('resumeSession needs the userId of whoever is asking')
      }
      const record = await store.get(id)
      if (!record || record.userId !== userId) return null
      return sessionFrom(record, opts)
    },

    /**
     * Release what the agent opened: the MCP connection and the provider.
     *
     * Not the store. A caller that supplied one owns its lifetime — closing somebody else's
     * Redis client here would be the agent reaching past its own boundary — and the default
     * in-memory one dies with the agent that holds it.
     */
    async close () {
      await mcp?.close()
      await provider.close?.()
    }
  }
}
