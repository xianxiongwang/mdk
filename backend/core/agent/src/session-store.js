import { randomUUID } from 'node:crypto'

/**
 * Where conversations live, behind an interface a Redis or SQL implementation can satisfy.
 *
 * Four rules any implementation honours, each of them a way an in-memory store could otherwise
 * be more forgiving than a networked one and hide a bug until production:
 *
 *   1. Every method is async.
 *   2. Records are copied in and out — a caller's object never becomes the stored one.
 *   3. `get` returns null for expired and never-existed alike, and `save` refuses both with a
 *      SESSION_GONE error rather than resurrecting them.
 *   4. Writes are last-one-wins; serialising them belongs to the caller.
 */

/** Idle time before a session is gone. Resets on every write. */
export const DEFAULT_TTL_MS = 30 * 60e3

/** Ceiling on stored messages: a memory guard, not the model's context window. */
export const DEFAULT_MAX_MESSAGES = 200

/**
 * Creates between self-reclaims. Expiry on read frees nothing for the sessions nobody resumes,
 * which are most of them, so a host that only ever creates would grow without bound.
 */
export const DEFAULT_SWEEP_EVERY = 100

/**
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {string} userId
 * @property {Array<{role: string, content: string}>} messages
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {object} metadata
 */

/**
 * The code `save` throws with when the record it was handed is not there to write to. Callers
 * branch on it to tell "this conversation is gone" from "this write did not land this time", so
 * an implementation that omits it gets the retry path forever.
 */
export const SESSION_GONE = 'SESSION_GONE'

/** @returns {Error} the error `save` throws for an id the store does not hold. */
export function sessionGone (id) {
  const err = new Error(`session "${id}" does not exist or has expired`)
  err.code = SESSION_GONE
  return err
}

const clone = (value) => structuredClone(value)

/** In-memory: correct, and no use beyond one process. */
export class MemorySessionStore {
  constructor ({ ttlMs = DEFAULT_TTL_MS, maxMessages = DEFAULT_MAX_MESSAGES, sweepEvery = DEFAULT_SWEEP_EVERY, now = Date.now } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError(`ttlMs must be a positive number, got ${ttlMs}`)
    if (!Number.isInteger(maxMessages) || maxMessages < 1) throw new TypeError(`maxMessages must be a positive integer, got ${maxMessages}`)
    if (!Number.isInteger(sweepEvery) || sweepEvery < 1) throw new TypeError(`sweepEvery must be a positive integer, got ${sweepEvery}`)
    this.ttlMs = ttlMs
    this.maxMessages = maxMessages
    this.sweepEvery = sweepEvery
    this.now = now
    this.records = new Map()
    this.sinceSweep = 0
  }

  /** @returns {Promise<SessionRecord>} */
  async create ({ userId, metadata = {} } = {}) {
    if (typeof userId !== 'string' || !userId.trim()) throw new TypeError('create needs a userId')
    if (++this.sinceSweep >= this.sweepEvery) {
      this.sinceSweep = 0
      await this.sweep()
    }
    const at = this.now()
    const record = { id: randomUUID(), userId, messages: [], createdAt: at, updatedAt: at, metadata: clone(metadata) }
    this.records.set(record.id, record)
    return clone(record)
  }

  /** @returns {Promise<SessionRecord|null>} null for missing and expired alike. */
  async get (id) {
    const record = this.records.get(id)
    if (!record) return null
    if (this.#expired(record)) {
      this.records.delete(id)
      return null
    }
    return clone(record)
  }

  /**
   * Write a record back, trimmed and re-stamped.
   *
   * Refuses an id the store does not hold: a session that expired mid-conversation must not come
   * back carrying its old history.
   *
   * `metadata` and `messages` are left alone when omitted, so a caller writing only the history
   * does not have to carry the rest. Pass `{}` to clear metadata — omitting it means "unchanged",
   * which is the more common intent and cannot express both.
   *
   * @returns {Promise<SessionRecord>}
   */
  async save (record) {
    if (!record?.id) throw new TypeError('save needs a record with an id')
    const existing = await this.get(record.id)
    if (!existing) throw sessionGone(record.id)

    const stored = clone({
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      metadata: record.metadata ?? existing.metadata,
      messages: trim(record.messages ?? existing.messages, this.maxMessages),
      updatedAt: this.now()
    })
    this.records.set(stored.id, stored)
    return clone(stored)
  }

  /** @returns {Promise<boolean>} whether a live record was there to remove — false for an expired
   * one, which `get` already reports as never having existed. */
  async delete (id) {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    return !this.#expired(record)
  }

  /** @returns {Promise<SessionRecord[]>} live sessions for one user, most recently used first. */
  async listByUser (userId) {
    const live = []
    for (const [id, record] of this.records) {
      if (this.#expired(record)) { this.records.delete(id); continue }
      if (record.userId === userId) live.push(clone(record))
    }
    return live.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Drop expired records. Reclaims memory only — `get` already refuses them — so correctness
   * never depends on this having run. Deliberately not a timer: an interval nobody clears is a
   * leak, and a store with native expiry returns 0 here.
   *
   * @returns {Promise<number>}
   */
  async sweep () {
    let removed = 0
    for (const [id, record] of this.records) {
      if (this.#expired(record)) { this.records.delete(id); removed++ }
    }
    return removed
  }

  // Survives at exactly ttlMs; pinned by test.
  #expired (record) {
    return this.now() - record.updatedAt > this.ttlMs
  }
}

/**
 * Keep the newest `max`, and never begin on an assistant turn — a reply whose question has been
 * dropped reads to the model as something it said unprompted.
 */
function trim (messages, max) {
  const kept = messages.length > max ? messages.slice(-max) : messages.slice()
  while (kept.length && kept[0].role === 'assistant') kept.shift()
  return kept
}
