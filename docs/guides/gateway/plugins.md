---
title: Gateway plugins
description: Use the default Gateway plugins, mount third-party plugins, and build your own using the mdk-plugin.json format
docs@tether_slug: guides/gateway/plugins
---

## Overview

The Gateway exposes HTTP routes through a declarative plugin system. Each plugin is a directory containing an
[`mdk-plugin.json`][plugins-manifest] manifest and one or more controller files. MDK ships a set of default plugins that load automatically; 
you can mount additional plugins for your own site logic.

> [!NOTE]
> A plugin builds its own [`@tetherto/mdk-client`][mdk-client-readme] to call into the Kernel — no knowledge of the MDK Protocol envelope or internal message shapes is required.

## Prerequisites

- The [Gateway is running][run-gateway]
- A Kernel instance running and reachable, or `kernelKey: false` to start without a Kernel connection (development only)

## Default plugins

MDK ships plugins that load automatically on Gateway startup:

- The `telemetry` plugin serves site metrics (hashrate, consumption, efficiency, temperature, and more)
- The `site-hashrate` plugin serves aggregated site hashrate history
- The `site-monitor` plugin serves site configuration, feature flags, and live per-device hashrate

> [!IMPORTANT]
> The [`auth` plugin][auth-plugin-readme] (`@tetherto/mdk-plugin-auth`) ships in the same package but is not among them, and mounting it via
> `extraPluginDirs` does not give you working identity endpoints: its controllers still expect a second handler parameter and a populated
> `req._info` that the Gateway does not provide. Supply your own identity layer.

The [plugin reference][plugins-readme] lists every route each of these plugins serves, with its method, generated from the plugin's
`mdk-plugin.json`. Plugins you mount yourself are documented by their own manifests.

<Steps>

<Step>

### Mount a plugin

Pass an `extraPluginDirs` array to `startGateway()` to load additional plugins at boot alongside the default plugins:

```js
const { startGateway } = require('@tetherto/mdk/backend/core/mdk')

await startGateway({
  kernel,
  port: 3000,
  extraPluginDirs: [
    path.join(__dirname, 'plugins/custom-metrics'),
    path.join(__dirname, 'plugins/alerts')
  ]
})
```

Each entry must be an absolute path to a directory containing an [`mdk-plugin.json`][plugins-manifest]. The plugin loader validates the
manifest and all handler files at startup — missing files or invalid manifests throw immediately before the server comes up.

[Exposing a plugin's routes to the operator agent][expose-data] turns them into MCP tools with no separate manifest, using this
same `extraPluginDirs` entry plus one flag.

</Step>

<Step>

### Build a plugin

A plugin is a directory with two things: a manifest and controllers.

#### 1.1 Create the manifest

[`mdk-plugin.json`][plugins-manifest] declares the plugin identity (`name`, `version`) and a `routes` array. Each route needs an `id`, a `handler` path, and either
an `http` block with a `method` and `path`, or those same `method`/`path` fields flattened to the route's top level; the bundled agent plugin
uses the flat form. Rather than copy a synthetic example, start from a real manifest and trim it:

- [`examples/backend/mdk-plugin-e2e/gateway-plugin/mdk-plugin.json`][e2e-manifest]: one route, fully annotated with a response
schema, `constraints`, `errors`, and `safety`. The easiest starting point, and [seeing a plugin serve your data][serve-an-endpoint]
runs it end to end
- [`examples/mvp-site/backend/gateway-plugins/site/mdk-plugin.json`][mvp-site-manifest]: four routes including `GET`s with query
parameters, and `POST`s with a `requestBody` and path parameters
- [`backend/core/plugins/telemetry/mdk-plugin.json`][telemetry-manifest]: auth, caching, query parameters, and named-export handlers

Path parameters use `{param}` syntax — the loader normalises them to Fastify's `:param` format. For named exports use `"handler": 
"./controllers/foo.js#namedExport"`. The [plugin reference][plugins-readme] explains what each field means and what the loader requires.

#### 1.2 Write a controller

A controller builds its own [`@tetherto/mdk-client`][mdk-client-readme] once, from the plugin's
context config, in a [`lib/client.js`][telemetry-client] every controller in the plugin requires.

Every controller exports an `async function (req)`:

```js
// controllers/live.js — read live telemetry
const mdkClient = require('../lib/client')

module.exports = async function live (req) {
  const deviceId = req.query.deviceId
  const telemetry = await mdkClient.pullTelemetry(deviceId, 'metrics')
  return { deviceId, ...telemetry }
}
```

```js
// controllers/command.js — dispatch a command
const mdkClient = require('../lib/client')

module.exports = async function command (req) {
  const deviceId = req.params.deviceId
  const { mode } = req.body

  const result = await mdkClient.sendCommand(deviceId, 'setPowerMode', { mode })

  return {
    deviceId,
    commandId: result.commandId,
    status: result.status
  }
}
```

</Step>

</Steps>

### The `req` object

A controller's only argument. [The controller reference][plugins-readme-controllers] documents every field
(`params`, `query`, `body`, `headers`, `_info`) and how it's assembled.

### The plugin's context module

`require('@tetherto/mdk-gateway/plugin')` resolves, inside a loaded plugin, to that plugin's own frozen context. [The
controller reference][plugins-readme-controllers] shows a controller building its own client from it:

| Field | Type | Contains |
| --- | --- | --- |
| `config` | `object` | The Gateway's runtime config, with `kernelKey`/`kernelBootstrap` folded in, and this plugin's own per-plugin config layered over the top key-by-key |

### Supplying per-plugin config

That per-plugin config isn't declared in `mdk-plugin.json` — it comes from the stack spec (`spec.gateway.plugins[].config`), passed as a `config` key alongside `dir` in the `extraPluginDirs` entry:

```js
extraPluginDirs: [
  { dir: path.join(__dirname, 'plugins/custom-metrics'), config: { apiKey: process.env.METRICS_API_KEY } }
]
```

Build a [`lib/client.js`][telemetry-client] from it once per plugin and `require` that module from every controller that
needs one — there is no per-request Kernel access to guard, only the client's own connect failures:

<details>
<summary>Migrate from the `services` parameter (pre-0.7)</summary>

A controller used to take `(req, services)`, a `services` object the Gateway passed to every plugin.

| Before | After |
| --- | --- |
| `module.exports = (req, services) => …` | `module.exports = (req) => …` |
| `services.conf` | `config` from `require('@tetherto/mdk-gateway/plugin')` |
| `services.mdkClient` | The plugin builds its own from `config.kernelKey` / `config.kernelBootstrap` |
| `services.dataProxy` | Removed with the data proxy |
| `services.authLib` | Removed in 0.6.0 |

Drop the second handler parameter, read `config` from the context module, and build your own MDK client for Kernel
access — the bundled `site-monitor`, `site-hashrate`, and `telemetry` plugins each ship a `lib/client.js` showing
the pattern.

</details>

> [!IMPORTANT]
> `createMdkClient` connects on first use and memoizes the connection. A failure maps to `ERR_MDK_CLIENT_UNAVAILABLE` (or your own
> `opts.errorCode`) and resets so the next call retries — guard the call, not a null client:
> ```js
> try {
>   return await mdkClient.pullTelemetry(deviceId, 'metrics')
> } catch (err) {
>   if (err.message === 'ERR_MDK_CLIENT_UNAVAILABLE') throw new Error('ERR_KERNEL_UNREACHABLE')
>   throw err
> }
> ```

### Read hardware data

Call the client directly for live device data — [`pullTelemetry`, `getCapabilities`, and `listWorkers`][client-readme-methods]
are documented with their return shapes in the client's own reference.

A Worker is single-device, so a live fleet-wide total — hashrate across every miner on site, say — is the controller's own job:
list every Worker, pull each device's live telemetry, and add the numbers up:

```js
const { workers } = await mdkClient.listWorkers()
const pulls = workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
  const { metrics } = await mdkClient.pullTelemetry(deviceId, 'metrics')
  return metrics?.stats?.hashrate_mhs?.avg || 0
}))
const totalHashrateMhs = (await Promise.all(pulls)).reduce((sum, v) => sum + v, 0)
```

[`site-monitor/controllers/hashrate.js`][site-monitor-hashrate] is the shipping example this pattern is copied from.

There is no separate Gateway-side store for historical or aggregated data, either. Fan [`pullWorkerTelemetry`][client-readme-methods]
out across every registered Worker and read the series from the Worker's own persisted tail-log:

```js
const { workers } = await mdkClient.listWorkers()
const results = await Promise.allSettled(
  workers.map((w) => mdkClient.pullWorkerTelemetry(w.workerId, { type: 'logs', key: 'stat-1D', tag: 't-miner', start, end }))
)
```

The [default telemetry controllers][telemetry-controllers] and [`telemetry/lib/site-data.js`][telemetry-site-data] show a worked,
production version of this fan-out (aliasing, error tolerance per Worker, and the aggregation shapes each route returns).

Note that "live" and "historical" are both network calls through the client, so guard them the same way. Neither degrades more
gracefully than the other: both fail if the Worker is unreachable, as does `listWorkers` if the Kernel is. Map each failure to
your own error rather than assuming one path is safe to leave unhandled.

### Send a command

[`sendCommand`][client-readme-methods] dispatches via the Kernel to the Worker that owns the device — the command
must be declared in the Worker's `mdk-contract.json`. `controllers/command.js` above already shows the pattern; the
client's own reference documents the full return shape (`commandId`, `status`, `result`, `error`).

### Caching

Add a `"cache"` array of dot-path strings to a route to enable request-level caching, bypassed with
`?overwriteCache=true`. [The manifest reference][plugins-manifest] shows the field in a real manifest.

### Stream routes

Add `"stream": true` to a route to own the raw `ServerResponse` instead of returning a plain value — for SSE or any
other response Fastify shouldn't serialize. [The manifest reference][plugins-manifest] covers the mechanism and the
handler's error behavior. [`backend/plugins/agent`][agent-plugin-readme] is a shipping example — its message route
streams `text/event-stream` this way; see the [agent Gateway-deployment guide][agent-guide] for the consumer side.

### Auth and permissions

The Gateway applies no authentication of its own, as [its authentication design][gateway-concept-auth] describes. Every route a plugin declares
is served to any caller, so a route that needs protecting carries that logic in its own controller. Identity is yours to supply: the manifest
`"auth"` and `"permissions"` fields have no reader and change nothing. The [bundled `auth` plugin][auth-plugin-readme] is not a substitute — the
Gateway neither registers it nor gives its controllers what they still expect.

Validate the token with your own identity layer and check it in the handler:

```js
const { validateToken } = require('../lib/my-identity-layer')

module.exports = async function protectedRoute (req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) throw Object.assign(new Error('ERR_UNAUTHORIZED'), { statusCode: 401 })

  const { permissions } = validateToken(token)
  if (!permissions.includes('miner:w')) throw Object.assign(new Error('ERR_FORBIDDEN'), { statusCode: 403 })

  // Your route logic
}
```

> [!IMPORTANT]
> A controller's return value always goes out as `200`. A thrown error's status comes from `err.statusCode` when it is an integer 400 or
> higher, and falls back to `400` otherwise. Attach `.statusCode` to get a specific code, the way `protectedRoute` does here; the bundled
> agent plugin uses this same pattern for its 503, 404, and 409 responses.

### Manifest validation errors

The plugin loader validates every manifest and handler at startup and throws if anything is wrong — see
[the loader's error codes][plugins-readme-mounting] for the full list.

## Next steps

- Try the [live site backend example][all-workers-guide] for a complete worked plugin with three routes: a live site overview,
  a historical series, and a command endpoint running under PM2 or Docker
- Build the [minimal dashboard tutorial][minimal-dashboard] — end-to-end worked example of the single-plugin + controller pattern
- Understand [how Workers declare their data][build-a-worker] via `mdk-contract.json` — what `mdkClient` reads and `sendCommand` dispatches
- See the full [manifest and controller reference][plugins-readme]
- Review the [Gateway API and config][gateway-readme]

## Links

[telemetry-controllers]: ../../../backend/core/plugins/telemetry/controllers
<!-- docs@tether.io: telemetry-controllers → https://github.com/tetherto/mdk/tree/main/backend/core/plugins/telemetry/controllers -->

[telemetry-client]: ../../../backend/core/plugins/telemetry/lib/client.js
<!-- docs@tether.io: telemetry-client → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/telemetry/lib/client.js -->

[telemetry-site-data]: ../../../backend/core/plugins/telemetry/lib/site-data.js
<!-- docs@tether.io: telemetry-site-data → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/telemetry/lib/site-data.js -->

[site-monitor-hashrate]: ../../../backend/core/plugins/site-monitor/controllers/hashrate.js
<!-- docs@tether.io: site-monitor-hashrate → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/site-monitor/controllers/hashrate.js -->

[auth-plugin-readme]: ../../../backend/core/plugins/README.md#the-bundled-auth-plugin
<!-- docs@tether.io: auth-plugin-readme → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#the-bundled-auth-plugin -->

[gateway-concept-auth]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-concept-auth → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->

[gateway-additional-routes]: ../../../backend/core/gateway/README.md#raw-fastify-routes
<!-- docs@tether.io: gateway-additional-routes → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md#raw-fastify-routes -->

[all-workers-guide]: ../deployment/run-all-workers-site.md
<!-- docs@tether.io: all-workers-guide → guides/deployment/run-all-workers-site -->

[e2e-manifest]: ../../../examples/backend/mdk-plugin-e2e/gateway-plugin/mdk-plugin.json
<!-- docs@tether.io: e2e-manifest → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/gateway-plugin/mdk-plugin.json -->

[serve-an-endpoint]: ../../tutorials/serve-an-endpoint.md
<!-- docs@tether.io: serve-an-endpoint → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/run.js -->
<!-- mdk-monorepo: routed page parked on the docs site; restore the slug rewrite when it is unparked -->

[mvp-site-manifest]: ../../../examples/mvp-site/backend/gateway-plugins/site/mdk-plugin.json
<!-- docs@tether.io: mvp-site-manifest → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/backend/gateway-plugins/site/mdk-plugin.json -->

[telemetry-manifest]: ../../../backend/core/plugins/telemetry/mdk-plugin.json
<!-- docs@tether.io: telemetry-manifest → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/telemetry/mdk-plugin.json -->

[plugins-readme]: ../../../backend/core/plugins/README.md
<!-- docs@tether.io: plugins-readme → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md -->

[plugins-manifest]: ../../../backend/core/plugins/README.md#manifest-format
<!-- docs@tether.io: plugins-manifest → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#manifest-format -->

[plugins-readme-controllers]: ../../../backend/core/plugins/README.md#controllers
<!-- docs@tether.io: plugins-readme-controllers → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#controllers -->

[plugins-readme-mounting]: ../../../backend/core/plugins/README.md#manifest-validation-errors
<!-- docs@tether.io: plugins-readme-mounting → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#manifest-validation-errors -->

[mdk-client-readme]: ../../../backend/core/client/README.md
<!-- docs@tether.io: mdk-client-readme → https://github.com/tetherto/mdk/blob/main/backend/core/client/README.md -->

[client-readme-methods]: ../../../backend/core/client/README.md#client-methods
<!-- docs@tether.io: client-readme-methods → https://github.com/tetherto/mdk/blob/main/backend/core/client/README.md#client-methods -->

[gateway-readme]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-readme → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->

[run-gateway]: run.md
<!-- docs@tether.io: run-gateway → guides/gateway/run -->

[minimal-dashboard]: ../../tutorials/build-a-dashboard.md
<!-- docs@tether.io: minimal-dashboard → tutorials/build-a-dashboard -->
[build-a-worker]: ../workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->

[expose-data]: ../agent/expose-data.md
<!-- docs@tether.io: expose-data → guides/agent/expose-data -->

[agent-plugin-readme]: ../../../backend/plugins/agent/README.md
<!-- docs@tether.io: agent-plugin-readme → https://github.com/tetherto/mdk/blob/main/backend/plugins/agent/README.md -->

[agent-guide]: ../agent/gateway-deployment.md
<!-- docs@tether.io: agent-guide → guides/agent/gateway-deployment -->
