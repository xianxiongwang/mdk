import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { JSX } from 'react'

import { DataTable, Typography } from '@tetherto/mdk-react-devkit/primitives'
import type { DataTableColumnDef } from '@tetherto/mdk-react-devkit/primitives'
import { Alerts, LineChartCard } from '@tetherto/mdk-react-devkit/domain'
import type { Alert, Device, LineChartCardData } from '@tetherto/mdk-react-devkit/domain'

import { DemoPageHeader } from '../../components/demo-page-header'
import { DemoBlock } from '../../components/demo-block'

import {
  FLEET_API_URL,
  type FleetApiResponse,
  type FleetRecord,
  toAlertRows,
  toChartData,
  toDeviceRows,
} from './fleet-adapter'

import './bring-your-own-backend-page.scss'

/*
 * Deliberately NOT imported anywhere in this page or its adapter:
 *
 *   @tetherto/mdk-react-adapter                     — no MDK hooks
 *   @tetherto/mdk-ui-foundation                     — no query factories, no client
 *   @tetherto/mdk-ui-foundation/presets/mining      — no tags, no selectors, no keys
 *
 * `npm run check:byob` enforces that, because "works with any backend" is the
 * sort of claim that rots silently. See ui/scripts/check-byob-isolation.mts.
 */

const COLUMNS: DataTableColumnDef<FleetRecord, unknown>[] = [
  { accessorKey: 'assetRef', header: 'Asset' },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'zone', header: 'Zone' },
  {
    id: 'state',
    header: 'State',
    accessorFn: (row) => row.health.state,
  },
  {
    id: 'flow',
    header: 'Flow (L/min)',
    accessorFn: (row) => row.readings.flowLitresPerMin.toFixed(1),
  },
  {
    id: 'notices',
    header: 'Notices',
    accessorFn: (row) => row.health.notices.length,
  },
]

/**
 * Proof that MDK's components are backend-agnostic.
 *
 * Every other page in this catalog feeds components from bundled fixtures. This
 * one fetches a real HTTP response from an API whose shape has nothing to do
 * with the mining Gateway — `records[]` with `health.notices[]`, a `page`
 * envelope, `atMs`/`value` samples — using plain TanStack `useQuery`, and adapts
 * it in `./fleet-adapter.ts`.
 *
 * That adapter is the whole integration surface. It is ~40 lines of pure
 * mapping, and everything below it is MDK.
 */
export const BringYourOwnBackendPage = (): JSX.Element => {
  /* A consumer's own query. No `createMdkQueryClient`, no endpoint map, no
   * `MdkProvider` runtime — this page would work outside one entirely, except
   * that `<Alerts>` reads search chips from the shared devices store. */
  const { data, isLoading, error } = useQuery<FleetApiResponse>({
    queryKey: ['fleet', 'v2', 'assets'],
    queryFn: async ({ signal }) => {
      const response = await fetch(FLEET_API_URL, { signal })
      if (!response.ok) throw new Error(`fleet API: HTTP ${response.status}`)
      return response.json() as Promise<FleetApiResponse>
    },
  })

  const rows = useMemo<FleetRecord[]>(() => data?.records ?? [], [data])
  const devices = useMemo<Device[]>(() => toDeviceRows(rows), [rows])
  const alerts = useMemo<Alert[]>(() => toAlertRows(rows), [rows])
  const chart = useMemo<LineChartCardData | undefined>(
    () => (data ? toChartData(data.series) : undefined),
    [data],
  )

  if (error) {
    return (
      <div className="byob-page">
        <DemoPageHeader title="Bring your own backend" />
        <Typography variant="body">
          {`Could not reach the demo API: ${(error as Error).message}`}
        </Typography>
      </div>
    )
  }

  return (
    <div className="byob-page">
      <DemoPageHeader
        title="Bring your own backend"
        description="Components driven by a non-mining API over real HTTP, with no MDK hooks. The adapter in fleet-adapter.ts is the entire integration surface."
      />

      <DemoBlock title="DataTable — the API's own row type, unmapped">
        <DataTable data={rows} columns={COLUMNS} />
      </DemoBlock>

      <DemoBlock title="LineChartCard — samples mapped to ChartCardData">
        <LineChartCard
          title="Total coolant flow"
          data={chart}
          isLoading={isLoading}
        />
      </DemoBlock>

      <DemoBlock title="Alerts — health.notices mapped to the alert row contract">
        <Alerts
          devices={devices}
          isCurrentAlertsLoading={isLoading}
          historicalAlerts={alerts}
          isHistoricalAlertsEnabled
        />
      </DemoBlock>
    </div>
  )
}
