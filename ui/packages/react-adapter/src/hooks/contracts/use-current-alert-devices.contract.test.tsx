/**
 * Contract test — `useCurrentAlertDevices`.
 *
 * The hardest payload case in the adapter: this hook returns the raw
 * `UseQueryResult<ListThingsDevice[][]>` — the per-node envelope, unshaped, by
 * design ("the table heads the outer array itself"). Both the envelope nesting
 * and the raw `UseQueryResult` surface are pinned here, because the injectable
 * data source flattens the payload to a generic row array and that change must
 * be a deliberate, visible break rather than a silent one.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useCurrentAlertDevices } from '../use-current-alert-devices'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useCurrentAlertDevices contract', () => {
  it('returns a flat row list, not the per-node envelope', async () => {
    const harness = createMdkHarness({
      respond: [[{ id: 'a' }, { id: 'b' }]],
    })

    const { result } = renderHook(() => useCurrentAlertDevices(OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Used to assert `[[{ id: 'a' }, { id: 'b' }]]` — two levels deep, with the
    // devkit table heading the outer array. That pushed the Gateway envelope
    // into a component prop type; unwrapping belongs here.
    expect(result.current.data).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('keeps rows from every responding node', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'a' }], [{ id: 'b' }]] })

    const { result } = renderHook(() => useCurrentAlertDevices(OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('exposes the full TanStack result surface, not a narrowed envelope', async () => {
    const harness = createMdkHarness({ respond: [[]] })

    const { result } = renderHook(() => useCurrentAlertDevices(OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current).toMatchObject({
      isLoading: expect.any(Boolean),
      isFetching: expect.any(Boolean),
      isSuccess: true,
    })
    expect(typeof result.current.refetch).toBe('function')
  })

  it('leaves data undefined while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useCurrentAlertDevices(OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.data).toBeUndefined()
    expect(harness.requests).toEqual([])
  })
})
