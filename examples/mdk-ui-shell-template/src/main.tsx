import { MdkProvider } from '@tetherto/mdk-react-adapter'
import { authStore } from '@tetherto/mdk-ui-foundation'
import { gatewayRedirectAuth } from '@tetherto/mdk-ui-foundation/presets/mining'
import React from 'react'

import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { API_BASE_URL, APP_NAME, AUTH_BYPASS, OAUTH_BASE_URL } from './constants/env'
import { permissionsFromToken } from './constants/permissions'
import { router } from './router'
import '@tetherto/mdk-fonts/jetbrains-mono.css'

import '@tetherto/mdk-react-devkit/styles.css'
import '@tetherto/mdk-react-devkit/styles-domain.css'
import './index.scss'

document.title = APP_NAME

// --- Session ------------------------------------------------------------
// One object describes the whole auth flow: the Google redirect, capturing the
// `?authToken=` the Gateway redirects back with (and scrubbing it out of the
// address bar), and refreshing the token before it expires. `MdkProvider` runs
// the capture on mount, so there is nothing to do here but declare it.
//
// Swap this for `noAuth()` — or your own `AuthProvider` — to point the shell at
// a backend with a different session model.
//
// `getPermissions` is where your permission policy plugs in. MDK ships none, so
// without it every write affordance (vote, submit, cancel, comment) stays
// disabled. See ./constants/permissions.ts — that mapping is an example to
// replace, not a recommendation.
const auth = gatewayRedirectAuth({
  oauthBaseUrl: OAUTH_BASE_URL,
  getPermissions: permissionsFromToken,
})

// Dev-only auth bypass: when there's no OAuth redirect to capture, seed a stub
// token so token-reading components render and the router's guard (see
// ./router.tsx) passes without a real OAuth backend. `auth.bootstrap()` — run
// inside `MdkProvider` below — still wins over this if a real `?authToken=` is
// on the URL. Token-refresh polling for this stub session is separately
// disabled in `App.tsx`. Never enabled in production.
if (AUTH_BYPASS && !authStore.getState().token) {
  authStore.getState().setToken('dev-auth-bypass')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MdkProvider apiBaseUrl={API_BASE_URL} auth={auth}>
      <RouterProvider router={router} />
    </MdkProvider>
  </React.StrictMode>,
)
