---
title: Build a minimal single-page dashboard
description: "[⏱️ ~15 min] From an empty directory to a running Kernel, Worker, Gateway plugin, and MDK UI dashboard"
docs@tether_slug: tutorials/build-a-dashboard
---

> [!NOTE]
> If **Kernel**, **Worker**, or **Gateway** are unfamiliar terms, read [the architecture overview][architecture]
> first. This tutorial also assumes you've skimmed [Build a third-party Worker][build-a-worker]: the one Worker used
> here is [`backend/workers/samples/demo-worker`][demo-worker], the same zero-dependency reference Worker that tutorial
> is built around.

This guide builds the smallest version of [the Starter site example][mvp-site] (`examples/mvp-site`): **one Worker, one Gateway route, one React page**. It
teaches the same end-to-end shape, including its UI layer, `@tetherto/mdk-react-devkit`
components driven by `@tetherto/mdk-react-adapter` hooks. However, it does so without that example's family-specific adapters,
persistence, history, commands, multi-page router, or chart aggregation. 

> [!NOTE]
> This tutorial hand-assembles every piece to teach the wiring. To scaffold a real dashboard app against a stack you
> already have running, use [`mdk create dashboard` and `mdk run dashboard`](../../packages/cli/README.md) instead.

## Overview

This tutorial builds the smallest version of the full MDK stack: **one Worker, one Gateway route, one React page**.

What you'll have at the end:

```text
examples/minimal-dashboard/
  package.json
  start.js                     # boots Kernel + the one Worker + Gateway, one process
  plugins/
    dashboard/
      mdk-plugin.json           # one route: GET /overview
      controllers/
        overview.js             # lists every Worker's devices + live telemetry
  ui/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx                  # <MdkProvider> + render OverviewPage
      OverviewPage.tsx           # polls /overview, renders devkit components
```

No router, no charts, no hand-rolled CSS, just one page built from three
`@tetherto/mdk-react-devkit` primitives (`LabeledCard`, `DataTable`, `Badge`) and one
`@tetherto/mdk-react-adapter` hook (`useQuery`), the same building blocks [`examples/mvp-site/ui`](../../examples/mvp-site/ui/package.json) uses, minus the
parts (router, sidebar, line charts, domain panels) this single-page, single-Worker dashboard doesn't need.

## Prerequisites

- Node.js `>=24`
- This repo checked out, with the backend and UI dependencies installed once from the repository root:

  ```bash
  npm run setup:core
  npm run setup:workers
  npm run setup:ui
  npm run build:ui
  ```

  Running `npm run setup` from the [Starter site example](../../examples/mvp-site/README.md) (`examples/mvp-site`) is also supported, but it is
  broader: it installs these backend and UI dependencies plus the Starter site example and UI dependencies and builds the UI packages.
- Commands below assume you create a new `examples/minimal-dashboard/` directory alongside [`examples/mvp-site/`](../../examples/mvp-site/README.md)

<Steps>

<Step>

### Pick the Worker

Use [`backend/workers/samples/demo-worker`][demo-worker] as-is: it needs no worker-infra services (provisioning
stores, alert templates), just `WorkerRuntime` and its own bundled mock device. Nothing in the steps below is
specific to it, though: swap in `startWhatsminerWorker`, `startAntminerWorker`, or your own Worker from
[Build a third-party Worker][build-a-worker] and everything past the next step is unchanged.

</Step>

<Step>

### Boot Kernel and Worker in the same process

The simplest of the three discovery modes ([full trade-offs here][deployment-trade-offs]): one Node process owns both the
Kernel and the Worker, so there's no key file or DHT topic to manage.

`examples/minimal-dashboard/start.js`:

```js
'use strict'

const path = require('path')
const { getKernel, waitForDiscovery } = require('../../backend/core/mdk')
const { startDemoWorker } = require('../backend/demo-worker-caller')
const demoMock = require('../../backend/workers/samples/demo-worker/mock/server')

const ROOT = path.join(__dirname, '.mdk-data')
const MOCK_PORT = 9101
const HTTP_PORT = Number(process.env.MDK_HTTP_PORT) || 3000

function onceListening (mock) {
  if (mock.server.listening) return Promise.resolve()
  return new Promise((resolve) => mock.server.once('listening', resolve))
}

async function main () {
  // the one fake device this dashboard will show, swap for real hardware later
  const mock = demoMock.createServer({ host: '127.0.0.1', port: MOCK_PORT, serial: 'WM3-0001' })
  await onceListening(mock)

  // Kernel + the one Worker, same process
  const kernel = await getKernel({ root: ROOT })
  const worker = await startDemoWorker({
    workerId: 'demo-worker-1',
    storeDir: path.join(ROOT, 'demo-worker-store'),
    seedDevices: [{ id: 'demo-0', opts: { host: '127.0.0.1', port: MOCK_PORT } }]
  })
  await kernel.registerWorker(worker.runtime.getPublicKey())
  await waitForDiscovery(kernel, { minWorkers: 1 })

  console.log('worker registered: %s', worker.deviceIds.join(', '))
}

module.exports = { main, ROOT, HTTP_PORT }
if (require.main === module) main().catch((err) => { console.error(err); process.exit(1) })
```

The demo Worker package exports no module of its own: it is an `mdk-contract.json` plus `src/` handler files, loaded from its own
directory and instantiated per device by the Worker Runtime. The separate [`demo-worker-caller`][demo-worker-caller] used here owns that
runtime, device configuration, persistence, sampling, and shutdown.

`getKernel({ root: ROOT })` with no `topic`/`discovery` option defaults to DHT discovery with a fresh random topic.
This example then registers the Worker's public key directly because both objects are in the same process. See the
[discovery model][workers-discovery] for the DHT, Local, and Same-process options to use in other deployments.

</Step>

<Step>

### Write the one Gateway plugin route

A [Gateway plugin][gateway-plugins] is a directory with a manifest and a controller. This one has a single read-only
route that lists every registered Worker's devices and pulls each one's default `metrics` telemetry bundle, with no
per-device-family branching, because there's only one family here.

#### 3.1 Write the plugin manifest

`examples/minimal-dashboard/plugins/dashboard/mdk-plugin.json`:

```json
{
  "name": "@your-org/mdk-plugin-dashboard",
  "version": "0.1.0",
  "description": "Minimal dashboard plugin: one route that lists every registered device and its live telemetry.",
  "routes": [
    {
      "id": "dashboard.overview",
      "handler": "./controllers/overview.js",
      "http": { "method": "GET", "path": "/overview" },
      "description": "Live snapshot of every device across every registered Worker.",
      "safety": "read-only"
    }
  ]
}
```

#### 3.2 Write the controller

`examples/minimal-dashboard/plugins/dashboard/lib/client.js` builds the plugin's client once:

```js
'use strict'

const { config } = require('@tetherto/mdk-gateway/plugin')
const { createMdkClient } = require('@tetherto/mdk-client')

module.exports = createMdkClient(config)
```

`examples/minimal-dashboard/plugins/dashboard/controllers/overview.js`:

```js
'use strict'

const mdkClient = require('../lib/client')

module.exports = async function overview (req) {
  const { workers } = await mdkClient.listWorkers()

  const devices = await Promise.all(
    workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
      const tel = await mdkClient.pullTelemetry(deviceId, 'metrics')
      return { deviceId, workerId: w.workerId, workerState: w.state, ...tel.metrics }
    }))
  )

  return { ts: Date.now(), devices }
}
```

A controller is `async (req) => value`: return a plain object, the Gateway serializes it to JSON itself; you never touch
`res`. `mdkClient` is the same client used everywhere else in MDK, with no knowledge of the underlying MDK Protocol
envelope required.

> [!NOTE]
> With more than one Worker family mixed in (miners, powermeters, sensors, ...) you'd branch by
> `deviceFamily` instead of spreading `tel.metrics` blindly. [The Starter site's overview controller][mvp-site-overview]
> shows that pattern once you outgrow this one.

</Step>

<Step>

### Serve the plugin and static page from the same Gateway

Add `startGateway` to `start.js`, mounting the plugin via `extraPluginDirs` and the built UI (Step 5's `ui/dist`) via
`common.staticRootPath`. This is the complete canonical file; its boot order is mock, Kernel, Worker, registration,
readiness, then Gateway:

```js
'use strict'

const path = require('path')
const { getKernel, startGateway, waitForDiscovery } = require('../../backend/core/mdk')
const { startDemoWorker } = require('../backend/demo-worker-caller')
const demoMock = require('../../backend/workers/samples/demo-worker/mock/server')

const ROOT = path.join(__dirname, '.mdk-data')
const MOCK_PORT = 9101
const HTTP_PORT = Number(process.env.MDK_HTTP_PORT) || 3000

function onceListening (mock) {
  if (mock.server.listening) return Promise.resolve()
  return new Promise((resolve) => mock.server.once('listening', resolve))
}

async function main () {
  // Start the mock device before its Worker tries to connect.
  const mock = demoMock.createServer({ host: '127.0.0.1', port: MOCK_PORT, serial: 'WM3-0001' })
  await onceListening(mock)

  // Start Kernel, then the Worker runtime that hosts the demo Worker plugin.
  const kernel = await getKernel({ root: ROOT })
  const worker = await startDemoWorker({
    workerId: 'demo-worker-1',
    storeDir: path.join(ROOT, 'demo-worker-store'),
    seedDevices: [{ id: 'demo-0', opts: { host: '127.0.0.1', port: MOCK_PORT } }]
  })

  // Register the Worker and wait until it is ready before accepting HTTP traffic.
  await kernel.registerWorker(worker.runtime.getPublicKey())
  await waitForDiscovery(kernel, { minWorkers: 1 })

  await startGateway({
    kernel,
    port: HTTP_PORT,
    root: path.join(ROOT, 'gateway'),
    tmpdir: path.join(ROOT, 'gateway'),
    extraPluginDirs: [path.join(__dirname, 'plugins', 'dashboard')],
    common: { staticRootPath: path.join(__dirname, 'ui', 'dist') }
  })

  console.log('worker registered: %s', worker.deviceIds.join(', '))
  console.log(`dashboard up: http://localhost:${HTTP_PORT}/`)
}

module.exports = { main, ROOT, HTTP_PORT }
if (require.main === module) main().catch((err) => { console.error(err); process.exit(1) })
```

> [!WARNING]
> This route accepts any caller, because the Gateway applies no authentication of its own and this controller adds none. Keep the Gateway off
> untrusted networks while you work. A production deployment needs TLS termination, network policy, and
> [authentication and authorization inside each controller](../guides/gateway/plugins.md#auth-and-permissions); write routes additionally need input
> validation, rate limits, and auditing.

> [!IMPORTANT]
> Serve the built page from `common.staticRootPath`, not a separate server on its own port. Gateway plugin
> controllers only receive `(req)`, never the underlying reply object, so a controller has no way to set
> `Access-Control-Allow-Origin`, and Gateway has no built-in CORS support. Building the UI (Step 5) and serving
> `ui/dist` from `staticRootPath` keeps `fetch('/overview')` same-origin with zero CORS configuration. This is also
> why [`examples/mvp-site`](../../examples/mvp-site/README.md)'s Vite *dev* server proxies `/site/*` to the Gateway port instead of calling it
> cross-origin. Step 5's `vite.config.ts` proxies `/overview` the same way for hot-reload development.

</Step>

<Step>

### Write the single-page UI with MDK devkit components

Instead of hand-rolled HTML, the page is a small React + Vite app built from the same packages
[`examples/mvp-site/ui`](../../examples/mvp-site/ui/package.json) uses, so `@tetherto/mdk-react-adapter` for the provider and data hook, `@tetherto/mdk-react-devkit`
for the components, scaled down to what one route needs: no router (one page), no charts (no history endpoint
here), no sidebar. Three primitives do the job: `LabeledCard` for the section container, `DataTable` for the sortable
device grid, and `Badge` to color-code `workerState`.

`examples/minimal-dashboard/ui/package.json`:

```json
{
  "name": "@your-org/mdk-minimal-dashboard-ui",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "@tetherto/mdk-react-adapter": "file:../../../ui/packages/react-adapter",
    "@tetherto/mdk-react-devkit": "file:../../../ui/packages/react-devkit",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.3.5"
  }
}
```

`examples/minimal-dashboard/ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`examples/minimal-dashboard/ui/vite.config.ts`: the dev-only proxy so `fetch('/overview')` stays same-origin
against the Gateway port, the same pattern [`examples/mvp-site/ui/vite.config.ts`][mvp-site-vite-config] uses for `/site/*`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

declare const process: { env: Record<string, string | undefined> }

const apiPort = process.env.VITE_API_PORT || '3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.MDK_UI_PORT) || 3041,
    proxy: { '/overview': `http://localhost:${apiPort}` }
  }
})
```

`examples/minimal-dashboard/ui/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>MDK dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`examples/minimal-dashboard/ui/src/main.tsx`: `<MdkProvider>` wires the TanStack Query client `useQuery` needs and
resolves the API base URL, exactly as it does in [`examples/mvp-site/ui/src/main.tsx`][mvp-site-main-tsx]:

```tsx
import { MdkProvider } from '@tetherto/mdk-react-adapter'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import '@tetherto/mdk-react-devkit/styles.css'
import { OverviewPage } from './OverviewPage'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('ERR_ROOT_ELEMENT_MISSING')

// Same-origin: the Vite dev proxy forwards /overview to the gateway;
// in production the Gateway serves this build from staticRootPath.
ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <MdkProvider apiBaseUrl="">
      <OverviewPage />
    </MdkProvider>
  </StrictMode>
)
```

With no `auth` prop, `MdkProvider` defaults to `gatewayRedirectAuth()` (the bundled mining Gateway's OAuth-redirect
flow) minus a redirect target — fine for a read-only route with no `"auth": true` requirement, like this one. Pass
`auth={noAuth()}` instead for a backend that needs no session at all, or `auth={gatewayRedirectAuth({ oauthBaseUrl })}`
to enable sign-in.

Create `ui/src/OverviewPage.tsx` under your new `examples/minimal-dashboard/`: `useQuery` polls the route from Step 3 the same way
[`examples/mvp-site/ui/src/SitePage.tsx`][mvp-site-page] polls `/site/overview`; `DataTable` and `Badge` replace that page's
hand-rolled markup:

```tsx
import { useMdkContext, useQuery } from '@tetherto/mdk-react-adapter'
import type { DataTableColumnDef } from '@tetherto/mdk-react-devkit'
import { Badge, DataTable, LabeledCard } from '@tetherto/mdk-react-devkit/primitives'

type Device = {
  deviceId: string
  workerId: string
  workerState: string
  hashrate_rt?: number
  power?: number
  temperature?: number
}

type Overview = { ts: number; devices: Device[] }

function get<T>(base: string, path: string): Promise<T> {
  return fetch(`${base}${path}`).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
  })
}

function stateBadgeStatus(state: string): 'success' | 'error' | 'default' {
  if (state === 'ready') return 'success'
  if (state === 'offline') return 'error'
  return 'default'
}

const columns: DataTableColumnDef<Device, unknown>[] = [
  { accessorKey: 'deviceId', header: 'Device' },
  { accessorKey: 'workerId', header: 'Worker' },
  {
    id: 'workerState',
    header: 'Worker state',
    cell: ({ row }) => {
      const state = (row.original.workerState || 'unknown').toLowerCase()
      return <Badge status={stateBadgeStatus(state)} text={state} />
    }
  },
  {
    accessorKey: 'hashrate_rt',
    header: 'Hashrate (TH/s)',
    cell: ({ getValue }) => (Number(getValue()) || 0).toFixed(2)
  },
  {
    accessorKey: 'power',
    header: 'Power (W)',
    cell: ({ getValue }) => (Number(getValue()) || 0).toFixed(0)
  },
  {
    accessorKey: 'temperature',
    header: 'Temp (°C)',
    cell: ({ getValue }) => (Number(getValue()) || 0).toFixed(1)
  }
]

export function OverviewPage() {
  const { apiBaseUrl } = useMdkContext()
  const overview = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => get<Overview>(apiBaseUrl, '/overview'),
    refetchInterval: 3000
  })

  return (
    <div style={{ padding: 24 }}>
      <LabeledCard label="Devices" isFullWidth>
        <DataTable<Device>
          data={overview.data?.devices ?? []}
          columns={columns}
          getRowId={(row) => row.deviceId}
          loading={overview.isLoading}
          enablePagination={false}
        />
      </LabeledCard>
    </div>
  )
}
```

A controller is `async (req) => value`; a page is `useQuery` + devkit components, and neither one touches the
other's plumbing. `OverviewPage` never imports `mdkClient`, and `overview.js` never imports React.

</Step>

<Step>

### Run it

#### 6.1 Add package.json

`examples/minimal-dashboard/package.json`:

```json
{
  "name": "@your-org/mdk-minimal-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "npm --prefix ui run build",
    "start": "node start.js"
  }
}
```

#### 6.2 Start the dashboard

Install each package's own dependencies, build the UI once, then boot the backend:

```bash
cd examples/minimal-dashboard
npm install
npm --prefix ui install
npm run build
npm run start
```

Open `http://localhost:3000/`, where the page polls `/overview` every 3 seconds and shows the one `demo-0` device
reporting live telemetry from its mock. Confirm the API directly with:

```bash
curl -s http://localhost:3000/overview
```

You should see JSON shaped like `{ "ts": ..., "devices": [{ "deviceId": "demo-0", "workerId": "demo-worker-1", "workerState": "READY", "hashrate_rt": ..., "power": ..., "temperature": ... }] }`.

### Hot-reload UI development

Vite does **not** replace the Gateway. Without hot reload you open `:3000` (Gateway serves the built `ui/dist`). With hot
reload you still need the Gateway for `/overview`, and Vite only serves the React app and proxies that path.

Keep **both** terminals running:

**Terminal 1, Gateway** (do not stop this):

```bash
cd examples/minimal-dashboard
npm run start
```

Wait for `dashboard up: http://localhost:3000/`.

**Terminal 2, Vite**:

```bash
cd examples/minimal-dashboard
VITE_API_PORT=3000 npm --prefix ui run dev
```

Open **`http://localhost:3041/`** (the Vite port), not `:3000`. Step 5's proxy forwards `/overview` to the Gateway on
`VITE_API_PORT`. If Terminal 1 is down, Vite logs `http proxy error: /overview` / `ECONNREFUSED` and the table stays empty.

</Step>

</Steps>

## Next steps

- **More Workers, zero controller changes**: `overview.js` already loops over every registered Worker generically.
  Register a second Worker the same way (Step 2's `startDemoWorker` + `startWhatsminerWorker`, etc., both followed by
  `kernel.registerWorker(...)`) and it appears in `/overview` for free.
- **A write route**: Add a second manifest entry (`POST /devices/{deviceId}/command`) calling
  `mdkClient.sendCommand(deviceId, 'setPowerMode', { mode })`, following the `command.js` example in
  [Gateway plugins][gateway-plugins], and a `Button` in `OverviewPage.tsx` that `POST`s to it. Before deploying any
  physical write command, require narrowly scoped authorization, validate its payload and target state, apply rate
  limits, and record an audit trail.
- **More pages, charts, history**: Add `react-router` and a second route/page, or graduate to the domain layer
  (`@tetherto/mdk-react-devkit/domain`'s `LineChartCard`, `MetricCard`, header stats bar) once the Gateway plugin
  grows a history endpoint to feed them. Compare [`examples/mvp-site/ui/src/DashboardPage.tsx`][mvp-site-dashboard-page] and
  [`examples/mvp-site/backend/gateway-plugins/site/controllers/history.js`][mvp-site-history-controller] for that shape.
- **Separate processes or hosts**: Replace the direct registration in Step 2 with Local discovery for processes on
  one machine or DHT discovery for separate hosts, as described in the [discovery model][workers-discovery].

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `/overview` returns `{ devices: [] }` | `kernel.registerWorker(...)` wasn't awaited, or `startGateway` was called before `waitForDiscovery` resolved |
| `/overview` returns `500` / `Cannot read properties of null` | Controller spread `tel.metrics` when `pullTelemetry` returned `null`: use `(tel && tel.metrics) \|\| {}` as in Step 3 |
| `pullTelemetry` throws / device shows zeros | The Worker's `connect()` couldn't reach the mock at boot: confirm the mock's `listening` event fired before `startDemoWorker` seeded it (Step 2's `onceListening`) |
| Vite shows `http proxy error: /overview` / `ECONNREFUSED`, page at `:3041` has no data | Gateway is not listening on the proxy target: keep `npm run start` running in another terminal, and set `VITE_API_PORT` to that Gateway port (default `3000`). Open `:3041`, not `:3000` |
| Browser `fetch('/overview')` fails from Vite with CORS / wrong host when Gateway is up | See the CORS note in Step 4: the Vite proxy must target the Gateway (`VITE_API_PORT`); do not call a different origin from the page |
| `ERR_PLUGIN_HANDLER_NOT_FOUND: routes.dashboard.overview: ./controllers/overview.js` on Gateway boot | `extraPluginDirs` must point at the directory *containing* `mdk-plugin.json`, not the controller file itself |
| Gateway boots but the page 404s | `common.staticRootPath` must be an absolute path (`path.join(__dirname, 'ui', 'dist')`) pointing at a *built* UI (`npm run build` in Step 6), not a relative string or the unbuilt `ui/src` |
| `Cannot find module '@tetherto/mdk-react-devkit'` when building [`ui/`](../../ui/README.md) | Run the Prerequisites' `npm run setup:ui && npm run build:ui` from the repo root first: the UI packages ship pre-built `dist/` output that [`ui/`](../../ui/README.md)'s `package.json` depends on via `file:` links |

## Links

[mvp-site]: ../../examples/mvp-site/README.md
<!-- docs@tether.io: mvp-site → https://github.com/tetherto/mdk/tree/main/examples/mvp-site -->

[full-site]: ../../examples/full-site/README.md
<!-- docs@tether.io: full-site → https://github.com/tetherto/mdk/tree/main/examples/full-site -->

[mvp-site-overview]: ../../examples/mvp-site/backend/gateway-plugins/site/controllers/overview.js
<!-- docs@tether.io: mvp-site-overview → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/backend/gateway-plugins/site/controllers/overview.js -->

[mvp-site-vite-config]: ../../examples/mvp-site/ui/vite.config.ts
<!-- docs@tether.io: mvp-site-vite-config → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/ui/vite.config.ts -->

[mvp-site-main-tsx]: ../../examples/mvp-site/ui/src/main.tsx
<!-- docs@tether.io: mvp-site-main-tsx → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/ui/src/main.tsx -->

[mvp-site-page]: ../../examples/mvp-site/ui/src/SitePage.tsx
<!-- docs@tether.io: mvp-site-page → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/ui/src/SitePage.tsx -->

[mvp-site-dashboard-page]: ../../examples/mvp-site/ui/src/DashboardPage.tsx
<!-- docs@tether.io: mvp-site-dashboard-page → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/ui/src/DashboardPage.tsx -->

[mvp-site-history-controller]: ../../examples/mvp-site/backend/gateway-plugins/site/controllers/history.js
<!-- docs@tether.io: mvp-site-history-controller → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/backend/gateway-plugins/site/controllers/history.js -->

[architecture]: ../concepts/architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->

[build-a-worker]: ../guides/workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->

[demo-worker]: ../../backend/workers/samples/demo-worker/package.json
<!-- docs@tether.io: demo-worker → https://github.com/tetherto/mdk/blob/main/backend/workers/samples/demo-worker/package.json -->

[demo-worker-caller]: ../../examples/backend/demo-worker-caller/index.js
<!-- docs@tether.io: demo-worker-caller → https://github.com/tetherto/mdk/blob/main/examples/backend/demo-worker-caller/index.js -->

[deployment-trade-offs]: ../guides/deployment/index.md
<!-- docs@tether.io: deployment-trade-offs → guides/deployment -->

[workers-discovery]: ../../backend/workers/README.md
<!-- docs@tether.io: workers-discovery → reference/worker -->

[gateway-plugins]: ../guides/gateway/plugins.md
<!-- docs@tether.io: gateway-plugins → guides/gateway/plugins -->
