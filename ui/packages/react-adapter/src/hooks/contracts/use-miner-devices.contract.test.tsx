/**
 * Contract test — `useMinerDevices`.
 *
 * Payload-changing hook. Note the deliberate difference from its siblings: this
 * one heads the envelope (first responding node only) where `useExplorerList` /
 * `useContainerSnapshots` / `useCabinetDevices` flatten across all of them. That
 * asymmetry is pinned rather than assumed — see the note on the second test.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useMinerDevices } from '../use-miner-devices'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useMinerDevices contract', () => {
  it('returns a flat row array', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'm1' }, { id: 'm2' }]] })

    const { result } = renderHook(() => useMinerDevices(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.map((d) => d.id)).toEqual(['m1', 'm2'])
  })

  it('keeps rows from every responding node of the envelope', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'm1' }], [{ id: 'm2' }]] })

    const { result } = renderHook(() => useMinerDevices(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Used to assert `['m1']`, pinning a bug: this hook dropped rows from
    // additional nodes while its list-things siblings flattened. It was a real
    // bug for rack-sharded deployments, so the assertion flipped on purpose.
    expect(result.current.data.map((d) => d.id)).toEqual(['m1', 'm2'])
  })

  it('exposes isFetching alongside isLoading', async () => {
    const harness = createMdkHarness({ respond: [[]] })

    const { result } = renderHook(() => useMinerDevices(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(typeof result.current.isFetching).toBe('boolean')
    expect(result.current.data).toEqual([])
  })

  it('holds the contract while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useMinerDevices(OPTS), { wrapper: harness.Wrapper })

    expect(result.current.data).toEqual([])
    expect(harness.requests).toEqual([])
  })
})
