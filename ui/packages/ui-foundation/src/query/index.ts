/**
 * The backend-agnostic query core.
 *
 * Everything here works against any HTTP API: the client factory, the runtime
 * carried on it (base URL, transport, endpoint map), the declarative resource
 * builders, and the URL/param helpers they share.
 *
 * The mining Gateway's query-key registry and its 36 factories are not here —
 * they are one configuration of this core, at
 * `@tetherto/mdk-ui-foundation/presets/mining`. `API_ENDPOINTS` does stay: it is
 * the bundled default map, so a consumer needs to be able to read it and to
 * override it selectively.
 */

/* `SESSION_EXPIRED_STATUS` moved to the `auth` module, which now owns what
 * "the session ended" means. It is reachable from the package root and from
 * `../auth`; re-exporting it here too would make it an ambiguous star export
 * across the two barrels, which ES modules resolve by dropping it silently. */
export {
  API_BASE_URL_ENV,
  createMdkQueryClient,
  type CreateMdkQueryClientOptions,
  DEPRECATED_API_BASE_URL_ENV,
  getApiBaseUrl,
  resolveApiBaseUrl,
} from './client'
export {
  API_ENDPOINTS,
  type ApiEndpoint,
  HTTP_METHODS,
  type HttpMethod,
  JSON_HEADERS,
} from './endpoints'
export { type EndpointName, endpointUrl, runtimeEndpoints, runtimeFetcher } from './factory-helpers'
export { createBearerFetcher, mdkFetch } from './mdk-fetch'
export {
  createResourceMutation,
  createResourceQuery,
  type ResourceMutationConfig,
  type ResourceQueryConfig,
} from './resource'
export { type ResourceKey, resourceKey } from './resource-key'
export {
  appendQuery,
  buildUrl,
  createGetQueryFn,
  DEFAULT_API_BASE_URL,
  type EndpointMap,
  type Fetcher,
  getEndpoints,
  getFetcher,
  getMdkRuntime,
  type MdkRuntime,
  type QueryFnContext,
  resolvePath,
} from './runtime'
