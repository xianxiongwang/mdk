import type { ListThingsDevice } from '@tetherto/mdk-ui-foundation'
import { flattenKernelEnvelope, listThingsQuery  } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useAuthToken } from './use-auth-token'

const COUNT_QUERY = JSON.stringify({ type: { $regex: '^miner-' } })
const COUNT_FIELDS = JSON.stringify({ id: 1, type: 1, 'last.status': 1 })

export type SiteMinerCounts = {
  total: number
  online: number
  offline: number
  error: number
}

const aggregate = (devices: ListThingsDevice[]): SiteMinerCounts => {
  const counts: SiteMinerCounts = { total: 0, online: 0, offline: 0, error: 0 }
  for (const device of devices) {
    counts.total += 1
    const status = device.last?.status ?? device.status
    if (status === 'online' || status === 'on') counts.online += 1
    else if (status === 'error' || status === 'alert') counts.error += 1
    else counts.offline += 1
  }
  return counts
}

export type UseSiteMinerCountsOptions = {
  /** Disable the query. Defaults to running whenever an auth token is present. */
  enabled?: boolean
  /** Polling interval in ms. Defaults to 60s. Pass 0 to disable. */
  refetchInterval?: number
}

/**
 * Counts active miners by status for the header `<HeaderMinersBox />`.
 * Hits `/auth/list-things?status=1` with a tight projection (id, type,
 * last.status only) so the response stays small even on big sites.
 *
 * @remarks
 * The `/auth/list-things` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/list-things`
 * ships in this repo.
 *
 * @category dashboard
 */
export const useSiteMinerCounts = (
  options: UseSiteMinerCountsOptions = {},
): UseQueryResult<SiteMinerCounts, Error> => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const factory = listThingsQuery(queryClient, {
    status: 1,
    query: COUNT_QUERY,
    fields: COUNT_FIELDS,
  })

  return useQuery({
    ...factory,
    enabled: options.enabled ?? !!token,
    refetchInterval: options.refetchInterval ?? 60_000,
    select: (raw) => aggregate(flattenKernelEnvelope(raw)),
  })
}
