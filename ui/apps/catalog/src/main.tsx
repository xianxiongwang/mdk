import '@tetherto/mdk-fonts/jetbrains-mono.css'
import '@tetherto/mdk-react-devkit/styles.css'
import '@tetherto/mdk-react-devkit/styles-domain.css'
import { MdkProvider } from '@tetherto/mdk-react-adapter'
import { noAuth } from '@tetherto/mdk-ui-foundation'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { router } from './router'
import './index.scss'
import { StrictMode } from 'react'

// Expose build info on the window and in the document title so it survives
// Terser's production console stripping (see `drop_console: true` in
// apps/catalog/vite.config.ts). Inspect via `window.__MDK_BUILD__` or
// `copy(window.__MDK_BUILD__)` in the browser console.
window.__MDK_BUILD__ = __BUILD_INFO__
document.title = `${document.title} · v${__BUILD_INFO__.version}`

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

// Every catalog page renders from bundled fixtures — there is no backend behind
// it and nothing to sign in to. `noAuth()` says that outright: no token is read,
// no `Authorization` header is sent, and no response can end a session that was
// never started. The previous bare `<MdkProvider>` inherited the mining Gateway
// flow by default, which was never true here.
ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <MdkProvider auth={noAuth()}>
      <RouterProvider router={router} />
    </MdkProvider>
  </StrictMode>,
)
