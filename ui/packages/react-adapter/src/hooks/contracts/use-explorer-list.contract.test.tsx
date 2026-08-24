/**
 * Contract test — `useExplorerList`.
 *
 * This hook's payload type changes when the data source becomes injectable
 * (`ListThingsDevice[]` → a generic row type), so its shape contract is pinned
 * here: envelope flattening, empty-state stability, and the signed-out path.
 * Nothing here names a URL, a query key, or a params builder.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { EXPLORER_TAB } from '@tetherto/mdk-ui-foundation/presets/mining'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useExplorerList } from '../use-explorer-list'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useExplorerList contract', () => {
  it('flattens rows across every responding node of the envelope', async () => {
    const harness = createMdkHarness({
      respond: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]],
    })

    const { result } = renderHook(() => useExplorerList(EXPLORER_TAB.MINER, OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Both inner arrays contribute — a sharded deployment must not lose rows.
    expect(result.current.things.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('reads exactly one resource', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'a' }]] })

    const { result } = renderHook(() => useExplorerList(EXPLORER_TAB.CONTAINER, OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(harness.requests).toHaveLength(1)
  })

  it('returns an empty row array for an empty envelope', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(() => useExplorerList(EXPLORER_TAB.CABINET, OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.things).toEqual([])
  })

  it('holds the envelope shape while signed out — rows never undefined', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useExplorerList(EXPLORER_TAB.MINER, OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.things).toEqual([])
    expect(typeof result.current.refetch).toBe('function')
    expect(harness.requests).toEqual([])
  })
})
