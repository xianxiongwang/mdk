import { RequireAuth } from '@tetherto/mdk-react-devkit'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'

import { App } from './App'
import { AUTH_BYPASS } from './constants/env'
import { ROUTE_PATHS } from './constants/routes'
import Home from './pages/Home'
import NotFound from './pages/NotFound'
import SignIn from './pages/SignIn'
import { ROUTES } from './routes'

export const router = createBrowserRouter([
  {
    path: ROUTE_PATHS.SIGN_IN,
    element: <SignIn />,
  },
  {
    path: '/',
    // AUTH_BYPASS (dev): render the app directly, skipping the sign-in gate.
    element: AUTH_BYPASS
      ? <App />
      : (
          <RequireAuth fallback={<Navigate to={ROUTE_PATHS.SIGN_IN} replace />}>
            <App />
          </RequireAuth>
        ),
    children: [
      { index: true, element: <Navigate to={ROUTE_PATHS.HOME} replace /> },
      {
        path: ROUTE_PATHS.HOME.replace(/^\//, ''),
        element: <Home />,
      },
      // Feature pages are added by `mdk-ui add page` into `./routes`; deep-link
      // params (e.g. Alerts' `/:uuid?`) come from each route's `routePath`.
      ...ROUTES.map((route) => {
        const Page = lazy(route.page)
        return {
          path: (route.routePath ?? route.path).replace(/^\//, ''),
          element: (
            <Suspense fallback={<div className="mdk-ui-shell-loader">Loading…</div>}>
              <Page />
            </Suspense>
          ),
        }
      }),
      { path: '*', element: <NotFound /> },
    ],
  },
])
