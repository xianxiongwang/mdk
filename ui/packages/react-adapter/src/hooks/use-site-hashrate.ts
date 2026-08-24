import { getLatestSample, type HashRateLogEntry } from '@tetherto/mdk-ui-foundation'
import { tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { buildHashrateTailLogParams, type DashboardQueryRange, readHashrateMhs } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

const MHS_PER_PHS = 1_000_000_000

export type SiteHashrate = {
  /** Latest aggregate value in PH/s. `undefined` while loading or with no data. */
  valuePhs: number | undefined
  /** Latest aggregate value in MH/s (raw backend unit). */
  valueMhs: number | undefined
  isLoading: boolean
}

export type UseSiteHashrateParams = DashboardQueryRange & {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
}

/**
 * Projects the freshest hashrate sample from the dashboard's tail-log
 * query. Shares the TanStack queryKey with
 * {@link useHashrateChartData}, so subscribing here does NOT trigger an
 * extra fetch — both hooks read the same cache entry.
 *
 * Use this for the header stats strip (`<HeaderHashrateBox />`).
 *
 * @remarks
 * The `/auth/tail-log` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic.
 *
 * @category dashboard
 */
export const useSiteHashrate = (params: UseSiteHashrateParams): SiteHashrate => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = tailLogQuery(queryClient, buildHashrateTailLogParams(params))

  const { data, isLoading } = useQuery({
    ...factory,
    enabled: params.enabled ?? !!token,
    refetchInterval: params.refetchInterval ?? 60_000,
    /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
    select: (raw: HashRateLogEntry[][]) => headOrEmpty<HashRateLogEntry>(raw),
  })

  const latest = getLatestSample<HashRateLogEntry>(data ?? undefined)
  const mhs = latest ? readHashrateMhs(latest) : undefined

  return {
    valuePhs: mhs === undefined ? undefined : mhs / MHS_PER_PHS,
    valueMhs: mhs,
    isLoading,
  }
}
