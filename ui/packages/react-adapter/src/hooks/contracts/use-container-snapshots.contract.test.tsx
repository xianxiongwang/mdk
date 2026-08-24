/**
 * Contract test — `useContainerSnapshots`.
 *
 * Payload-changing hook. Pinned: envelope flattening, the empty-`containerKeys`
 * gate, and empty-state stability.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useContainerSnapshots } from '../use-container-snapshots'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useContainerSnapshots contract', () => {
  it('flattens snapshots across every responding node', async () => {
    const harness = createMdkHarness({
      respond: [[{ id: 'c-1' }], [{ id: 'c-2' }]],
    })

    const { result } = renderHook(() => useContainerSnapshots(['c-1', 'c-2'], OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.containers.map((c) => c.id)).toEqual(['c-1', 'c-2'])
  })

  it('does not read anything for an empty container list', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useContainerSnapshots([], OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.containers).toEqual([])
    expect(harness.requests).toEqual([])
  })

  it('returns an empty container array for an empty envelope', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(() => useContainerSnapshots(['c-1'], OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.containers).toEqual([])
  })
})
