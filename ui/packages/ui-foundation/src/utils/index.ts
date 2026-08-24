/**
 * Framework-agnostic utilities shared across the toolkit.
 *
 * Anything here MUST stay pure TypeScript with no React or DOM dependencies.
 * React-aware utilities live in `@tetherto/mdk-react-adapter`; UI-coupled
 * helpers (JSX renderers, devkit-core consumers) live in
 * `@tetherto/mdk-react-devkit`.
 *
 * The mining query dialect used to live here too — the `t-*` tags, `*_aggr`
 * field names and Mongo selector composers. It now sits under
 * `../presets/mining/dialect`, so this directory holds only helpers that are
 * genuinely backend-agnostic.
 */

export * from './auth-utils'
export * from './device-actions'
export * from './historical-log-chunks'
export * from './latest-sample'
export * from './settings-utils'
export * from './token-utils'
export * from './url-utils'
