import { authStore } from '@tetherto/mdk-ui-foundation'
import { useEffect } from 'react'
import { useStore } from 'zustand'

import { useMdkAuth } from '../provider/mdk-provider'

/**
 * Adopts whatever session the environment is offering, then returns the current
 * token so callers can react to it (e.g. redirect once signed in).
 *
 * The capture itself is the provider's `bootstrap`. For the bundled mining
 * Gateway that means reading `?authToken=` off the OAuth redirect and scrubbing
 * it from the address bar via `history.replaceState`, so the token never lingers
 * in the URL or in browser history. A provider with no `bootstrap` (`noAuth`, or
 * one whose credentials come from elsewhere) makes this a pure read.
 *
 * Router-agnostic by design — pair with any client-side router, or none.
 *
 * `MdkProvider` also calls `bootstrap` on mount, so a tree inside it does not
 * need this hook to capture the token. It remains the right hook for *reading*
 * the token, and stays safe to call because `bootstrap` is idempotent.
 *
 * @example
 * ```tsx
 * const App = () => {
 *   const token = useAuthToken()
 *   return token ? <Outlet/> : <Navigate to="/signin" replace />
 * }
 * ```
 * @category auth
 */
export const useAuthToken = (): string | null => {
  const auth = useMdkAuth()
  /* Subscribes to the store rather than calling `auth.getToken()`, which is a
   * plain read and cannot trigger a re-render. A provider keeping its token
   * elsewhere still works — it just re-renders on its own schedule. */
  const token = useStore(authStore, (s) => s.token)

  useEffect(() => {
    auth.bootstrap?.()
  }, [auth])

  return token
}
