import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GATEWAY_REFRESH_INTERVAL_MS, gatewayRedirectAuth } from '../auth'
import { createMdkQueryClient } from '@/query/client'
import { createAuthStore } from '@/store/auth-store'
import { MdkFetchError } from '@/types/api-mining.types'

const freshStore = () => createAuthStore()

/* A token in the Gateway's shape: the `roles:` segment is what `getRoles` reads
 * and what the refresh call echoes back. */
const TOKEN = 'session:abc:roles:admin:site_manager'

const stubLocation = (search: string) => {
  const replaceState = vi.fn()
  vi.stubGlobal('window', {
    location: { search, pathname: '/dashboard', hash: '' },
    history: { state: null, replaceState },
  })
  return replaceState
}

describe('gatewayRedirectAuth', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  describe('bootstrap', () => {
    it('captures a token off the redirect and scrubs it from the URL', () => {
      const store = freshStore()
      const replaceState = stubLocation(`?authToken=${TOKEN}&tab=live`)

      gatewayRedirectAuth({ store }).bootstrap?.()

      expect(store.getState().token).toBe(TOKEN)
      expect(replaceState).toHaveBeenCalledWith(null, '', '/dashboard?tab=live')
    })

    it('drops the query string entirely when the token was the only param', () => {
      const store = freshStore()
      const replaceState = stubLocation(`?authToken=${TOKEN}`)

      gatewayRedirectAuth({ store }).bootstrap?.()

      expect(replaceState).toHaveBeenCalledWith(null, '', '/dashboard')
    })

    it('is a no-op with no token on the URL, leaving a rehydrated session intact', () => {
      const store = freshStore()
      store.getState().setToken('rehydrated')
      const replaceState = stubLocation('?tab=live')

      gatewayRedirectAuth({ store }).bootstrap?.()

      expect(store.getState().token).toBe('rehydrated')
      expect(replaceState).not.toHaveBeenCalled()
    })

    it('does not rewrite history when the URL token already matches the stored one', () => {
      const store = freshStore()
      store.getState().setToken(TOKEN)
      const replaceState = stubLocation(`?authToken=${TOKEN}`)

      gatewayRedirectAuth({ store }).bootstrap?.()

      expect(replaceState).not.toHaveBeenCalled()
    })

    it('applies getPermissions to the captured token', () => {
      const store = freshStore()
      stubLocation(`?authToken=${TOKEN}`)

      gatewayRedirectAuth({
        store,
        getPermissions: (token) => ({ caps: token.split(':').slice(-2) }),
      }).bootstrap?.()

      expect(store.getState().permissions).toEqual({ caps: ['admin', 'site_manager'] })
    })
  })

  describe('signIn', () => {
    it('redirects to the Google OAuth path', () => {
      const location = { href: '', search: '', pathname: '/', hash: '' }
      vi.stubGlobal('window', { location, history: { state: null, replaceState: vi.fn() } })

      gatewayRedirectAuth({ oauthBaseUrl: 'https://oauth.test' }).signIn?.()

      expect(location.href).toBe('https://oauth.test/oauth/google')
    })

    it('trims trailing slashes off the base URL', () => {
      const location = { href: '', search: '', pathname: '/', hash: '' }
      vi.stubGlobal('window', { location, history: { state: null, replaceState: vi.fn() } })

      gatewayRedirectAuth({ oauthBaseUrl: 'https://oauth.test///' }).signIn?.()

      expect(location.href).toBe('https://oauth.test/oauth/google')
    })

    it('throws a directive error when no oauthBaseUrl was configured', () => {
      vi.stubGlobal('window', {
        location: { href: '', search: '', pathname: '/', hash: '' },
        history: { state: null, replaceState: vi.fn() },
      })

      expect(() => gatewayRedirectAuth().signIn?.()).toThrow(/oauthBaseUrl/)
    })
  })

  describe('refresh', () => {
    it('posts the current roles and returns the reissued token', async () => {
      const store = freshStore()
      store.getState().setToken(TOKEN)

      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ token: 'reissued' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      vi.stubGlobal('fetch', fetchSpy)

      const auth = gatewayRedirectAuth({ store })
      const client = createMdkQueryClient({ apiBaseUrl: 'http://api.test', auth })

      await expect(auth.refresh?.(client)).resolves.toBe('reissued')
      /* The provider adopts the new token itself — the caller only schedules. */
      expect(store.getState().token).toBe('reissued')

      const [url, init] = fetchSpy.mock.calls[0] ?? []
      expect(url).toBe('http://api.test/auth/token')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ roles: ['admin', 'site_manager'] })
    })

    it('resolves null without a request when there is no session to refresh', async () => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const auth = gatewayRedirectAuth({ store: freshStore() })
      const client = createMdkQueryClient({ apiBaseUrl: 'http://api.test', auth })

      await expect(auth.refresh?.(client)).resolves.toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('resolves null when the Gateway answers without a token', async () => {
      const store = freshStore()
      store.getState().setToken(TOKEN)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      const auth = gatewayRedirectAuth({ store })
      const client = createMdkQueryClient({ apiBaseUrl: 'http://api.test', auth })

      await expect(auth.refresh?.(client)).resolves.toBeNull()
    })
  })

  describe('session contract', () => {
    it('counts both 401 and 500 as the session ending', () => {
      const auth = gatewayRedirectAuth({ store: freshStore() })

      expect(auth.isSessionEnded?.(new MdkFetchError(401, 'x'))).toBe(true)
      expect(auth.isSessionEnded?.(new MdkFetchError(500, 'x'))).toBe(true)
      expect(auth.isSessionEnded?.(new MdkFetchError(404, 'x'))).toBe(false)
      expect(auth.isSessionEnded?.(new Error('500'))).toBe(false)
    })

    it('exposes the 250 s refresh cadence by default and honours an override', () => {
      expect(gatewayRedirectAuth().refreshIntervalMs).toBe(GATEWAY_REFRESH_INTERVAL_MS)
      expect(GATEWAY_REFRESH_INTERVAL_MS).toBe(250_000)
      expect(gatewayRedirectAuth({ refreshIntervalMs: 0 }).refreshIntervalMs).toBe(0)
    })

    it('reads roles out of the token', () => {
      expect(gatewayRedirectAuth().getRoles?.(TOKEN)).toEqual(['admin', 'site_manager'])
      expect(gatewayRedirectAuth().getRoles?.('no-roles')).toEqual([])
    })

    it('clears token and permissions on signOut', () => {
      const store = freshStore()
      store.getState().setToken(TOKEN)
      store.getState().setPermissions({ superAdmin: true })

      gatewayRedirectAuth({ store }).signOut()

      expect(store.getState().token).toBeNull()
      expect(store.getState().permissions).toBeNull()
    })

    it('derives no permissions unless the app supplies a mapping', () => {
      expect(gatewayRedirectAuth().getPermissions).toBeUndefined()
    })
  })
})
