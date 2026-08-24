/**
 * Contract test — `useCabinetDevices`.
 *
 * Payload-changing hook, and one of the two that had no spec at all before this
 * pass. Pinned: envelope flattening, the empty-`root` gate, and empty-state
 * stability.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useCabinetDevices } from '../use-cabinet-devices'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useCabinetDevices contract', () => {
  it('flattens the cabinet family across every responding node', async () => {
    const harness = createMdkHarness({
      respond: [[{ id: 'pm-1' }], [{ id: 'sensor-1' }]],
    })

    const { result } = renderHook(() => useCabinetDevices('lv-1', OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.devices.map((d) => d.id)).toEqual(['pm-1', 'sensor-1'])
  })

  it('does not read anything for an empty root', () => {
    const harness = createMdkHarness()

    const { result } = renderHook(() => useCabinetDevices('', OPTS), {
      wrapper: harness.Wrapper,
    })

    expect(result.current.devices).toEqual([])
    expect(harness.requests).toEqual([])
  })

  it('returns an empty device array for an empty envelope', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(() => useCabinetDevices('lv-1', OPTS), {
      wrapper: harness.Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.devices).toEqual([])
    expect(typeof result.current.refetch).toBe('function')
  })
})
