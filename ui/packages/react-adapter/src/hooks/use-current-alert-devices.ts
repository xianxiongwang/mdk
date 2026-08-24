import type { ListThingsDevice } from '@tetherto/mdk-ui-foundation'
import { buildCurrentAlertDevicesParams, flattenKernelEnvelope, listThingsQuery  } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { ALERTS_POLL_INTERVAL_MS } from './poll-intervals'
import { useAuthToken } from './use-auth-token'

export type UseCurrentAlertDevicesOptions = {
  /** Polling interval in ms. Defaults to 20s (matches the reference app). Pass 0 to disable. */
  refetchInterval?: number
  /** Disable the query (e.g. when the consuming view is hidden). Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /**
   * Alerts search chips (the devices store's `filterTags`). Included in the
   * backend `list-things` selector — chips trigger a refetch that narrows the
   * dataset server-side, mirroring the reference app's alerts search.
   */
  filterTags?: string[]
}

/**
 * TanStack Query hook returning a flat list of the devices that currently carry
 * one or more alerts, ready to hand straight to the devkit `<Alerts>` /
 * `<CurrentAlerts>` table.
 *
 * Used to return the raw nested `ListThingsDevice[][]` and let the table head the
 * outer array itself, which pushed the Gateway's per-Kernel envelope all the way
 * into a component prop type — so a consumer on another backend had to reproduce
 * an envelope shape, and rows from every node after the first were dropped.
 * Unwrapping is the data layer's job.
 *
 * Unlike `useActiveIncidents` — which maps the same endpoint down to the
 * dashboard card's `IncidentRow[]` — this hook leaves the *rows* unshaped so the
 * table can derive its own filter tokens and per-row status. Both hit
 * `/auth/list-things`; this one requests a wider field set, so it uses a
 * distinct cache key.
 *
 * @remarks
 * The `/auth/list-things` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/list-things`
 * ships in this repo.
 *
 * @category alerts
 */
export const useCurrentAlertDevices = (
  options: UseCurrentAlertDevicesOptions = {},
): UseQueryResult<ListThingsDevice[], Error> => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = listThingsQuery(queryClient, buildCurrentAlertDevicesParams(options.filterTags))

  return useQuery({
    ...factory,
    refetchInterval: options.refetchInterval ?? ALERTS_POLL_INTERVAL_MS,
    enabled: options.enabled ?? !!token,
    select: (raw: ListThingsDevice[][]) => flattenKernelEnvelope(raw),
  })
}
