/**
 * Every read hook must stay quiet while signed out.
 *
 * An ungated read fires the moment it mounts. Without a token the backend answers
 * 401, and the QueryClient's session guard reads that as "the session ended" and
 * clears `authStore` — so a dashboard mounted before sign-in could bounce a user
 * who was midway through signing in. These twelve hooks had no `enabled` gate at
 * all; the other twenty-seven always did.
 *
 * The assertion is deliberately about the transport, not about `enabled`: a hook
 * could grow a different gating mechanism and still satisfy the contract, which
 * is "makes no request without a session".
 */

import { authStore } from '@tetherto/mdk-ui-foundation'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMdkHarness } from '@/test-utils/mdk-harness'
import { useActiveIncidents } from '../use-active-incidents'
import { useConsumptionChartData } from '../use-consumption-chart-data'
import { useHashrateChartData } from '../use-hashrate-chart-data'
import { usePoolRows } from '../use-pool-rows'
import { usePoolStats } from '../use-pool-stats'
import { usePowerModeTimelineData } from '../use-power-mode-timeline-data'
import { useSiteConsumptionChartData } from '../use-site-consumption-chart-data'
import { useSiteContainerCapacity } from '../use-site-container-capacity'
import { useSiteHashrate } from '../use-site-hashrate'
import { useSiteMinerCounts } from '../use-site-miner-counts'
import { useSiteMinerStats } from '../use-site-miner-stats'
import { useSitePowerMeter } from '../use-site-power-meter'

/* The range-taking hooks need a window; the value is irrelevant to gating. */
const RANGE = { timeline: '1h', start: 1_000, end: 2_000 } as const

/** Only `enabled` is ever passed; typed loosely so one table covers both shapes. */
type GateOptions = { enabled?: boolean }

/**
 * `[name, render]`, where every render threads its options through to the hook.
 * Threading matters: a table of zero-arg closures would make the `enabled: false`
 * case below pass without the flag ever reaching the hook.
 */
const GATED_READS: Array<[string, (options: GateOptions) => unknown]> = [
  ['useActiveIncidents', (o) => useActiveIncidents(o)],
  ['useConsumptionChartData', (o) => useConsumptionChartData({ ...RANGE, ...o })],
  ['useHashrateChartData', (o) => useHashrateChartData({ ...RANGE, ...o })],
  ['usePoolRows', (o) => usePoolRows(o)],
  ['usePoolStats', (o) => usePoolStats(o)],
  ['usePowerModeTimelineData', (o) => usePowerModeTimelineData({ ...RANGE, ...o })],
  ['useSiteConsumptionChartData', (o) => useSiteConsumptionChartData({ ...RANGE, ...o })],
  ['useSiteContainerCapacity', (o) => useSiteContainerCapacity(o)],
  ['useSiteHashrate', (o) => useSiteHashrate({ ...RANGE, ...o })],
  ['useSiteMinerCounts', (o) => useSiteMinerCounts(o)],
  ['useSiteMinerStats', (o) => useSiteMinerStats(o)],
  ['useSitePowerMeter', (o) => useSitePowerMeter(o)],
]

/* Long enough that an ungated query would have reached the transport — these
 * hooks fetch on mount, so there is no interval to wait out. */
const SETTLE_MS = 50

describe('read hooks are gated on a session', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    authStore.getState().reset()
  })

  describe('signed out', () => {
    for (const [name, render] of GATED_READS) {
      it(`${name} issues no request`, async () => {
        const harness = createMdkHarness({ token: null, respond: {} })

        renderHook(() => render({}), { wrapper: harness.Wrapper })
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

        expect(harness.requests).toEqual([])
      })
    }
  })

  describe('signed in', () => {
    for (const [name, render] of GATED_READS) {
      it(`${name} issues its request`, async () => {
        const harness = createMdkHarness({ token: 'test-token', respond: {} })

        renderHook(() => render({}), { wrapper: harness.Wrapper })

        await waitFor(() => expect(harness.requests.length).toBeGreaterThan(0), {
          timeout: 1_000,
        })
      })
    }
  })

  describe('explicit enabled', () => {
    for (const [name, render] of GATED_READS) {
      it(`${name} stays quiet when the caller disables it despite a token`, async () => {
        const harness = createMdkHarness({ token: 'test-token', respond: {} })

        /* `enabled: false` has to beat the token, not merely default from it —
         * a page that knows its params are not ready yet relies on this. */
        renderHook(() => render({ enabled: false }), { wrapper: harness.Wrapper })
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

        expect(harness.requests).toEqual([])
      })
    }
  })
})
