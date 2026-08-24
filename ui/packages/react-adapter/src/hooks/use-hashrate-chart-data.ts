import { type ChartCardData, type ChartDataset, type HashRateLogEntry, type MinerpoolStatsHistoryEntry, type TailLogEntry, WEBAPP_SHORT_NAME } from '@tetherto/mdk-ui-foundation'
import { extDataQuery, tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { buildHashrateTailLogParams, buildMinerpoolStatsHistoryExtDataParams, type DashboardQueryRange, readHashrateMhs } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { buildAscDedupedPoints, computeMinMaxAvg, lastY } from './chart-points'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

/* Unit conventions:
 * - Tail-log (miner) emits hashrate in MH/s; 1 PH/s = 1e9 MH/s.
 * - Pool API emits hashrate in raw H/s; 1 PH/s = 1e15 H/s. */
const MH_PER_PHS = 1_000_000_000
const HS_PER_PHS = 1_000_000_000_000_000

/* Colour palette mirrors the reference app's hashrate chart legend so consumers
 * see the same lines in the same hues across both apps. */
const APP_COLOR = '#f7931a'
const AGGR_POOL_COLOR = '#22afff'
const POOL_COLORS: Record<string, string> = {
  f2pool: '#8b5cf6',
  ocean: '#ff3b30',
}
const FALLBACK_POOL_COLORS = ['#34c759', '#ffd700', '#ff85a1', '#6ee7b7']

const APP_LABEL = `${WEBAPP_SHORT_NAME} Hash Rate`
const AGGR_POOL_LABEL = 'Aggr Pool Hash Rate'
const POOL_LABEL_SUFFIX = ' Hash Rate'

const formatPhs = (value: number): string => `${value.toFixed(2)} PH/s`

const titleCasePool = (poolType: string): string => {
  if (poolType.length === 0) return poolType
  return poolType.charAt(0).toUpperCase() + poolType.slice(1)
}

const colorForPool = (poolType: string, fallbackIndex: number): string => {
  return POOL_COLORS[poolType] ?? FALLBACK_POOL_COLORS[fallbackIndex % FALLBACK_POOL_COLORS.length]!
}

const buildAggrPoolPoints = (
  entries: readonly MinerpoolStatsHistoryEntry[],
): Array<{ x: number; y: number | null }> =>
  buildAscDedupedPoints(entries, (entry) => {
    const stats = entry.stats
    if (!Array.isArray(stats) || stats.length === 0) return null
    let total = 0
    let any = false
    for (const pool of stats) {
      if (typeof pool.hashrate === 'number') {
        total += pool.hashrate
        any = true
      }
    }
    return any ? total / HS_PER_PHS : null
  })

const buildPerPoolDatasets = (entries: readonly MinerpoolStatsHistoryEntry[]): ChartDataset[] => {
  /* Group entries by poolType. Each group becomes one dataset. */
  const grouped = new Map<string, Array<{ ts: number; hashrate: number }>>()
  for (const entry of entries) {
    const ts = Number(entry.ts)
    if (!Number.isFinite(ts)) continue
    const stats = Array.isArray(entry.stats) ? entry.stats : []
    for (const pool of stats) {
      const poolType = pool.poolType
      const hashrate = pool.hashrate
      if (typeof poolType !== 'string' || poolType.length === 0) continue
      if (typeof hashrate !== 'number') continue
      const bucket = grouped.get(poolType) ?? []
      bucket.push({ ts, hashrate })
      if (!grouped.has(poolType)) grouped.set(poolType, bucket)
    }
  }

  /* Stable, alphabetical order so the legend is deterministic across
   * refetches and fallback colours land on the same pools. */
  const poolTypes = Array.from(grouped.keys()).sort()
  return poolTypes.map((poolType, index) => {
    const samples = grouped.get(poolType)!
    const points = buildAscDedupedPoints(samples, (entry) => entry.hashrate / HS_PER_PHS)
    return {
      label: `${titleCasePool(poolType)}${POOL_LABEL_SUFFIX}`,
      borderColor: colorForPool(poolType, index),
      data: points,
    }
  })
}

export type UseHashrateChartDataParams = DashboardQueryRange & {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
}

export type HashrateChartResult = {
  /** Chart-ready payload — assign directly to `<LineChartCard data={...} />`. */
  data: ChartCardData | undefined
  isLoading: boolean
}

/**
 * Multi-series hashrate chart data — the app-side series (miner tail-log) plus
 * an `Aggr Pool` rollup and one line per individual pool (drawn from
 * the paginated `type=minerpool, key=stats-history` ext-data feed).
 *
 * Both upstream calls share the page's `{ timeline, start, end }`
 * inputs; results are merged into a single `ChartCardData` payload so
 * the dashboard page stays pure presentation. Each pool gets a
 * deterministic colour from the reference-app-mirrored palette.
 *
 * @remarks
 * The miner series' `/auth/tail-log` endpoint is illustrative — no built-in
 * plugin mounts it over HTTP. No reference implementation ships in this
 * repo. The pool series' `/auth/ext-data` route is also not served by the
 * three built-in plugins (`telemetry`, `site-hashrate`, `site-monitor`); a
 * generic route ships in `@tetherto/mdk-plugin-auth`, but see
 * [the bundled auth plugin](https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#the-bundled-auth-plugin)
 * for why it throws rather than runs. Bring your own
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) for
 * each.
 *
 * @category dashboard
 */
export const useHashrateChartData = (params: UseHashrateChartDataParams): HashrateChartResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const minerFactory = tailLogQuery(queryClient, buildHashrateTailLogParams(params))
  const poolHistoryFactory = extDataQuery<MinerpoolStatsHistoryEntry>(
    queryClient,
    buildMinerpoolStatsHistoryExtDataParams({ start: params.start, end: params.end }),
  )

  const results = useQueries({
    queries: [
      {
        ...minerFactory,
        enabled: params.enabled ?? !!token,
        refetchInterval: params.refetchInterval ?? 60_000,
        /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
        select: (raw: HashRateLogEntry[][] | TailLogEntry[][]) =>
          headOrEmpty<HashRateLogEntry>(raw as HashRateLogEntry[][]),
      },
      {
        ...poolHistoryFactory,
        enabled: params.enabled ?? !!token,
        refetchInterval: params.refetchInterval ?? 60_000,
        /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
        select: (raw: MinerpoolStatsHistoryEntry[][]) =>
          headOrEmpty<MinerpoolStatsHistoryEntry>(raw),
      },
    ],
  })

  const minerQuery = results[0]
  const poolQuery = results[1]

  const chartData = useMemo<ChartCardData | undefined>(() => {
    const minerEntries = minerQuery.data
    const poolEntries = poolQuery.data
    if (minerEntries === undefined && poolEntries === undefined) return undefined

    const datasets: ChartDataset[] = []

    /* App-side series — derived from the miner tail-log aggregate. */
    const appPoints = buildAscDedupedPoints(minerEntries ?? [], (entry) => {
      const mhs = readHashrateMhs(entry as HashRateLogEntry)
      return mhs === undefined ? null : mhs / MH_PER_PHS
    })
    datasets.push({
      label: APP_LABEL,
      borderColor: APP_COLOR,
      data: appPoints,
    })

    /* Aggr Pool — sum of every pool's hashrate at each timestamp. */
    if (Array.isArray(poolEntries) && poolEntries.length > 0) {
      const aggrPoints = buildAggrPoolPoints(poolEntries)
      datasets.push({
        label: AGGR_POOL_LABEL,
        borderColor: AGGR_POOL_COLOR,
        data: aggrPoints,
      })
      /* Per-pool series, alphabetical for legend stability. */
      datasets.push(...buildPerPoolDatasets(poolEntries))
    }

    /* The app-side series drives the highlighted value + min/max/avg — it's
     * the canonical "site hashrate" figure. */
    const latest = lastY(appPoints)
    return {
      datasets,
      yTicksFormatter: formatPhs,
      priceFormatter: formatPhs,
      highlightedValue: latest == null ? undefined : { value: latest.toFixed(3), unit: 'PH/s' },
      minMaxAvg: computeMinMaxAvg(appPoints, formatPhs),
    }
  }, [minerQuery.data, poolQuery.data])

  return {
    data: chartData,
    isLoading: minerQuery.isLoading || poolQuery.isLoading,
  }
}
