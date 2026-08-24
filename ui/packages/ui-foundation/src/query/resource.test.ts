import { describe, expect, it, vi } from 'vitest'

import { createMdkQueryClient } from './client'
import { HTTP_METHODS } from './endpoints'
import { createResourceMutation, createResourceQuery } from './resource'
import type { EndpointMap, Fetcher } from './runtime'

const ENDPOINTS: EndpointMap = {
  widgets: '/widgets',
  widget: '/widgets/:id',
  widgetAction: '/widgets/:id/actions/:verb',
}

const makeClient = (fetcher: Fetcher) =>
  createMdkQueryClient({ apiBaseUrl: 'https://api.test', endpoints: ENDPOINTS, fetcher })

const spyFetcher = () => {
  const calls: Array<{ url: string, init?: RequestInit }> = []
  const fetcher: Fetcher = async <T>(url: string, init?: RequestInit): Promise<T> => {
    calls.push({ url, init })
    return { ok: true } as T
  }
  return { fetcher, calls }
}

describe('createResourceQuery', () => {
  it('builds the key from the input and the URL from the endpoint', async () => {
    const { fetcher, calls } = spyFetcher()
    const widgetsQuery = createResourceQuery<unknown, { limit: number }>({
      endpoint: 'widgets',
      key: (input) => ['widgets', input],
      params: (input) => ({ limit: input.limit }),
    })

    const def = widgetsQuery(makeClient(fetcher), { limit: 10 })
    expect(def.queryKey).toEqual(['widgets', { limit: 10 }])

    await def.queryFn()
    expect(calls[0]?.url).toBe('https://api.test/widgets?limit=10')
  })

  it('omits the query string when the resource declares no params', async () => {
    const { fetcher, calls } = spyFetcher()
    const query = createResourceQuery({ endpoint: 'widgets', key: () => ['widgets'] })

    await query(makeClient(fetcher), undefined).queryFn()
    expect(calls[0]?.url).toBe('https://api.test/widgets')
  })

  it('fills path segments and URL-encodes them', async () => {
    const { fetcher, calls } = spyFetcher()
    const widgetQuery = createResourceQuery<unknown, { id: string }>({
      endpoint: 'widget',
      key: ({ id }) => ['widgets', id],
      pathParams: ({ id }) => ({ id }),
    })

    await widgetQuery(makeClient(fetcher), { id: 'a/b' }).queryFn()
    expect(calls[0]?.url).toBe('https://api.test/widgets/a%2Fb')
  })

  it('threads the abort signal through to the transport', async () => {
    const { fetcher, calls } = spyFetcher()
    const query = createResourceQuery({ endpoint: 'widgets', key: () => ['widgets'] })
    const controller = new AbortController()

    await query(makeClient(fetcher), undefined).queryFn({ signal: controller.signal })
    expect(calls[0]?.init?.signal).toBe(controller.signal)
  })

  it('defers URL construction so a descriptor can be built then left unused', () => {
    const { fetcher, calls } = spyFetcher()
    const widgetQuery = createResourceQuery<unknown, { id: string }>({
      endpoint: 'widget',
      key: ({ id }) => ['widgets', id],
      pathParams: ({ id }) => ({ id }),
    })

    // Adapter hooks build unconditionally and gate with `enabled`. Constructing
    // the descriptor with no id must not throw — only requesting it would.
    const def = widgetQuery(makeClient(fetcher), { id: '' })
    expect(def.queryKey).toEqual(['widgets', ''])
    expect(calls).toEqual([])
    expect(() => def.queryFn()).toThrow(/no value for ':id'/)
  })

  it('honours an explicitly passed fetcher over the client runtime', async () => {
    const runtime = spyFetcher()
    const override = spyFetcher()
    const query = createResourceQuery({ endpoint: 'widgets', key: () => ['widgets'] })

    await query(makeClient(runtime.fetcher), undefined, override.fetcher).queryFn()
    expect(override.calls).toHaveLength(1)
    expect(runtime.calls).toHaveLength(0)
  })
})

describe('createResourceMutation', () => {
  it('sends the payload as a JSON body with the declared method', async () => {
    const { fetcher, calls } = spyFetcher()
    const create = createResourceMutation<{ name: string }>({
      endpoint: 'widgets',
      method: HTTP_METHODS.POST,
      key: () => ['widgets', 'create'],
    })

    await create(makeClient(fetcher)).mutationFn({ name: 'w1' })

    expect(calls[0]?.url).toBe('https://api.test/widgets')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: 'w1' }))
    expect(calls[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('reshapes the body when the resource declares one', async () => {
    const { fetcher, calls } = spyFetcher()
    const vote = createResourceMutation<{ id: string, approve: boolean, local: string }>({
      endpoint: 'widgetAction',
      method: HTTP_METHODS.PUT,
      key: () => ['widgets', 'vote'],
      pathParams: ({ id }) => ({ id, verb: 'vote' }),
      body: ({ approve }) => ({ approve }),
    })

    await vote(makeClient(fetcher)).mutationFn({ id: 'w1', approve: true, local: 'dropped' })

    expect(calls[0]?.url).toBe('https://api.test/widgets/w1/actions/vote')
    // The client-only field never reaches the API.
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ approve: true }))
  })

  it('sends neither body nor Content-Type when the body resolves to undefined', async () => {
    const { fetcher, calls } = spyFetcher()
    const remove = createResourceMutation<{ ids: string[] }>({
      endpoint: 'widgets',
      method: HTTP_METHODS.DELETE,
      key: () => ['widgets', 'delete'],
      params: ({ ids }) => ({ ids }),
      body: () => undefined,
    })

    await remove(makeClient(fetcher)).mutationFn({ ids: ['a', 'b'] })

    expect(calls[0]?.url).toBe('https://api.test/widgets?ids=a%2Cb')
    expect(calls[0]?.init).toEqual({ method: 'DELETE' })
  })

  it('exposes the declared invalidation prefixes', () => {
    const { fetcher } = spyFetcher()
    const create = createResourceMutation<{ name: string }>({
      endpoint: 'widgets',
      method: HTTP_METHODS.POST,
      key: () => ['widgets', 'create'],
      invalidates: [['widgets'], ['dashboard']],
    })

    expect(create(makeClient(fetcher)).invalidates).toEqual([['widgets'], ['dashboard']])
  })

  it('defaults invalidates to an empty list', () => {
    const { fetcher } = spyFetcher()
    const create = createResourceMutation<undefined>({
      endpoint: 'widgets',
      method: HTTP_METHODS.POST,
      key: () => ['widgets', 'create'],
    })

    expect(create(makeClient(fetcher)).invalidates).toEqual([])
  })

  it('throws a named error for an endpoint no map defines', () => {
    const { fetcher } = spyFetcher()
    const broken = createResourceMutation<undefined>({
      endpoint: 'nope',
      method: HTTP_METHODS.POST,
      key: () => ['nope'],
    })

    expect(() => broken(makeClient(fetcher)).mutationFn(undefined)).toThrow(
      /no endpoint named 'nope'/,
    )
  })

  it('never reaches the global fetch', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const { fetcher } = spyFetcher()
    const create = createResourceMutation<undefined>({
      endpoint: 'widgets',
      method: HTTP_METHODS.POST,
      key: () => ['widgets'],
    })
    await create(makeClient(fetcher)).mutationFn(undefined)

    expect(globalFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
