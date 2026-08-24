import type { PowerModeTimelineEntry } from '@tetherto/mdk-ui-foundation'
import { tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

const POWER_MODE_AGGR_FIELDS = JSON.stringify({
  power_mode_group_aggr: 1,
  status_group_aggr: 1,
})

export type UsePowerModeTimelineDataParams = {
  timeline: string
  start?: number
  end?: number
  tag?: string
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  refetchInterval?: number
}

/**
 * TanStack Query hook returning power-mode/status samples shaped for
 * `<PowerModeTimelineChart data={...} />`.
 *
 * @remarks
 * The `/auth/tail-log` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic.
 *
 * @category dashboard
 */
export const usePowerModeTimelineData = (
  params: UsePowerModeTimelineDataParams,
): UseQueryResult<PowerModeTimelineEntry[], Error> => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = tailLogQuery(queryClient, {
    key: `stat-${params.timeline}`,
    type: 'miner',
    tag: params.tag ?? 't-miner',
    aggrFields: POWER_MODE_AGGR_FIELDS,
    start: params.start,
    end: params.end,
  })

  return useQuery({
    ...factory,
    enabled: params.enabled ?? !!token,
    refetchInterval: params.refetchInterval ?? 60_000,
    /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
    select: (raw) => headOrEmpty<PowerModeTimelineEntry>(raw),
  })
}
