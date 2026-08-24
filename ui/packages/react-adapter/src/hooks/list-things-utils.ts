/**
 * Helpers for unwrapping the nested `list-things` / `tail-log` response shape.
 *
 * The Gateway returns these endpoints as a per-Kernel array of arrays
 * (`T[][]` — one inner array per responding node). These helpers centralise that
 * unwrapping so it isn't re-implemented in every read hook.
 *
 * ## Reading only the first node is a deliberate, and incomplete, choice
 *
 * **Row lists** (`list-things`, `list-racks`) are flattened instead — see
 * `flattenKernelEnvelope` in the mining preset. Taking `[0]` there loses rows on
 * a sharded deployment, which was a real bug.
 *
 * **Aggregate time series** (`tail-log` with `aggrFields`, `ext-data` history)
 * still take `[0]`, i.e. one Kernel's series. On a single-Kernel site that is
 * exactly right. On a sharded one it under-reports — but flattening would be
 * strictly worse: two nodes' series concatenate into duplicate timestamps carrying
 * different values, and the chart builders dedupe them, so one node silently
 * wins with no indication anything was dropped.
 *
 * The correct merge is per-timestamp aggregation, and it is metric-specific: sum
 * for power and hashrate, undefined for the power-mode timeline (a mode is a
 * state, not a quantity). That is a decision about what each chart *means*, so it
 * is deliberately not made here. The five call sites are marked; grep
 * `single-Kernel assumption`.
 */

/**
 * First inner array of a nested `T[][]` response, or `[]` when absent.
 *
 * For series data this is also the Kernel-merge strategy — see the note above
 * before reaching for it in a new hook.
 */
export const headOrEmpty = <T>(value: T[][] | undefined | null): T[] => {
  if (!Array.isArray(value)) return []
  const first = value[0]
  return Array.isArray(first) ? first : []
}

/** First row of a nested `T[][]` response (`value[0][0]`), or `undefined`. */
export const headHead = <T>(value: T[][] | undefined | null): T | undefined =>
  headOrEmpty(value)[0]
