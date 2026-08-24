/**
 * The seam between the generic query engine (`./runtime`) and the bundled mining
 * defaults (`./endpoints`, `./mdk-fetch`).
 *
 * Every factory in `./factories` and `./pool-factories` builds its request
 * through these two helpers, so this file is the *only* place that knows the
 * mining Gateway is the fallback. When the mining specifics move out to a preset,
 * this is the file that changes — not the 36 factories.
 *
 * @category query
 */

import type { QueryClient } from '@tanstack/query-core'

import { API_ENDPOINTS } from './endpoints'
import { mdkFetch } from './mdk-fetch'
import {
  buildUrl,
  type EndpointMap,
  type Fetcher,
  getApiBaseUrl,
  getEndpoints,
  getFetcher,
  resolvePath,
} from './runtime'

/**
 * Transport for a factory call: whatever the client carries, else the bundled
 * bearer fetcher.
 *
 * Used as a default-parameter expression, so it is evaluated per call. That is
 * what let the injectable transport land without touching any of the ~77 adapter
 * hooks: `siteQuery(queryClient)` still compiles and now honours a client built
 * with `createMdkQueryClient({ fetcher })`.
 */
export const runtimeFetcher = (client: QueryClient): Fetcher => getFetcher(client) ?? mdkFetch

/** Endpoint map for a factory call: whatever the client carries, else mining. */
export const runtimeEndpoints = (client: QueryClient): EndpointMap =>
  getEndpoints(client) ?? API_ENDPOINTS

/** A name in the bundled mining map, or any name a consumer's own map defines. */
export type EndpointName = keyof typeof API_ENDPOINTS | (string & {})

/**
 * Resolve a named endpoint against the client's map into an absolute URL.
 *
 * `pathParams` fills the template's `:name` segments (URL-encoded by
 * `resolvePath`). A consumer map that omits a name falls back to the mining
 * template, so a partial override is valid — you only declare the paths you
 * actually redirect.
 *
 * Throws on a name that neither map defines, rather than requesting the base URL
 * with an empty path.
 */
export const endpointUrl = (
  client: QueryClient,
  name: EndpointName,
  pathParams?: Record<string, string | number>,
): string => {
  const template
    = runtimeEndpoints(client)[name] ?? API_ENDPOINTS[name as keyof typeof API_ENDPOINTS]
  if (template === undefined) {
    throw new Error(
      `endpointUrl: no endpoint named '${name}'. `
      + 'Add it to the map passed as `endpoints` to createMdkQueryClient.',
    )
  }
  return buildUrl(getApiBaseUrl(client), resolvePath(template, pathParams))
}
