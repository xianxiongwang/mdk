import type { ContainerPoolStat } from '@tetherto/mdk-ui-foundation'
import { containerPoolStatsQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { POOL_MANAGER_POLL_INTERVAL_MS } from './poll-intervals'
import { useAuthToken } from './use-auth-token'

export type UseContainerPoolStatsOptions = {
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
}

export type UseContainerPoolStatsResult = {
  /** Per-container override-count rows. */
  data: ContainerPoolStat[]
  isLoading: boolean
  error: unknown
  refetch: () => void
}

/**
 * Fetches per-container pool override counts from
 * `GET /auth/pools/stats/containers`. Feeds the Sites Overview cards.
 *
 * @remarks
 * The `/auth/pools/*` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/pools/*`
 * ships in this repo.
 *
 * @category dashboard
 */
export const useContainerPoolStats = (
  options: UseContainerPoolStatsOptions = {},
): UseContainerPoolStatsResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = containerPoolStatsQuery(queryClient)

  const result = useQuery({
    ...factory,
    refetchInterval: options.refetchInterval ?? POOL_MANAGER_POLL_INTERVAL_MS,
    enabled: options.enabled ?? !!token,
  })

  return {
    /* `?? []` only covers null/undefined — a backend answering with an object
     * or an error envelope would pass straight through to callers that `.map`
     * it. `usePendingActions` already guarded this way. */
    data: Array.isArray(result.data) ? result.data : [],
    isLoading: result.isLoading,
    error: result.error,
    refetch: () => void result.refetch(),
  }
}
