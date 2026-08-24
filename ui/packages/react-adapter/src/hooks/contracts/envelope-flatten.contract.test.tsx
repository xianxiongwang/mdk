/**
 * Contract tests — remaining per-node envelope readers.
 *
 * `useRackLayout` and `useContainerUnits` both read a `T[][]` per-node envelope
 * but disagree on how: one flattens across every node, the other heads it. Both
 * behaviours are pinned, because the disagreement is invisible in a single-node
 * deployment and silently loses rows in a sharded one.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useContainerUnits } from '../use-container-units'
import { useRackLayout } from '../use-rack-layout'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useRackLayout contract', () => {
  it('flattens racks across every responding node', async () => {
    const harness = createMdkHarness({ respond: [[{ rack: 'r1' }], [{ rack: 'r2' }]] })

    const { result } = renderHook(() => useRackLayout({ type: 'container' }, OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.racks.map((r) => r.rack)).toEqual(['r1', 'r2'])
  })

  it('does not read anything without a worker type', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useRackLayout({ type: '' }, OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.racks).toEqual([])
    // The backend 400s on a missing `type`, so the hook must not ask at all.
    expect(harness.requests).toEqual([])
  })

  it('returns an empty rack list for an empty envelope', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(() => useRackLayout({ type: 'miner' }, OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.racks).toEqual([])
    expect(typeof result.current.refetch).toBe('function')
  })
})

describe('useContainerUnits contract', () => {
  it('returns the container rows', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'c1' }, { id: 'c2' }]] })

    const { result } = renderHook(() => useContainerUnits(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
  })

  it('keeps rows from every responding node', async () => {
    const harness = createMdkHarness({ respond: [[{ id: 'c1' }], [{ id: 'c2' }]] })

    const { result } = renderHook(() => useContainerUnits(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Used to assert `toHaveLength(1)`, pinning a bug: this hook took only
    // `envelope[0]` via `headOrEmpty` while `useRackLayout` above flattened, so
    // a rack-sharded deployment silently lost rows. Both now flatten.
    expect(result.current.data).toHaveLength(2)
  })

  it('defaults to an empty array while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useContainerUnits(OPTS), { wrapper: harness.Wrapper })

    expect(result.current.data).toEqual([])
    expect(harness.requests).toEqual([])
  })
})
