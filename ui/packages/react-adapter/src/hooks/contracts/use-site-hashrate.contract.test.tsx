/**
 * Contract test — `useSiteHashrate`.
 *
 * Representative of the "param builder + unit conversion + latest sample" group.
 * The unit contract is the load-bearing part: the backend emits MH/s and the
 * header box renders PH/s, so the conversion factor is part of the hook's public
 * behaviour and must survive the data-source swap.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useSiteHashrate } from '../use-site-hashrate'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const RANGE = { timeline: '1m', refetchInterval: 0 } as const

describe('useSiteHashrate contract', () => {
  it('converts MH/s to PH/s and exposes both units', async () => {
    // 2e9 MH/s == 2 PH/s
    const harness = createMdkHarness({
      respond: [[{ ts: 1000, hashrate_mhs_1m_sum_aggr: 2_000_000_000 }]],
    })

    const { result } = renderHook(() => useSiteHashrate(RANGE), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.valueMhs).toBe(2_000_000_000)
    expect(result.current.valuePhs).toBe(2)
  })

  it('projects the freshest sample, not the first', async () => {
    const harness = createMdkHarness({
      respond: [[
        { ts: 1000, hashrate_mhs_1m_sum_aggr: 1_000_000_000 },
        { ts: 2000, hashrate_mhs_1m_sum_aggr: 3_000_000_000 },
      ]],
    })

    const { result } = renderHook(() => useSiteHashrate(RANGE), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.valuePhs).toBe(3)
  })

  it('leaves both values undefined when the series carries no sample', async () => {
    const harness = createMdkHarness({ respond: [[]] })

    const { result } = renderHook(() => useSiteHashrate(RANGE), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.valueMhs).toBeUndefined()
    expect(result.current.valuePhs).toBeUndefined()
  })
})
