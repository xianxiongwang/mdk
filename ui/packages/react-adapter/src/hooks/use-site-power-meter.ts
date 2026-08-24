import type { ListThingsDevice } from '@tetherto/mdk-ui-foundation'
import { flattenKernelEnvelope, listThingsQuery  } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthToken } from './use-auth-token'

const SITE_QUERY = JSON.stringify({ 'info.pos': { $eq: 'site' } })
const POWER_FIELDS = JSON.stringify({
  id: 1,
  tags: 1,
  'last.snap.stats.power_w': 1,
})

const W_PER_MW = 1_000_000

/* The reference app filters by `device.tags` (an array of role strings — e.g.
 * `['t-powermeter']`), not by `device.type`. Mirror that or the
 * lookup misses on the same backend payload. */
const filterByTag = (devices: ListThingsDevice[], tag: string): ListThingsDevice[] =>
  devices.filter((d) => Array.isArray(d.tags) && d.tags.includes(tag))

const readPowerW = (device: ListThingsDevice | undefined): number | undefined => {
  if (!device) return undefined
  const stats = (device.last?.snap as { stats?: { power_w?: unknown } } | undefined)?.stats
  const value = stats?.power_w
  return typeof value === 'number' ? value : undefined
}

export type SitePowerMeter = {
  /** Site-level power reading in MW. `undefined` while loading or with no powermeter device. */
  valueMw: number | undefined
  /** Raw site-level reading in watts. */
  valueW: number | undefined
  isLoading: boolean
}

export type UseSitePowerMeterOptions = {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 30s. Pass 0 to disable. */
  refetchInterval?: number
}

/**
 * Site-level power reading for the header's `<HeaderConsumptionBox />`. Reads
 * the freshest snapshot from a `t-powermeter`-tagged thing at `info.pos =
 * 'site'`; falls back to a `t-container`-tagged thing if no powermeter is
 * configured (matches the reference app's `useHeaderStats` fallback chain).
 *
 * Note this is **distinct** from {@link useSiteConsumption}, which sums the
 * per-miner aggregates from tail-log and is appropriate for the chart card's
 * time-series. The site power meter typically reads larger than the miner
 * sum (it includes cooling, ancillary load, etc.).
 *
 * @remarks
 * The `/auth/list-things` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic.
 *
 * @category dashboard
 */
export const useSitePowerMeter = (options: UseSitePowerMeterOptions = {}): SitePowerMeter => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = listThingsQuery(queryClient, {
    status: 1,
    query: SITE_QUERY,
    fields: POWER_FIELDS,
    limit: 100,
  })

  const { data, isLoading } = useQuery({
    ...factory,
    enabled: options.enabled ?? !!token,
    refetchInterval: options.refetchInterval ?? 30_000,
  })

  const devices = flattenKernelEnvelope(data)
  /* Prefer a dedicated powermeter; fall back to container readings only
   * when no powermeter is configured (the reference app's getDeviceDataByType chain).
   * Sum across all matching devices to handle multi-meter sites. */
  const powermeters = filterByTag(devices, 't-powermeter')
  const fallbacks = powermeters.length > 0 ? powermeters : filterByTag(devices, 't-container')
  let totalWatts = 0
  let any = false
  for (const device of fallbacks) {
    const watts = readPowerW(device)
    if (typeof watts === 'number') {
      totalWatts += watts
      any = true
    }
  }
  const watts = any ? totalWatts : undefined

  return {
    valueMw: watts === undefined ? undefined : watts / W_PER_MW,
    valueW: watts,
    isLoading,
  }
}
