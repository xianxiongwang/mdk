import type { AggregatedPool } from '@tetherto/mdk-ui-foundation'
import { poolsQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { POOL_MANAGER_POLL_INTERVAL_MS } from './poll-intervals'
import { useAuthToken } from './use-auth-token'

export type UsePoolsOptions = {
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
}

export type UsePoolsResult = {
  /** Aggregated pool rows (hashrate / workers / balance / revenue). */
  data: AggregatedPool[]
  isLoading: boolean
  error: unknown
  refetch: () => void
}

/**
 * Fetches aggregated pools from `GET /auth/pools` (hashrate / workers /
 * balance / revenue / summary). Feeds the Dashboard pool panel — distinct
 * from `usePoolConfigsData` (`/auth/configs/pool`), which drives the editable
 * Pools list.
 *
 * @remarks
 * The `/auth/pools` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/pools`
 * ships in this repo.
 *
 * @category dashboard
 */
export const usePools = (options: UsePoolsOptions = {}): UsePoolsResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = poolsQuery(queryClient)

  const result = useQuery({
    ...factory,
    refetchInterval: options.refetchInterval ?? POOL_MANAGER_POLL_INTERVAL_MS,
    enabled: options.enabled ?? !!token,
  })

  return {
    // `GET /auth/pools` wraps the rows in `{ pools, summary }`.
    data: result.data?.pools ?? [],
    isLoading: result.isLoading,
    error: result.error,
    refetch: () => void result.refetch(),
  }
}
