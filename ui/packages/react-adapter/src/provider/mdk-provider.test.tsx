import { type AuthProvider, authStore, MdkFetchError, noAuth } from '@tetherto/mdk-ui-foundation'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, renderHook } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MdkProvider, useMdkAuth, useMdkContext } from './mdk-provider'

/** Minimal provider that records what MdkProvider asks of it. */
const spyAuth = (overrides: Partial<AuthProvider> = {}) => {
  const bootstrap = vi.fn()
  const signOut = vi.fn()
  const provider: AuthProvider = {
    getToken: () => 'tok',
    bootstrap,
    signOut,
    ...overrides,
  }
  return { provider, bootstrap, signOut }
}

/* The QueryClient MdkProvider builds is internal by design, so tests reach it the
 * way any descendant would — through the QueryClientProvider context. */
let capturedClient: QueryClient | undefined

const ClientProbe = (): null => {
  capturedClient = useQueryClient()
  return null
}

const renderCapturingClient = (tree: ReactElement): QueryClient | undefined => {
  capturedClient = undefined
  render(tree)
  return capturedClient
}

describe('MdkProvider', () => {
  it('supplies the apiBaseUrl to descendants', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MdkProvider apiBaseUrl="http://api.test">{children}</MdkProvider>
    )

    const { result } = renderHook(() => useMdkContext(), { wrapper })
    expect(result.current.apiBaseUrl).toBe('http://api.test')
  })

  it('defaults apiBaseUrl to an empty string when none is provided', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MdkProvider>{children}</MdkProvider>
    )
    const { result } = renderHook(() => useMdkContext(), { wrapper })
    expect(result.current.apiBaseUrl).toBe('')
  })

  it('useMdkContext throws outside the provider', () => {
    expect(() => renderHook(() => useMdkContext())).toThrow(/MdkProvider/)
  })

  it('renders its children', () => {
    const { getByText } = render(
      <MdkProvider>
        <span>hello</span>
      </MdkProvider>,
    )
    expect(getByText('hello')).toBeTruthy()
  })

  describe('auth provider', () => {
    afterEach(() => {
      authStore.getState().reset()
      vi.unstubAllGlobals()
    })

    it('publishes the supplied provider to descendants', () => {
      const { provider } = spyAuth()
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MdkProvider auth={provider}>{children}</MdkProvider>
      )

      const { result } = renderHook(() => useMdkAuth(), { wrapper })
      expect(result.current).toBe(provider)
    })

    it('bootstraps the session on mount, so host apps stop hand-rolling it', () => {
      const { provider, bootstrap } = spyAuth()

      render(
        <MdkProvider auth={provider}>
          <span>x</span>
        </MdkProvider>,
      )

      expect(bootstrap).toHaveBeenCalledTimes(1)
    })

    it('bootstraps before children render, so no guard sees a tokenless first paint', () => {
      /* The regression this pins: with the capture in an effect, a route guard
       * renders its sign-in fallback once — and `RequireAuth` would persist the
       * still-token-bearing OAuth URL to sessionStorage on the way past. */
      const provider: AuthProvider = {
        getToken: () => authStore.getState().token,
        signOut: vi.fn(),
        bootstrap: () => authStore.getState().setToken('captured'),
      }

      const seenOnFirstRender: Array<string | null> = []
      const Probe = () => {
        seenOnFirstRender.push(useMdkAuth().getToken())
        return null
      }

      render(
        <MdkProvider auth={provider}>
          <Probe />
        </MdkProvider>,
      )

      expect(seenOnFirstRender[0]).toBe('captured')
    })

    it('bootstraps once across re-renders', () => {
      const { provider, bootstrap } = spyAuth()

      const { rerender } = render(
        <MdkProvider auth={provider}>
          <span>x</span>
        </MdkProvider>,
      )
      rerender(
        <MdkProvider auth={provider}>
          <span>y</span>
        </MdkProvider>,
      )

      expect(bootstrap).toHaveBeenCalledTimes(1)
    })

    it('tolerates a provider with no bootstrap', () => {
      expect(() =>
        render(
          <MdkProvider auth={noAuth()}>
            <span>x</span>
          </MdkProvider>,
        ),
      ).not.toThrow()
    })

    it('falls back to the bundled Gateway flow when no provider is passed', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MdkProvider>{children}</MdkProvider>
      )

      const { result } = renderHook(() => useMdkAuth(), { wrapper })

      /* The Gateway provider is the one that knows about refresh cadence and
       * role parsing; `noAuth` and a bare provider do not. */
      expect(result.current.refreshIntervalMs).toBe(250_000)
      expect(result.current.getRoles?.('session:a:roles:admin')).toEqual(['admin'])
    })

    it('useMdkAuth works outside a provider, unlike useMdkContext', () => {
      const { result } = renderHook(() => useMdkAuth())
      expect(result.current.refreshIntervalMs).toBe(250_000)
    })

    it('forwards onSessionExpired and signs out through the provider on a 401', () => {
      const signOut = vi.fn()
      const onSessionExpired = vi.fn()
      const provider: AuthProvider = {
        getToken: () => 'tok-1',
        signOut,
        isSessionEnded: (e) => e instanceof MdkFetchError && e.status === 401,
      }

      const client = renderCapturingClient(
        <MdkProvider apiBaseUrl="http://api.test" auth={provider} onSessionExpired={onSessionExpired}>
          <ClientProbe />
        </MdkProvider>,
      )

      /* `MdkProvider` accepted no `onSessionExpired` prop before this change, so
       * the callback `createMdkQueryClient` had always supported was unreachable
       * through the React entry point. */
      client?.getQueryCache().config.onError?.(new MdkFetchError(401, 'expired'), {} as never)

      expect(signOut).toHaveBeenCalledTimes(1)
      expect(onSessionExpired).toHaveBeenCalledTimes(1)
    })

    it('leaves the session alone for an error the provider does not count', () => {
      const signOut = vi.fn()
      const onSessionExpired = vi.fn()
      const provider: AuthProvider = {
        getToken: () => 'tok-1',
        signOut,
        isSessionEnded: (e) => e instanceof MdkFetchError && e.status === 401,
      }

      const client = renderCapturingClient(
        <MdkProvider auth={provider} onSessionExpired={onSessionExpired}>
          <ClientProbe />
        </MdkProvider>,
      )
      client?.getQueryCache().config.onError?.(new MdkFetchError(500, 'boom'), {} as never)

      expect(signOut).not.toHaveBeenCalled()
      expect(onSessionExpired).not.toHaveBeenCalled()
    })

    it('sends the provider\'s token as the bearer credential', async () => {
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      vi.stubGlobal('fetch', fetchSpy)

      const provider: AuthProvider = { getToken: () => 'tok-from-provider', signOut: vi.fn() }
      const client = renderCapturingClient(
        <MdkProvider apiBaseUrl="http://api.test" auth={provider}>
          <ClientProbe />
        </MdkProvider>,
      )

      const fetcher = client?.getDefaultOptions().queries?.meta?.fetcher as
        | (<T>(url: string) => Promise<T>)
        | undefined
      await fetcher?.('http://api.test/auth/site')

      const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
      expect(headers.get('Authorization')).toBe('Bearer tok-from-provider')
    })

    it('keeps the same QueryClient when only onSessionExpired identity changes', () => {
      const { provider } = spyAuth()
      const seen: Array<QueryClient | undefined> = []

      const Probe = () => {
        seen.push(useQueryClient())
        return null
      }

      const { rerender } = render(
        <MdkProvider auth={provider} onSessionExpired={() => {}}>
          <Probe />
        </MdkProvider>,
      )
      rerender(
        <MdkProvider auth={provider} onSessionExpired={() => {}}>
          <Probe />
        </MdkProvider>,
      )

      /* A fresh client per render would drop the entire cache — the whole reason
       * `onSessionExpired` is excluded from the memo dependencies. */
      expect(new Set(seen).size).toBe(1)
      expect(seen.length).toBeGreaterThan(1)
    })

    it('uses a supplied QueryClient as-is while still publishing auth', () => {
      const supplied = new QueryClient()
      const { provider } = spyAuth()
      let seen: QueryClient | undefined
      let seenAuth: AuthProvider | undefined

      const Probe = () => {
        seen = useQueryClient()
        seenAuth = useMdkAuth()
        return null
      }

      render(
        <MdkProvider queryClient={supplied} auth={provider}>
          <Probe />
        </MdkProvider>,
      )

      expect(seen).toBe(supplied)
      expect(seenAuth).toBe(provider)
    })
  })
})
