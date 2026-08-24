/**
 * The entire integration surface for a non-mining backend.
 *
 * A consumer writes this file — not MDK. It maps one API's response shape onto
 * MDK's component contracts. Nothing here imports from MDK's data layer; it is
 * pure functions over plain objects, which is why it is trivial to test and why
 * swapping the backend means editing only this file.
 *
 * The API it targets is deliberately unlike the mining Gateway: a `page`
 * envelope, `records[]` rather than a per-node array-of-arrays, nested
 * `health.notices[]` instead of `last.alerts[]`, `atMs`/`value` samples, and
 * severities named `warning`/`critical`/`info` on a `level` field.
 */

import type { Alert, Device, LineChartCardData } from '@tetherto/mdk-react-devkit/domain'

/** Served from `public/demo-api/` — a real HTTP GET, not a stubbed fetch. */
export const FLEET_API_URL = '/demo-api/fleet-api-v2.json'

export type FleetNotice = {
  ref: string
  title: string
  detail: string
  level: 'info' | 'warning' | 'critical'
  raisedAtMs: number
}

export type FleetRecord = {
  assetRef: string
  kind: string
  zone: string
  health: {
    state: 'nominal' | 'degraded' | 'faulted'
    notices: FleetNotice[]
  }
  readings: {
    flowLitresPerMin: number
    inletTempC: number
  }
}

export type FleetSeries = {
  metric: string
  unit: string
  samples: Array<{ atMs: number, value: number }>
}

export type FleetApiResponse = {
  apiVersion: string
  generatedAt: number
  page: { number: number, size: number, totalRecords: number }
  records: FleetRecord[]
  series: FleetSeries
}

/* `health.state` → the status string the alerts table groups and filters on. */
const STATE_TO_STATUS: Record<FleetRecord['health']['state'], string> = {
  nominal: 'running',
  degraded: 'warning',
  faulted: 'offline',
}

const toAlert = (notice: FleetNotice): Alert => ({
  uuid: notice.ref,
  name: notice.title,
  description: notice.detail,
  message: notice.detail,
  severity: notice.level,
  createdAt: notice.raisedAtMs,
})

/**
 * Map API records onto the `Device[]` the alerts table reads.
 *
 * The contract is small and honest: an `id`, a `type`, and `last.alerts`. It used
 * to be `Device[][]` — the Gateway's per-node envelope — which would have forced
 * this function to wrap its output in a meaningless extra array.
 */
export const toDeviceRows = (records: FleetRecord[]): Device[] =>
  records.map((record) => ({
    id: record.assetRef,
    type: record.kind,
    code: record.assetRef,
    info: { container: record.zone, pos: record.zone },
    last: {
      alerts: record.health.notices.map(toAlert),
      snap: { stats: { status: STATE_TO_STATUS[record.health.state] } },
    },
  })) as Device[]

/** Flatten every record's notices into the historical-log contract. */
export const toAlertRows = (records: FleetRecord[]): Alert[] =>
  records.flatMap((record) =>
    record.health.notices.map((notice) => ({
      ...toAlert(notice),
      thing: { id: record.assetRef, type: record.kind, info: { container: record.zone } },
    })),
  ) as Alert[]

/**
 * Map the API's samples onto `LineChartCardData`.
 *
 * `x` must be **milliseconds** — `LineChart` divides by 1000 to reach the
 * lightweight-charts `UTCTimestamp`. This API already emits `atMs`, so there is
 * nothing to convert; an API emitting seconds would multiply here.
 */
export const toChartData = (series: FleetSeries): LineChartCardData => {
  const points = series.samples
    .slice()
    .sort((a, b) => a.atMs - b.atMs)
    .map((sample) => ({ x: sample.atMs, y: sample.value }))

  const format = (value: number): string => `${value.toFixed(1)} ${series.unit}`
  const latest = points.at(-1)?.y ?? null

  return {
    datasets: [{ label: series.metric, borderColor: '#22afff', data: points }],
    yTicksFormatter: format,
    priceFormatter: format,
    ...(latest === null ? {} : { highlightedValue: { value: latest.toFixed(1), unit: series.unit } }),
  }
}
