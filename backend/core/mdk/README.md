# @tetherto/mdk

## Overview

Bootstrap utilities for MDK. This package is the primary entry point for application developers. It provides 
high-level convenience functions that wire together the [Kernel](../kernel/README.md), [device Workers](../../workers/README.md), 
and the [Gateway](../gateway/README.md) HTTP server without requiring direct knowledge of lower-level APIs.

## Prerequisites

- Node.js >= 24

## Install

This package is part of the MDK monorepo and requires both core and Worker dependencies. After cloning, install from the repo root:

```bash
backend/core/install-packages.sh
backend/workers/install-packages.sh
```

The [run a mining site tutorial](../../../docs/tutorials/run-a-site.md) is the full clone-and-install walkthrough.

## Usage

```js
const { getKernel, startGateway, waitForDiscovery, shutdown } = require('@tetherto/mdk')
const { startWhatsminerWorker } = require('@tetherto/mdk-worker-whatsminer')

// 1. Start Kernel
const kernel = await getKernel()

// 2. Start a Worker: each Worker package ships its own boot function that
//    constructs a WorkerRuntime internally (see @tetherto/mdk-worker)
const { runtime } = await startWhatsminerWorker({
  workerId: 'whatsminer-rack-1',
  model: 'm56s',
  storeDir: './data/whatsminer',
  seedDevices: [{ id: 'WM-001', opts: { address: '192.168.1.10', port: 14028, password: 'admin' } }]
})

// 3. Register the Worker with Kernel (same-process mode, no DHT/local discovery needed)
await kernel.registerWorker(runtime.getPublicKey())

// 4. Wait for Kernel to discover and register the Worker
await waitForDiscovery(kernel)

// 5. Optionally start the HTTP API
const server = await startGateway({ kernel, port: 3000 })

// In tests or scripts where SIGINT is not fired:
// await shutdown(kernel)
```

> [!NOTE]
> - There is no single generic `startWorker(WorkerClass, opts)` entry point: every Worker package supplies its own
> boot function that [builds a `WorkerRuntime` for its plugin](#start-a-worker). 
> - [Worker deployment options](../../../docs/concepts/deployment-topologies.md) include same-process, local, and DHT.

## API

### `getKernel(opts?)` → `Promise<KernelManager>`

Start the Kernel with defaults suited for single-process development. Automatically:
- In DHT mode, reads the topic from `DEFAULT_TOPIC_FILE` or generates one if absent
- In local mode, watches a shared Worker-key directory and does not create or join a DHT topic
- Publishes the HRPC public key as hex to `DEFAULT_KEY_FILE` after start, so out-of-process clients can connect without configuration
- Registers signal handlers for graceful shutdown

The key file is not deleted on shutdown: the key is stable across restarts (HRPC seeds persist in the Kernel store), so a leftover 
file stays correct for the same store directory.

```js
const kernel = await getKernel()
// kernel.topic — hex DHT topic used, or undefined in local mode
// kernel.getPublicKey() — HRPC public key
```

| Option | Type | Description |
|--------|------|-------------|
| `opts.root` | `string` | Data root directory (default: `os.tmpdir()/mdk`) |
| `opts.storeDir` | `string` | Override Hyperbee store path |
| `opts.discovery` | `object` | Discovery config: `{ mode: 'dht' \| 'local', dir? }` (default: DHT) |
| `opts.topic` | `string` | 32-byte hex DHT topic (overrides topic file) |
| `opts.topicFile` | `string` | Override path to topic file |
| `opts.keyFile` | `string\|false` | Path for the HRPC key file (default: `DEFAULT_KEY_FILE`); `false` to disable publishing |
| `opts.hrpc` | `object\|false` | HRPC config (default: enabled, empty allowlist) |
| `opts.telemetryPullMs` | `number` | Telemetry poll interval in ms |
| `opts.healthPingMs` | `number` | Health ping interval in ms |

Cadence options are flat on `getKernel()`. For nested `cadences` configuration, including `statePullMs`, use the 
[`createKernel()` API](../kernel/README.md#createkernelopts--kernelmanager).

### Start a Worker

There is no generic `startWorker(WorkerClass, opts)` export in this package. Each Worker package (e.g.
`@tetherto/mdk-worker-whatsminer`) supplies its own boot function that constructs a
[`WorkerRuntime`](../mdk-worker/lib/worker-runtime.js) internally and connects it to Kernel through [DHT, local, or
same-process discovery](../../../docs/concepts/deployment-topologies.md). Every boot function accepts (`kernelTopic`, `discovery`, 
or direct `kernel.registerWorker(runtime.getPublicKey())`).

```js
const { startWhatsminerWorker } = require('@tetherto/mdk-worker-whatsminer')

const { runtime, stop } = await startWhatsminerWorker({
  workerId: 'whatsminer-rack-1',   // one runtime process = one workerId
  model: 'm56s',
  storeDir: './data/whatsminer',
  kernelTopic: null,               // omit/null to register by key instead of a DHT topic
  seedDevices: [{ id: 'WM-001', opts: { address: '192.168.1.10', port: 14028, password: 'admin' } }]
})

await kernel.registerWorker(runtime.getPublicKey()) // same-process discovery
```

Returns vary by Worker package, but every boot function returns at least `{ runtime, stop }`: `runtime` is the
`WorkerRuntime` instance (`getPublicKey()`, `getDeviceContext(deviceId)`); `stop()` tears the Worker down.

### `startGateway(opts?)` → `Promise<WrkServerHttp>`

Start the Fastify-based HTTP server. Writes config files under `opts.root`, deep-merging any override objects 
with the example defaults.

```js
const server = await startGateway({
  kernel,
  port: 3000,
  root: './data/gateway'
})
```

| Option | Type | Description |
|--------|------|-------------|
| `opts.root` | `string` | Config/data root (default: `os.tmpdir()/mdk/gateway`) |
| `opts.port` | `number` | HTTP port (default: 3000) |
| `opts.env` | `string` | Environment string (default: `'development'`) |
| `opts.kernel` | `KernelManager` | Kernel instance; Gateway stop is registered on cleanup. Its `getPublicKey()` also resolves the Kernel key |
| `opts.kernelKey` | `string\|Buffer\|false` | Kernel HRPC listener public key (hex or Buffer); `false` to run without a Kernel connection (each plugin's own `mdkClient` still builds, but fails per call with [`ERR_MDK_CLIENT_UNAVAILABLE`](../client/README.md#createmdkclientconfig-opts--auto-connecting-client)) |
| `opts.keyFile` | `string` | Key file to resolve the Kernel key from (default: `DEFAULT_KEY_FILE`) |
| `opts.bootstrap` | `array` | DHT bootstrap nodes threaded to each plugin's own client (testnets) |
| `opts.common` | `object` | Overrides for `common.json` |
| `opts.httpd` | `object` | Overrides for `httpd.config.json` |
| `opts.store` | `object` | Overrides for `store.config.json` |
| `opts.additionalRoutes` | `array` | Extra Fastify route definitions (raw escape hatch; prefer `extraPluginDirs`) |
| `opts.extraPluginDirs` | `array` | Plugin package directories to load at boot alongside the built-in plugins |

The Kernel HRPC key is resolved **before any boot side effects**, in this order:

1. `opts.kernelKey`: hex or Buffer; `false` means run without a Kernel connection.
2. `opts.kernel.getPublicKey()`: in-process Kernel handle.
3. Key file: `opts.keyFile` or `DEFAULT_KEY_FILE`.
4. Otherwise throws: `ERR_KERNEL_KEY_FILE_NOT_FOUND`.

The resolved key lands in each plugin's context; the Gateway worker itself opens no Kernel connection — each plugin builds its own
[`@tetherto/mdk-client`](../client/README.md) from that key, and a failed connect fails that plugin's calls with
[`ERR_MDK_CLIENT_UNAVAILABLE`](../client/README.md#createmdkclientconfig-opts--auto-connecting-client) so as not to crash the HTTP server.

### `startKernel(opts?)` → `Promise<KernelManager>`

Lower-level Kernel start. Prefer `getKernel()` for new code. Does not register SIGINT or read the topic file, and writes the key file only when 
`opts.keyFile` is explicitly passed.
For caller-managed construction and lifecycle, use [`createKernel()` from `@tetherto/mdk-kernel`](../kernel/README.md#createkernelopts--kernelmanager).

### `waitForDiscovery(kernel, timeout?)` → `Promise<WorkerEntry[]>`

Poll the registry until at least one Worker reaches `READY` state with devices populated, or `timeout` ms elapses 
(default: 30 000 ms). Returns the full list of registered Workers.

```js
await waitForDiscovery(kernel, 15000)
const workers = kernel.registry.listWorkers()
```

### `onShutdown(cleanupFn, opts?)` → handler

Register a one-shot cleanup handler on `SIGINT` / `SIGTERM`. Returns the handler so tests can invoke it directly.

| Option | Type | Description |
|--------|------|-------------|
| `opts.signals` | `string[]` | Signals to listen for (default: `['SIGINT', 'SIGTERM']`) |
| `opts.forceMs` | `number` | Force-exit timeout if cleanup hangs (default: 3000 ms) |

> [!NOTE]
> `getKernel()`, `startGateway()`, and every Worker boot function register their own `onShutdown`
> handlers internally. Call this only when you need to add teardown logic outside
> a boot handle — for example, closing a database or flushing a log buffer.

### `shutdown(handle)` → `Promise<void>`

Gracefully stop any MDK boot handle — Kernel, Gateway, or Worker. Drains the handle's `_cleanup` array in registration order, 
then calls `.stop()` on the handle itself. Idempotent: calling `shutdown` twice on the same handle is safe.

```js
await shutdown(kernel) // stops Gateway and Workers (chained), then stops Kernel
```

Prefer `shutdown(kernel)` over calling `shutdown` on each handle separately: passing the Kernel handle tears everything down in the 
order services were started.

### Constants

```js
const { DEFAULT_TOPIC_FILE, DEFAULT_KEY_FILE } = require('@tetherto/mdk')
// DEFAULT_TOPIC_FILE — os.tmpdir()/mdk/.dht-topic
// DEFAULT_KEY_FILE   — os.tmpdir()/mdk/.kernel-key (Kernel HRPC public key, hex)
```

## Single-process full stack

The typical pattern for running everything in one process during development:

```js
const { getKernel, startGateway, waitForDiscovery } = require('@tetherto/mdk')
const { startWhatsminerWorker } = require('@tetherto/mdk-worker-whatsminer')
const { startAntminerWorker } = require('@tetherto/mdk-worker-antminer')

async function main () {
  const kernel = await getKernel()

  const { runtime: wm } = await startWhatsminerWorker({
    workerId: 'whatsminer-rack-1',
    model: 'm56s',
    storeDir: './data/whatsminer',
    seedDevices: [{ id: 'WM-001', opts: { address: '192.168.1.10', port: 14028, password: 'admin' } }]
  })
  await kernel.registerWorker(wm.getPublicKey())

  const { runtime: am } = await startAntminerWorker({
    workerId: 'antminer-rack-1',
    model: 's19xp',
    storeDir: './data/antminer',
    seedDevices: [{ id: 'AM-001', opts: { address: '192.168.1.20', port: 4028 } }]
  })
  await kernel.registerWorker(am.getPublicKey())

  await waitForDiscovery(kernel)

  await startGateway({ kernel, port: 3000 })
  console.log('MDK running at http://localhost:3000')
}

main()
```

## Config management

`startGateway()` and each Worker's boot function copy example config files into their `opts.root/config/` (or `storeDir`) on first run.
After that, the files are left untouched so your edits survive restarts. Pass override objects to `startGateway()` to programmatically
set specific values without editing files.

Config file precedence:
1. Existing file on disk (your edits are authoritative).
2. Deep-merged overrides from `opts.*`.
3. `.example` template from the package.

## Directory layout

```
mdk/
├── index.js              # `getKernel`, `startGateway`, `waitForDiscovery`
├── services.js           # `startServices` — facility bootstrap helpers
├── worker.js             # Worker-side entry point
├── lib/
│   ├── local-discovery.js  # `keysDir`, `publishWorkerKey`: the `discovery: { mode: 'local' }` helpers
│   ├── utils.js            # Shared helpers (isValidSnap, isOffline, etc.)
│   ├── worker-infra.js     # `createWorkerInfra` — per-Worker infra bootstrap
│   ├── services/           # One class per domain service (Actions, Alerts, Comments, LogHistory, Logs, Pool, Provisioning, Settings, Snaps, Stats)
│   │   └── pool-utils/     # Shared pool-service constants and time helpers
│   ├── templates/          # Alert and stats computation templates
│   └── things/             # Thing subclasses — Container, Miner, PowerMeter, Sensor (base: Thing)
├── utils/
│   ├── constants.js        # MDK_STORE and other well-known names
│   ├── index.js            # Facility bootstrap helpers (Intervals, Store, ActionApprover)
│   ├── initialize.js       # Service initialization helpers
│   ├── service-bootstrap.js # Spawns/manages service subprocesses
│   └── compose-yaml.js     # `buildComposeYaml` — docker-compose file generation
└── tests/
    ├── unit/                # One suite per lib/service/thing/util module
    └── integration/         # Kernel-key-file, local-discovery, actions-flow (per Worker family)
```

## Next steps

- [Run the Gateway](../../../docs/guides/gateway/run.md): programmatic and standalone startup, auth configuration, and HRPC key setup
- [Add hardware devices](../../workers/README.md): understand how Workers register devices and expose them to Kernel
- [Add custom routes with plugins](../../../docs/guides/gateway/plugins.md): extend the Gateway via `extraPluginDirs`
- [See the full-site example](../../../examples/full-site/README.md): multi-Worker, multi-device setup in a separate-process topology
- [Understand the the full MDK layer model](../../../docs/concepts/architecture.md)
