import { describe, expect, it } from 'vitest'

import { buildAscDedupedPoints, computeMinMaxAvg, lastY } from '../chart-points'

describe('lastY', () => {
  it('returns the latest numeric sample', () => {
    expect(lastY([{ x: 1, y: 10 }, { x: 2, y: 20 }])).toBe(20)
  })

  it('skips trailing gaps', () => {
    expect(lastY([{ x: 1, y: 10 }, { x: 2, y: null }, { x: 3, y: null }])).toBe(10)
  })

  it('returns null when every sample is a gap', () => {
    expect(lastY([{ x: 1, y: null }])).toBeNull()
  })

  it('returns null for an empty series', () => {
    expect(lastY([])).toBeNull()
  })

  it('treats 0 as a real sample, not a gap', () => {
    expect(lastY([{ x: 1, y: 5 }, { x: 2, y: 0 }])).toBe(0)
  })
})

describe('computeMinMaxAvg', () => {
  const format = (value: number): string => value.toFixed(1)

  it('derives min, max and average from the numeric samples', () => {
    const stats = computeMinMaxAvg([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }], format)
    expect(stats).toEqual({ min: '2.0', max: '6.0', avg: '4.0' })
  })

  it('ignores gaps when averaging', () => {
    const stats = computeMinMaxAvg([{ x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 6 }], format)
    expect(stats).toEqual({ min: '2.0', max: '6.0', avg: '4.0' })
  })

  it('returns undefined when there is no numeric sample', () => {
    expect(computeMinMaxAvg([{ x: 1, y: null }], format)).toBeUndefined()
    expect(computeMinMaxAvg([], format)).toBeUndefined()
  })
})

describe('buildAscDedupedPoints', () => {
  it('sorts entries ascending by ts', () => {
    const points = buildAscDedupedPoints(
      [{ ts: 3000, v: 3 }, { ts: 1000, v: 1 }, { ts: 2000, v: 2 }],
      (entry) => entry.v,
    )
    expect(points).toEqual([{ x: 1000, y: 1 }, { x: 2000, y: 2 }, { x: 3000, y: 3 }])
  })

  it('keeps x in milliseconds, snapped to the enclosing second', () => {
    const points = buildAscDedupedPoints([{ ts: 1750, v: 1 }], (entry) => entry.v)
    expect(points).toEqual([{ x: 1000, y: 1 }])
  })

  it('collapses same-second samples to the latest value', () => {
    const points = buildAscDedupedPoints(
      [{ ts: 1100, v: 1 }, { ts: 1900, v: 9 }],
      (entry) => entry.v,
    )
    expect(points).toEqual([{ x: 1000, y: 9 }])
  })

  it('preserves nulls returned by the accessor as gaps', () => {
    const points = buildAscDedupedPoints(
      [{ ts: 1000, v: 1 }, { ts: 2000, v: null }],
      (entry) => entry.v,
    )
    expect(points).toEqual([{ x: 1000, y: 1 }, { x: 2000, y: null }])
  })

  it('does not mutate the input array', () => {
    const entries = [{ ts: 2000, v: 2 }, { ts: 1000, v: 1 }]
    buildAscDedupedPoints(entries, (entry) => entry.v)
    expect(entries[0]?.ts).toBe(2000)
  })

  it('returns an empty series for no entries', () => {
    expect(buildAscDedupedPoints([], () => 1)).toEqual([])
  })
})
