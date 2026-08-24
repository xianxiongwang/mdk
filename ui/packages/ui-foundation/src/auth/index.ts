/**
 * Framework-agnostic authentication seam. React bindings live in
 * `@tetherto/mdk-react-adapter`; the mining Gateway's implementation lives in
 * `@tetherto/mdk-ui-foundation/presets/mining`.
 */

export {
  applySession,
  type AuthProvider,
  type AuthTokenStore,
  bearerTokenAuth,
  type BearerTokenAuthOptions,
  isSessionExpiredError,
  noAuth,
  SESSION_EXPIRED_STATUS,
} from './provider'
