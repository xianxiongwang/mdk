/**
 * Shared point-building helpers for the chart-shaping hooks.
 *
 * Every hook that returns a `ChartCardData` payload needs the same three
 * steps: turn raw telemetry entries into an ascending, de-duplicated point
 * series, read the latest non-null value for `highlightedValue`, and derive
 * the min/max/avg footer stats. Keeping them here means the per-hook code is
 * only the parts that differ — the query, the unit conversion, and the labels.
 */

import type { ChartDataPoint } from '@tetherto/mdk-ui-foundation'

const MS_PER_SECOND = 1000

/**
 * Latest non-null `y` in a point series, or `null` when every sample is a gap.
 * Used for the `highlightedValue` on a chart card.
 */
export const lastY = (points: readonly ChartDataPoint[]): number | null => {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const y = points[i]?.y
    if (typeof y === 'number') return y
  }
  return null
}

/**
 * Min / max / average of the non-null samples, pre-formatted with the caller's
 * unit formatter. Returns `undefined` when the series has no numeric sample,
 * so the footer stats can be omitted entirely rather than rendered as `NaN`.
 */
export const computeMinMaxAvg = (
  points: readonly ChartDataPoint[],
  format: (value: number) => string,
): { min: string; max: string; avg: string } | undefined => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0
  for (const point of points) {
    if (typeof point.y === 'number') {
      if (point.y < min) min = point.y
      if (point.y > max) max = point.y
      sum += point.y
      count += 1
    }
  }
  if (count === 0) return undefined
  return { min: format(min), max: format(max), avg: format(sum / count) }
}

/**
 * Build an ascending, tie-free point series from raw telemetry entries.
 *
 * `LineChart` divides `x` by 1000 to derive the lightweight-charts
 * `UTCTimestamp`, so `x` stays in **milliseconds** here. lightweight-charts
 * also rejects duplicate timestamps, so entries are sorted by `ts`, snapped to
 * the enclosing second, and consecutive same-bucket samples collapse to the
 * latest value.
 */
export const buildAscDedupedPoints = <T extends { ts?: unknown }>(
  entries: readonly T[],
  toY: (entry: T) => number | null,
): ChartDataPoint[] => {
  const sorted = [...entries].sort((a, b) => Number(a.ts) - Number(b.ts))
  const out: ChartDataPoint[] = []
  for (const entry of sorted) {
    const xMs = Math.floor(Number(entry.ts) / MS_PER_SECOND) * MS_PER_SECOND
    const y = toY(entry)
    const last = out[out.length - 1]
    if (last && last.x === xMs) {
      last.y = y
    } else {
      out.push({ x: xMs, y })
    }
  }
  return out
}
