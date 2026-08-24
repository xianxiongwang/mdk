/**
 * Contract tests — hooks that project a scalar or object out of a response.
 *
 * `useSite`, `useCurrentUserEmail`, `useSiteStatusLive` and `useMiners` do not
 * return row arrays, so the pass-through family's envelope assertions don't
 * apply. What matters here is the projection rule: which field wins, what the
 * absent case looks like, and how the pagination envelope is unwrapped.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useCurrentUserEmail } from '../use-current-user-email'
import { useMiners } from '../use-miners'
import { useSite } from '../use-site'
import { useSiteStatusLive } from '../use-site-status-live'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useSite contract', () => {
  it('projects the site label out of the response', async () => {
    const harness = createMdkHarness({ respond: { site: 'Site A' } })

    const { result } = renderHook(() => useSite(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.site).toBe('Site A')
  })

  it('leaves the label undefined when the response omits it', async () => {
    const harness = createMdkHarness({ respond: {} })

    const { result } = renderHook(() => useSite(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.site).toBeUndefined()
  })
})

describe('useCurrentUserEmail contract', () => {
  it('returns the email as a bare scalar, not an envelope', async () => {
    const harness = createMdkHarness({ respond: { email: 'someone@example.test' } })

    const { result } = renderHook(() => useCurrentUserEmail(), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current).toBe('someone@example.test'))
  })

  it('prefers metadata.email over the top-level email', async () => {
    const harness = createMdkHarness({
      respond: { email: 'top@example.test', metadata: { email: 'meta@example.test' } },
    })

    const { result } = renderHook(() => useCurrentUserEmail(), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current).toBe('meta@example.test'))
  })

  it('is undefined while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useCurrentUserEmail(), { wrapper: harness.Wrapper })

    expect(result.current).toBeUndefined()
    expect(harness.requests).toEqual([])
  })
})

describe('useSiteStatusLive contract', () => {
  it('passes the composite snapshot through untouched', async () => {
    const snapshot = { hashrate: 1, power: 2, efficiency: 3, miners: 4, alerts: 5, ts: 6 }
    const harness = createMdkHarness({ respond: snapshot })

    const { result } = renderHook(() => useSiteStatusLive(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual(snapshot)
  })

  it('leaves data undefined rather than substituting an empty object', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useSiteStatusLive(OPTS), { wrapper: harness.Wrapper })

    expect(result.current.data).toBeUndefined()
  })
})

describe('useMiners contract', () => {
  it('unwraps the paginated envelope into rows plus a site-wide total', async () => {
    const harness = createMdkHarness({
      respond: { data: [{ id: 'm1' }, { id: 'm2' }], totalCount: 57 },
    })

    const { result } = renderHook(() => useMiners(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    // The total is the site-wide count, not the page length.
    expect(result.current.totalCount).toBe(57)
  })

  it('accepts a bare array response and derives the total from its length', async () => {
    const harness = createMdkHarness({ respond: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] })

    const { result } = renderHook(() => useMiners(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(3)
    expect(result.current.totalCount).toBe(3)
  })

  it('falls back to the page length when the envelope omits totalCount', async () => {
    const harness = createMdkHarness({ respond: { data: [{ id: 'm1' }] } })

    const { result } = renderHook(() => useMiners(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.totalCount).toBe(1)
  })

  it('reports zero rows and zero total while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useMiners(OPTS), { wrapper: harness.Wrapper })

    expect(result.current.data).toEqual([])
    expect(result.current.totalCount).toBe(0)
    expect(harness.requests).toEqual([])
  })
})
