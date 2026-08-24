/**
 * The data-source runtime — the injection seam that lets a consumer point MDK
 * at their own backend instead of the mining Gateway.
 *
 * Everything here is domain-agnostic. A runtime bundles the three things a query
 * factory needs to build a request: where the API lives (`baseUrl`), how to talk
 * to it (`fetcher`), and what its paths are (`endpoints`). It rides on the
 * TanStack `QueryClient`'s `meta`, which is the one object every factory already
 * receives, so no factory signature has to change to read it.
 *
 * Why `meta` rather than React context: the factories are framework-agnostic and
 * are called from plain functions as well as hooks. `meta` is the only channel
 * available to both. (`resolveApiBaseUrl` already used it for the base URL; this
 * generalises that trick to the whole runtime.)
 *
 * @category query
 */

import type { QueryClient } from '@tanstack/query-core'

/** Fallback API base URL when neither an override nor an env var is set. */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000'

/**
 * Minimal transport contract: take a URL, return parsed JSON. Deliberately
 * fetch-shaped and nothing more — an implementation may add auth headers, retry,
 * throttling, or serve fixtures from memory.
 */
export type Fetcher = <T>(url: string, init?: RequestInit) => Promise<T>

/**
 * The slice of TanStack's query-function context the factories care about: the
 * `AbortSignal` fired when a query is cancelled. Optional + defaulted by
 * {@link createGetQueryFn} so factory unit tests can call `queryFn()` with no
 * args; in real `useQuery` usage TanStack always supplies a live signal.
 */
export type QueryFnContext = { signal?: AbortSignal }

/**
 * Named request paths, as templates. A segment written `:name` is substituted by
 * {@link resolvePath}, so a path with a dynamic part stays declarative here
 * rather than being string-concatenated at the call site:
 *
 * ```ts
 * const endpoints = {
 *   devices: '/devices',
 *   device: '/devices/:id',
 *   poolBalanceHistory: '/auth/pools/:pool/balance-history',
 * } satisfies EndpointMap
 * ```
 */
export type EndpointMap = Record<string, string>

/** What a query factory needs in order to build a request. */
export type MdkRuntime = {
  /** Resolved API base URL. `''` means "use relative URLs" (reverse proxy). */
  baseUrl: string
  /** Transport. Omitted when a caller hand-builds a client; factories fall back. */
  fetcher?: Fetcher
  /** Request paths. Omitted likewise; factories fall back to the bundled preset. */
  endpoints?: EndpointMap
}

/* Trim trailing slashes without a regex: an unanchored `/\/+$/` backtracks
 * polynomially (ReDoS) on long slash-heavy input; this linear scan does not. */
const trimTrailingSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value.charAt(end - 1) === '/') end -= 1
  return value.slice(0, end)
}

/**
 * Join a base URL and a path, tolerating a trailing slash on the base and a
 * missing leading slash on the path.
 *
 * @category query
 */
export const buildUrl = (base: string, path: string): string => {
  const trimmedBase = trimTrailingSlashes(base)
  const trimmedPath = path.startsWith('/') ? path : `/${path}`
  return `${trimmedBase}${trimmedPath}`
}

/**
 * Substitute `:name` segments in a path template, URL-encoding each value.
 *
 * Encoding here is what makes the template form safe: previously every dynamic
 * path was assembled with `${BASE}/${encodeURIComponent(id)}` at the call site,
 * so a missed `encodeURIComponent` was a silent path-injection bug.
 *
 * Throws when a template placeholder has no corresponding value — a missing id
 * would otherwise produce a request to a subtly wrong path (`/devices/undefined`)
 * and surface as a confusing 404.
 *
 * @category query
 */
export const resolvePath = (template: string, params: Record<string, string | number> = {}): string =>
  template.replace(/:([A-Z_]\w*)/gi, (_match, name: string) => {
    const value = params[name]
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `resolvePath: no value for ':${name}' in template '${template}'. `
        + `Supplied: ${JSON.stringify(Object.keys(params))}`,
      )
    }
    return encodeURIComponent(String(value))
  })

/**
 * Append query params to a URL. `undefined` / `null` values and empty arrays are
 * skipped; array values serialize comma-separated (`{ ids: ['a', 'b'] }` →
 * `?ids=a,b`), the `qs` `arrayFormat: 'comma'` convention the Gateway expects,
 * without the extra dependency.
 *
 * @category query
 */
export const appendQuery = (url: string, params: Record<string, unknown>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.map((entry) => String(entry)).join(','))
    } else {
      search.set(key, typeof value === 'string' ? value : String(value))
    }
  }
  const qs = search.toString()
  return qs.length === 0 ? url : `${url}?${qs}`
}

/**
 * Build a signal-aware GET `queryFn`. This is the single place the `AbortSignal`
 * is threaded into the fetcher: TanStack cancels a query (firing the signal) when
 * its last observer unmounts on navigation, or when an invalidation supersedes a
 * request that is still in flight — so the request `abort()`s instead of running
 * to completion and discarding its result. `T` pins the parsed response type.
 *
 * `url` may be a **thunk**, which defers URL construction to request time. That
 * matters for paths with a dynamic segment: adapter hooks build the factory
 * descriptor unconditionally and gate fetching with `enabled`, so a disabled
 * query (say, a detail view before an id is selected) would otherwise resolve a
 * path it is never going to request — and `resolvePath` rightly throws on a
 * missing segment. Passing a thunk keeps that strictness without penalising the
 * build-then-disable pattern.
 *
 * @category query
 */
export const createGetQueryFn
  = <T>(fetcher: Fetcher, url: string | (() => string)) =>
    ({ signal }: QueryFnContext = {}): Promise<T> =>
      fetcher<T>(typeof url === 'function' ? url() : url, { signal })

/** Read the runtime stashed on a client by `createMdkQueryClient`. */
const readRuntime = (client: QueryClient): Partial<MdkRuntime> => {
  const meta = client.getDefaultOptions().queries?.meta as
    | { apiBaseUrl?: string, fetcher?: Fetcher, endpoints?: EndpointMap }
    | undefined
  return {
    baseUrl: meta?.apiBaseUrl,
    fetcher: meta?.fetcher,
    endpoints: meta?.endpoints,
  }
}

/**
 * Read the configured base URL back from a `QueryClient`. Falls back to the
 * default when the client was not produced by `createMdkQueryClient`.
 *
 * @category query
 */
export const getApiBaseUrl = (client: QueryClient): string =>
  readRuntime(client).baseUrl ?? DEFAULT_API_BASE_URL

/**
 * Read the injected transport, or `undefined` when the client carries none —
 * which is the case for a hand-built `QueryClient`. Callers decide the fallback;
 * the mining factories fall back to the bundled bearer fetcher.
 *
 * @category query
 */
export const getFetcher = (client: QueryClient): Fetcher | undefined =>
  readRuntime(client).fetcher

/**
 * Read the injected endpoint map, or `undefined` when the client carries none.
 * The mining factories fall back to the bundled mining preset.
 *
 * @category query
 */
export const getEndpoints = (client: QueryClient): EndpointMap | undefined =>
  readRuntime(client).endpoints

/**
 * Read the whole runtime at once. `baseUrl` is always resolved; `fetcher` and
 * `endpoints` are `undefined` unless injected.
 *
 * @category query
 */
export const getMdkRuntime = (client: QueryClient): MdkRuntime => ({
  baseUrl: getApiBaseUrl(client),
  fetcher: getFetcher(client),
  endpoints: getEndpoints(client),
})
