/**
 * Plain time units. Backend-agnostic by nature — they were previously defined
 * inside the mining alert-query builders, which meant a genuinely generic helper
 * (`fetchHistoricalAlertsInChunks`) had to import from the mining dialect just to
 * get "one day in milliseconds".
 */

/** One day in milliseconds. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1_000
