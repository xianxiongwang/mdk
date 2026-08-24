import type { ChartCardData, TailLogEntry } from '@tetherto/mdk-ui-foundation'
import { tailLogQuery } from '@tetherto/mdk-ui-foundation/presets/mining'
import { buildSiteConsumptionTailLogParams, type DashboardQueryRange } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { buildAscDedupedPoints, computeMinMaxAvg, lastY } from './chart-points'
import { headOrEmpty } from './list-things-utils'
import { useAuthToken } from './use-auth-token'

const W_PER_MW = 1_000_000
/* lightweight-charts parses concrete CSS colours only — `var(...)`
 * is rejected by its `colorStringToRgba`. Mirror the value of
 * `--mdk-color-primary` from `_colors.scss`. */
const PRIMARY_LINE_COLOR = '#f7931a'
const DATASET_LABEL = 'Total Consumption'

const formatMw = (value: number): string => `${value.toFixed(2)} MW`

export type UseSiteConsumptionChartDataParams = DashboardQueryRange & {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
}

export type SiteConsumptionChartResult = {
  /** Chart-ready payload — assign directly to `<LineChartCard data={...} />`. */
  data: ChartCardData | undefined
  isLoading: boolean
}

/**
 * Site-level power consumption time-series, shaped for
 * `<LineChartCard />`. Reads `site_power_w` from the
 * `t-powermeter`-tagged tail-log (same source the header's
 * `useSitePowerMeter` snapshot uses), converts W → MW, and emits
 * `highlightedValue` + `minMaxAvg`. Mirrors the reference app's `Power Consumption`
 * card query verbatim: `type=powermeter, tag=t-powermeter,
 * aggrFields={site_power_w:1}`.
 *
 * @remarks
 * The `/auth/tail-log` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic.
 *
 * @category dashboard
 */
export const useSiteConsumptionChartData = (
  params: UseSiteConsumptionChartDataParams,
): SiteConsumptionChartResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = tailLogQuery(queryClient, buildSiteConsumptionTailLogParams(params))

  const { data, isLoading } = useQuery({
    ...factory,
    enabled: params.enabled ?? !!token,
    refetchInterval: params.refetchInterval ?? 60_000,
    /* single-Kernel assumption: one node's series. See list-things-utils.ts. */
    select: (raw: TailLogEntry[][]) => headOrEmpty<TailLogEntry>(raw),
  })

  const chartData = useMemo<ChartCardData | undefined>(() => {
    if (data === undefined) return undefined
    const points = buildAscDedupedPoints(data, (entry) => {
      const watts = entry.site_power_w
      return typeof watts === 'number' ? watts / W_PER_MW : null
    })
    const latest = lastY(points)
    return {
      datasets: [{ label: DATASET_LABEL, borderColor: PRIMARY_LINE_COLOR, data: points }],
      yTicksFormatter: formatMw,
      priceFormatter: formatMw,
      highlightedValue: latest == null ? undefined : { value: latest.toFixed(2), unit: 'MW' },
      minMaxAvg: computeMinMaxAvg(points, formatMw),
    }
  }, [data])

  return { data: chartData, isLoading }
}
