/**
 * TanStack Query factories for the MDK data layer.
 *
 * @remarks
 * Not every factory here is illustrative: `siteQuery` and `featureConfigQuery` are served by the default
 * `site-monitor` Gateway plugin. `tailLogQuery`/`tailLogMultiQuery` have no built-in plugin either, but the
 * [full-site](https://github.com/tetherto/mdk/tree/main/examples/full-site/plugins/site) and
 * [mvp-site](https://github.com/tetherto/mdk/tree/main/examples/mvp-site/backend/gateway-plugins/site) example
 * plugins serve the same tail-log data under a different route (`/site/history`) — useful as a pattern
 * reference, not a drop-in match. Every other factory in this file has no built-in or reference
 * implementation anywhere in this repo — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching your Worker/business logic.
 */

import type { QueryClient } from '@tanstack/query-core'
import type {
  AuthTokenRequest,
  AuthTokenResponse,
  ContainerSettingsEntry,
  ExtDataParams,
  FeatureConfigResponse,
  GlobalDataParams,
  HistoryLogParams,
  ListRacksParams,
  ListThingsDevice,
  ListThingsParams,
  MinerpoolExtDataEntry,
  PduLayoutParams,
  PduLayoutResponse,
  Rack,
  SiteResponse,
  TailLogEntry,
  TailLogMultiParams,
  TailLogParams,
  ThingCommentBody,
  ThingConfigParams,
} from '../../types/api-mining.types'
import { HTTP_METHODS, type HttpMethod, JSON_HEADERS } from '../../query/endpoints'
import { endpointUrl, runtimeFetcher } from '../../query/factory-helpers'
import { queryKeys } from './keys'
import { createResourceMutation } from '../../query/resource'
import { appendQuery, createGetQueryFn, type Fetcher } from '../../query/runtime'

/**
 * TanStack Query factory for `GET /auth/tail-log`. Returns the raw nested
 * response shape (`Array<Array<TailLogEntry>>`) — callers unwrap with
 * `_head(response)` (or a typed `select` projection).
 *
 * @category query
 */
export const tailLogQuery = (
  client: QueryClient,
  params: TailLogParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.tailLog(params),
  queryFn: createGetQueryFn<TailLogEntry[][]>(
    fetcher,
    appendQuery(endpointUrl(client, 'tailLog'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/list-things`. `query` and `fields`
 * are Mongo-style selectors passed as already-stringified JSON.
 *
 * @category query
 */
export const listThingsQuery = (
  client: QueryClient,
  params: ListThingsParams = {},
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.listThings(params),
  queryFn: createGetQueryFn<ListThingsDevice[][]>(
    fetcher,
    appendQuery(endpointUrl(client, 'listThings'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/history-log`. `logType` is required
 * (`'alerts' | 'info'`).
 *
 * @category query
 */
export const historyLogQuery = (
  client: QueryClient,
  params: HistoryLogParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.historyLog(params),
  queryFn: createGetQueryFn<Record<string, unknown>[]>(
    fetcher,
    appendQuery(endpointUrl(client, 'historyLog'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/ext-data`. Generic in the response
 * row type so adapters can pin the result to a typed envelope (see
 * `minerpoolStatsQuery` for the canonical narrowing). `query` is a
 * JSON-stringified provider-specific selector.
 *
 * @category query
 */
export const extDataQuery = <TRow = unknown>(
  client: QueryClient,
  params: ExtDataParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.extData(params),
  queryFn: createGetQueryFn<TRow[][]>(
    fetcher,
    appendQuery(endpointUrl(client, 'extData'), params),
  ),
})

/**
 * Convenience wrapper around `extDataQuery` pinned to `type=minerpool` and
 * `query={"key":"stats"}`. Returns the canonical `MinerpoolExtDataEntry[][]`
 * envelope so the pool counts hook can `_head(_head(...))` without casts.
 *
 * @category query
 */
export const minerpoolStatsQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) =>
  extDataQuery<MinerpoolExtDataEntry>(
    client,
    { type: 'minerpool', query: JSON.stringify({ key: 'stats' }) },
    fetcher,
  )

/**
 * TanStack Query factory for `GET /auth/tail-log/multi` — the batched
 * variant of tail-log (`keys` is a comma-separated list of `stat-*` keys).
 * Returns the same per-worker nested envelope as `tailLogQuery`, one series
 * per requested key.
 *
 * @category query
 */
export const tailLogMultiQuery = (
  client: QueryClient,
  params: TailLogMultiParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.tailLogMulti(params),
  queryFn: createGetQueryFn<TailLogEntry[][]>(
    fetcher,
    appendQuery(endpointUrl(client, 'tailLogMulti'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/site` — the configured site label.
 *
 * @category query
 */
export const siteQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.site(),
  queryFn: createGetQueryFn<SiteResponse>(
    fetcher,
    endpointUrl(client, 'site'),
  ),
})

/**
 * TanStack Query factory for `GET /auth/list-racks`. `type` (worker type,
 * e.g. `miner` / `container`) is required — the backend 400s with
 * `ERR_TYPE_INVALID` without it. Response is the per-Kernel nested envelope.
 *
 * @category query
 */
export const listRacksQuery = (
  client: QueryClient,
  params: ListRacksParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.listRacks(params),
  queryFn: createGetQueryFn<Rack[][]>(
    fetcher,
    appendQuery(endpointUrl(client, 'listRacks'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/pdu-layout` — the static PDU socket
 * grid for a container type. The backend sources it from the container
 * worker's `pduGridLayout` config keyed by the exact type string, and 400s
 * with `ERR_PDU_LAYOUT_NOT_FOUND` when no layout is provisioned.
 *
 * @category query
 */
export const pduLayoutQuery = (
  client: QueryClient,
  params: PduLayoutParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.pduLayout(params),
  queryFn: createGetQueryFn<PduLayoutResponse>(
    fetcher,
    appendQuery(endpointUrl(client, 'pduLayout'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/global/data`. Generic in the row
 * type — see `containerSettingsQuery` for the canonical narrowing.
 *
 * @category query
 */
export const globalDataQuery = <TRow = unknown>(
  client: QueryClient,
  params: GlobalDataParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.globalData(params),
  queryFn: createGetQueryFn<TRow[]>(
    fetcher,
    appendQuery(endpointUrl(client, 'globalData'), params),
  ),
})

/**
 * Convenience wrapper around `globalDataQuery` pinned to
 * `type=containerSettings` — per-model container thresholds/parameters.
 * Verified live: the response is a flat `ContainerSettingsEntry[]`, not the
 * per-Kernel envelope.
 *
 * @category query
 */
export const containerSettingsQuery = (
  client: QueryClient,
  options: { model?: string; overwriteCache?: boolean } = {},
  fetcher: Fetcher = runtimeFetcher(client),
) =>
  globalDataQuery<ContainerSettingsEntry>(
    client,
    { type: 'containerSettings', ...options },
    fetcher,
  )

/**
 * TanStack Query factory for `GET /auth/thing-config` — a thing type's
 * config document (Settings tab). Both params are required by the backend
 * schema. Response shape is worker-specific, so callers narrow via the
 * generic.
 *
 * @category query
 */
export const thingConfigQuery = <TConfig = Record<string, unknown>>(
  client: QueryClient,
  params: ThingConfigParams,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.thingConfig(params),
  queryFn: createGetQueryFn<TConfig>(
    fetcher,
    appendQuery(endpointUrl(client, 'thingConfig'), params),
  ),
})

/**
 * TanStack Query factory for `GET /auth/global-config` — the global system
 * config document. Shape is deployment-specific (not yet captured live), so
 * callers narrow via the generic.
 *
 * @category query
 */
export const globalConfigQuery = <TConfig = Record<string, unknown>>(
  client: QueryClient,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  queryKey: queryKeys.globalConfig(),
  queryFn: createGetQueryFn<TConfig>(
    fetcher,
    endpointUrl(client, 'globalConfig'),
  ),
})

/**
 * TanStack Query factory for `GET /auth/featureConfig` — deployment feature
 * flags, including the multi-site mode switch. Note the camelCase path:
 * there is no `/auth/feature-config` route (a kebab-case request falls
 * through to the SPA fallback).
 *
 * @category query
 */
export const featureConfigQuery = (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
  queryKey: queryKeys.featureConfig(),
  queryFn: createGetQueryFn<FeatureConfigResponse>(
    fetcher,
    endpointUrl(client, 'featureConfig'),
  ),
})

/**
 * TanStack Mutation factory for `POST /auth/token`. Used by `useTokenPolling`
 * to refresh the session token every 250 s.
 *
 * @category query
 */
/* Deliberately hand-written rather than a `createResourceMutation` config: it is
 * the only mutation whose payload is optional (`mutationFn()` posts `{}`), and
 * expressing "defaulted payload" in the builder would need conditional typing
 * for the benefit of exactly one endpoint. */
export const authTokenMutation = (
  client: QueryClient,
  fetcher: Fetcher = runtimeFetcher(client),
) => ({
  mutationKey: queryKeys.authToken(),
  mutationFn: (body: AuthTokenRequest = {}) =>
    fetcher<AuthTokenResponse>(endpointUrl(client, 'authToken'), {
      method: HTTP_METHODS.POST,
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
})

/* The three /auth/thing/comment verbs share one Fastify schema — add (POST),
 * edit (PUT) and delete (DELETE) differ only by method. Every write invalidates
 * `list-things`, because comments are embedded in the Thing record and there is
 * no GET for them. */
const thingCommentMutation = (method: HttpMethod, key: () => readonly unknown[]) =>
  createResourceMutation<ThingCommentBody>({
    endpoint: 'thingComment',
    method,
    key,
    invalidates: [['auth', 'list-things']],
  })

/**
 * TanStack Mutation factory for `POST /auth/thing/comment` — add a device
 * comment. Requires the `comments:write` permission; the backend stamps the
 * author from the session token.
 *
 * @category query
 */
export const addThingCommentMutation = thingCommentMutation(
  HTTP_METHODS.POST,
  () => queryKeys.addThingComment(),
)

/**
 * TanStack Mutation factory for `PUT /auth/thing/comment` — edit an existing
 * device comment (`body.id` identifies it).
 *
 * @category query
 */
export const editThingCommentMutation = thingCommentMutation(
  HTTP_METHODS.PUT,
  () => queryKeys.editThingComment(),
)

/**
 * TanStack Mutation factory for `DELETE /auth/thing/comment` — remove an
 * existing device comment (`body.id` identifies it; the schema still requires
 * the full body on delete).
 *
 * @category query
 */
export const deleteThingCommentMutation = thingCommentMutation(
  HTTP_METHODS.DELETE,
  () => queryKeys.deleteThingComment(),
)
