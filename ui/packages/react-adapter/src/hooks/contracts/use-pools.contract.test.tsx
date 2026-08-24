/**
 * Contract test — `usePools`.
 *
 * Asserts the hook's *return shape* only. No URL, no query key, no `meta`.
 * Request-shape assertions live in `specs/use-pools.test.tsx` (mining
 * conformance) and are expected to change when the data source is swapped;
 * everything here is expected to survive it.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { poolsQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { usePools } from '../use-pools'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

describe('usePools contract', () => {
  it('unwraps the response envelope into a row array', async () => {
    const harness = createMdkHarness()
    harness.seed(poolsQuery, {
      pools: [{ name: 'pool-a' }, { name: 'pool-b' }],
      summary: { totalHashrate: 12 },
    })

    const { result } = renderHook(() => usePools({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.error).toBeNull()
    expect(typeof result.current.refetch).toBe('function')
    expect(harness.requests).toEqual([])
  })

  it('returns an empty array when the envelope carries no rows', async () => {
    const harness = createMdkHarness()
    harness.seed(poolsQuery, { summary: {} })

    const { result } = renderHook(() => usePools({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual([])
  })

  it('exposes an empty array — never undefined — before data arrives', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => usePools({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    // Signed out: the query never runs, and the contract still holds.
    expect(result.current.data).toEqual([])
    expect(harness.requests).toEqual([])
  })
})
