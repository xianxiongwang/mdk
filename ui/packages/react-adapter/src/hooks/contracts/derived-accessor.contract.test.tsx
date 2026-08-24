/**
 * Contract tests — pass-through hooks that expose a derived accessor.
 *
 * `useFeatureFlags`, `useContainerSettings` and `usePduLayout` return a payload
 * and also a lookup function computed from it (`isEnabled`, `settingsForModel`,
 * `hasPduLayout`). The accessor is the part components actually call, so it is
 * the part that has to keep working across a data-source swap — asserting only
 * the payload would miss it.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useContainerSettings } from '../use-container-settings'
import { useFeatureFlags } from '../use-feature-flags'
import { usePduLayout } from '../use-pdu-layout'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

describe('useFeatureFlags contract', () => {
  it('exposes the flag map and an isEnabled lookup consistent with it', async () => {
    const harness = createMdkHarness({ respond: { alpha: true, beta: false } })

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.flags).toEqual({ alpha: true, beta: false })
    expect(result.current.isEnabled('alpha')).toBe(true)
    expect(result.current.isEnabled('beta')).toBe(false)
  })

  it('reports unknown flags as disabled rather than undefined', async () => {
    const harness = createMdkHarness({ respond: {} })

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEnabled('nope')).toBe(false)
  })

  it('keeps the accessor callable while signed out', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useFeatureFlags(), { wrapper: harness.Wrapper })

    expect(result.current.flags).toEqual({})
    expect(result.current.isEnabled('alpha')).toBe(false)
    expect(harness.requests).toEqual([])
  })
})

describe('useContainerSettings contract', () => {
  it('exposes the settings rows and a per-model lookup', async () => {
    const harness = createMdkHarness({
      respond: [{ model: 'model-a', foo: 1 }, { model: 'model-b', foo: 2 }],
    })

    const { result } = renderHook(() => useContainerSettings({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.settings).toHaveLength(2)
    expect(result.current.settingsForModel('model-b')).toMatchObject({ foo: 2 })
  })

  it('returns undefined from the lookup for an unknown model', async () => {
    const harness = createMdkHarness({ respond: [{ model: 'model-a' }] })

    const { result } = renderHook(() => useContainerSettings({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.settingsForModel('missing')).toBeUndefined()
  })

  it('keeps the lookup callable with no data', () => {
    const harness = createMdkHarness({ token: null })

    const { result } = renderHook(() => useContainerSettings({ refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.settings).toEqual([])
    expect(result.current.settingsForModel('model-a')).toBeUndefined()
  })
})

describe('usePduLayout contract', () => {
  const PARAMS = { type: 'container-type-a' }

  it('exposes the layout and a hasPduLayout flag derived from it', async () => {
    // Response is the `{ type, layout }` envelope, not a bare array.
    const harness = createMdkHarness({
      respond: { type: PARAMS.type, layout: [{ socket: 1 }, { socket: 2 }] },
    })

    const { result } = renderHook(() => usePduLayout(PARAMS, { refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.layout).toHaveLength(2)
    expect(result.current.hasPduLayout).toBe(true)
  })

  it('reports hasPduLayout false when no layout is provisioned', async () => {
    const harness = createMdkHarness({ respond: { type: PARAMS.type, layout: [] } })

    const { result } = renderHook(() => usePduLayout(PARAMS, { refetchInterval: 0 }), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.layout).toEqual([])
    expect(result.current.hasPduLayout).toBe(false)
  })
})
