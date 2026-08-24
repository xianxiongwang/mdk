/**
 * Contract test — `useSiteConsumptionChartData`.
 *
 * Representative of the response-shaping group. The return value is the generic
 * `ChartCardData` contract that `<LineChartCard />` consumes directly, so this
 * is the shape that must hold across any data source: dataset structure, the
 * millisecond x-axis, W→MW conversion, and the footer/highlight derivations.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useSiteConsumptionChartData } from '../use-site-consumption-chart-data'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const RANGE = { timeline: '1m', refetchInterval: 0 } as const

describe('useSiteConsumptionChartData contract', () => {
  it('emits a single ChartCardData dataset with millisecond x values', async () => {
    const harness = createMdkHarness({
      respond: [[
        { ts: 1000, site_power_w: 1_000_000 },
        { ts: 2000, site_power_w: 3_000_000 },
      ]],
    })

    const { result } = renderHook(() => useSiteConsumptionChartData(RANGE), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const data = result.current.data
    expect(data?.datasets).toHaveLength(1)
    // W → MW, and x stays in ms (LineChart divides by 1000 itself).
    expect(data?.datasets[0]?.data).toEqual([
      { x: 1000, y: 1 },
      { x: 2000, y: 3 },
    ])
    expect(typeof data?.datasets[0]?.borderColor).toBe('string')
  })

  it('derives the highlighted value from the latest sample', async () => {
    const harness = createMdkHarness({
      respond: [[
        { ts: 1000, site_power_w: 1_000_000 },
        { ts: 2000, site_power_w: 3_500_000 },
      ]],
    })

    const { result } = renderHook(() => useSiteConsumptionChartData(RANGE), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.highlightedValue).toEqual({ value: '3.50', unit: 'MW' })
  })

  it('provides formatters the chart card can call without further shaping', async () => {
    const harness = createMdkHarness({ respond: [[{ ts: 1000, site_power_w: 2_000_000 }]] })

    const { result } = renderHook(() => useSiteConsumptionChartData(RANGE), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.yTicksFormatter?.(2)).toBe('2.00 MW')
    expect(result.current.data?.priceFormatter?.(2)).toBe('2.00 MW')
  })

  it('renders a gap rather than a zero for a missing reading', async () => {
    const harness = createMdkHarness({
      respond: [[{ ts: 1000, site_power_w: 1_000_000 }, { ts: 2000 }]],
    })

    const { result } = renderHook(() => useSiteConsumptionChartData(RANGE), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.datasets[0]?.data).toEqual([
      { x: 1000, y: 1 },
      { x: 2000, y: null },
    ])
  })

  it('stays idle while signed out', async () => {
    const harness = createMdkHarness({ token: null, respond: [[]] })

    renderHook(() => useSiteConsumptionChartData(RANGE), { wrapper: harness.Wrapper })

    // This assertion used to read `toHaveLength(1)`, pinning a bug: the hook
    // passed no `enabled`, so it fired with no Authorization header and the
    // resulting 401 tripped the global session guard and reset `authStore`.
    // It now matches its siblings. The whole set of twelve is covered in
    // `token-gate.contract.test.tsx`; this case stays here so the hook's own
    // contract file is self-contained.
    expect(harness.requests).toEqual([])
  })
})
