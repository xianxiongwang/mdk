import { flattenKernelEnvelope, listThingsQuery  } from '@tetherto/mdk-ui-foundation/presets/mining'
import { type IncidentRow, mapDevicesToIncidents } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useAuthToken } from './use-auth-token'

const ACTIVE_ALERTS_QUERY = JSON.stringify({ 'last.alerts': { $ne: null } })
const ACTIVE_ALERTS_FIELDS = JSON.stringify({
  id: 1,
  type: 1,
  'info.pos': 1,
  'info.container': 1,
  'last.alerts': 1,
})

export type UseActiveIncidentsOptions = {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 20s (matches the reference app). Pass 0 to disable. */
  refetchInterval?: number
  /** Date formatter for the row body. Defaults to ISO string. */
  formatDate?: (d: Date) => string
}

/**
 * TanStack Query hook returning the list of currently-firing alerts, shaped
 * for `<ActiveIncidentsCard items={...} />`.
 *
 * @remarks
 * The `/auth/list-things` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation ships in this repo.
 *
 * @category dashboard
 */
export const useActiveIncidents = (
  options: UseActiveIncidentsOptions = {},
): UseQueryResult<IncidentRow[], Error> => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = listThingsQuery(queryClient, {
    status: 1,
    query: ACTIVE_ALERTS_QUERY,
    fields: ACTIVE_ALERTS_FIELDS,
  })

  return useQuery({
    ...factory,
    enabled: options.enabled ?? !!token,
    refetchInterval: options.refetchInterval ?? 20_000,
    select: (raw) => mapDevicesToIncidents(flattenKernelEnvelope(raw), options.formatDate),
  })
}
