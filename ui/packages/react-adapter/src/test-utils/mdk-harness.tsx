/**
 * Contract-test harness for the adapter hooks.
 *
 * The existing `specs/*` suites hand-build a `QueryClient`, stub `fetch`, and
 * assert on the exact request URL (`expect(url).toBe('http://api/auth/site')`).
 * That pins them to one backend's URL space: they break on any change to URL
 * construction, and they never catch a change to what a hook *returns*.
 *
 * This harness inverts that. A contract test says "given this payload for the
 * pools resource, `usePools` returns this shape" — with no URL, no query-key
 * literal, and no `meta` plumbing anywhere in the test:
 *
 * ```tsx
 * const harness = createMdkHarness()
 * harness.seed(poolsQuery, { pools: [{ name: 'pool-a' }] })
 * const { result } = renderHook(() => usePools(), { wrapper: harness.Wrapper })
 * expect(result.current.data).toHaveLength(1)
 * ```
 *
 * Resources are seeded through their **factory**, so the only backend concept a
 * test names is "the pools resource". When the data source becomes injectable,
 * the URL and key shapes move underneath these tests without touching them —
 * request-shape assertions belong in the mining-conformance suite instead.
 *
 * Any query that was not seeded hits the guard fetcher and fails with a message
 * naming the resource, rather than hanging until the test times out.
 */

import { authStore, createMdkQueryClient } from '@tetherto/mdk-ui-foundation'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { MdkProvider } from '../provider/mdk-provider'

/** Anything with a `queryKey` — the read half of a ui-foundation factory. */
type QueryDescriptor = { queryKey: QueryKey }

/**
 * A ui-foundation read factory: takes the client (plus any params) and returns
 * a `{ queryKey, queryFn }` descriptor.
 */
type QueryFactory<TArgs extends unknown[]> = (
  client: QueryClient,
  ...args: TArgs
) => QueryDescriptor

export type MdkHarnessOptions = {
  /**
   * Session token seeded into `authStore`. Most read hooks default to
   * `enabled: !!token`, so a token has to be present for them to resolve.
   * Pass `null` to assert the signed-out path.
   */
  token?: string | null
  /** Base URL handed to the provider. Irrelevant to assertions; kept configurable. */
  apiBaseUrl?: string
  /**
   * Payload served for **any** request the hook makes.
   *
   * This is the preferred seam for the single-query hooks (most of them): the
   * test states "the backend returns this" without naming a URL, a query key,
   * or a params builder — so it keeps working when the request shape changes.
   *
   * Several hooks build their params inline rather than through a named
   * ui-foundation builder; for those, `seed()` would force the test to
   * duplicate that inline object, which is exactly the backend knowledge a
   * contract test must not carry. `respond` avoids it entirely.
   *
   * Pass a function to vary the response per call — use the call index, not the
   * URL, unless a multi-resource hook genuinely needs to distinguish them.
   */
  respond?: unknown | ((url: string, callIndex: number) => unknown)
}

export type MdkHarness = {
  queryClient: QueryClient
  Wrapper: (props: { children: ReactNode }) => ReactNode
  /**
   * Pre-resolve a resource with `data`, keyed by whatever the factory computes.
   * Extra arguments are forwarded to the factory, so parameterised resources
   * seed the same way:
   *
   * ```ts
   * harness.seed(poolsQuery, body)
   * harness.seed(tailLogQuery, body, buildHashrateTailLogParams(range))
   * ```
   */
  seed: <TArgs extends unknown[]>(
    factory: QueryFactory<TArgs>,
    data: unknown,
    ...args: TArgs
  ) => void
  /**
   * Requests that reached the transport. With `respond` set this is every
   * request the hook made (assert `.length` to pin down how many resources a
   * hook reads); without it, anything here is a resource the test forgot to
   * seed, and the query will have failed loudly.
   */
  requests: string[]
}

/**
 * Transport stub.
 *
 * Without `respond`, every request is rejected: contract tests seed the cache,
 * so reaching the network means a resource was missed — surfaced immediately
 * with the offending URL instead of hanging until the test times out.
 *
 * With `respond`, the payload is served as a JSON `Response` so the real
 * `createBearerFetcher` path (status check, content-type sniff, JSON parse) is
 * exercised rather than bypassed.
 */
const createStubFetch = (
  seen: string[],
  respond: MdkHarnessOptions['respond'],
  hasRespond: boolean,
): typeof fetch =>
  ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const callIndex = seen.length
    seen.push(url)

    if (!hasRespond) {
      return Promise.reject(
        new Error(
          `Unexpected network call in a contract test: ${url}\n`
          + 'Either seed the resource with harness.seed(<factory>, <payload>) or '
          + 'pass `respond` to createMdkHarness().',
        ),
      )
    }

    const body = typeof respond === 'function'
      ? (respond as (url: string, callIndex: number) => unknown)(url, callIndex)
      : respond

    return Promise.resolve(
      new Response(JSON.stringify(body ?? null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as typeof fetch

/**
 * Build a provider-backed harness for contract tests.
 *
 * `fetch` is stubbed via `vi.stubGlobal`, so a suite-level
 * `afterEach(() => { vi.unstubAllGlobals(); authStore.getState().reset() })`
 * restores global state — the same convention the existing specs use.
 */
export const createMdkHarness = (options: MdkHarnessOptions = {}): MdkHarness => {
  const { token = 'test-token', apiBaseUrl = '' } = options
  const hasRespond = 'respond' in options
  const requests: string[] = []

  const queryClient = createMdkQueryClient({
    apiBaseUrl,
    defaultOptions: {
      queries: {
        // Seeded entries must never be considered stale, or TanStack schedules a
        // background refetch and the transport stub fires.
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  })

  vi.stubGlobal('fetch', createStubFetch(requests, options.respond, hasRespond))

  if (token !== null) authStore.getState().setToken(token)

  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <MdkProvider apiBaseUrl={apiBaseUrl} queryClient={queryClient}>
      {children}
    </MdkProvider>
  )

  const seed = <TArgs extends unknown[]>(
    factory: QueryFactory<TArgs>,
    data: unknown,
    ...args: TArgs
  ): void => {
    const { queryKey } = factory(queryClient, ...args)
    queryClient.setQueryData(queryKey, data)
  }

  return { queryClient, Wrapper, seed, requests }
}
