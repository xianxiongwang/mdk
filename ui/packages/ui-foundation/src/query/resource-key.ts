/**
 * Generic cache-key builder for resources declared with `createResourceQuery`.
 *
 * TanStack matches keys structurally and prefix-first, so the shape of a key
 * decides what an invalidation reaches. `resourceKey` encodes the one convention
 * that makes that predictable: the resource name is always the first segment,
 * and the input — when there is one — is always the last.
 *
 * ```ts
 * resourceKey('widgets')                 // ['widgets']
 * resourceKey('widgets', { limit: 10 })  // ['widgets', { limit: 10 }]
 * resourceKey('widget', 'w-1')           // ['widget', 'w-1']
 * ```
 *
 * The first form is a prefix of the second, so
 * `invalidateQueries({ queryKey: resourceKey('widgets') })` clears every
 * parameterisation of the resource — which is nearly always what a write wants.
 * Pass `scope` to nest below the name (`resourceKey('widgets', input, ['live'])`
 * → `['widgets', 'live', input]`) when a resource has variants that should
 * invalidate independently.
 *
 * A param object is embedded as-is rather than serialised: TanStack hashes keys
 * deterministically with sorted object keys, so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` are the same key. Stringifying here would make them differ.
 *
 * Presets are free to hand-write their keys instead — the bundled mining preset
 * does, in `presets/mining/keys.ts`, because its keys mirror URL paths and
 * changing their shape would silently change invalidation behaviour. `resourceKey`
 * is for new resources, where there is no existing shape to preserve.
 *
 * @category query
 */

/** Cache key shape TanStack matches structurally for invalidation. */
export type ResourceKey = readonly unknown[]

export const resourceKey = (
  name: string,
  params?: unknown,
  scope: readonly string[] = [],
): ResourceKey =>
  /* `undefined` params are dropped rather than appended: a trailing `undefined`
   * is a distinct key from no segment at all, which would split the cache
   * between `resourceKey(name)` and `resourceKey(name, undefined)`. */
  params === undefined ? [name, ...scope] : [name, ...scope, params]
