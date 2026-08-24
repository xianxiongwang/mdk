import type { TailLogEntry } from '@tetherto/mdk-ui-foundation'
import { tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

export type UseConsumptionChartDataParams = {
  /** Stat key suffix — e.g. '1m', '5m', '3h'. */
  timeline: string
  /** Lower bound of the time window (ms epoch). */
  start?: number
  /** Upper bound of the time window (ms epoch). */
  end?: number
  /** Thing tag — defaults to `t-miner`. Use `t-powermeter` for transformer-level consumption. */
  tag?: string
  /** Aggregate field name — defaults to `power_w_sum_aggr` (miner-level). */
  powerAttribute?: string
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 60s. */
  refetchInterval?: number
}

/**
 * TanStack Query hook returning raw consumption tail-log samples. Most
 * dashboards should consume the higher-level `useSiteConsumptionChartData`,
 * which wraps this hook with the site powermeter defaults and returns a
 * `<LineChartCard>`-ready `ChartCardData` payload.
 *
 * @remarks
 * The `/auth/tail-log` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/tail-log`
 * ships in this repo.
 *
 * @category dashboard
 */
export const useConsumptionChartData = (
  params: UseConsumptionChartDataParams,
): UseQueryResult<TailLogEntry[], Error> => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const powerAttribute = params.powerAttribute ?? 'power_w_sum_aggr'
  const factory = tailLogQuery(queryClient, {
    key: `stat-${params.timeline}`,
    type: 'miner',
    tag: params.tag ?? 't-miner',
    aggrFields: JSON.stringify({ [powerAttribute]: 1 }),
    start: params.start,
    end: params.end,
  })

  return useQuery({
    ...factory,
    enabled: params.enabled ?? !!token,
    refetchInterval: params.refetchInterval ?? 60_000,
    /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
    select: (raw) => headOrEmpty<TailLogEntry>(raw),
  })
}
