import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'

import { createMdkQueryClient } from './client'
import { API_ENDPOINTS } from './endpoints'
import {
  appendQuery,
  buildUrl,
  type EndpointMap,
  type Fetcher,
  getEndpoints,
  getFetcher,
  getMdkRuntime,
  resolvePath,
} from './runtime'
/* The mining factories appear here only as the subject of the
 * "bring your own data source" proof below: the point is that a real preset's
 * factories route through an injected map they know nothing about. */
import { siteQuery, tailLogQuery } from '@/presets/mining/factories'
import { poolBalanceHistoryQuery, poolsQuery } from '@/presets/mining/pool-factories'

describe('buildUrl', () => {
  it('joins a base and a path', () => {
    expect(buildUrl('http://api.test', '/auth/site')).toBe('http://api.test/auth/site')
  })

  it('strips trailing slashes from the base', () => {
    expect(buildUrl('http://api.test///', '/auth/site')).toBe('http://api.test/auth/site')
  })

  it('adds a missing leading slash to the path', () => {
    expect(buildUrl('http://api.test', 'auth/site')).toBe('http://api.test/auth/site')
  })

  it('supports a relative base (reverse-proxy mode)', () => {
    expect(buildUrl('', '/auth/site')).toBe('/auth/site')
  })

  /* Trailing-slash trimming is a linear scan rather than `/\/+$/` — that regex
   * backtracks polynomially on slash-heavy input (ReDoS). This asserts the
   * result stays correct for a pathological base and returns promptly. */
  it('trims a pathological run of trailing slashes', () => {
    const base = `http://api.test${'/'.repeat(50_000)}`
    expect(buildUrl(base, '/auth/site')).toBe('http://api.test/auth/site')
  })

  it('leaves a base that is only slashes empty', () => {
    expect(buildUrl('///', '/auth/site')).toBe('/auth/site')
  })
})

describe('appendQuery', () => {
  it('returns the url untouched when no params survive', () => {
    expect(appendQuery('http://x/y', { a: undefined, b: null, c: [] })).toBe('http://x/y')
  })

  it('serializes scalars', () => {
    expect(appendQuery('http://x/y', { range: '1D', limit: 50, overwriteCache: true })).toBe(
      'http://x/y?range=1D&limit=50&overwriteCache=true',
    )
  })

  it('serializes arrays comma-separated', () => {
    expect(appendQuery('http://x/y', { ids: ['a', 'b', 'c'] })).toBe('http://x/y?ids=a%2Cb%2Cc')
  })
})

describe('resolvePath', () => {
  it('returns a static template untouched', () => {
    expect(resolvePath('/auth/site')).toBe('/auth/site')
  })

  it('substitutes a named segment', () => {
    expect(resolvePath('/devices/:id', { id: 'miner-01' })).toBe('/devices/miner-01')
  })

  it('substitutes several segments in one template', () => {
    expect(resolvePath('/auth/actions/:type/:id/vote', { type: 'voting', id: 7 })).toBe(
      '/auth/actions/voting/7/vote',
    )
  })

  it('URL-encodes each value', () => {
    expect(resolvePath('/devices/:id', { id: 'miner/01' })).toBe('/devices/miner%2F01')
  })

  it('throws when a placeholder has no value, naming the template', () => {
    expect(() => resolvePath('/devices/:id', {})).toThrow(/no value for ':id'/)
  })

  it('throws on an empty value rather than building a path with a hole', () => {
    // `/auth/pools//balance-history` was the old silent behaviour.
    expect(() => resolvePath('/auth/pools/:pool/balance-history', { pool: '' })).toThrow()
  })
})

describe('runtime readers', () => {
  it('reports no fetcher or endpoints for a hand-built client', () => {
    const client = new QueryClient()
    expect(getFetcher(client)).toBeUndefined()
    expect(getEndpoints(client)).toBeUndefined()
  })

  it('falls back to the default base URL for a hand-built client', () => {
    expect(getMdkRuntime(new QueryClient()).baseUrl).toBe('http://localhost:3000')
  })

  it('exposes what createMdkQueryClient was given', () => {
    const fetcher: Fetcher = async () => ({}) as never
    const endpoints: EndpointMap = { site: '/v2/site' }
    const client = createMdkQueryClient({ apiBaseUrl: 'https://api.test', fetcher, endpoints })

    expect(getMdkRuntime(client)).toEqual({
      baseUrl: 'https://api.test',
      fetcher,
      endpoints,
    })
  })

  it('carries the runtime on mutations as well as queries', () => {
    const fetcher: Fetcher = async () => ({}) as never
    const client = createMdkQueryClient({ fetcher })
    const meta = client.getDefaultOptions().mutations?.meta as { fetcher?: Fetcher }
    expect(meta.fetcher).toBe(fetcher)
  })
})

describe('bring your own data source', () => {
  /**
   * The point of the whole refactor: the same factories, and the ~77 adapter
   * hooks above them, driven by someone else's API — no fork of this package,
   * and no call-site change.
   */
  const OTHER_API: EndpointMap = {
    site: '/v2/location',
    tailLog: '/v2/metrics',
    pools: '/v2/workers',
    poolBalanceHistory: '/v2/workers/:pool/history',
  }

  const fixtureFetcher = (fixtures: Record<string, unknown>) => {
    const seen: string[] = []
    const fetcher: Fetcher = async <T>(url: string): Promise<T> => {
      seen.push(url)
      const path = url.replace('https://other.test', '').split('?')[0] ?? ''
      return fixtures[path] as T
    }
    return { fetcher, seen }
  }

  it('routes a static endpoint to the injected map and returns injected data', async () => {
    const { fetcher, seen } = fixtureFetcher({ '/v2/location': { site: 'Somewhere Else' } })
    const client = createMdkQueryClient({
      apiBaseUrl: 'https://other.test',
      endpoints: OTHER_API,
      fetcher,
    })

    const result = await siteQuery(client).queryFn()

    expect(seen).toEqual(['https://other.test/v2/location'])
    expect(result).toEqual({ site: 'Somewhere Else' })
  })

  it('routes a query-param endpoint and preserves the params', async () => {
    const { fetcher, seen } = fixtureFetcher({ '/v2/metrics': [[{ ts: 1 }]] })
    const client = createMdkQueryClient({
      apiBaseUrl: 'https://other.test',
      endpoints: OTHER_API,
      fetcher,
    })

    const result = await tailLogQuery(client, { key: 'stat-1m', limit: 10 }).queryFn()

    expect(seen[0]).toBe('https://other.test/v2/metrics?key=stat-1m&limit=10')
    expect(result).toEqual([[{ ts: 1 }]])
  })

  it('substitutes a dynamic segment from the injected template', async () => {
    const { fetcher, seen } = fixtureFetcher({ '/v2/workers/pool-a/history': { log: [] } })
    const client = createMdkQueryClient({
      apiBaseUrl: 'https://other.test',
      endpoints: OTHER_API,
      fetcher,
    })

    await poolBalanceHistoryQuery(client, 'pool-a', { range: '1D' }).queryFn()

    expect(seen[0]).toBe('https://other.test/v2/workers/pool-a/history?range=1D')
  })

  it('accepts a partial map, falling back to the mining path for the rest', async () => {
    const { fetcher, seen } = fixtureFetcher({
      '/v2/workers': { pools: [] },
      [API_ENDPOINTS.site]: { site: 'Mining default' },
    })
    // Only `pools` is redirected; `site` is absent from the override.
    const client = createMdkQueryClient({
      apiBaseUrl: 'https://other.test',
      endpoints: { pools: '/v2/workers' },
      fetcher,
    })

    await poolsQuery(client).queryFn()
    await siteQuery(client).queryFn()

    expect(seen).toEqual([
      'https://other.test/v2/workers',
      `https://other.test${API_ENDPOINTS.site}`,
    ])
  })

  it('never touches the global fetch when a fetcher is injected', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const { fetcher } = fixtureFetcher({ '/v2/location': { site: 'x' } })
    const client = createMdkQueryClient({
      apiBaseUrl: 'https://other.test',
      endpoints: OTHER_API,
      fetcher,
    })

    await siteQuery(client).queryFn()

    expect(globalFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still defaults to the mining preset when nothing is injected', () => {
    const client = createMdkQueryClient({ apiBaseUrl: 'https://gateway.test' })
    // Same descriptor shape as before the seam existed.
    expect(siteQuery(client).queryKey).toEqual(['auth', 'site'])
    expect(getEndpoints(client)).toBeUndefined()
  })
})
