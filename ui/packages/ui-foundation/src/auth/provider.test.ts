import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMdkQueryClient } from '../query/client'
import { createAuthStore } from '../store/auth-store'
import { MdkFetchError } from '../types/api-mining.types'
import {
  applySession,
  type AuthProvider,
  bearerTokenAuth,
  isSessionExpiredError,
  noAuth,
  SESSION_EXPIRED_STATUS,
} from './provider'

/* A non-persisted store per test, so nothing leaks through localStorage. */
const freshStore = () => createAuthStore()

describe('isSessionExpiredError', () => {
  it('recognises a 401 MdkFetchError', () => {
    expect(isSessionExpiredError(new MdkFetchError(SESSION_EXPIRED_STATUS, 'nope'))).toBe(true)
  })

  it('rejects other statuses and other error types', () => {
    expect(isSessionExpiredError(new MdkFetchError(500, 'boom'))).toBe(false)
    expect(isSessionExpiredError(new Error('401'))).toBe(false)
    expect(isSessionExpiredError(undefined)).toBe(false)
  })
})

describe('bearerTokenAuth', () => {
  it('reads the token from the supplied store at call time', () => {
    const store = freshStore()
    const auth = bearerTokenAuth({ store })

    expect(auth.getToken()).toBeNull()
    store.getState().setToken('tok-1')
    expect(auth.getToken()).toBe('tok-1')
  })

  it('clears the store on signOut', () => {
    const store = freshStore()
    store.getState().setToken('tok-1')
    store.getState().setPermissions({ superAdmin: true })

    bearerTokenAuth({ store }).signOut()

    expect(store.getState().token).toBeNull()
    expect(store.getState().permissions).toBeNull()
  })

  it('defaults isSessionEnded to the 401 test', () => {
    const auth = bearerTokenAuth({ store: freshStore() })
    expect(auth.isSessionEnded?.(new MdkFetchError(401, 'x'))).toBe(true)
    expect(auth.isSessionEnded?.(new MdkFetchError(403, 'x'))).toBe(false)
  })

  it('honours an overridden isSessionEnded', () => {
    const auth = bearerTokenAuth({
      store: freshStore(),
      isSessionEnded: (e) => e instanceof MdkFetchError && e.status === 403,
    })
    expect(auth.isSessionEnded?.(new MdkFetchError(403, 'x'))).toBe(true)
    expect(auth.isSessionEnded?.(new MdkFetchError(401, 'x'))).toBe(false)
  })

  it('leaves getPermissions unset unless supplied', () => {
    expect(bearerTokenAuth({ store: freshStore() }).getPermissions).toBeUndefined()
  })
})

describe('noAuth', () => {
  it('never produces a token', () => {
    expect(noAuth().getToken()).toBeNull()
  })

  it('treats nothing as a session end, so an open API\'s 401 does not sign anyone out', () => {
    expect(noAuth().isSessionEnded?.(new MdkFetchError(401, 'x'))).toBe(false)
  })

  it('signs out without throwing', () => {
    expect(() => noAuth().signOut()).not.toThrow()
  })
})

describe('applySession', () => {
  it('writes the token and derived permissions together', () => {
    const store = freshStore()
    const provider = bearerTokenAuth({
      store,
      getPermissions: (token) => ({ caps: [token] }),
    })

    applySession(provider, store, 'tok-1')

    expect(store.getState().token).toBe('tok-1')
    expect(store.getState().permissions).toEqual({ caps: ['tok-1'] })
  })

  it('leaves permissions untouched when the provider derives none', () => {
    const store = freshStore()
    applySession(bearerTokenAuth({ store }), store, 'tok-1')

    expect(store.getState().token).toBe('tok-1')
    expect(store.getState().permissions).toBeNull()
  })

  it('resets both on a null or empty token', () => {
    const store = freshStore()
    const provider = bearerTokenAuth({ store, getPermissions: () => ({ superAdmin: true }) })

    applySession(provider, store, 'tok-1')
    applySession(provider, store, null)
    expect(store.getState().token).toBeNull()
    expect(store.getState().permissions).toBeNull()

    applySession(provider, store, 'tok-2')
    applySession(provider, store, '')
    expect(store.getState().token).toBeNull()
  })
})

describe('createMdkQueryClient — provider wiring', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the provider\'s token as the bearer credential', async () => {
    const store = freshStore()
    store.getState().setToken('tok-from-provider')
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const client = createMdkQueryClient({
      apiBaseUrl: 'http://api.test',
      auth: bearerTokenAuth({ store }),
    })

    const fetcher = client.getDefaultOptions().queries?.meta?.fetcher as
      | (<T>(url: string) => Promise<T>)
      | undefined
    await fetcher?.('http://api.test/auth/site')

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok-from-provider')
  })

  it('sends no credential under noAuth', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const client = createMdkQueryClient({ apiBaseUrl: 'http://api.test', auth: noAuth() })
    const fetcher = client.getDefaultOptions().queries?.meta?.fetcher as
      | (<T>(url: string) => Promise<T>)
      | undefined
    await fetcher?.('http://api.test/widgets')

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBeNull()
  })

  it('an explicit fetcher wins over the provider-derived one', () => {
    const custom = vi.fn()
    const client = createMdkQueryClient({ fetcher: custom as never, auth: noAuth() })

    expect(client.getDefaultOptions().queries?.meta?.fetcher).toBe(custom)
  })

  it('signs out and notifies once when several requests report the session ended', () => {
    const store = freshStore()
    store.getState().setToken('tok-1')
    const onSessionExpired = vi.fn()

    const client = createMdkQueryClient({
      auth: bearerTokenAuth({ store }),
      onSessionExpired,
    })

    const expired = new MdkFetchError(SESSION_EXPIRED_STATUS, 'expired')
    /* Two failures arriving together — the guard is keyed on the token still
     * being present, so the second is a no-op. */
    client.getQueryCache().config.onError?.(expired, {} as never)
    client.getQueryCache().config.onError?.(expired, {} as never)

    expect(store.getState().token).toBeNull()
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone for an error the provider does not count', () => {
    const store = freshStore()
    store.getState().setToken('tok-1')
    const onSessionExpired = vi.fn()

    const client = createMdkQueryClient({
      auth: bearerTokenAuth({ store }),
      onSessionExpired,
    })

    client.getQueryCache().config.onError?.(new MdkFetchError(500, 'boom'), {} as never)

    expect(store.getState().token).toBe('tok-1')
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('does not retry a request that ended the session, but retries others once', () => {
    const client = createMdkQueryClient({ auth: bearerTokenAuth({ store: freshStore() }) })
    const retry = client.getDefaultOptions().queries?.retry as (
      count: number,
      error: unknown,
    ) => boolean

    expect(retry(0, new MdkFetchError(SESSION_EXPIRED_STATUS, 'expired'))).toBe(false)
    expect(retry(0, new MdkFetchError(500, 'boom'))).toBe(true)
    expect(retry(1, new MdkFetchError(500, 'boom'))).toBe(false)
  })

  it('honours a provider that widens what ends a session', () => {
    const store = freshStore()
    store.getState().setToken('tok-1')
    const auth: AuthProvider = {
      ...bearerTokenAuth({ store }),
      isSessionEnded: (e) => e instanceof MdkFetchError && (e.status === 401 || e.status === 500),
    }

    const client = createMdkQueryClient({ auth })
    client.getQueryCache().config.onError?.(new MdkFetchError(500, 'boom'), {} as never)

    expect(store.getState().token).toBeNull()
  })
})
