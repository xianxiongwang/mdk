/**
 * Contract test — `useCancelAction`.
 *
 * Representative of the mutation group, whose envelope is
 * `{ <verb>, can<Verb>, is<Verb>ing, error }`. Pinned: the verb resolves, the
 * permission flag is derived from the session rather than hard-coded, and the
 * pending flag transitions. The request shape (`DELETE …/cancel?ids=…`) belongs
 * in the mining-conformance spec, not here.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useCancelAction } from '../use-cancel-action'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

describe('useCancelAction contract', () => {
  it('exposes the mutation envelope', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    expect(typeof result.current.cancel).toBe('function')
    expect(typeof result.current.canCancel).toBe('boolean')
    expect(result.current.isCancelling).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('denies the write when the session carries no matching permission', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    // `permissions` is unset, so the gate must fail closed. Note this is also
    // the *only* state a real app reaches today: nothing in the frontend ever
    // calls `setPermissions`, so every write gate resolves `false` until the
    // host populates it. Wiring that is part of the pluggable auth provider.
    expect(result.current.canCancel).toBe(false)
  })

  it('grants the write when the session carries the actions permission', () => {
    const harness = createMdkHarness()
    // `AuthConfig` shape — a permission string list, graded `r` / `w` / `rw`.
    authStore.getState().setPermissions({ permissions: ['actions:rw'] })

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    expect(result.current.canCancel).toBe(true)
  })

  it('honours superAdmin without an explicit permission entry', () => {
    const harness = createMdkHarness()
    authStore.getState().setPermissions({ superAdmin: true })

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    expect(result.current.canCancel).toBe(true)
  })

  it('resolves the cancel call and clears the pending flag', async () => {
    const harness = createMdkHarness({ respond: { ok: true } })

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    await result.current.cancel({ ids: [1, 2] })

    await waitFor(() => expect(result.current.isCancelling).toBe(false))
    expect(harness.requests).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a failure on `error` instead of throwing out of the hook', async () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useCancelAction(), { wrapper: harness.Wrapper })

    // No `respond`, so the transport rejects — the hook must capture it.
    await expect(result.current.cancel({ ids: [1] })).rejects.toThrow()
    await waitFor(() => expect(result.current.error).toBeTruthy())
  })
})
