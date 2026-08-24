import { type AuthProvider, authStore, MdkFetchError, noAuth } from '@tetherto/mdk-ui-foundation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MdkProvider } from '@/provider/mdk-provider'
import { useTokenPolling } from '../use-token-polling'

const wrapperWithClient = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    statusText: status === 401 ? 'Unauthorized' : status === 500 ? 'Server Error' : 'OK',
    headers: { 'content-type': 'application/json' },
  })

describe('useTokenPolling', () => {
  beforeEach(() => {
    authStore.getState().reset()
  })

  afterEach(() => {
    authStore.getState().reset()
    vi.unstubAllGlobals()
  })

  it('refreshes the token at the configured interval', async () => {
    authStore.getState().setToken('initial')
    const fetchImpl = vi.fn(async () => jsonResponse(200, { token: 'refreshed' }))
    vi.stubGlobal('fetch', fetchImpl)

    const client = new QueryClient({
      defaultOptions: { queries: { meta: { apiBaseUrl: 'http://api' }, retry: false } },
    })

    renderHook(() => useTokenPolling({ intervalMs: 20 }), {
      wrapper: wrapperWithClient(client),
    })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled(), { timeout: 1000 })
    await waitFor(() => expect(authStore.getState().token).toBe('refreshed'), { timeout: 1000 })
  })

  it('clears the session on a 401', async () => {
    authStore.getState().setToken('stale')
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'unauthorized' }))
    vi.stubGlobal('fetch', fetchImpl)

    const onSessionEnded = vi.fn()
    const client = new QueryClient({
      defaultOptions: {
        queries: { meta: { apiBaseUrl: 'http://api' }, retry: false },
        mutations: { retry: 0 },
      },
    })

    renderHook(() => useTokenPolling({ intervalMs: 20, onSessionEnded }), {
      wrapper: wrapperWithClient(client),
    })

    await waitFor(() => expect(authStore.getState().token).toBeNull(), { timeout: 1000 })
    expect(onSessionEnded).toHaveBeenCalled()
  })

  it('does not poll when no token is set and enabled is unspecified', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchImpl)
    const client = new QueryClient()
    renderHook(() => useTokenPolling({ intervalMs: 20 }), {
      wrapper: wrapperWithClient(client),
    })

    // Give it enough real time that an interval-based call WOULD have fired.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('MdkFetchError exposes the status used by isSessionEnded', () => {
    expect(new MdkFetchError(401, 'x').status).toBe(401)
    expect(new MdkFetchError(500, 'y').status).toBe(500)
  })

  describe('provider-driven scheduling', () => {
    const withAuth = (auth: AuthProvider, client: QueryClient) => {
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <MdkProvider auth={auth} queryClient={client}>
          {children}
        </MdkProvider>
      )
      return Wrapper
    }

    it('calls the provider\'s refresh rather than a hardcoded endpoint', async () => {
      const refresh = vi.fn(async () => 'refreshed')
      const auth: AuthProvider = { getToken: () => 'initial', signOut: vi.fn(), refresh }
      const client = new QueryClient()

      renderHook(() => useTokenPolling({ intervalMs: 20 }), {
        wrapper: withAuth(auth, client),
      })

      await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
      expect(refresh).toHaveBeenCalledWith(client)
    })

    it('schedules nothing for a provider with no refresh, so noAuth needs no special case', () => {
      const setInterval = vi.spyOn(window, 'setInterval')

      renderHook(() => useTokenPolling({ intervalMs: 20 }), {
        wrapper: withAuth(noAuth(), new QueryClient()),
      })

      expect(setInterval).not.toHaveBeenCalled()
      setInterval.mockRestore()
    })

    it('takes its cadence from the provider when the caller specifies none', async () => {
      const refresh = vi.fn(async () => null)
      const auth: AuthProvider = {
        getToken: () => 'initial',
        signOut: vi.fn(),
        refresh,
        refreshIntervalMs: 20,
      }

      renderHook(() => useTokenPolling(), { wrapper: withAuth(auth, new QueryClient()) })

      await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    })

    it('an explicit intervalMs overrides the provider cadence', async () => {
      const refresh = vi.fn(async () => null)
      const auth: AuthProvider = {
        getToken: () => 'initial',
        signOut: vi.fn(),
        refresh,
        /* Long enough that the test would time out if the provider won. */
        refreshIntervalMs: 60_000,
      }

      renderHook(() => useTokenPolling({ intervalMs: 20 }), {
        wrapper: withAuth(auth, new QueryClient()),
      })

      await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    })

    it('disables polling on a zero cadence', async () => {
      const refresh = vi.fn(async () => null)
      const auth: AuthProvider = {
        getToken: () => 'initial',
        signOut: vi.fn(),
        refresh,
        refreshIntervalMs: 0,
      }

      renderHook(() => useTokenPolling(), { wrapper: withAuth(auth, new QueryClient()) })

      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(refresh).not.toHaveBeenCalled()
    })

    it('signs out through the provider when refresh reports the session ended', async () => {
      const signOut = vi.fn()
      const onSessionEnded = vi.fn()
      const auth: AuthProvider = {
        getToken: () => 'stale',
        signOut,
        refresh: async () => {
          throw new MdkFetchError(403, 'forbidden')
        },
        /* A backend that signals expiry with 403 — the hook must defer to this
         * rather than to its own 401/500 assumption. */
        isSessionEnded: (e) => e instanceof MdkFetchError && e.status === 403,
      }

      renderHook(() => useTokenPolling({ intervalMs: 20, onSessionEnded }), {
        wrapper: withAuth(auth, new QueryClient()),
      })

      await waitFor(() => expect(signOut).toHaveBeenCalled(), { timeout: 1000 })
      expect(onSessionEnded).toHaveBeenCalled()
    })

    it('leaves the session alone for an error the provider does not count', async () => {
      const signOut = vi.fn()
      const onSessionEnded = vi.fn()
      const auth: AuthProvider = {
        getToken: () => 'live',
        signOut,
        refresh: async () => {
          throw new MdkFetchError(503, 'unavailable')
        },
        isSessionEnded: (e) => e instanceof MdkFetchError && e.status === 401,
      }

      renderHook(() => useTokenPolling({ intervalMs: 20, onSessionEnded }), {
        wrapper: withAuth(auth, new QueryClient()),
      })

      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(signOut).not.toHaveBeenCalled()
      expect(onSessionEnded).not.toHaveBeenCalled()
    })

    it('skips a tick once the session is gone', async () => {
      let token: string | null = 'initial'
      const refresh = vi.fn(async () => null)
      const auth: AuthProvider = {
        getToken: () => token,
        signOut: vi.fn(),
        refresh,
      }

      renderHook(() => useTokenPolling({ intervalMs: 20, enabled: true }), {
        wrapper: withAuth(auth, new QueryClient()),
      })

      await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
      const callsBeforeSignOut = refresh.mock.calls.length
      token = null

      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(refresh.mock.calls.length).toBe(callsBeforeSignOut)
    })
  })
})
