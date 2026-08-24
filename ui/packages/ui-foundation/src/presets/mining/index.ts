/**
 * The mining Gateway preset — everything that knows what *this* backend looks
 * like, gathered in one place.
 *
 * MDK ships this bundled and wired as the default, so an app targeting the
 * mining Gateway needs no configuration. It is a preset rather than the core,
 * though: the generic engine in `../../query/runtime.ts` has no knowledge of it,
 * and `createMdkQueryClient({ endpoints, fetcher })` replaces it wholesale.
 *
 * Contents:
 * - `dialect/` — tags, aggregate field names, field projections and the Mongo
 *   selector composers that build this backend's request params.
 * - `keys.ts` — the query-key registry. Keys mirror Gateway URL paths, which is
 *   exactly why they are preset-scoped: their shape is this API's shape, and it
 *   decides what an invalidation reaches.
 * - `factories.ts` / `pool-factories.ts` — the 36 read/write factories, one per
 *   Gateway endpoint, each pairing a key with a request built from the client's
 *   runtime.
 *
 * `API_ENDPOINTS` stays in the core (`../../query/endpoints.ts`): it is the
 * bundled *default* map that `endpointUrl` falls back to, so the core has to be
 * able to name it. Still to move here (tracked): the mining response types in
 * `../../types/`.
 */

export * from './auth'
export * from './dialect'
export * from './factories'
export { type QueryKeyMap, queryKeys } from './keys'
export * from './pool-factories'
