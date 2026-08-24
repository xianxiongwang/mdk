/**
 * Contract test — `useCabinetGroups`.
 *
 * A composite hook (derives from `useExplorerList`, issues no query of its own)
 * and also a payload-changing one: `CabinetGroup.devices` carries the row type
 * that the injectable data source generalises. Pinned: the grouping rule, the
 * site-group fallback and its ordering, and empty-state stability.
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useCabinetGroups } from '../use-cabinet-groups'

afterEach(() => {
  vi.unstubAllGlobals()
  authStore.getState().reset()
})

const OPTS = { refetchInterval: 0 } as const

describe('useCabinetGroups contract', () => {
  it('groups devices by their owning container', async () => {
    const harness = createMdkHarness({
      respond: [[
        { id: 'pm-1', info: { container: 'cont-a' } },
        { id: 'pm-2', info: { container: 'cont-b' } },
        { id: 'pm-3', info: { container: 'cont-a' } },
      ]],
    })

    const { result } = renderHook(() => useCabinetGroups(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const byContainer = Object.fromEntries(
      result.current.groups.map((g) => [g.container, g.devices.map((d) => d.id)]),
    )
    expect(byContainer['cont-a']).toEqual(['pm-1', 'pm-3'])
    expect(byContainer['cont-b']).toEqual(['pm-2'])
  })

  it('collects unassigned devices under the site group and sorts it last', async () => {
    const harness = createMdkHarness({
      respond: [[
        { id: 'meter-site' },
        { id: 'pm-1', info: { container: 'cont-a' } },
      ]],
    })

    const { result } = renderHook(() => useCabinetGroups(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.groups.at(-1)?.container).toBe('site')
    expect(result.current.groups.at(-1)?.devices.map((d) => d.id)).toEqual(['meter-site'])
  })

  it('returns an empty group list when there are no devices', async () => {
    const harness = createMdkHarness({ respond: [] })

    const { result } = renderHook(() => useCabinetGroups(OPTS), { wrapper: harness.Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.groups).toEqual([])
    expect(typeof result.current.refetch).toBe('function')
  })
})
