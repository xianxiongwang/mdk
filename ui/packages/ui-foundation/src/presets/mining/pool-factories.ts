/**
 * TanStack Query factories for the MiningOS Pool Manager surface.
 *
 * Reads (`GET /auth/configs/pool`, `/auth/pools*`, `/auth/miners`,
 * `/auth/actions`) and the voting/approval write workflow
 * (`POST /auth/actions/:type`, `PUT .../:id/vote`, `DELETE .../cancel`).
 *
 * Follows the same `(client, params?, fetcher = mdkFetch)` contract as the
 * other mining factories in `./factories`, returning plain
 * `{ queryKey, queryFn }` / `{ mutationKey, mutationFn }` objects so adapter
 * hooks own polling, retries, and cache invalidation.
 *
 * @remarks
 * These `/auth/*` endpoints have no built-in or reference implementation anywhere in this repo — create your
 * own via a [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching your Worker/business
 * logic.
 */

import type { QueryClient } from '@tanstack/query-core'

import type {
  ActionsParams,
  ActionTypeQuery,
  CancelActionsPayload,
  ContainerPoolStat,
  LiveActionsResponse,
  MinersParams,
  MinersResponse,
  PoolBalanceHistoryParams,
  PoolBalanceHistoryResponse,
  PoolConfigEntry,
  PoolConfigForDeviceResponse,
  PoolsResponse,
  SiteStatusLive,
  SubmitBatchActionsPayload,
  VoteActionPayload,
  VotingActionPayload,
} from '../../types/pool.types'
import { HTTP_METHODS } from '../../query/endpoints'
import { appendQuery, createGetQueryFn, type Fetcher } from '../../query/runtime'
import { endpointUrl, runtimeFetcher } from '../../query/factory-helpers'
import { queryKeys } from './keys'
import { createResourceMutation } from '../../query/resource'

/** Fixed URL segment for the voting/approval workflow. */
const VOTING_ACTION_TYPE = 'voting'

/** Page size for the active action types (voting / ready / executing). */
const LIVE_ACTIONS_LIMIT = 1000

/** Page size for the recently-completed (`done`) action feed. */
const DONE_ACTIONS_LIMIT = 3

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Shape of the `/auth/userinfo` response.
 * Email may appear on the root or nested in `metadata`.
 *
 * @category api
 */
export type UserInfoResponse = {
  email?: string
  metadata?: {
    email?: string
    id?: number
    roles?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * `GET /auth/userinfo` — current authenticated user's profile.
 * Used to resolve the caller's email for partitioning live actions
 * into "mine vs others".
 *
 * @category query
 */
export const userInfoQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.userInfo(),
  queryFn: createGetQueryFn<UserInfoResponse>(
    fetcher,
    endpointUrl(client, 'userInfo'),
  ),
})

/**
 * `GET /auth/configs/pool` — raw pool configurations. The shape the devkit
 * `usePoolConfigs` transform consumes.
 *
 * @category query
 */
export const poolConfigsQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.poolConfigs(),
  queryFn: createGetQueryFn<PoolConfigEntry[]>(
    fetcher,
    endpointUrl(client, 'poolConfigs'),
  ),
})

/**
 * `GET /auth/pools/stats/containers` — per-container override counts.
 *
 * @category query
 */
export const containerPoolStatsQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.containerPoolStats(),
  queryFn: createGetQueryFn<ContainerPoolStat[]>(
    fetcher,
    endpointUrl(client, 'containerPoolStats'),
  ),
})

/**
 * `GET /auth/pools/config/:minerId` — pool config + override count for a
 * single device/miner.
 *
 * @category query
 */
export const poolConfigForDeviceQuery = (
  client: QueryClient,
  minerId: string,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.poolConfigForDevice(minerId),
  queryFn: createGetQueryFn<PoolConfigForDeviceResponse>(
    fetcher,
    () => endpointUrl(client, 'poolConfigForDevice', { minerId }),
  ),
})

/**
 * `GET /auth/pools` — aggregated pools (hashrate / workers / balance /
 * revenue). Feeds the Dashboard pool panel.
 *
 * @category query
 */
export const poolsQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.pools(),
  queryFn: createGetQueryFn<PoolsResponse>(
    fetcher,
    endpointUrl(client, 'pools'),
  ),
})

/**
 * `GET /auth/pools/:pool/balance-history` — per-pool revenue/hashrate
 * history for the chart view.
 *
 * @category query
 */
export const poolBalanceHistoryQuery = (
  client: QueryClient,
  pool: string,
  params: PoolBalanceHistoryParams = {},
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.poolBalanceHistory(pool, params),
  queryFn: createGetQueryFn<PoolBalanceHistoryResponse>(
    fetcher,
    () => appendQuery(endpointUrl(client, 'poolBalanceHistory', { pool }), params),
  ),
})

/**
 * `GET /auth/miners` — miners with their assigned `poolConfig` (Miner
 * Explorer rows). `filter` / `fields` / `sort` are JSON-stringified selectors.
 * Returns the paginated {@link MinersResponse} envelope.
 *
 * @category query
 */
export const minersQuery = (
  client: QueryClient,
  params: MinersParams = {},
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.miners(params),
  queryFn: createGetQueryFn<MinersResponse>(
    fetcher,
    appendQuery(endpointUrl(client, 'miners'), params),
  ),
})

/**
 * `GET /auth/site/status/live?overwriteCache=true` — composite live site-status
 * snapshot (hashrate / power / efficiency / miner, alert & pool counts). Polled
 * on a short interval by `useSiteStatusLive`; `overwriteCache` bypasses the
 * server-side LRU cache so each poll reflects the latest sample.
 *
 * @category query
 */
export const siteStatusLiveQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.siteStatusLive(),
  queryFn: createGetQueryFn<SiteStatusLive>(
    fetcher,
    appendQuery(endpointUrl(client, 'siteStatusLive'), {
      overwriteCache: true,
    }),
  ),
})

/**
 * `GET /auth/actions` — pending/voting actions list (the review-tray
 * source). Array params serialize comma-separated.
 *
 * @category query
 */
export const actionsQuery = (
  client: QueryClient,
  params: ActionsParams = {},
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.actions(params),
  queryFn: createGetQueryFn(
    fetcher,
    appendQuery(endpointUrl(client, 'actions'), params),
  ),
})

/**
 * `GET /auth/actions?queries=…` — polls all action types in a single request
 * using the multi-type query format. Returns the typed response map
 * `{ voting, ready, executing, done }`.
 *
 * @category query
 */
export const liveActionsQuery = (
  client: QueryClient,
  queries: ActionTypeQuery[] = [
    { type: 'voting', opts: { reverse: true, limit: LIVE_ACTIONS_LIMIT } },
    { type: 'ready', opts: { reverse: true, limit: LIVE_ACTIONS_LIMIT } },
    { type: 'executing', opts: { reverse: true, limit: LIVE_ACTIONS_LIMIT } },
    { type: 'done', opts: { reverse: true, limit: DONE_ACTIONS_LIMIT } },
  ],
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.liveActions(queries),
  queryFn: createGetQueryFn<[LiveActionsResponse]>(
    fetcher,
    `${endpointUrl(client, 'actions')}?${new URLSearchParams({
      queries: JSON.stringify(queries),
      overwriteCache: 'true',
    }).toString()}`,
  ),
})

// ---------------------------------------------------------------------------
// Writes — voting/approval workflow
// ---------------------------------------------------------------------------

/**
 * Query-key prefixes refreshed after any action write (submit / vote / cancel).
 * A write can change pool configs, miner assignments, the aggregated pools and
 * the actions queue, so all four refresh together.
 *
 * They live here, beside the mutations that cause the invalidation, rather than
 * in the adapter — query keys are the data layer's business.
 *
 * @category query
 */
export const ACTION_WRITE_INVALIDATE_PREFIXES = [
  ['auth', 'configs', 'pool'],
  ['auth', 'miners'],
  ['auth', 'pools'],
  ['auth', 'actions'],
] as const

/** Live-actions key — refetched (not just invalidated) so new cards appear at once. */
export const LIVE_ACTIONS_REFETCH_KEY = ['auth', 'actions', 'live'] as const

const ACTION_INVALIDATES = ACTION_WRITE_INVALIDATE_PREFIXES.map((prefix) => [...prefix])

/**
 * `POST /auth/actions/voting` — submit a single staged action. The backend
 * exposes a fixed `voting` path, so the client-only `type` field is stripped
 * from the body; the remaining fields (`query`, `action`, `params`,
 * `rackType`, …) form the request body.
 *
 * @category query
 */
export const submitActionMutation = createResourceMutation<VotingActionPayload>({
  endpoint: 'submitAction',
  method: HTTP_METHODS.POST,
  key: () => queryKeys.submitAction(),
  pathParams: () => ({ type: VOTING_ACTION_TYPE }),
  body: ({ type: _type, ...body }) => body,
  invalidates: ACTION_INVALIDATES,
})

/**
 * `POST /auth/actions/voting/batch` — submit a batch of staged actions in one
 * request. Expects the {@link SubmitBatchActionsPayload} body
 * (`{ batchActionsPayload, batchActionUID, suffix? }`).
 *
 * @category query
 */
export const submitBatchActionMutation = createResourceMutation<SubmitBatchActionsPayload>({
  endpoint: 'submitBatchAction',
  method: HTTP_METHODS.POST,
  key: () => queryKeys.submitBatchAction(),
  pathParams: () => ({ type: VOTING_ACTION_TYPE }),
  invalidates: ACTION_INVALIDATES,
})

/**
 * `PUT /auth/actions/voting/:id/vote` — approve or reject a pending action.
 *
 * @category query
 */
export const voteActionMutation = createResourceMutation<VoteActionPayload>({
  endpoint: 'voteAction',
  method: HTTP_METHODS.PUT,
  key: () => queryKeys.voteAction(),
  pathParams: ({ id }) => ({ type: VOTING_ACTION_TYPE, id }),
  body: ({ approve }) => ({ approve }),
  invalidates: ACTION_INVALIDATES,
})

/**
 * `DELETE /auth/actions/:type/cancel?ids=<comma>` — cancel pending actions.
 * Arguments ride in the query string, so no body is sent.
 *
 * @category query
 */
export const cancelActionsMutation = createResourceMutation<CancelActionsPayload>({
  endpoint: 'cancelActions',
  method: HTTP_METHODS.DELETE,
  key: () => queryKeys.cancelActions(),
  pathParams: ({ type }) => ({ type }),
  params: ({ ids }) => ({ ids }),
  body: () => undefined,
  invalidates: ACTION_INVALIDATES,
})
