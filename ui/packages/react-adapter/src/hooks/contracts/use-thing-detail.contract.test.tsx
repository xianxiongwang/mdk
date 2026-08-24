/**
 * Contract test — `useThingDetail`.
 *
 * Payload-changing hook: `thing` moves from `ListThingsDevice` to a generic row
 * type when the data source becomes injectable. Pinned here: single-row
 * projection, the absent-row case, and the id-gating behaviour.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useThingDetail } from '../use-thing-detail'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useThingDetail contract', () => {
  it('projects the first row out of the envelope', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'miner-01', info: { site: 's' } }]] })

    const { result } = renderHook(() => useThingDetail('miner-01', OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.thing?.id).toBe('miner-01')
  })

  it('leaves `thing` undefined when the envelope carries no row', async () => {
    const harness = createMdkHarness({ respond: [[]] })

    const { result } = renderHook(() => useThingDetail('missing', OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.thing).toBeUndefined()
  })

  it('does not read anything without an id', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useThingDetail(undefined, OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.thing).toBeUndefined()
    expect(harness.requests).toEqual([])
  })

  it('does not read anything while signed out', () => {
    const harness = createMdkHarness({ token: null })

    renderHook(() => useThingDetail('miner-01', OPTS), { wrapper: harness.Wrapper })

    expect(harness.requests).toEqual([])
  })
})
