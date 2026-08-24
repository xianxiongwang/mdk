/**
 * Contract tests — the thin pass-through hook family.
 *
 * These hooks are structurally identical: spread a factory into `useQuery`, gate
 * on the token, unwrap trivially, and return
 * `{ <key>: T[], isLoading, error, refetch }`. Twenty-one of them share that
 * shape, so the shared envelope is asserted once, table-driven, rather than
 * copy-pasted into a file per hook. That makes the family's contract explicit
 * and means a hook that silently drifts out of the family fails here.
 *
 * Hooks in the family with an extra derived accessor (`useFeatureFlags`,
 * `useContainerSettings`, `usePduLayout`) or a non-array payload (`useSite`,
 * `useSiteStatusLive`) get their own file, because that part is not shared.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useContainerPoolStats } from '../use-container-pool-stats'
import { usePendingActions } from '../use-pending-actions'
import { usePoolConfigsData } from '../use-pool-configs-data'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

/**
 * Each entry: the hook, the row array it exposes, and a representative flat
 * backend payload.
 *
 * This table used to carry a `guardsNonArray` flag per hook, because only
 * `usePendingActions` did `Array.isArray(data) ? data : []` while the other two
 * did `data ?? []`. All three now guard, so the flag is gone and the behaviour
 * is asserted uniformly below.
 */
const FAMILY = [
  {
    name: 'useContainerPoolStats',
    render: () => useContainerPoolStats(OPTS),
    payload: [{ containerId: 'c-1', overrides: 2 }, { containerId: 'c-2', overrides: 0 }],
    rows: (r: { data: unknown[] }) => r.data,
  },
  {
    name: 'usePoolConfigsData',
    render: () => usePoolConfigsData(OPTS),
    payload: [{ name: 'pool-a' }, { name: 'pool-b' }],
    rows: (r: { data: unknown[] }) => r.data,
  },
  {
    name: 'usePendingActions',
    render: () => usePendingActions(OPTS),
    payload: [{ id: 1 }, { id: 2 }],
    rows: (r: { data: unknown[] }) => r.data,
  },
] as const

describe.each(FAMILY)('$name contract', ({ render, payload, rows }) => {
  it('returns the backend rows and reads exactly one resource', async () => {
    const harness = createMdkHarness({ respond: payload })

    const { result } = renderHook(render, { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(rows(result.current as never)).toHaveLength(2)
    expect(harness.requests).toHaveLength(1)
  })

  it('defaults to an empty array rather than undefined', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(render, { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(rows(result.current as never)).toEqual([])
  })

  it('coerces a non-array payload to an empty array', async () => {
    const harness = createMdkHarness({ respond: { unexpected: true } })

    const { result } = renderHook(render, { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // `data ?? []` used to let an object through under a key typed as a row
    // array, so a component mapping over it threw. Two of these three hooks had
    // that hole; all three now guard with `Array.isArray`.
    expect(rows(result.current as never)).toEqual([])
  })

  it('exposes error and refetch, and stays idle while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(render, { wrapper: harness.Wrapper })

    expect(rows(result.current as never)).toEqual([])
    expect(result.current.error).toBeNull()
    expect(typeof result.current.refetch).toBe('function')
    expect(harness.requests).toEqual([])
  })
})
