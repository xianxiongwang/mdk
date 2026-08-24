import type { MinerpoolExtDataEntry, PoolMinerStats } from '@tetherto/mdk-ui-foundation'
import { minerpoolStatsQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

/* Pool API reports hashrate in raw H/s (hashes per second). */
const HS_PER_PHS = 1_000_000_000_000_000

export type PoolDetail = {
  title: string
  value?: string | number
}

export type PoolRow = {
  /** Stable React key — derived from poolType. */
  id: string
  /** Display name in the reference app style — `minerpool-{poolType}-shelf-0`. */
  name: string
  /** Raw poolType string (e.g. `f2pool`, `ocean`). */
  poolType: string
  /** 24h revenue in BTC, if reported. */
  revenue24hBtc: number | undefined
  /** Hashrate in raw H/s (backend unit). */
  hashrateHs: number | undefined
  /** Hashrate in PH/s (derived). */
  hashratePhs: number | undefined
  /** Raw per-pool stats blob — useful for ad-hoc consumers. */
  stats: PoolMinerStats
  /** Key/value pairs ready for `<PoolDetailsCard />` inside the popover. */
  details: PoolDetail[]
}

export type UsePoolRowsResult = {
  rows: PoolRow[]
  isLoading: boolean
}

export type UsePoolRowsOptions = {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 120s. Pass 0 to disable. */
  refetchInterval?: number
}

const optionalNumber = (value: unknown): number | string => (typeof value === 'number' ? value : '')

const buildPoolDetails = (poolType: string, name: string, stats: PoolMinerStats): PoolDetail[] => [
  { title: 'Id', value: name },
  { title: 'Rack', value: `minerpool-${poolType}-shelf` },
  { title: 'User name', value: typeof stats.username === 'string' ? stats.username : '' },
  { title: 'Balance', value: optionalNumber(stats.balance) },
  { title: 'Unsettled', value: optionalNumber(stats.unsettled) },
  { title: 'Revenue last 24hrs', value: optionalNumber(stats.revenue_24h) },
  { title: 'Active Worker Count', value: optionalNumber(stats.active_workers_count) },
]

const buildPoolRow = (stats: PoolMinerStats, index: number): PoolRow | null => {
  const poolType = stats.poolType
  if (typeof poolType !== 'string' || poolType.length === 0) return null
  const hashrateHs = typeof stats.hashrate === 'number' ? stats.hashrate : undefined
  const name = `minerpool-${poolType}-shelf-0`
  return {
    id: `${poolType}-${index}`,
    name,
    poolType,
    revenue24hBtc: typeof stats.revenue_24h === 'number' ? stats.revenue_24h : undefined,
    hashrateHs,
    hashratePhs: hashrateHs === undefined ? undefined : hashrateHs / HS_PER_PHS,
    stats,
    details: buildPoolDetails(poolType, name, stats),
  }
}

/**
 * Returns one row per configured mining pool, ready for the
 * `<MiningPoolsPanel />` table. Reuses the same TanStack queryKey as
 * {@link usePoolStats} so subscribing here doesn't trigger an extra
 * fetch — both hooks share the cache entry.
 *
 * Names follow the reference app's "minerpool-`{poolType}`-shelf-0" convention so
 * the rows match what operators see in the production dashboard.
 *
 * @remarks
 * Shares {@link usePoolStats}'s `/auth/ext-data` query — see that hook's
 * `@remarks` for the endpoint's default-wiring and backing-plugin status.
 *
 * @category dashboard
 */
export const usePoolRows = (options: UsePoolRowsOptions = {}): UsePoolRowsResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = minerpoolStatsQuery(queryClient)

  const result: UseQueryResult<MinerpoolExtDataEntry[][], Error> = useQuery({
    ...factory,
    enabled: options.enabled ?? !!token,
    refetchInterval: options.refetchInterval ?? 120_000,
  })

  const rows = useMemo<PoolRow[]>(() => {
    const entries = headOrEmpty<MinerpoolExtDataEntry>(result.data)
    const pools = entries[0]?.stats ?? []
    const out: PoolRow[] = []
    pools.forEach((stats, index) => {
      const row = buildPoolRow(stats, index)
      if (row) out.push(row)
    })
    return out
  }, [result.data])

  return { rows, isLoading: result.isLoading }
}
