import type { TailLogEntry } from '@tetherto/mdk-ui-foundation'
import { tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthToken } from './use-auth-token'

/* Container nominal capacity changes slowly — the reference app pulls it from the
 * 5-minute tail-log aggregate, not the realtime stream. */
const STAT_KEY = 'stat-5m'
const CONTAINER_AGGR_FIELDS = JSON.stringify({
  container_nominal_miner_capacity_sum_aggr: 1,
})

const headOrUndefined = (value: TailLogEntry[][] | undefined | null): TailLogEntry | undefined => {
  if (!Array.isArray(value)) return undefined
  const first = value[0]
  if (!Array.isArray(first)) return undefined
  return first[0]
}

export type SiteContainerCapacity = {
  /** Total nominal miner slots across all site containers (the "2,188" denominator). */
  value: number | undefined
  isLoading: boolean
}

export type UseSiteContainerCapacityOptions = {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 5min. Pass 0 to disable. */
  refetchInterval?: number
}

/**
 * Reads the aggregated nominal miner capacity across the site's containers
 * — i.e. the maximum number of miners the facility was designed to host.
 * Used as the "denominator" of the `<HeaderMinersBox />` row: e.g. the
 * `2,188` in `158 / 2,188`.
 *
 * @remarks
 * The `/auth/tail-log` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic.
 *
 * @category dashboard
 */
export const useSiteContainerCapacity = (
  options: UseSiteContainerCapacityOptions = {},
): SiteContainerCapacity => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = tailLogQuery(queryClient, {
    key: STAT_KEY,
    type: 'container',
    tag: 't-container',
    limit: 1,
    aggrFields: CONTAINER_AGGR_FIELDS,
  })

  const { data, isLoading } = useQuery({
    ...factory,
    enabled: options.enabled ?? !!token,
    refetchInterval: options.refetchInterval ?? 300_000,
  })

  const entry = headOrUndefined(data)
  const raw = entry?.container_nominal_miner_capacity_sum_aggr
  return {
    value: typeof raw === 'number' ? raw : undefined,
    isLoading,
  }
}
