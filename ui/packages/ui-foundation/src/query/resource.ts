/**
 * Declarative builders for query and mutation factories.
 *
 * A "resource" is one endpoint plus the rules for turning a caller's input into a
 * request: which endpoint, what cache key, which query params, which path
 * segments. Declaring that is enough — URL assembly, param serialisation, path
 * encoding, abort-signal threading and transport selection all come from the
 * client's runtime.
 *
 * This is the authoring API for "bring your own data": a consumer registers their
 * endpoint map on the client, declares resources against it, and gets factories
 * indistinguishable from the bundled mining ones.
 *
 * ```ts
 * const widgetsQuery = createResourceQuery<Widget[], { limit?: number }>({
 *   endpoint: 'widgets',
 *   key: (input) => ['widgets', input],
 *   params: (input) => ({ limit: input.limit }),
 * })
 *
 * const widgetQuery = createResourceQuery<Widget, { id: string }>({
 *   endpoint: 'widget',                    // '/widgets/:id'
 *   key: ({ id }) => ['widgets', id],
 *   pathParams: ({ id }) => ({ id }),
 * })
 *
 * useQuery(widgetsQuery(queryClient, { limit: 10 }))
 * ```
 *
 * It is also the shape a `mdk-ui add hook` generator targets: everything that
 * varies per endpoint is data, not code.
 *
 * @category query
 */

import type { QueryClient } from '@tanstack/query-core'

import type { HttpMethod } from './endpoints'
import { JSON_HEADERS } from './endpoints'
import { type EndpointName, endpointUrl, runtimeFetcher } from './factory-helpers'
import { appendQuery, createGetQueryFn, type Fetcher } from './runtime'

/** Cache key shape TanStack matches structurally for invalidation. */
type ResourceKey = readonly unknown[]

export type ResourceQueryConfig<TInput> = {
  /** Endpoint name, resolved against the client's map. */
  endpoint: EndpointName
  /** Cache key for this input. Arrays so TanStack can prefix-match invalidations. */
  key: (input: TInput) => ResourceKey
  /** Query-string params. Omit for an endpoint that takes none. */
  params?: (input: TInput) => Record<string, unknown>
  /** Values for the endpoint template's `:name` segments. */
  pathParams?: (input: TInput) => Record<string, string | number>
}

/**
 * Build a read factory: `(client, input) => { queryKey, queryFn }`.
 *
 * URL construction is deferred into the `queryFn`, so a descriptor built for a
 * query that is currently disabled never resolves its path — adapter hooks build
 * unconditionally and gate with `enabled`, and `resolvePath` throws on a missing
 * path segment.
 */
export const createResourceQuery = <TResponse, TInput = void>(
  config: ResourceQueryConfig<TInput>,
) =>
  (client: QueryClient, input: TInput, fetcher: Fetcher = runtimeFetcher(client)) => ({
    queryKey: config.key(input),
    queryFn: createGetQueryFn<TResponse>(fetcher, () => {
      const url = endpointUrl(client, config.endpoint, config.pathParams?.(input))
      const params = config.params?.(input)
      return params ? appendQuery(url, params) : url
    }),
  })

export type ResourceMutationConfig<TBody> = {
  /** Endpoint name, resolved against the client's map. */
  endpoint: EndpointName
  /** HTTP verb. Reads use the fetcher's implicit GET, so only writes appear here. */
  method: HttpMethod
  /** Mutation key, for TanStack's `isMutating` tracking. */
  key: () => ResourceKey
  /** Values for the endpoint template's `:name` segments, from the payload. */
  pathParams?: (body: TBody) => Record<string, string | number>
  /** Query-string params, from the payload (e.g. `?ids=a,b` on a DELETE). */
  params?: (body: TBody) => Record<string, unknown>
  /**
   * Request body. Defaults to the payload as-is; override to strip client-only
   * fields the API would reject, or to reshape. Return `undefined` for a write
   * that carries its arguments in the query string — no body and no
   * `Content-Type` are then sent.
   */
  body?: (body: TBody) => unknown
  /**
   * Cache-key prefixes to invalidate on success. Keeping this beside the endpoint
   * is what stops invalidation prefixes being hardcoded away from the resource
   * they belong to.
   */
  invalidates?: ResourceKey[]
}

/**
 * Build a write factory: `(client, ...) => { mutationKey, mutationFn, invalidates }`.
 *
 * `invalidates` is returned rather than applied — the adapter hook owns cache
 * effects, so it decides when to run them (and can add its own).
 */
export const createResourceMutation = <TBody, TResponse = unknown>(
  config: ResourceMutationConfig<TBody>,
) =>
  (client: QueryClient, fetcher: Fetcher = runtimeFetcher(client)) => ({
    mutationKey: config.key(),
    invalidates: config.invalidates ?? [],
    mutationFn: (payload: TBody): Promise<TResponse> => {
      const url = endpointUrl(client, config.endpoint, config.pathParams?.(payload))
      const params = config.params?.(payload)
      const target = params ? appendQuery(url, params) : url
      const body = config.body ? config.body(payload) : payload

      // A write whose arguments ride in the query string sends neither a body
      // nor a Content-Type — announcing JSON with no payload would be a lie.
      if (body === undefined) return fetcher<TResponse>(target, { method: config.method })

      return fetcher<TResponse>(target, {
        method: config.method,
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      })
    },
  })
