
# v0.0.1

The first release labels used a pre-SemVer `V-0.0.x-beta` scheme. These were realigned to SemVer 
(0.0.2 -> v0.2.0, 0.0.3 -> v0.3.0); see CHANGELOG.md for the current entries. 
v0.0.1 remains as [originally released](../release-notes/0.0.1-release.md).

# v0.2.0

> Also, see the [v0.2.0 release notes](../release-notes/0.2.0-release.md).

MDK v0.2.0 is a major architectural overhaul release. The monorepo has been restructured into three fully federated domains (`backend/core`, `backend/workers`, `ui`), the Worker layer has been promoted to a first-class package with a formal protocol contract, the UI state layer has been rewritten around Zustand and React 19, and a new agent-first CLI and MCP endpoint land as net-new additions.

## Breaking changes

### Node.js minimum version bumped to `>=24`

All packages now require Node.js 24+. The previous minimum was Node.js 20.

### Monorepo directory layout restructured

| 0.0.1 path | 0.2.0 path |
|---|---|
| `core/` | `backend/core/` |
| `ui-client/` | `ui/` |
| `core/packages/miners/` | `backend/workers/miners/` |
| `core/packages/containers/` | `backend/workers/containers/` |
| `core/packages/powermeters/` | `backend/workers/power-meter/` |
| `core/packages/sensors/` | `backend/workers/temperature/` |
| `core/packages/minerpools/` | `backend/workers/minerpools/` |
| `core/packages/mdk/ork/` | `backend/core/ork/` |
| `core/packages/mdk/app-node/` | `backend/core/app-node/` |

Workers are no longer nested inside `core/packages/`. They live in a standalone `backend/workers/` domain 
with their own install and test lifecycle.

### `LIB_TYPES` path constants updated

Worker type identifiers changed:

| 0.0.1 | 0.2.0 |
|---|---|
| `'mdk/ork'` | `'core/ork'` |
| `'mdk/app-node'` | `'core/app-node'` |

Worker-specific paths follow the new `'workers/<category>/<provider>'` pattern (e.g. `'workers/miners/antminer'`, `'workers/containers/bitdeer'`).

### UI package manager switched from pnpm to npm

`pnpm-lock.yaml` has been replaced by `package-lock.json`. All `catalog:` dependency references have been removed and replaced with explicit version ranges. The workspace root package name changed from `@tetherto/mdk-core-ui` to `mdk-ui`.

### UI package structure replaced

The `packages/core` and `packages/foundation` packages have been removed and replaced by four new packages:

| Removed (0.0.1) | Replacement (0.2.0) |
|---|---|
| `packages/core` (monolithic component lib) | `@tetherto/mdk-react-devkit` |
| `packages/foundation` (domain components) | `@tetherto/mdk-react-devkit` (foundation/) |
| — | `@tetherto/mdk-ui-core` (framework-agnostic state) |
| — | `@tetherto/mdk-react-adapter` (React bindings) |
| — | `@tetherto/mdk-ui-cli` (`mdk-ui` CLI) |

### State management migrated from Redux Toolkit to Zustand

Redux slices (`auth`, `notification`, `actions`, `devices`, `timezone`) have been removed and replaced by Zustand vanilla stores in `@tetherto/mdk-ui-core`.

### React upgraded from 18 to 19

All UI packages now target React 19.

### Core MDK API replaced

`core/lib/mdk.js` (exporting `initType`, `startApi`, `initialize`) is replaced by `backend/core/mdk/index.js` with an explicit async API:

```js
// 0.0.1
const { initType, startApi } = require('@tetherto/mdk-core')
await startApi(port)
await initType(MyMinerClass, rack)

// 0.2.0
const { getOrk, startWorker, startAppNode, waitForDiscovery } = require('@tetherto/mdk-core/mdk')
const ork = await getOrk()
await startWorker(MyMinerClass, { ork, rack })
await startAppNode({ ork, port: 3000 })
await waitForDiscovery(ork)
```

## Added

### Federated root orchestrator

A new root `package.json` wires all three domains with unified scripts that fan out to each domain:

```bash
npm run setup       # install all domains
npm run build       # build all domains
npm run test        # test all domains
npm run lint        # lint all domains
npm run typecheck   # typecheck all domains
npm run ci          # CI-mode (lockfile-faithful) install
npm run clean       # tear down artifacts and node_modules
npm run link-check  # validate all markdown links
```

Per-domain variants available as `:ui`, `:core`, `:workers` suffixes.

### Backend: Orchestration Kernel (`backend/core/ork/`)

Full rewrite of the ORK as a structured `OrkManager` class with discrete internal modules:

| Module | Responsibility |
|---|---|
| `discovery/dht-listener` | Joins Hyperswarm DHT; finds Workers by topic key |
| `transport/hrpc-gateway` | Opens HRPC channels to each discovered Worker |
| `transport/ipc-gateway` | UNIX socket gateway for app-node consumers |
| `transport/worker-channel` | Per-Worker channel management |
| `modules/worker-registry` | Strict device-to-Worker ownership mapping |
| `modules/telemetry-collector` | Pull-only telemetry collection |
| `modules/command-dispatcher` | Routes commands by `deviceId` to the correct Worker |
| `modules/health-monitor` | Tracks Worker and device health states |
| `modules/scheduler` | Coordinates pull intervals to prevent overload |
| `protocol/envelope` | Binary envelope codec (`serialize` / `deserialize`) |
| `protocol/actions` | Canonical action catalogue |
| `protocol/schemas` | Hyperschema-based envelope validation |
| `storage/stores` | Persistent registry between restarts |
| `storage/wal` | Write-ahead log for command state |

### Backend: new MDK API (`backend/core/mdk/index.js`)

| Export | Description |
|---|---|
| `getOrk(opts)` | Initialize and return an `OrkManager`; reads DHT topic from `DEFAULT_TOPIC_FILE` by default |
| `startOrk(opts)` | Explicit ORKstartup (backward-compatible form) |
| `startWorker(ManagerClass, opts)` | Start a Worker; auto-generates and persists DHT topic; loads `mdk-contract.json` |
| `startAppNode(opts)` | Start the app-node HTTP server programmatically with config-file bootstrapping |
| `waitForDiscovery(ork, timeout)` | Poll until at least one Worker reaches `READY` state |
| `startServices(config)` | Orchestrate multiple services via PM2 or Docker |
| `DEFAULT_TOPIC_FILE` | Well-known path for the persisted DHT topic |
| `DEFAULT_IPC_SOCK` | Well-known UNIX socket path for ORK ↔ app-node IPC |

### Backend: services module (`backend/core/mdk/services.js`)

`startServices(config)` supports two runtimes:

- **PM2** — generates `ecosystem.config.js` with optional auto-start
- **Docker** — generates `docker-compose.generated.yml` (Compose v3.8) with volume mounts and environment injection

Config shape:
```js
{
  runtime: 'pm2' | 'docker',
  env: 'development' | 'production',
  services: [
    { kind: 'app-node', name, port },
    { kind: 'worker', name, worker, type, rack }
  ],
  shouldAutoStart: boolean,
  image?: string   // docker only
}
```

### Backend: MDK Worker adapter (`backend/workers/base/lib/mdk-worker-adapter.js`)

New `MDKWorkerAdapter` class manages every Worker's Hyperswarm RPC server and DHT peer discovery:

- Listens on the `'mdk'` protocol channel
- Routes telemetry pull and command requests via `handleRequest(envelope)`
- Manages persistent DHT/RPC keypairs in Hyperbee (`_getOrCreateSeed()`)
- `start()` / `stop()` / `getPublicKey()` / `_joinDiscoveryTopic()`

### Backend: Worker contract system (`mdk-contract.json`)

Every Worker now ships a machine-readable `mdk-contract.json` declaring its full surface:

| Section | What it declares |
|---|---|
| `metadata` | Provider, deviceFamily, brand, modelsSupported, overview |
| `devices` | Device instance descriptors |
| `capabilities.telemetry` | Named metrics with units (hashrate_rt/avg, power, temperature, fan speeds, uptime, shares, efficiency, power_mode) |
| `capabilities.commands` | Named commands with input constraints (reboot, setPowerMode, setLED, setupPools, setPowerPct, registerThing, updateThing, forgetThings) |
| `capabilities.config` | Configuration schema |
| `capabilities.health` | States, alerts, and troubleshooting entries |
| `capabilities.errors` | Error catalogue |

A JSON Schema for validating contracts ships at `backend/workers/base/mdk-contract.schema.json`.

### Backend: new Worker packages

Workers promoted to `backend/workers/` with `base` templates for each category:

| Category | Workers |
|---|---|
| `miners/` | antminer (S19XP, S19XPH, S21, S21PRO), avalon, whatsminer (M56S) |
| `containers/` | antspace, bitdeer, microbt |
| `minerpools/` | ocean, f2pool |
| `power-meter/` | abb, satec, schneider, **electricity** (new) |
| `temperature/` | seneca |

Each Worker ships: `mdk-contract.json`, `README.md`, `USAGE.md` (where applicable), `examples/`, and a mock server.

New `base` templates added per category: `miners/base`, `containers/base`, `minerpools/base`, `power-meter/base`, `temperature/base`, and the universal `base/`.

### Backend: `electricity` power meter (new)

New `power-meter/electricity` Worker for electricity utility data sources.

### Backend: App-Node improvements

- Fleet aggregation: computes site-level hashrate, average temperature, and cross-rack efficiency
- **MCP (Model Context Protocol) server endpoint** — AI agents can query fleet state and issue commands
- `setup-config.sh` — one-shot config file bootstrapping for first-run deployments
- Comprehensive test suite: unit tests for all handlers, routes, and lib utilities; integration tests for HTTP API and WebSocket

### Backend: config bootstrapping

- `ensureConfigFromExamples(packageDir)` — auto-copies `.example` config files to runtime locations on first start
- `findRepoRoot()` — resolves monorepo root from any nested package path

### UI: `@tetherto/mdk-ui-core` (new package)

Framework-agnostic, pure TypeScript state layer:

- **Zustand vanilla stores**: `authStore`, `devicesStore`, `notificationStore`, `timezoneStore`, `actionsStore`
- `TanStack QueryClient` factory with environment-aware base URL resolution
- Entry points: `.` (main), `./store`, `./query`, `./types`, `./stores.json` (machine-readable registry)

### UI: `@tetherto/mdk-react-adapter` (new package)

React bindings for `mdk-ui-core`:

- `<MdkProvider>` — top-level React context wrapper
- Hooks: `useAuth()`, `useDevices()`, `useNotifications()`, `useTimezone()`, `useActions()`
- Re-exports `useQuery` and `useMutation` from TanStack Query v5
- Entry points: `.`, `./hooks`, `./provider`, `./hooks.json`

### UI: `@tetherto/mdk-react-devkit` (new package)

Full React component library replacing `packages/core` and `packages/foundation`:

**Core UI primitives** (`src/core/`): accordion, alert, avatar, button, checkbox, dialog, input, label, multi-level-select, separator, skeleton, slider, spinner, switch, tabs, Toast, and more.

**Domain components** (`src/foundation/`): active-incidents-card, alarm, alerts, chart-wrapper, container, dashboard, device-explorer; financial report widgets (hash-balance, cost, EBITDA, energy-balance, subsidy-fee, efficiency); explorer views for Bitdeer, Bitmain, Bitmain Immersion, MicroBT; line-chart-card, pool-details, pool-manager, reporting-tool, settings, stats-export, timeline-chart, widget-top-row.

**New interactive visualization dependencies**:
- `react-selecto@1.26.3` — drag-to-select across chart elements
- `react-zoom-pan-pinch@4.0.3` — zoom/pan/pinch for dashboards and charts

Entry points: `.`, `./core`, `./foundation`, `./domain`, `./feature`, `./registry.json`, `./blueprints.json`, `./styles.css`, `./tokens.scss`.

### UI: `@tetherto/mdk-ui-cli` (`mdk-ui`) (new package)

Agent-first CLI for the UI toolkit:

- Binary: `mdk-ui`
- Built with `commander@12.1.0`
- Commands: registry discovery, doc/example fetching, page scaffolding, typecheck helpers
- Ships `dist/cli-manifest.json` for tooling discovery

### UI: new scripts

| Script | What it does |
|---|---|
| `build:registry` | Generates `registry.json` (component metadata for agent consumption) |
| `check:agent-ready` | Validates workspace compliance with the agent-ready contract |
| `api:surface` | Generates the public API surface documentation |
| `lint:scss` | Dedicated SCSS linting via Stylelint |

### UI: new dev dependencies

- `stylelint@^17.11.1` — CSS/SCSS linting
- `typedoc@^0.28.19` — API documentation generation
- `zod@^3.24.0` — runtime schema validation
- `@tetherto/mdk-ui-cli@*` — MDK UI CLI tooling
- `vite@^7.3.2`

### UI: agent-first docs

- `ui/AGENTS.md` — contract overview and quick recipe for LLM consumers
- `ui/docs/AGENT_FIRST.md` — manifests, blueprints, registry, and `mdk-ui-shell` end-to-end recipe

### Documentation (`docs/`)

New root-level `docs/` directory with role-based navigation:

| Section | Contents |
|---|---|
| `docs/concepts/` | `about.md`, `architecture.md`, `terminology.md`, `deployment-topologies.md` |
| `docs/tutorials/` | `get-started/` — three-rung onboarding (observe → interact → build) |
| `docs/reference/` | `release-notes/`, `maintainers/` |
| `backend/workers/docs/` | `architecture.md`, `install-pattern.md`, `agent-ready.md`, `supported-hardware.md`, `catalogue.json`, `workers-manifest.yaml`, `orchestrator.md` |

### CI/CD

- Replaced separate `ui.yaml` + `core.yaml` workflows with a unified `ci.yml`
- Added `link-check.yml` workflow
- Added composite actions: `node-setup-cache` and `node-restore-cache` for faster CI installs
- Moved `audit-ci.jsonc` to `.github/scripts/`

### Repo-level additions

- Root `.gitignore`
- `CHANGELOG.md` in project root
- `linkinator.config.json` for markdown link validation (`npm run link-check`)
- `.claude/settings.local.json`: Claude Code project settings

## Changed

### Backend

- `initialize()` path resolution updated for new monorepo nesting depth
- Root `core/package.json` simplified — external runtime dependencies moved to individual sub-package 
manifests; only `standard@17.1.0` remains as a root dev dependency
- Test and install lifecycle managed via `install-packages.sh` and `test-packages.sh` workspace shell scripts

### UI

- Package manager: pnpm → npm (engine constraint: `npm >=11.0.0`)
- Node.js engine constraint: `node >=20.0.0` → `node >=24.0.0`
- Demo app renamed from `mdk-demo-ui` to `mdk-catalog-ui` (scripts updated: `build:demo` → `build:catalog`, `dev:demo` → `dev:catalog`, `preview:demo` → `preview:catalog`)
- `turbo` upgraded from catalog pin to `^2.9.14`
- `eslint` upgraded to `^9.39.2`; `@antfu/eslint-config` to `^6.7.3`

## Removed

- `core/` top-level directory (replaced by `backend/core/`)
- `ui-client/` top-level directory (replaced by `ui/`)
- `core/packages/` Worker packages (promoted to `backend/workers/`)
- `core/packages/mdk/ork/` and `core/packages/mdk/app-node/` (promoted to `backend/core/ork/` and `backend/core/app-node/`)
- `core/packages/mdk/mock-control-service/` (functionality absorbed into `backend/core/examples/`)
- `RELEASE_NOTES/` root directory (release notes moved to `docs/reference/release-notes/`)
- `scripts/` root directory (CI scripts moved to `.github/scripts/`)
- `.github/actions/setup-runtime/` (replaced by `node-setup-cache` + `node-restore-cache`)
- `ui-client/docs/COVERAGE.md`, `BUILD_SYSTEM.md`, `BUILD_SCRIPTS.md`, `WATCH_MODE_GUIDE.md`, `SCSS_SETUP.md` (consolidated into `ui/docs/BUILD.md` and `ui/docs/STYLING.md`)
- `ui-client/pnpm-lock.yaml` and `pnpm-workspace.yaml` (pnpm removed)
- `ui-client/packages/core` and `packages/foundation` (replaced by new package split)

## v0.3.0

> For a high-level introduction, see the [v0.3.0 release notes](../release-notes/0.3.0-release.md).

### Overview

MDK v0.3.0 focuses on extensibility, multi-host deployments, and a richer UI data layer. The headline additions are:

- A formal plugin system for App Node routes (`@tetherto/mdk-plugins`)
- A local-discovery mode that bypasses DHT for same-machine setups
- An HRPC client transport for cross-host App Node connections
- A unified lifecycle API (`onShutdown` / `shutdown`)
- A wave of new UI components covering alerts, inventory, repairs, and operational reporting

### Breaking changes

#### Node.js minimum version bumped to `>=24`

All packages previously requiring `>=22` now require Node.js 24+. Update your runtime before upgrading.

#### App-node HTTP routes moved to the plugin system

`metricsRoutes` and `devicesRoutes` are no longer registered directly in `backend/core/app-node/workers/lib/server/index.js`. Auth and telemetry endpoints are now delivered by the built-in plugins in `backend/core/plugins/`. Code that patched or monkey-patched these route registrations must be migrated to the plugin manifest format.

#### `waitForDiscovery()` signature changed

The second argument is now an options object instead of a bare timeout number:

```js
// 0.2.0
await waitForDiscovery(ork, 30000)

// 0.3.0
await waitForDiscovery(ork, { timeoutMs: 30000, minWorkers: 1, requireDevices: true })
```

A bare numeric second argument is still accepted as `timeoutMs` for backward compatibility, but the old positional form is deprecated.

### Added

#### Plugin system

(`backend/core/plugins/`)

A new `@tetherto/mdk-plugins` package introduces a declarative, file-based plugin format for App Node routes.

**Plugin manifest** (`mdk-plugin.json`):

Each plugin directory ships a manifest that describes its HTTP surface:

| Field | Description |
|---|---|
| `name`, `version`, `description` | Plugin identity |
| `routes[].id` | Unique route identifier |
| `routes[].handler` | JS file + optional named export (`./controllers/foo.js#namedExport`) |
| `routes[].auth` | Whether the route requires authentication |
| `routes[].cache` | Cache key parts extracted from the request (`query.start`, `params.id`, etc.) |
| `routes[].http` | Method, path (using `{param}` syntax), parameters, and response descriptors |

**Built-in plugins**:

| Plugin | Routes |
|---|---|
| `auth` | `GET /auth/userinfo`, `POST /auth/token`, `GET /auth/permissions`, `GET /auth/ext-data` |
| `telemetry` | `GET /auth/metrics/hashrate`, `consumption`, `efficiency`, `miner-status`, `power-mode`, `power-mode/timeline`, `temperature`, `containers/{id}`, `containers/{id}/history` |
| `site-hashrate` | Site-level hashrate metrics (placeholder, expanded in a later release) |

**Plugin loader** (`backend/core/app-node/workers/lib/plugin-loader.js`):
- `loadPlugin(pluginDir)` — loads manifest + handler files; validates route structure and uniqueness.
- Normalizes path parameters from `{id}` to `:id` (Fastify format).

**Plugin adapter** (`backend/core/app-node/workers/lib/plugin-adapter.js`):
- `buildFastifyRoutes(plugin, ctx)` — converts plugin routes to Fastify handlers, wires `authCheck` / `capCheck` for `auth: true` routes, and applies request-level caching.

**App-node integration**:

`startAppNode()` now accepts an `extraPluginDirs` option — an array of plugin package directory paths to load at boot alongside the built-in plugins.

```js
await startAppNode({ port: 3000, extraPluginDirs: ['/my-site/plugins/custom-metrics'] })
```

#### Local Worker discovery

(`backend/core/mdk/lib/local-discovery.js`)

A new same-machine discovery mode lets Workers publish their RPC public key to a shared directory instead of joining the DHT. This eliminates DHT round-trip latency for local deployments.

| Function | Description |
|---|---|
| `publishWorkerKey(dir, workerId, rpcKeyHex)` | Worker side: writes the stable RPC key to `<dir>/<workerId>.key` |
| `discoverWorkerKeys(ork, dir, opts)` | ORK side: watches `dir` for `.key` files, offers each to `ork.dhtListener.discoverWorker(key)`, rescans every 4 s |

Both `getOrk()` and `startWorker()` now accept a `discovery` option:

```js
// DHT (default, works cross-network)
await getOrk({ discovery: { mode: 'dht' } })

// Local file handoff (same machine only, no DHT join)
await getOrk({ discovery: { mode: 'local', dir: '/var/run/mdk/keys' } })
await startWorker(MyMinerClass, { discovery: { mode: 'local', dir: '/var/run/mdk/keys' } })
```

In `'local'` mode no DHT topic file is written and no Hyperswarm DHT join occurs.

#### HRPC client transport

(`backend/core/client/`)

The client package now supports two transports: the existing UNIX socket IPC and a new Holepunch RPC (HRPC) gateway transport for connecting to remote App Nodes.

**New dependencies**: `@hyperswarm/rpc ^3.5.0`, `hyperdht ^6.32.0`.

**`HRPCClient`** (`backend/core/client/lib/hrpc-client.js`):
- Connects to the ORK HRPC gateway using the gateway's public key.
- Serializes/deserializes MDK protocol envelopes via `@hyperswarm/rpc`.
- Accepts optional DHT seed/bootstrap overrides for test isolation.

**`createMdkClient()` transport selection**:

```js
// IPC (unchanged default)
const client = createMdkClient({ ipc: '/var/run/mdk.sock' })

// HRPC (new — cross-host app-node)
const client = createMdkClient({ hrpc: { key: '<gateway-public-key-hex>' } })
```

**`createWorkerClient(rpcKey, hrpcOpts)`** — new factory that binds a client directly to a specific Worker's RPC key without going through the ORK gateway.

#### Enhanced Client methods

`createMdkClient()` returns several new methods for waiting on infrastructure readiness:

| Method | Description |
|---|---|
| `connect({ warmup?, warmupRetries?, warmupDelayMs? })` | Optional post-connect warmup with configurable retries |
| `getStatus({ retries?, retryDelayMs?, timeoutMs? })` | Aggregate `WORKER_LIST` with built-in retries |
| `waitForWorkers({ count?, requireDevices?, timeoutMs?, intervalMs? })` | Poll until `count` Workers (with or without registered devices) are ready |
| `waitForDevice(deviceId, { workerId?, timeoutMs?, intervalMs? })` | Poll until a specific device is registered in the ORK registry |
| `getWorkerKey(workerId)` | Resolve a Worker's RPC public key from the registry |
| `sendWorkerCommand(workerId, deviceId, command, params, { hrpc? })` | Issue a command directly to a Worker, bypassing the App Node HTTP layer |

`pullTelemetry()` now accepts a full query object in addition to a bare type string.

#### MDK lifecycle API

(`backend/core/mdk/index.js`)

Two new exports simplify service teardown:

**`onShutdown(cleanupFn, opts?)`**
- Registers a one-shot handler for `SIGINT` / `SIGTERM`.
- Force-exits after `opts.forceMs` (default 3 s) if the cleanup function hangs.
- Idempotent; returns a handle for manual invocation in tests.

**`shutdown(handle)`**
- Unified async teardown for any MDK boot handle (ORK, App Node, or Worker).
- Drains the handle's `_cleanup` array and calls `.stop()` or the manager→adapter chain.
- Idempotent via an internal `__mdkShutdownDone` flag.

#### Enhanced `waitForDiscovery()`

| New option | Default | Description |
|---|---|---|
| `minWorkers` | `1` | Minimum number of ready Workers required |
| `requireDevices` | `true` | Whether Workers must have registered devices |
| `timeoutMs` | `30000` | Total wait timeout in ms |
| `intervalMs` | `500` | Poll interval in ms |

Returns the full Worker list (not just the ready subset).

#### Extended `startAppNode()` options

| New option | Description |
|---|---|
| `tmpdir` | Explicit corestore directory; defaults to `root` in test environments for hermetic isolation |
| `orkKey` | ORK HRPC gateway public key (hex or Buffer); selects HRPC transport instead of IPC |
| `extraPluginDirs` | External plugin directories to load at boot |

#### ORK integration tests & fixtures

New out-of-process test coverage for DHT-based discovery:

- `backend/core/ork/tests/integration/dht-topic-discovery.test.js` — spawns separate ORK and Workers processes, shares only a topic file, asserts the Workers reaches `READY` within 30 s.
- `backend/core/ork/tests/fixtures/repro-ork.js` / `repro-worker.js` — standalone fixture processes for DHT integration testing.

#### Whatsminer Workers restart test

`backend/workers/miners/whatsminer/tests/integration/manager-restart.test.js` — new integration test verifying that the `WhatsminerManager` reconnects correctly after a restart cycle.

#### MDK core unit tests

New unit tests covering the new lifecycle functions:

- `backend/core/mdk/tests/unit/shutdown.test.js`
- `backend/core/mdk/tests/unit/wait-for-discovery.test.js`
- `backend/core/mdk/tests/integration/local-discovery.test.js`

#### UI: alert utilities

(`@tetherto/mdk-ui-core`)

**`ui/packages/ui-core/src/utils/alert-queries.ts`**:

| Export | Description |
|---|---|
| `ONE_DAY_MS` | 24-hour constant |
| `DEFAULT_HISTORICAL_WINDOW_MS` | 14-day default look-back |
| `getDefaultHistoricalAlertsRange(now?)` | Seed range for alert queries |
| `buildCurrentAlertDevicesParams(filterTags?)` | `list-things` query params for current-alert devices (1 000 limit) |
| `buildHistoricalAlertsParams(range)` | `history-log` query params for a given alert window |

**`ui/packages/ui-core/src/utils/historical-log-chunks.ts`**:

| Export | Description |
|---|---|
| `breakTimeIntoIntervals(start, end, intervalMs?)` | Split a time range into 24-hour windows |
| `mergeAlertsByUuid(prev, next)` | Deduplicate alerts by `uuid` (later entry wins) |
| `fetchHistoricalAlertsInChunks(range, fetchWindow, opts?)` | Paginate + merge, honours `AbortSignal` for early exit |

#### UI: alert hooks

(`@tetherto/mdk-react-adapter`)

**`useCurrentAlertDevices(options?)`** - queries the current set of devices carrying active alerts via `list-things`. Returns `ListThingsDevice[][]` (table-row format). Refreshes every 20 s by default; accepts `filterTags` and a custom `refetchInterval`.

**`useHistoricalAlerts({ start, end, intervalMs?, enabled? })`** - fetches historical alert logs over a date range, fanning out into 24-hour chunks. Merges results client-side; aborts in-flight requests when the range changes.

#### UI: new core chart components

(`@tetherto/mdk-react-devkit`)

| Component | Location | Description |
|---|---|---|
| `AverageDowntimeChart` | `src/core/components/average-downtime-chart/` | Downtime metrics visualization |
| `ThresholdLineChart` | `src/core/components/threshold-line-chart/` | Line chart with configurable threshold bands |
| `OperationsEnergyCostChart` | `src/core/components/operations-energy-cost-chart/` | Energy cost over time |
| `MinMaxAvg` | `src/core/components/min-max-avg/` | Min/max/average display primitive |

#### UI: new foundation domain components

(`@tetherto/mdk-react-devkit`)

**Alerts** (`src/foundation/components/alerts/`):
- Alert table with dedicated column styles.
- Powered by the new `useCurrentAlertDevices` and `useHistoricalAlerts` hooks.

**Inventory** (`src/foundation/components/inventory/`):
- Device inventory management table.
- `MovementDetailsModal` tracks device movements between racks and containers.

**Repairs** (`src/foundation/components/repairs/`):
- Device repair and maintenance log tracking.
- `RepairLogChanges` page component.

#### UI: reporting tool

(`@tetherto/mdk-react-devkit`)

The reporting tool is the SDK's analytics surface. It presents financial and operational reports over a user-selected timeframe, each report reading from `@tetherto/mdk-ui-core` query helpers and rendering through shared chart primitives. The 0.3.0 release adds a revenue report, a consolidated operational dashboard, deeper hashrate views, and shared charting improvements.

**Financial reports**:
- `reporting-tool/financial/revenue-chart/` - new revenue report across the selected period, joining the existing cost, EBITDA, energy balance, and subsidy fee reports.
- Energy balance now renders downtime through the `AverageDowntimeChart` core primitive in place of its former bespoke chart.

**Operational reports**:
- `reporting-tool/operational/dashboard/` - new composite report backed by the `useOperationsDashboard` hook, summarizing fleet operations in a single view.
- `reporting-tool/operational/hashrate/` - adds a site-view tab alongside the existing mining-unit and miner-type views, with polished charts and shared axis scaling.
- `reporting-tool/operational/efficiency/` - chart legends and MDK tooltips added to the efficiency bars.

**Shared reporting infrastructure**:
- `MinMaxAvg` primitive for min/max/average summaries across reports.
- `headerAction` and `titleExtra` slots on `ChartContainer` and `LineChartCard` for mounting controls and context beside a chart title.
- `use-single-series-bar-legend` hook consolidating single-series bar chart legends.
- Reporting panels render transparent, and doughnut tooltips report values through `UNITS.PERCENT` for consistent formatting.

Timeframe selection runs through the `timeframe-controls` and `report-time-frame-selector` components and the `use-financial-date-range` hook, so every report shares one date-range model.

#### UI: catalog demo pages

(`ui/apps/catalog`)

New demo pages added to `mdk-catalog-ui`:

| Page | File |
|---|---|
| Average Downtime Chart | `average-downtime-chart-page.tsx` |
| Threshold Line Chart | `threshold-line-chart-page.tsx` |
| Operations Energy Cost Chart | `operations-energy-cost-chart-page.tsx` |
| Repair Log Changes | `repair-log-changes-page.tsx` |
| Movement Details Modal | `inventory/movement-details-modal/` |
| Operational Dashboard | `reporting-tool/operational-dashboard/` |
| Revenue Chart | `reporting-tool/financial/revenue-chart/` |

#### UI: CLI shell template

(`@tetherto/mdk-ui-cli`)

`ui/packages/cli/templates/mdk-ui-shell/src/pages/Alerts.tsx` - `Alerts` page added to the scaffold template generated by `mdk-ui scaffold`.

#### Examples

(`examples/`)

All backend examples have been consolidated and expanded under `examples/backend/`:

| Example | Description |
|---|---|
| `examples/backend/site/` | Multi-process deployment (ORK + App Node + Workers); includes `Dockerfile`, `docker-entrypoint.sh`, and client scripts for PM2 and Docker modes |
| `examples/backend/site-single-process/` | Single-process deployment for same-machine demos and development |
| `examples/backend/ork/auth-whitelist.js` | HRPC firewall allowlist setup with key pair generation and `hp-rpc-cli` usage examples |
| `examples/backend/ork/command-flow.js` | End-to-end command dispatch flow |
| `examples/backend/ork/telemetry-flow.js` | Telemetry pull flow |
| `examples/backend/ork/ork-shell.js` | Interactive ORK REPL |
| `examples/backend/miners/` | Per-miner Worker examples |
| `examples/backend/containers/` | Container Worker examples |
| `examples/backend/minerpools/` | Pool Worker examples |
| `examples/backend/powermeters/` | Power-meter Worker examples |
| `examples/backend/sensors/` | Sensor (temperature) Worker examples |
| `examples/backend/mdk-e2e/` | End-to-end MDK lifecycle example |
| `examples/backend/mdk-site/` | Full-site MDK example |
| `examples/full-site/` | Monorepo-level full site example |

#### `.nvmrc`

A `.nvmrc` file has been added to the repository root pinning the Node.js version for `nvm` users.

#### CI/CD: docs-only path detection

`.github/workflows/ci.yml` now detects whether a PR touches only documentation (`docs/`, `*.md`, `LICENSE`, `linkinator.config.json`). When the condition is true the domain build and test pipelines are skipped, cutting CI time for documentation-only changes.

### Changed

#### Node.js engine requirement

All `backend/` packages have updated their `engines.node` constraint from `>=22` to `>=24`.

#### `backend/core/client/` — dual-transport support

The client description updated to "IPC and HRPC (RPC gateway) transports for ORK". Transport is now selected at construction time via `{ ipc }` or `{ hrpc }`.

#### App Node server routes

`workers/lib/server/index.js` no longer imports or registers `metricsRoutes` or `devicesRoutes` directly. Route coverage is now provided by the built-in plugin packages. The `auth.routes.js` file has been simplified — handler imports and helper utilities (`createAuthRoute`, `createCachedAuthRoute`) have been removed; auth callbacks now delegate fully to the plugin layer.

#### `startAppNode()` test isolation

When `env === 'test'` and no explicit `tmpdir` is provided, the corestore directory defaults to `root`, giving each test run a hermetic, independent store without manual path wiring.

### Removed

- `backend/core/examples/` — moved to `examples/backend/`.
- `backend/core/ork/examples/` — moved to `examples/backend/ork/`.
- `examples/core/` — replaced by `examples/backend/`.
- `ui/packages/react-devkit/src/foundation/components/reporting-tool/financial/energy-balance/components/downtime-chart.tsx` and `downtime-chart.example.tsx` - superseded by the new `AverageDowntimeChart` primitive in `src/core/components/`.
- Direct `metricsRoutes` and `devicesRoutes` registrations from the App Node server (functionality now lives in the plugin system).

### Security

- Pinned `esbuild` to `>=0.28.1` in the UI workspace via a `ui/package.json` override, clearing advisory GHSA-gv7w-rqvm-qjhr.
- Pinned `undici` to `^7.28.0` via a `ui/package.json` override (the vulnerable version was pulled in transitively by `jsdom`), clearing seven advisories including the high-severity TLS certificate validation bypass GHSA-vmh5-mc38-953g.

## v0.4.0

> For a high-level introduction, see the [v0.4.0 release notes](../release-notes/0.4.0-release.md).

### Overview

- Delivers the write path to complement 0.3.0's read-heavy plugin/discovery work
- Adds a full **Pool Manager** UI feature, **inventory & spare-parts management**, four new chart primitives
- Implements a **CSS split** of `@tetherto/mdk-react-devkit` into core and foundation stylesheets (breaking)
- Adds a much richer local dev story — a shared worker **mock framework** and an expanded `examples/full-site` fleet

### Breaking changes

#### `@tetherto/mdk-react-devkit` CSS split into core + foundation stylesheets

`@tetherto/mdk-react-devkit/styles.css` no longer contains mining-domain (foundation) component styles — it now ships only design tokens + core primitives (Button, Card, Input, charts, …), ~18 KB gzipped. Foundation component styles (explorer, containers, pool-manager, reporting-tool, settings, …) moved to a new `@tetherto/mdk-react-devkit/styles-foundation.css`, ~70 KB gzipped.

**Action required** if you use any foundation (mining-domain) components — add a second import after `styles.css`:

```ts
import "@tetherto/mdk-react-devkit/styles.css"
import "@tetherto/mdk-react-devkit/styles-foundation.css" // only if using foundation components
```

`styles.css` must be imported **first** — it defines the `--mdk-*` design tokens the foundation styles reference. Apps using only core primitives need no change and ship ~70 KB less CSS. No JS API changed; failure is silent (foundation components render unstyled), which is why this is called out as a required upgrade step rather than a runtime error. See `ui/docs/STYLING.md#core-and-foundation-stylesheets`.

The package's `exports` map gained `"./styles-foundation.css"` and a `"./package.json"` self-export; `files` now explicitly lists `src/**/*.scss` and `src/**/*.webp` to support the split.

### Added

#### Write-action flow (end-to-end)

A full approve/reject/cancel lifecycle for write commands, from the kernel down to the UI:
- End-to-end **write-action approval flow** (kernel `action-manager`/`action-caller` + permissions + a batch of React write hooks)
- A durable **command state machine with a write-ahead log** for crash-recoverable command dispatch

**Kernel** (`backend/core/kernel/lib/modules/`):

| Module | Responsibility |
|---|---|
| `action-manager/index.js` (`ActionManager`) | Handles the action approval lifecycle — `pushAction()`, batch push, vote counting against `ACTION_NEG_VOTES_THRESHOLD`, and delegating writes to workers once quorum is reached. Wraps the legacy `@tetherto/svc-facs-action-approver` (pinned git dependency `#v1.0.0`) behind MDK protocol envelopes instead of legacy worker RPC handlers. |
| `action-manager/caller-proxy.js` | Adapts `ActionCaller` into the shape `svc-facs-action-approver` expects. |
| `action-caller/index.js` | Resolves an action into per-worker write calls (`getWriteCalls()`) and required permissions. |
| `permissions/index.js` | `PERMISSION_LEVELS` (`r`/`w`/`rw`) and `hasWritePermission(permissions, baseType)` / `hasPermission()` — colon-delimited device-family permission strings (e.g. `miner:w`, `container:w`). |

New protocol actions (`backend/core/kernel/lib/protocol/actions.js`, protocol version bumped `0.1.0` → `0.2.0`):

```
action.push, action.push-batch, action.get, action.get-batch,
action.query, action.vote, action.cancel-batch,
write.calls.request, write.calls.response
```

New dependencies: `async ^3.2.6`, `mingo ^6.4.15` (MongoDB-style query matching, used for action/permission filtering), `@bitfinex/lib-js-util-base`.

**`@tetherto/mdk-react-adapter`** — new write hooks (`ui/packages/react-adapter/src/hooks/`), all gated on the `actions:w` permission via `useCheckPerm`:

| Hook | Description |
|---|---|
| `useSubmitSingleAction()` | Submits one staged action from the local `actionsStore` queue by id; inspects the 200 response body for embedded errors before treating the call as successful. |
| `useSubmitPendingActions()` | Drains the entire staged queue, `POST`s each action, clears the queue, invalidates pool/miner/actions caches. |
| `useVoteOnAction()` | Casts an approve/reject vote via `PUT /auth/actions/voting/:id/vote`. |
| `useCancelAction()` | Cancels one or more pending voting actions via `DELETE /auth/actions/voting/cancel?ids=…`. |
| `usePendingActions({ params?, refetchInterval?, enabled? })` | Fetches the server-side voting/approval queue via `GET /auth/actions` (distinct from the local staging buffer). |
| `useLiveActions()` | Queries live actions and partitions them into `[mine, others]` by comparing the submitter's email against the current user; polls every `LIVE_ACTIONS_POLL_INTERVAL_MS`. |

`action-write-utils.ts` centralizes `ACTIONS_WRITE_PERM`, `invalidateAfterActionWrite()`, `extractSubmitError()`, and `toVotingPayload()` shared by the hooks above.

**`@tetherto/mdk-ui-foundation`** — new query/mutation factories in `pool-factories.ts`: `actionsQuery`, `liveActionsQuery`, `submitActionMutation`, `submitBatchActionMutation`, `voteActionMutation`, `cancelActionsMutation`.

New integration coverage: `backend/core/kernel/tests/integration/actions.test.js` and `actions-stress.test.js` (a stress-test harness exercising the push/vote/cancel flow under load).

#### Command state machine and write-ahead log

A durable state machine now backs every dispatched command, replacing fire-and-forget dispatch with a recoverable lifecycle.

**`backend/core/kernel/lib/modules/command-state-machine/`**:
- States: `QUEUED → DISPATCHED → EXECUTING → SUCCESS | FAILED | TIMEOUT` (`TIMEOUT` is semi-terminal — re-queued if retry budget remains). `isValidTransition(from, to)` enforces the transition table
- `CommandStateMachine` is wired into `KernelManager._initModules()` with `wal`, `workerChannel`, `registry`, `maxRetries` (default 3, `kernel.commandMaxRetries`), and `timeoutMs` (default 30000, `kernel.commandTimeoutMs`)

**`backend/core/kernel/lib/storage/wal.js`** — append-only Write-Ahead Log for command state transitions. Every transition is persisted before it takes effect; on restart the state machine sweeps the WAL: `DISPATCHED`/`EXECUTING` are forced to `TIMEOUT`, `TIMEOUT` is re-queued if retries remain, `QUEUED` is left alone, and terminal entries (`SUCCESS`/`FAILED`) are eligible for compaction.

**New gateway actions** (`gateway-handler.js`): `COMMAND_STATUS` → `dispatcher.getStatus(commandId)`, `COMMAND_CANCEL` → `dispatcher.cancel(commandId)`.

**Command scopes** (`COMMAND_SCOPES`: `device` | `worker` | `rack`) let a single command target a device, an entire worker, or a rack, resolved in `command-dispatcher`. `MAX_TARGETS` (1024) caps fan-out per command.

#### Pool Manager (UI feature)

New `pool-manager` foundation feature (`ui/packages/react-devkit/src/domain/features/pool-manager/` and `.../components/pool-manager/`) covering pool configuration, a sites overview, a miner explorer, site-overview-details, an actions sidebar (review tray for pending write-actions), and an assign-pool modal. Ships with a CLI shell-template page and a `PoolManager.tsx` scaffold entry, each sub-feature documented with a `USAGE.md` and `.example.tsx`.

**Pool data layer** (`@tetherto/mdk-ui-foundation`, `ui/packages/ui-foundation/src/`):
- `types/pool.types.ts` — pool/miner/site type definitions
- `query/pool-factories.ts` — `poolConfigsQuery`, `poolConfigForDeviceQuery`, `poolsQuery`, `poolBalanceHistoryQuery`, `minersQuery`, `siteStatusLiveQuery`, `containerPoolStatsQuery`, `userInfoQuery`

**`@tetherto/mdk-react-adapter`** — new consuming hooks: `usePools`, `usePoolConfigs`, `usePoolConfigsData`, `usePoolStats`, `usePoolRows`, `usePoolBalanceHistory`, `useContainerPoolStats`, `useSitesOverview`, `useSitesOverviewData`, `useSiteStatusLive`, `useSiteMinerCounts`, `useSiteMinerStats`, `useSiteDetailMiners`, `useSiteEfficiency`, `useSiteHashrate`, `useSiteConsumption`, `useSiteConsumptionChartData`, `useSiteContainerCapacity`, `useSitePowerMeter`, `useMiners`, `useMinerDevices`, `useMinerDuplicateValidation`, `useStaticMinerIpAssignment`, `usePoolManagerDashboard`

#### Inventory & Spare-Parts Management (UI)

`MovementDetailsModal` (`inventory/movement-details-modal/`) tracks device movements between racks and containers.

`ui/packages/react-devkit/src/domain/components/inventory/spare-parts/` — a full spare-parts CRUD surface: `AddSparePartModal`, `BulkAddSparePartsModal` (CSV upload via `use-bulk-csv-upload.ts`), `BatchMoveSparePartsModal`, `MoveSparePartModal`, `ConfirmDeleteSparePartModal`, and `SparePartSubTypesModal`. Each ships a `USAGE.md`, SCSS module, and example.

#### New Core Chart Primitives (`@tetherto/mdk-react-devkit`)

| Component | Location |
|---|---|
| `AreaChart` | `src/primitives/components/area-chart/` |
| `BarChart` | `src/primitives/components/bar-chart/` |
| `DoughnutChart` | `src/primitives/components/doughnut-chart/` |
| `GaugeChart` | `src/primitives/components/gauge-chart/` |
| `LineChart` | `src/primitives/components/line-chart/` |
| `MultiSelect` | `src/primitives/components/multi-select/` |
| `ChartContainer` / `ChartStatsFooter` | `src/primitives/components/chart-container/`, `chart-stats-footer/` — shared chart chrome |

#### Worker mock framework and mock control service

A shared framework for running fake devices locally, replacing ad-hoc per-worker mocks.

- **`backend/workers/mock/`** — `base.mock.js` (`BaseMock` + transport contract) plus per-device-type mocks (`miner.mock.js`, `container.mock.js`, `minerpool.mock.js`, `powermeter.mock.js`, `sensor.mock.js`) and a `transports/` directory (`http`, `modbus`, `mqtt`, `tcp`, plus a shared `base` transport)
- **`backend/workers/scripts/run-mocks.js`** — parallel mock-device runner behind `npm run mock` (root script: `"mock": "npm --prefix backend/workers run mock"`); accepts a comma-delimited device list and per-mock flags, and prints the available device/type list when run with no arguments
- **`backend/core/mock-control-service/`** — new `@tetherto/mdk-mock-control-service` package (`routes.js`, `mock-control-agent.js`) for controlling mock device behavior at runtime (e.g. simulating faults) rather than only static fixtures
- Every miner/container/sensor worker package (`antminer`, `avalon`, `whatsminer`, `f2pool`, `ocean`, `abb`, `satec`, `schneider`, `seneca`) was reworked to plug into the shared mock/transport framework, with `mock/server.js` rewritten and a short `README.md`/`USAGE.md` added per package

#### Documentation

- **`docs/concepts/stack/`** (new) — `app-node.md`, `app-toolkit.md`, `kernel.md`, `workers.md`: a structured per-layer breakdown of the stack, replacing the older `docs/concepts/worker-discovery.md`
- **`docs/how-to/gateway/`** (new) — `index.md`, `plugins.md` (plugin authoring), `run.md`, `teardown.md` (lifecycle/shutdown guidance for the 0.3.0 `onShutdown`/`shutdown` API)
- **`docs/scripts/generate-plugin-reference.js`** — regenerates the route tables in `backend/core/plugins/README.md` from each plugin's `mdk-plugin.json`, run via `npm run generate:plugin-reference`, so published plugin docs can't drift from the manifests
- `docs/concepts/architecture.md`, `about.md`, `deployment-topologies.md`, and `terminology.md` received substantial rewrites consistent with the stack-doc restructuring
- **`RELEASING.md`** — release-process guide, plus a GitHub pull-request template
- **`docs/reference/release-notes/0.4.0-release.md`** — new release-notes stub for this version

#### Tooling

- **`check-registry-completeness`** (`ui/packages/react-devkit/scripts/check-registry-completeness.mts`, with `registry-completeness-exceptions.json`) — verifies every exported component is registered in the component catalog/registry
- **`treeshake-check`** (`ui/scripts/treeshake-check.mjs`) — verifies package exports remain tree-shakeable

### Changed

#### `@tetherto/mdk-react-devkit` bundle footprint

Dependency and bundle-size reductions accompany the core/foundation stylesheet split (see Breaking Changes), so core-only consumers ship roughly the design-tokens-plus-primitives subset instead of the full stylesheet.

#### Test file naming convention

Unit test files under `backend/workers/base/tests/` and `backend/workers/miners/base/tests/` were renamed to the `*.test.js` suffix (e.g. `thing.js` → `thing.test.js`, `miner.manager.js` → `miner.manager.test.js`), matching the `NODE_ENV=test brittle 'tests/**/*.test.js'` glob now standardized across backend packages' `test`/`test:coverage`/`test:integration` scripts.

#### Dependency bumps

- `@vitejs/plugin-react` `^5.1.4` → `^6.0.2` across UI packages.
- All `backend/core`, `backend/workers`, and `ui/packages` package versions synced to `0.3.0`

### Removed

- The JetBrains Mono **Thin** font weight (`ui/packages/fonts/src/fonts/JetBrainsMono-Thin.woff2`) from `@tetherto/mdk-fonts`
- Legacy `backend/workers/base` and miner scaffolding files (cleanup)

### Fixed

- Console errors in the catalog / full-site UI (#132)
- Full-site miners local-discovery watch (#129) and example setup (#99)
- Documentation port/link fixes (#117)

## v0.5.0

> For a high-level introduction, see the [v0.5.0 release notes](../release-notes/0.5.0-release.md).

### Overview

- Completes the control-plane **rename**: **ORK → Kernel** and **App Node → Gateway**, across backend, UI, examples, and docs (breaking)
- **Retires the IPC transport** — HRPC is now the only client transport, with a zero-config Kernel **key-file** bootstrap (breaking)
- Extracts the Worker runtime into a standalone **`@tetherto/mdk-worker`** package and migrates every worker onto the `WorkerRuntime` plugin model, deleting the legacy `base/`/`ThingManager` packages (breaking)
- Renames the UI foundation package **`@tetherto/mdk-ui-core` → `@tetherto/mdk-ui-foundation`** and restructures `@tetherto/mdk-react-devkit` into **`primitives`/`domain`** layers (breaking)
- Renames every worker package to a uniform **`@tetherto/mdk-worker-*`** scheme, and removes the microbt and electricity workers (breaking)
- Adds **paginated, searchable** pools and containers listings
- Ships a **third-party Worker developer guide**, a docs-generation pipeline, a full-site **dashboard + MCP server** example, and a large **test-coverage** push

### Breaking changes

#### ORK renamed to Kernel

The orchestration runtime called **ORK** is now the **Kernel** throughout the codebase, matching the docs and protocol terminology.

- `backend/core/ork/` → `backend/core/kernel/`; package `@tetherto/mdk-ork` → **`@tetherto/mdk-kernel`**
- Internal module `lib/ork.manager.js` → `lib/kernel.manager.js`; class `ORKManager` → `KernelManager`
- The UI nomenclature was swept in lockstep (`ork` → `kernel`) across `@tetherto/mdk-ui-foundation`, `@tetherto/mdk-react-adapter`, and `@tetherto/mdk-react-devkit`; the JSDoc capability tag `@orkCapability` / `ork-capabilities` → `@kernelCapability` / `kernel-capabilities`

**Not affected**: the MDK protocol action names are unchanged — only doc comments moved from "ORK"/"App Node" to "Kernel"/"Gateway". Envelope string values (`identity.request`, `command.request`, `worker.list`, …) are identical, so a 0.4.x peer still speaks the same wire protocol.

**Action required**: replace imports of `@tetherto/mdk-ork` with `@tetherto/mdk-kernel` and path references to `backend/core/ork` with `backend/core/kernel`.

#### App Node renamed to Gateway

- `backend/core/app-node/` → `backend/core/gateway/`; package `@tetherto/mdk-app-node` → **`@tetherto/mdk-gateway`**
- The bootstrap export **`startAppNode()` → `startGateway()`** (`backend/core/mdk`)
- The client envelope `sender`/`requesterId` value `'app-node'` → `'gateway'`
- `@tetherto/mdk-plugins` is now described as "MDK Gateway Plugins" (was "MDK App Node Plugins")

**Action required**: rename `startAppNode` call sites to `startGateway`, and update the `@tetherto/mdk-app-node` dependency to `@tetherto/mdk-gateway`.

#### IPC transport removed — HRPC only

The Unix-socket IPC transport is gone; HRPC (RPC listener) is the sole client transport.

- **Client**: `backend/core/client/lib/ipc-client.js` deleted; `createMdkClient` no longer accepts `opts.ipc`; `_createTransport` now throws `ERR_MDK_CLIENT_TRANSPORT_REQUIRED` when neither `hrpc` nor `transport` is supplied
- **Kernel**: `IPCListener` and its `KernelManager` lifecycle wiring removed, along with the `listeners.ipc` option on `createKernel`
- **Zero-config bootstrap replacement**: `getKernel` now writes the Kernel's HRPC public key (hex) to a **key file** — `DEFAULT_KEY_FILE` = `<tmpdir>/mdk/.kernel-key` — after start, so out-of-process clients connect without any hand-passed key. `startGateway` resolves the key from that file (order documented); `opts.keyFile` (`string | boolean`) overrides, and `keyFile: false` disables it. New error `ERR_KERNEL_KEY_FILE_NOT_FOUND`.

#### `@tetherto/mdk-ui-core` renamed to `@tetherto/mdk-ui-foundation`

The core UI data/state package is now published as **`@tetherto/mdk-ui-foundation`** (`ui/packages/ui-core/` → `ui/packages/ui-foundation/`). Update the dependency name and imports; the API surface is unchanged by the rename itself.

#### `@tetherto/mdk-react-devkit` layer restructure and export-map changes (`core`/`foundation` → `primitives`/`domain`)

The devkit source layers were renamed — `src/core/` → **`src/primitives/`** (alias `@core` → `@primitives`), `src/foundation/` → **`src/domain/`** (alias `@foundation` → `@domain`), and the inner `components/domain/` → `components/composite/`. This moved **193 component `USAGE.md`** files and their sources; update any deep imports into `@tetherto/mdk-react-devkit/src/...` accordingly.

The package `exports` map changed:

- `"./core"` **removed** → use `"./primitives"`
- `"./foundation"` and `"./feature"` **removed** (unused convenience exports); `"./domain"` retained but now resolves to `./dist/domain/index`
- Stylesheet `"./styles-foundation.css"` **renamed to `"./styles-domain.css"`** (source `styles-foundation.scss` → `styles-domain.scss`). **Action required** for anyone who adopted the 0.4.0 core/foundation CSS split: rename the second import to `@tetherto/mdk-react-devkit/styles-domain.css`.

#### Registry & docs-data schema bumped to `2.0.0` (ORK → Kernel field rename)

`REGISTRY_SCHEMA_VERSION` (`1.4.0` → `2.0.0`) and `DOCS_DATA_SCHEMA_VERSION` (`1.3.0` → `2.0.0`) both moved, because the capability fields consumers read were renamed: `orkCapabilities` → `kernelCapabilities`, type `OrkCapability` → `KernelCapability`, the required JSDoc tag `@orkCapability` → `@kernelCapability`, and the index keys `componentsByOrkCapability`/`hooksByOrkCapability`/blueprint `byOrkCapability` → `…ByKernelCapability`. The `find`/`docs`/`blueprints` CLI commands emit the renamed field.

#### Worker packages renamed to `@tetherto/mdk-worker-*`

Every worker package moved to a uniform scheme, e.g. `@tetherto/miner-antminer` → **`@tetherto/mdk-worker-antminer`**, `@tetherto/container-bitdeer` → **`@tetherto/mdk-worker-bitdeer`**, and the demo `@tetherto/sample-demo-worker` → **`@tetherto/mdk-worker-demo`** (also across antspace, avalon, whatsminer, f2pool, ocean, abb, satec, schneider, seneca).

#### Worker runtime extracted; legacy `base/` packages removed

`WorkerRuntime` now ships in the new `@tetherto/mdk-worker` package (see Added), and every worker was migrated onto the `WorkerRuntime` plugin model (`plugin/` with `boot.js`, `index.js`, `mdk-contract.json`, `src/commands/*`, `src/telemetry/*`). The shared `base/` packages were deleted: `backend/workers/base/` (`ThingManager`, `thing.js`, `mdk-worker-adapter.js`, `lib/services/*`, `facs/*`, contract schema) and the per-family `miners/base`, `containers/base`, `power-meter/base`, `temperature/base`, `minerpools/base`. Consumers no longer import `ThingManager`, the family managers, or the device bases.

### Added

#### `@tetherto/mdk-worker` — Worker Runtime package

New package (`backend/core/mdk-worker/`, v0.1.0) — "hosts a Worker Plugin's devices behind one HRPC channel to the Kernel."

| Export / feature | Description |
|---|---|
| `WorkerRuntime` (`lib/worker-runtime.js`) | Hosts N same-type devices behind one HRPC channel; `getPublicKey()`, `getDeviceContext(deviceId)`; handlers invoked as `(ctx, params)` with `ctx = { deviceId, device, config }`, results wrapped in MDK protocol envelopes. Generalizes/replaces the former `MDKWorkerAdapter` (persistent seeds, single HRPC respond loop, DHT topic announce carried over; `ThingManager` delegation replaced by per-device handler dispatch). |
| `loadPlugin` (`lib/plugin-loader.js`) | Plugin loader with eager handler loading. |
| `service-builtins.js` | `telemetryBuiltin`, `commandBuiltin`, `mergeBuiltinCommands` — serves the legacy worker-infra surface (logs/count/config, pool `ext_data` queries, write-action approval) from injected `opts.services`. |
| `mdk-contract.schema.json` | Formal JSON Schema (draft 2020-12) for the device-lib contract, re-homed with the runtime. |
| `opts.allowEmptyDevices` | Opt-in zero-device boot for provisioning-first bootstrap; default still throws `ERR_DEVICES_REQUIRED`. |

Dependencies: `@hyperswarm/rpc` 3.5.0, `hyperdht` 6.32.0, `hyperswarm` 4.17.0, `debug` 4.4.1.

#### Gateway — paginated, searchable listings

- **Pools list pagination + search** (`server/handlers/pools.handlers.js`): `getPools` accepts `search`, `offset`, `limit`. `search` matches `name`/`pool`/`account` (case-insensitive); `total` counts the matched set before the page slice; `summary` still covers the full pool set. Response is `{ pools, summary, total }`. Schema adds `search` (string), `offset` (int ≥ 0), `limit` (int 1–100).
- **Containers list server-side filter/sort/pagination** (`server/handlers/devices.handlers.js`): `getContainers` pushes tag + filter + search to `listThings`, takes the global `total` from `getThingsCount`, then merges/sorts/slices (matching the miners handler).

#### `@tetherto/mdk` — absorbed worker-infra services

The former `mdk-utils` package was absorbed into `@tetherto/mdk`: new `lib/services/` (actions, alerts, comments, log-history, logs, pool, provisioning, settings, snaps, stats + `pool-utils/`), `lib/things/` device layer (thing, miner, container, powermeter, sensor + constants), `lib/templates/` (alerts, stats), `lib/worker-infra.js`, `lib/utils.js`, with extensive new unit coverage. New deps pulled in: `@bitfinex/bfx-facs-http`, `@bitfinex/bfx-facs-scheduler`, `@bitfinex/lib-js-util-base`, `@bitfinex/lib-js-util-promise`, `async` 3.2.6, `mingo` 6.5.6, `uuid` 14.0.0.

#### Per-worker runtime plugins + contract-declared handlers

Each surviving worker gained a `plugin/` package (`boot.js`, `index.js`, `mdk-contract.json`, `src/commands/*`, `src/telemetry/*`) with matching integration + unit test suites — antminer, avalon, whatsminer (miners); antspace, bitdeer (containers); f2pool, ocean (minerpools); abb, satec, schneider (power-meter); seneca (temperature). Example: antminer telemetry (accepted/rejected shares, hashrate-avg, power, power-mode, efficiency, status, temperature, uptime, snap) and commands (reboot, set-led, set-power-mode, setup-pools). A `whatsminer/examples/run-runtime-parity.js` e2e runs the runtime against mock devices.

#### Documentation

- **Worker developer guides**: `docs/guides/workers/build-a-worker.md` (build a third-party Worker end-to-end, from your own repo) and `docs/tutorials/quickstart/build-a-dashboard.md` (one Worker + one Gateway route + one static page, no build step).
- **HRPC**: `examples/backend/inspect-over-hrpc.md` (inspect MDK over HRPC with `hp-rpc-cli`); the IPC transport docs were replaced with the HRPC key-file flow across the top-level README and core/worker READMEs.
- **MCP**: `examples/full-site/docs/mcp-server.md` documents a full-site MCP server that connects to the Kernel directly over HRPC (no Gateway) and exposes registry/telemetry/command tools over HTTP.
- **New stack/reference pages**: `docs/concepts/stack/kernel.md` and `stack/gateway.md` (replacing the ORK/app-node pages); `docs/reference/glossary.md` (replacing `docs/concepts/terminology.md`), with an HRPC section.
- **Docs-generation pipeline**: `mdk-ui docs:generate` with package-grouped versioned reference nav (`ui/packages/cli`), documented in `ui/docs/extending-docs-to-backend.md` and a rewritten `ui/docs/docs-sync-how-to.html`.

#### Examples

- **full-site dashboard + MCP**: a new `DashboardPage.tsx` and supporting UI (`AppSidebar`, `ContainerGrid`, `Containers`/`Control`/`Monitoring`/`Pools` pages, chart components), plus an MCP server (`backend/proc/mcp-server.js`, `.mcp.json`) and new dep `@modelcontextprotocol/sdk ^1.29.0`.
- **`examples/site-backend/`** (new) — boots every worker family as its own OS process against mock hardware, coordinated by a Kernel and exposed via the Gateway HTTP API; runnable under PM2 or Docker (Dockerfile, docker-compose, PM2 ecosystem).
- **`examples/backend/mdk-plugin-e2e/`** (new) — plugin-authoring e2e: `WorkerRuntime` hosting mock devices + Kernel + Gateway Plugin aggregation.
- **`examples/backend/demo-worker-caller/index.js`** (new) — a single-file "caller" showing how a host constructs `WorkerRuntime` around the shipped demo-worker plugin and runs a telemetry sampler loop.
- **`examples/backend/kernel/`** (new) and per-family example test packages (`@tetherto/mdk-backend-*-examples`) with a shared `examples/backend/utils/test-harness.js` (`runAutoExit`).

#### CI / tooling

- A new **`examples` CI pipeline** (`.github/workflows/ci.yml`): `list-examples`, `setup-examples`, and `test-examples` matrix jobs discovering every `examples/**/package.json`, plus an "Examples" row in the summary (no coverage threshold enforced for examples).
- **`.mailmap`** (new) — maps contributor commit emails to non-routable `example.com` placeholders for this public repo (no history rewrite).

### Changed

- **full-site realigned to the "11-family" site**: description now "3 miner families + 2 containers + 3 powermeters + 2 sensors + 2 pools over the RPC listener"; test expectations moved from 12 families/13 workers to the current 11 after the wm-v3 demo family and microbt containers were removed. The seed was made effective under the Worker runtime (unique-id default `pos`, restart-and-wait for registry visibility), taking e2e to 14/14.
- **CI worker dependency install** rewritten to install shared core deps (`backend/core/{kernel,client,mdk,mdk-worker}`, `backend/workers/mock`, `backend/core/mock-control-service`) instead of the deleted `base/` packages.
- **Nomenclature** propagated through examples and CI: `proc/ork.js` → `kernel.js`, `proc/app-node.js` → `gateway.js`; `ui-core` → `ui-foundation` in CI and issue templates.
- **Information-architecture restructure** in docs: `how-to/` collapsed into `guides/` (deployment, gateway, miners); `docs/concepts/stack` files renamed; `terminology.md` → `reference/glossary.md`.
- All release-line `package.json` versions across `backend/core`, `backend/workers`, `ui/packages`, and `examples/` synced to `0.5.0`; independently-versioned newcomers (`@tetherto/mdk-worker`, the demo/sample workers, the mock, and two examples) keep their own `0.1.0`/`0.0.1` versions.

### Removed

- **microbt container workers** — the entire `backend/workers/containers/microbt/` tree, plus its catalogue/manifest/supported-hardware/mock-runner entries and the mdk constants/bootstrap references.
- **electricity power-meter worker** (`backend/workers/power-meter/electricity/`).
- All worker **`base/` packages** (`ThingManager`, device bases, family managers) after the runtime migration.
- Client **`ipc-client.js`**, Kernel **`IPCListener`**, and the Gateway IPC transport.
- The **`mdk-utils`** package (absorbed into `@tetherto/mdk`).
- Deleted docs: `docs/concepts/terminology.md`, `stack/ork.md`, `stack/app-node.md`, `docs/how-to/**` (moved to `guides/`), `backend/core/ork/README.md` + `docs/phase-bootstrap-api.md`, `backend/workers/docs/orchestrator.md`.

### Fixed

- **Containers list truncation / wrong total**: `getContainers` previously fetched only a tag-filtered page and re-filtered in memory (offset:0/limit:0), so user filters saw a truncated set and `total` was the page length; now uses a server-side query + global `getThingsCount`.
- **MQTT mock determinism** (`backend/workers/mock/transports/mqtt.transport.js`): `close()` now force-closes (`client.end(true)`) and runs an idempotent `_runCleanup()` directly rather than waiting on the `'end'` event (which may never fire when the broker is gone), preventing leaked publish intervals that held the event loop open.
- **bitdeer MQTT broker per worker** (`containers/bitdeer/plugin/boot.js`): the shared module-level `svc-facs-mqtt` aedes broker meant the first worker's `stop()` killed every later worker's broker; boot now creates its own `Aedes` broker + `net` server per worker and closes both in `stop()`. `svc-facs-mqtt` dropped; `aedes 1.0.2` and `mqtt 5.15.2` promoted to direct deps. (An earlier lazy-`require` fix so bare requires can exit was superseded by this.)
- **UI** — log the user out and redirect on session expiry (`@tetherto/mdk-ui-foundation`) (#180); abort in-flight requests on unmount; guard the power-adjustment insert against a missing PDU tab; carry device-action targeting fields through the voting payload; restore Op Centre factory exports dropped in a query-barrel refactor.
- **full-site** — seed effective under the Worker runtime; local-discovery watch and example setup corrections.
- **schneider** — corrected a "Terher" typo in the package author field.
- Numerous documentation link repairs (404s flagged by the markdown link checker), including the stale worker-guide anchor fixed in the 0.5.0 changeset.

#### Tests

A large coverage push lifted each flagged backend package above the 80% per-package gate. Highlights (before → after, statements/branches/functions/lines):

| Package | Coverage | Added unit tests (selected) |
|---|---|---|
| bitdeer | 74% br → ~97% | D40 command handlers, `optimizeSocketCalls` PDU collapse, boot arg validation, alert templates |
| antminer | 76% → ~99% | device getters/setters (injected fake fetch), error maps, DHCP/static conf, power modes, pools; mock router; plugin handlers |
| whatsminer | 79% br → ~97% | write-action wrappers, AES-ECB token handshake + 135/136 retry paths, firmware header parsing, mock utils |
| f2pool | 77% br → ~95% | mock router validation/error + auth-hook 401s, `fetchStats` fallbacks + cached-month refresh + rate-limit path |
| abb | 52% fns → ~99% | B2X/M1M20/M4M20/REU615 `_readValues`/`_prepSnap` vs fake Modbus, per-channel telemetry incl. `?? 0` fallbacks, `ERR_MODEL_INVALID` |

Plus `@tetherto/mdk-client` typed request-wrapper tests, new Kernel suites (`kernel-manager`, `actions-stress`, key-file integration), and `@tetherto/mdk-react-devkit` branch-coverage additions.

## v0.6.0

> For a high-level introduction, see the [v0.6.0 release notes](../release-notes/0.6.0-release.md).

### Overview

- Reduces the **Gateway to a thin plugin host**: The entire built-in HTTP API (auth/OAuth2, WebSocket, alerts, users, audit log, and ~20 route/handler/schema modules) is deleted, and routes now come only from plugins (breaking)
- Replaces the mock-control-service package with **`@tetherto/mdk-mcp`**, an MCP server that exposes MDK data to agents as declarative tools (breaking)
- Ships **`@tetherto/mdk-skill`**, an Agent Skills bundle versioned against the MDK release line
- Turns the UI shell template into a **runnable example** and slims `mdk-ui create` to a bare backbone whose feature pages are added on demand (breaking)
- Consolidates the examples around a new **`examples/mvp-site`** single-container site, and makes the repo root an **npm workspaces** monorepo
- Adds **versioned Whatsminer API protocol handlers** (v2/v3) and a `site-monitor` Gateway plugin
- Moves every UI surface from the discontinued `react-router-dom` shim to **`react-router` v8**, clearing a high-severity advisory that no override could resolve (breaking for scaffolded apps)

### Breaking changes

#### Gateway reduced to a plugin host — built-in HTTP API removed

`@tetherto/mdk-gateway` no longer ships an application API of its own. Every route module, handler, schema, and supporting library behind the old `workers/lib/server/` tree is deleted; the worker now boots the httpd facility, registers plugins, and serves whatever those plugins declare. What went away:

| Area | Removed |
|---|---|
| Auth / identity | `lib/auth.js`, `lib/users.js`, `lib/server/lib/authCheck.js`, `capCheck.js`, the `svc-facs-auth` + two `svc-facs-httpd-oauth2` facilities, the `auth` sqlite facility, and the periodic `cleanupTokens` interval |
| Realtime | `@fastify/websocket` registration, `routes/ws.routes.js`, `lib/alerts.js` and the 5-second `broadcastAlerts` loop |
| Data / state | `lib/globalData.js` and the `global-data` hyperbee, `lib/dcs.utils.js`, `lib/metrics.utils.js`, `lib/period.utils.js`, `lib/server/lib/queryUtils.js`, `routeHelpers.js` |
| Audit | `lib/server/lib/auditLogger.js` and the optional `audit.logger.json` config |
| Routes / handlers | `actions`, `alerts`, `auth`, `configs`, `coolingSystem`, `devices`, `energySystem`, `explorer`, `finance`, `global`, `groups`, `logs`, `metrics`, `miners`, `pools`, `settings`, `site`, `site-monitor`, `things`, `users`, `ws` — plus every `schemas/*.js` |

The `_pluginServices` object handed to plugins lost `authLib`; it now exposes only `dataProxy`, `mdkClient`, and `conf`. The example config files `config/facs/auth.config.json.example`, `config/facs/httpd-oauth2.config.json.example`, and `config/audit.logger.json.example` are gone.

Dependencies dropped from the package: `@fastify/websocket`, `@bitfinex/bfx-facs-db-sqlite`, `@bitfinex/bfx-facs-http`, `@bitfinex/bfx-facs-interval`, `@bitfinex/lib-js-util-base`, `@tetherto/hp-svc-facs-store`, `@tetherto/svc-facs-auth`, `@tetherto/svc-facs-httpd-oauth2`, `mingo`, and the `@tetherto/mdk` self-dependency. `@tetherto/svc-facs-httpd` moved **v1.0.0 → v2.0.0**.

**Action required**: anything that called a built-in Gateway endpoint must now supply it as a plugin. The three default plugins the worker registers are `telemetry`, `site-hashrate`, and the new `site-monitor`; register your own with `extraPluginDirs`.

**Note on `@tetherto/mdk-plugin-auth`**: the plugin still ships inside `@tetherto/mdk-plugins`, but the Gateway no longer auto-registers it, and its `permissions`/`token` controllers read `services.authLib` — which the Gateway no longer provides. Treat the bundled auth plugin as unwired in 0.6.0 and bring your own identity layer.

#### `startGateway()` auth options removed

In `@tetherto/mdk`, the Gateway bootstrap no longer knows about authentication:

- `opts.noAuth`, `opts.auth`, and `opts.httpdOauth2` are **removed** (as is the internal no-auth OAuth2 stub used to satisfy facility validation)
- `auth.config.json` and `httpd-oauth2.config.json` are no longer materialised into the run directory — the config mapping is now just `httpd`, `net`, `store`, and `logging`
- `ctx.noauth` is no longer set on the worker context

`startKernel()` is now a thin alias for `getKernel()` rather than a second, divergent bootstrap path.

#### `@tetherto/mdk-mock-control-service` removed

The standalone mock-control-service package is gone. Its `mock-control-agent.js` now lives in `@tetherto/mdk-worker-mock` (`backend/workers/mock/mock-control-agent.js`), and the nine per-worker `mock/mock-control-agent.js` copies (antspace, bitdeer, f2pool, antminer, avalon, whatsminer, abb, satec, schneider, seneca) were deleted in favour of that single shared implementation. The package's `routes.js` and its HTTP agent integration test were dropped with it.

**Action required**: import the mock control agent from `@tetherto/mdk-worker-mock` and drop any dependency on `@tetherto/mdk-mock-control-service`.

#### UI shell template moved out of the CLI and slimmed to a backbone

The `mdk-ui-shell` template is no longer a scaffold-only tree inside `@tetherto/mdk-ui-cli`. It now lives at **`examples/mdk-ui-shell-template/`** as a real Vite app you can `npm run dev` in place, and the CLI's build step copies it into `dist/templates/mdk-ui-shell-template` (filtering local artifacts like `node_modules`, `dist`, `.env`, `package-lock.json`, and renaming `.gitignore` → `_gitignore`, which `create` restores at scaffold time).

`mdk-ui create` now produces a **bare backbone** — Google OAuth sign-in, the token lifecycle, and the app frame (header, user menu, sidebar) around a Home landing page — with no feature pages. The reference pages (Dashboard, Alerts, Pool Manager, Explorer, Site Overview) ship in the template under `_managed/pages/`, which `create` strips; they are restored individually with `mdk-ui add page <Name>`.

Template resolution changed from filesystem discovery to an explicit registry, because templates now span two source roots (the runnable `examples/` app and the bundled `packages/cli/templates/starter` scaffold) that only reunite under `dist/templates/` once published.

**Action required**: expect a scaffolded app to contain no feature pages; add the ones you want with `mdk-ui add page`. Anyone reading templates out of the CLI package tree should read `dist/templates/<id>` instead.

#### Examples restructured

- **`examples/e2e/` removed** — its UI became `examples/mvp-site/ui/`
- **`examples/site-backend/` removed** — its site Gateway plugin became `examples/mvp-site/backend/gateway-plugins/site/` (controllers `command`, `history`, `overview`, plus `utils`)
- **`examples/backend/` de-packaged** — every nested `package.json` under it is gone (containers, minerpools, miners, powermeters, sensors, site, site-single-process, mdk-e2e, mdk-plugin-e2e), taking the tree from 131 to 57 tracked files. The remaining examples are plain scripts run from the parent rather than installable packages, and the per-family device scripts were folded into per-vendor entry points (e.g. `containers/mdk.client.container.js` → `containers/antspace/index.js`, `miners/mdk.client.miner.js` → `miners/whatsminer/index.js`).

### Added

#### `@tetherto/mdk-mcp` — MCP server

New package at `backend/core/mcp/` exposing MDK data to agents over the Model Context Protocol.

| Piece | Description |
|---|---|
| `createMcpServer(root, port, client, pluginDirs)` (`server.js`) | Starts a `StreamableHTTPServerTransport` MCP server on `127.0.0.1:<port>`, answering `POST /mcp` only; validates `root`/`port` with `ERR_INVALID_MCP_ROOT` / `ERR_INVALID_MCP_PORT`, and installs SIGINT/SIGTERM shutdown that closes the MDK client first |
| `loadPlugin` (`lib/plugin-loader.js`) | Loads `mcp-plugin.json` manifests and returns their `tools[]`; each tool declares `id`, `description`, `handler`, and an optional JSON-Schema `schema` that the SDK enforces before dispatch |
| Tool handlers | Invoked as `(args, services)` with `services.mdkClient`, so a tool reaches the fleet through the ordinary MDK protocol client |

A fresh server instance is constructed per request (stateless transport, no session id). Dependencies: `@modelcontextprotocol/sdk` ^1.29.0, `async` 3.2.6, `debug` 4.4.1. `examples/full-site/` gained an `mcp-client.js` driver alongside its updated `docs/mcp-server.md`.

#### `@tetherto/mdk-skill` — MDK Developer Skill Suite

New package at `packages/mdk-skill/` — an Agent Skills (`SKILL.md`) bundle assembled from the monorepo's real artifacts and versioned to track the MDK release line. It is a copy-only assembler: each library owns its artifacts, and this package curates them into `dist/skills/` and installs them flat into `.cursor/skills/` or `.claude/skills/` (`npm run install:skills`; `assemble` also runs on `prepack`).

Five skills ship: `mdk` (with `architecture`, `glossary`, `package-index`, and `protocol` references), `mdk-device-worker` (contract-authoring, device-families, local-testing and worker-base-api references, an `mdk-contract.template.json` asset, plus `validate-contract.mjs` and `worker-smoke.mjs` scripts), `mdk-app-plugin`, `mdk-deployment`, and `mdk-ui-component`. A top-level `mdk-contract.schema.json` and a `sources.map.json` describing the copy graph are included.

#### `site-monitor` Gateway plugin

New built-in plugin (`backend/core/plugins/site-monitor/`) — "site identity, feature configuration, and live per-device hashrate via the MDK protocol client" — registered by default alongside `telemetry` and `site-hashrate`.

| Route | Method + path | Description |
|---|---|---|
| `site.info` | `GET /auth/site` | Site name from the Gateway config (`common.json` `site`) |
| `site.feature-config` | `GET /auth/featureConfig` | The `featureConfig` object from the Gateway config |
| `site.hashrate` | `GET /site-monitor/hashrate` | Live per-device hashrate and power with site totals |

All three are declared `auth: false` and `safety: "read-only"`.

#### Whatsminer versioned API protocol handlers

`@tetherto/mdk-worker-whatsminer` gained a protocol layer at `lib/protocols/` that adapts to the device's API generation instead of assuming one wire format.

- `ApiHandlerFactory` resolves a handler from any version string by **major** version (`'2.2.2'` → the v2 handler), with `normalizeVersion`, `getSupportedVersions`, `getHandlerClass`, `getDefaultPort`, and `isVersionSupported` helpers; an unknown major throws `ERR_UNSUPPORTED_API_VERSION`.
- Two handlers over a shared `wm-api-base`: **v2** (canonical `2.0.5`, port `4028`, auth command `get_token`) and **v3** (canonical `3.0.3`, port `4433`, auth command `get.device.info`), with a `COMMAND_MAP_V3` translating v2 underscore commands to v3 dot notation. v2 remains the default.
- Five new unit suites cover the factory, constants, base handler, and both version handlers

#### UI — container detail, system info, and clickable table rows

- **`ContainerDetail`** (`@tetherto/mdk-react-devkit`, `domain/features/container-detail/`) — the presentational page shell every container tab mounts into: a back link, the container name, and a per-model tab strip. The page owns routing and the active tab and supplies the body as `children`; a `ContainerDetailPlaceholder` covers not-yet-built tabs. Exported from `domain/features`, with `USAGE.md`, an example, and specs. A matching `container-detail-page.tsx` was added to the catalog app.
- **`useSystemInfo`** (`@tetherto/mdk-react-adapter`) — composes `GET /auth/site`, `GET /auth/userinfo`, and `GET /auth/featureConfig` into one page-ready `SystemInfo` payload (`site`, `email`, `roles`, `featureCount`) with a single `refetch`. Exported with its `SystemInfo` and `UseSystemInfoResult` types.
- **`DataTable` row clicks** — new `onRowClick` on the `DataTable` primitive, threaded through `DeviceExplorer` and `DeviceExplorerTable`. Rows become `role="button"`, focusable, and activatable with Enter/Space; clicks originating inside a `button`, `a`, `input`, `label`, `[role="checkbox"]`, or anything marked `data-no-row-click` are ignored, so selection checkboxes and expand toggles keep working.
- **Hashrate helpers** — `getHashrateString` and `getHashrateUnit` are now exported from the devkit `domain` entry point
- **Header stat boxes** — `HeaderHashrateBox` gained `fractionDigits` prop (default `3`) for controlling decimal precision.

#### `examples/mvp-site`

A new minimal single-container site demo: Kernel, Gateway, a Whatsminer worker, an Ocean pool worker, a SATEC powermeter worker, and the MDK React UI, with an MCP server via `@tetherto/mdk-mcp`. Devices are seeded from a gitignored `config/devices.json` (keyed by `miners` / `powermeters`, copied from the checked-in `.example`), each mock device getting its own port. Ships PM2 deployment under `deploy/`, a `setup-config.js` generator, `start.js`, unit tests, and its own UI workspace with pool setup, dynamic hashrate units, and site hashrate history.

#### Documentation

- **Container worker guides** (new): `docs/guides/containers/index.md`, `run-antspace-worker.md`, and `run-bitdeer-worker.md`
- **New reference pages**: `docs/reference/kernel/modules.md` and `docs/reference/protocol/messages.md`
- Refreshed worker/deployment/gateway guides, the get-started and quickstart tutorials, `docs/concepts/security-boundaries.md`, `docs/concepts/stack/workers.md`, and the glossary to match the plugin-host Gateway and the new example layout

#### CI / tooling

- **`.github/scripts/workspace-context.sh`** resolves, per package directory, whether the authoritative install is a single root `npm ci` (workspace member) or an in-place install (standalone package such as `ui`, `backend/core/plugins`, or the example UIs), and prints the install dir, cache slug, and `node_modules` path the cache actions consume. Members share one `workspace-root` cache slug keyed on the root lockfile, which fixes members failing to link dev bins (e.g. `standard`) under a partial single-workspace install.
- **`.github/actions/test-with-coverage`** (new) enforces the ≥80% per-package coverage gate; the `mdk` package is sharded across parallel runners (fast unit vs. the slow actions-flow integration suites) with a `coverage-mdk` job merging shard coverage before gating.
- Changes under `.github/scripts/` are now classified as CI-infra and run every suite

### Changed

- **The repo root is now an npm workspaces monorepo.** Root `package.json` declares 21 workspace members — `backend/core/{client,gateway,kernel,mdk,mdk-worker,mcp,plugins}`, every `backend/workers/*` package, and `examples/mvp-site` — plus a root `overrides` block. `ui/`, `backend/core/plugins`, and the example UI apps stay standalone. Install workspace members with one `npm ci` at the root, not per package.
- **Gateway internal dependencies moved from `file:` links to registry ranges** — `@tetherto/mdk-client` and `@tetherto/mdk-plugins` are now `^0.6.0` rather than `file:../client` / `file:../plugins`. `examples/mvp-site` likewise consumes `@tetherto/mdk-*` at `^0.6.0`.
- **Managed pages gained Dashboard and hidden-page support.** `Dashboard` (hashrate + consumption charts, active incidents, mining pools) is now a managed page restorable with `mdk-ui add page Dashboard`. `navIcon`/`navEntry` became optional so deep-link-only pages can be managed without a sidebar entry, and `add`/`remove page` skip nav patching for them.
- **Mock initial states and utilities reworked** across antspace (default + immersion), bitdeer (D40), f2pool, ocean, whatsminer (M56S), and the shared `base.mock.js`, with new unit suites for `base.mock`, device mocks, miner mocks, and a `cli-mock` fixture set
- **Dependency bumps**: `fastify` 5.8.5 → 5.10.0 and `@fastify/static` 9.1.3 → 10.1.2 (Gateway + root overrides); `@tetherto/svc-facs-httpd` v1.0.0 → v2.0.0; `aedes` 1.0.2 → 1.1.1; `mingo` 6.4.6 → 6.4.15; `svgo` ^3.0.0 → ^3.3.4. The router move is covered under Security — `react-router-dom` is replaced outright, not bumped.
- **Doc generators now extract TypeScript types** via a shared `ui/scripts/ts-morph-utils.mts`, used by the react-adapter hook generator, the devkit registry generator and its `registry-types`, and the ui-foundation store generator
- All package versions across `backend/core`, `backend/workers`, `ui/`, `examples/`, and `packages/mdk-skill` are synced to **`0.6.0`**, including `examples/mdk-ui-shell-template`, which moves off its `0.0.0` scaffold default onto the shared release line

### Removed

- The Gateway's entire built-in HTTP API surface — see Breaking changes for the module-by-module list, plus the `ws` integration test and the ~40 unit suites covering the deleted routes, handlers, and libraries
- **`@tetherto/mdk-mock-control-service`**, and the nine duplicated per-worker `mock/mock-control-agent.js` copies
- **`examples/e2e/`** and **`examples/site-backend/`**, and every nested `package.json` under `examples/backend/`
- The **`mdk-ui-shell` template tree** inside `@tetherto/mdk-ui-cli` (relocated to `examples/mdk-ui-shell-template/`), including the template's `_meta.json` and its `constants/dashboard.ts` / `constants/routes.ts`
- The **`generate:shell`** script from `ui/package.json`, and the `!apps/mdk-ui-shell` workspace exclusion — the shell is no longer generated into `ui/apps/`
- The Gateway's **`test:ws`** npm script

### Security

#### UI — Header stat box prop renames

**`HeaderHashrateBox` and `HeaderMinersBox` props renamed** from MOS terminology to App terminology:

- `HeaderHashrateBox`:
  - `mosPhs` → `appPhs`
  - `mosLabel` → `appLabel` (default changed from `'MOS'` to `'APP'`)
  
- `HeaderMinersBox`:
  - `mosTotal` → `appTotal`  
  - `mosLabel` → `appLabel` (default changed from `'MOS'` to `'APP'`)

**Action required**: Update all `HeaderHashrateBox` and `HeaderMinersBox` usage to use the new prop names. The functionality is identical; only the prop names have changed.

**Migration example**:
```tsx
// Before (0.5.x)
<HeaderHashrateBox mosPhs={1234.5} mosLabel="MOS" />
<HeaderMinersBox mosTotal={50} mosLabel="MOS" />

// After (0.6.0)
<HeaderHashrateBox appPhs={1234.5} appLabel="APP" />
<HeaderMinersBox appTotal={50} appLabel="APP" />
```

#### `react-router-dom` replaced by `react-router` v8 (breaking for scaffolded apps)

`react-router-dom@7` is affected by GHSA-qwww-vcr4-c8h2 (high), and the fix exists only in `react-router@8.3.0` — a release that discontinued the `react-router-dom` package entirely (its last version, `7.18.1`, hard-pins `react-router: 7.18.1`, so no override can resolve it). Every UI surface therefore moved off the shim:

| Package | Before | After |
|---|---|---|
| `ui/apps/catalog` | `react-router-dom@^7.13.0` | `react-router@^8.3.0` |
| `examples/mdk-ui-shell-template` | `react-router-dom@^7.13.0` | `react-router@^8.3.0` |
| `examples/mvp-site/ui` | `react-router-dom@^7.18.1` | `react-router@^8.3.0` |
| `examples/full-site/ui` | `react-router-dom@^7.18.1` | `react-router@^8.3.0` |

26 files changed their import specifier from `react-router-dom` to `react-router`; no router API changed, since v7's `react-router-dom` was already a re-export of `react-router` and every symbol in use (`createBrowserRouter`, `RouterProvider`, `HashRouter`, `Navigate`, `Route`, `Routes`, `Link`, `Outlet`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) is exported unchanged by 8.3.0.

**Action required** for anyone with an app scaffolded from an earlier shell template: replace the `react-router-dom` dependency with `react-router@^8.3.0` and rewrite the import specifier. Note `react-router@8` raises its peers to `react`/`react-dom` `>= 19.2.7` and `engines.node` to `>= 22.22.0`.

**Not affected**: `@tetherto/mdk-react-devkit`, `@tetherto/mdk-react-adapter`, and `@tetherto/mdk-ui-foundation` declare no router dependency — `RequireAuth` is router-agnostic by design. The bundled `templates/starter` scaffold stays on `react-router-dom@^6`, which neither advisory affects.

#### Dependency overrides and bumps

- `ajv` `8.17.1` → **`8.20.0`** in `backend/workers` (direct devDependency), clearing GHSA-2g4f-4pwh-qvx6 (ReDoS via the `$data` option; affected `>= 7.0.0-alpha.0, < 8.18.0`).
- `brace-expansion` forced to **`>= 5.0.8`** (GHSA-mh99-v99m-4gvg, DoS via unbounded expansion; the advisory marks every version `<= 5.0.7` vulnerable) via `overrides` in the repo root, `ui/`, `backend/core`, `backend/workers`, `examples/full-site`, and `examples/mdk-ui-shell-template`. This clears it wherever a modern `glob`/`minimatch` is present. It remains reachable through the dev-only `standard` → eslint@8 → minimatch@3 chain, which accepts only `brace-expansion@^1.1.7` and for which upstream published no patched 1.x — documented against the `audit-ci` allowlist entry rather than silently suppressed.
- Removed a dead `@isaacs/brace-expansion` override pinned to `5.0.5`, **a version that was never published** (only 5.0.0 and 5.0.1 exist). It appeared in no lockfile, so it never resolved — but it would have failed any install that needed the package.

The remaining advisory-clearing overrides, in `ui/package.json` and the root `overrides` block:

| Override | Resolution |
|---|---|
| `brace-expansion` (`>=1.0.0 <1.1.13`, `>=2.0.0 <2.0.3`, `>=5.0.0 <5.0.7`) | all pinned to `>=5.0.7` |
| `immutable` (`>=5.0.0 <5.1.8`) | `>=5.1.8` |
| `js-yaml` (`>=4.0.0 <4.3.0`) | `>=4.3.0 <5.0.0` |
| `linkify-it` (`<=5.0.1`) | `>=5.0.2 <6.0.0` |
| `shell-quote` (`<1.9.0`) | `>=1.9.0` |
| `ws` (`>=8.0.0 <=8.20.0`) | `>=8.20.1` |
| `@hono/node-server` | `2.0.12` |
| `svgo` | `^3.3.4` |

One advisory was added to the `audit-ci` allowlist (`.github/scripts/audit-ci.jsonc`): `GHSA-mh99-v99m-4gvg`, with an inline rationale recording why no override or upgrade can reach it and what removing it would take. `GHSA-qwww-vcr4-c8h2` is **not** allowlisted — it is fixed outright by the `react-router` v8 move above.

### Fixed

- **Device actions were rejected with a 400.** `toVotingPayload` posted the staged `tags` and `crossThing` fields, which the `POST /auth/actions/voting` body schema does not recognise, and sent no `query` — so every device-targeted action failed its `required: ['query','action','params']` check. Targeting now reaches the backend solely through `query`, built from the staged tags as `{ tags: { $in: tags } }`; an action can opt out with `overrideQuery: false` to submit an explicit `query` as-is (pool assignment targets by device id, not tags). `PendingSubmissionAction` gained typed `overrideQuery` and `crossThing` fields documenting that both are client-only queue metadata and never posted.
- **One bad pool account no longer breaks the whole Ocean stats cycle.** Unknown or inactive accounts return an error body with no `result`; `fetchStats` now wraps each account's earnings/hashrate/balance reads, raises `ERR_ACCOUNT_DATA_MISSING` when earnings or hashrate are absent, logs `ERR_STATS_FETCH <username>`, and continues to the next account instead of failing the entire fetch.
