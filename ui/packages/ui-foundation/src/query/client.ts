import { MutationCache, QueryCache, QueryClient } from '@tanstack/query-core'

import { type AuthProvider, bearerTokenAuth, isSessionExpiredError } from '../auth/provider'
import { createBearerFetcher } from './mdk-fetch'
import { DEFAULT_API_BASE_URL, type EndpointMap, type Fetcher } from './runtime'

const readViteEnv = (key: string): string | undefined => {
  try {
    // `import.meta` is a syntactic form. We read it via a runtime indirection
    // so this file remains importable from CommonJS Node tooling that doesn't
    // know about it. Static analysers can't see through the indirection,
    // hence the `// eslint-disable-next-line` below.
    // eslint-disable-next-line no-new-func
    const reader = new Function('return import.meta') as () => {
      env?: Record<string, string | undefined>
    }
    return reader()?.env?.[key]
  } catch {
    return undefined
  }
}

const readNodeEnv = (key: string): string | undefined => {
  try {
    return typeof process !== 'undefined' ? process.env?.[key] : undefined
  } catch {
    return undefined
  }
}

/**
 * The env var naming the API base URL. `VITE_` for bundlers that expose
 * `import.meta.env`, the bare name for Node.
 *
 * Namespaced on purpose: a host app very often has its own `API_BASE_URL` for
 * its own backend, and MDK reading that by accident is a hard bug to see.
 *
 * @category query
 */
export const API_BASE_URL_ENV = {
  vite: 'VITE_MDK_API_URL',
  node: 'MDK_API_URL',
} as const

/**
 * Names accepted for one major with a warning. The shell template read
 * `VITE_API_BASE_URL` while the resolver below only ever looked at
 * `VITE_MDK_API_URL`, so setting either one worked in some layers and silently
 * did nothing in others — a trap worth removing rather than preserving.
 *
 * @deprecated Use {@link API_BASE_URL_ENV}. Removed in the next major.
 * @category query
 */
export const DEPRECATED_API_BASE_URL_ENV = {
  vite: 'VITE_API_BASE_URL',
  node: 'API_BASE_URL',
} as const

/* Warn at most once per process, not once per client — a host building several
 * clients would otherwise repeat it on every construction. */
let deprecationWarned = false

const warnDeprecatedEnv = (name: string): void => {
  if (deprecationWarned) return
  deprecationWarned = true
  console.warn(
    `[mdk] ${name} is deprecated and will stop being read in the next major. `
    + `Rename it to ${name.startsWith('VITE_') ? API_BASE_URL_ENV.vite : API_BASE_URL_ENV.node}.`,
  )
}

/** First non-blank value among the given readers, trimmed. */
const firstConfigured = (
  candidates: Array<{ value: string | undefined, name?: string }>,
): string | undefined => {
  for (const { value, name } of candidates) {
    if (value === undefined) continue
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    if (name !== undefined) warnDeprecatedEnv(name)
    return trimmed
  }
  return undefined
}

/**
 * Resolves the API base URL:
 *
 *   1. Explicit override (caller-supplied, typically from `MdkProvider`).
 *      An explicit empty string (`''`) is honoured as "use relative URLs" — the
 *      canonical signal that requests should go through a reverse proxy (the
 *      Vite dev-server proxy in development, an ingress in production).
 *   2. `VITE_MDK_API_URL` (bundler) or `MDK_API_URL` (Node).
 *   3. The deprecated `VITE_API_BASE_URL` / `API_BASE_URL`, which warn once.
 *   4. Hardcoded default (`http://localhost:3000`).
 *
 * @category query
 */
export const resolveApiBaseUrl = (override?: string): string => {
  if (override === '') return ''
  if (override && override.trim().length > 0) return override.trim()

  return (
    firstConfigured([
      { value: readViteEnv(API_BASE_URL_ENV.vite) },
      { value: readNodeEnv(API_BASE_URL_ENV.node) },
      {
        value: readViteEnv(DEPRECATED_API_BASE_URL_ENV.vite),
        name: DEPRECATED_API_BASE_URL_ENV.vite,
      },
      {
        value: readNodeEnv(DEPRECATED_API_BASE_URL_ENV.node),
        name: DEPRECATED_API_BASE_URL_ENV.node,
      },
    ]) ?? DEFAULT_API_BASE_URL
  )
}

export type CreateMdkQueryClientOptions = {
  apiBaseUrl?: string
  /**
   * How the session works: token source, sign-out, and what counts as the
   * backend ending it. Defaults to `bearerTokenAuth()` — a token read from
   * `authStore`, cleared on a 401 — which is what this function did inline
   * before the seam existed.
   *
   * The provider also supplies the default transport's credentials, so passing
   * one is enough to change the auth scheme; `fetcher` only needs overriding to
   * change the transport itself.
   */
  auth?: AuthProvider
  /**
   * Transport for every query and mutation. Defaults to a bearer fetcher reading
   * the token from `auth`.
   *
   * This is the seam for "bring your own backend": pass a `Fetcher` that talks
   * to your API (custom auth scheme, throttling, a different protocol) or one
   * that serves fixtures from memory for a server-less demo.
   */
  fetcher?: Fetcher
  /**
   * Request paths, as `:name` templates. Defaults to the bundled mining Gateway
   * map (`API_ENDPOINTS`). Pass your own to point the same factories and hooks
   * at a different API's URL space.
   */
  endpoints?: EndpointMap
  /**
   * Fired after the session is cleared because the backend reported it ended
   * (by default, HTTP 401 on any query or mutation; `auth.isSessionEnded`
   * decides). The host app can use this to navigate to its sign-in page.
   * Redirecting is optional — clearing the token already drops any
   * `RequireAuth`-guarded UI to its sign-in fallback.
   */
  onSessionExpired?: () => void
  /** Optional QueryClient default options pass-through. */
  defaultOptions?: ConstructorParameters<typeof QueryClient>[0] extends infer P
    ? P extends { defaultOptions?: infer D }
      ? D
      : never
    : never
}

/**
 * Build a TanStack `QueryClient` carrying the data-source runtime.
 *
 * The runtime (`baseUrl`, `fetcher`, `endpoints`) is stashed on
 * `defaultOptions.{queries,mutations}.meta`, where every query factory reads it
 * back via `getMdkRuntime` / `getFetcher` / `getEndpoints`. That is what makes
 * the data source swappable: the factories and the ~77 adapter hooks above them
 * are unchanged, and only what is handed to this function differs.
 *
 * ```ts
 * // mining Gateway (the default — both options may be omitted)
 * createMdkQueryClient({ apiBaseUrl })
 *
 * // someone else's API
 * createMdkQueryClient({ apiBaseUrl, endpoints: MY_ENDPOINTS, fetcher: myFetcher })
 * ```
 *
 * @category query
 */
export const createMdkQueryClient = (options: CreateMdkQueryClientOptions = {}): QueryClient => {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl)
  const auth = options.auth ?? bearerTokenAuth()

  /* Credentials come from the provider, so a custom auth scheme needs no custom
   * transport. Built per client rather than reusing the `mdkFetch` singleton,
   * which is hardwired to the `authStore` singleton — two clients with different
   * providers would otherwise send the same token. */
  const fetcher = options.fetcher ?? createBearerFetcher({ getToken: auth.getToken })

  const runtimeMeta = {
    apiBaseUrl: baseUrl,
    fetcher,
    ...(options.endpoints ? { endpoints: options.endpoints } : {}),
  }

  const isSessionEnded = auth.isSessionEnded ?? isSessionExpiredError

  // Global session-ended guard: any query/mutation that fails the provider's
  // test means the backend has ended the session, so clear it immediately.
  // `RequireAuth` reads the token reactively, so this alone bounces the user
  // to the sign-in fallback — without waiting for the next token-refresh poll.
  // The token check keeps it idempotent when several requests fail together, so
  // `onSessionExpired` fires once rather than once per failed request.
  const handleSessionExpiry = (error: unknown): void => {
    if (!isSessionEnded(error)) return
    if (auth.getToken() === null) return
    auth.signOut()
    options.onSessionExpired?.()
  }

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleSessionExpiry }),
    mutationCache: new MutationCache({ onError: handleSessionExpiry }),
    defaultOptions: {
      ...options.defaultOptions,
      queries: {
        staleTime: 30_000,
        // Don't burn a retry on an ended session — it won't recover, so surface
        // it (and trigger the guard above) on the first response.
        retry: (failureCount, error) => !isSessionEnded(error) && failureCount < 1,
        ...options.defaultOptions?.queries,
        meta: { ...runtimeMeta, ...options.defaultOptions?.queries?.meta },
      },
      mutations: {
        retry: 0,
        ...options.defaultOptions?.mutations,
        meta: { ...runtimeMeta, ...options.defaultOptions?.mutations?.meta },
      },
    },
  })
}

/**
 * Re-exported for backwards compatibility — the implementation moved to
 * `./runtime` alongside the rest of the runtime readers.
 */
export { getApiBaseUrl } from './runtime'
