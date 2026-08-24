/**
 * @tetherto/mdk-ui-foundation — framework-agnostic headless core for the MDK Devkit.
 *
 * Exposes:
 *   - Zustand vanilla stores: auth / devices / timezone / notifications / actions
 *   - TanStack `QueryClient` factory (`createMdkQueryClient`) with environment-aware
 *     base URL resolution
 *   - Declarative resource builders (`createResourceQuery` /
 *     `createResourceMutation`) plus the runtime they read from the client:
 *     base URL, transport, endpoint map
 *   - Device-action submission builders (`device-actions.ts`): `DEVICE_ACTION` /
 *     `DEVICE_BATCH_ACTION` constants, per-action `buildXxx` helpers, cross-thing
 *     fan-out builders, and `buildDeviceActionSubmission` with the extras-override guard
 *   - Shared API types and pool/settings/chart type contracts
 *
 * The mining Gateway's own key registry, factories and request vocabulary live at
 * `@tetherto/mdk-ui-foundation/presets/mining`.
 */

export * from './auth'
export * from './constants'
/* The mining preset is deliberately NOT re-exported here. Its `t-*` tags,
 * `*_aggr` field names, Mongo selector composers, key registry and 36 factories
 * are one backend's vocabulary, so they are reachable only at
 * `@tetherto/mdk-ui-foundation/presets/mining`. Anything exported from this
 * barrel is a promise that it works against any backend. */
export * from './query'
export * from './store'
export * from './types'

export * from './utils'

export const VERSION = '0.0.1'
