---
todo: "see docs/reference/maintainers/ia.md — check:plugin-reference-fresh and check:plugin-manifest"
---

# @tetherto/mdk-plugins

Default [Gateway](../gateway/README.md) plugins and the declarative plugin format for extending the MDK Gateway with 
custom HTTP routes.

## Overview

A plugin is a directory containing:

- `mdk-plugin.json`: manifest declaring route identity, HTTP surface, and caching
- One or more controller files — each exports `async function (req)`

The Gateway registers `telemetry`, `site-hashrate`, and `site-monitor` automatically, and accepts additional plugin directories via 
`startGateway({ extraPluginDirs: [...] })`. The `auth` plugin ships here but is [neither registered nor wired](#the-bundled-auth-plugin).

> [!TIP]
> New to the plugin system? Read the [Gateway plugins how-to guide](../../../docs/guides/gateway/plugins.md) for a step-by-step walkthrough.
> For the broader toolkit context, see the [MDK App Toolkit concept page](../../../docs/concepts/app-toolkit.md).

## Manifest format

Read a real manifest rather than a field table — every supported field is exercised across the shipping manifests, and they are validated at startup 
so they cannot drift:

- [telemetry manifest](telemetry/mdk-plugin.json): `cache`, query `parameters`, `responses`, `constraints`, `errors`, and
named-export handlers (`./controllers/power-mode.js#timeline`)
- [site-plugin manifest](../../../examples/full-site/plugins/site/mdk-plugin.json): a `POST` with a `requestBody`, path
`parameters`, and `safety`

What is required and what is rejected is defined by `_validateManifest` in [`plugin-loader.js`](../gateway/workers/lib/plugin-loader.js): `name`, 
`version`, and a non-empty `routes` array, plus per route an `id`, a `handler`, an allowed `http.method` (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`), an 
`http.path`, and unique route ids. Path parameters in `{param}` form are normalized to Fastify's `:param`.

Beyond the validated fields, three are read:

- `cache` is enforced: an array of dot-paths composed into the cache key by [`plugin-adapter.js`](../gateway/workers/lib/plugin-adapter.js):

  ```json
  {
    "id": "telemetry.hashrate",
    "cache": ["query.start", "query.end", "query.groupBy"],
    ...
  }
  ```

  Pass `?overwriteCache=true` to bypass and refresh. See [the guide's Caching step](../../../docs/guides/gateway/plugins.md#caching)
  for the how-to
- `description` is read by [`generate-plugin-reference.js`](../../../docs/scripts/generate-plugin-reference.js) to build the route tables
- `stream` marks a route that owns the raw `ServerResponse` instead of returning a plain value: [`plugin-adapter.js`](../gateway/workers/lib/plugin-adapter.js)
hijacks the reply so Fastify never serializes it, and calls the handler as `(req, raw)`. A throw before any header is written maps to a JSON error
carrying `err.statusCode` (or `400` by default); a throw after headers are sent just ends the socket instead of leaving it open.
[`backend/plugins/agent`](../../plugins/agent/README.md) is the shipping example — its message route streams `text/event-stream` this way.
See [the guide's Stream routes step](../../../docs/guides/gateway/plugins.md#stream-routes) for the how-to

The following have no reader:

- `constraints`, `errors`, and `safety` record intent for humans and agents reading the manifest
- [`auth` and `permissions`](../../../docs/guides/gateway/plugins.md#auth-and-permissions) may be used to document what a route expects, 
and pair each declaration with the matching check in the controller that serves it

## Controllers

A controller exports `async function (req)` and returns a value that is serialized as a `200` JSON response. Use `"handler": 
"./file.js#namedExport"` for a non-default export. Any shipping controller shows the shape — for example,
[`hashrate.js`](telemetry/controllers/hashrate.js).

`req`, assembled in [`plugin-adapter.js`](../gateway/workers/lib/plugin-adapter.js):

| Field | Type | Contains |
| --- | --- | --- |
| `req.params` | `object` | Path parameters (e.g. `{ deviceId: 'wm-001' }`) |
| `req.query` | `object` | Query string parameters |
| `req.body` | `object` | Parsed JSON request body |
| `req.headers` | `object` | HTTP headers |
| `req._info` | `object` | Internal request metadata (rarely needed) |

- A controller builds its own [`@tetherto/mdk-client`](../client/README.md) from the plugin's context
config (`require('@tetherto/mdk-gateway/plugin')`), same as [`telemetry/lib/client.js`](telemetry/lib/client.js) does, and requires that
module once per plugin rather than per controller

> [!TIP]
> The [plugin authoring guide](../../../docs/guides/gateway/plugins.md) walks through building a controller and the plugin's context module.

## Default plugins

These plugins ship with MDK: `telemetry`, `site-hashrate`, and `site-monitor`. They are registered on Gateway startup by 
[`http.node.wrk.js`](../gateway/workers/http.node.wrk.js); `auth` is not, and mounting it needs work first 
([the bundled auth plugin](#the-bundled-auth-plugin)).

> [!Note]
> Every route below is served without authentication: the Gateway applies no token check of its own; [protecting a route is
> controller responsibility](../../../docs/guides/gateway/plugins.md#auth-and-permissions).

The tables are generated from every `mdk-plugin.json` in this directory by 
[`docs/scripts/generate-plugin-reference.js`](../../../docs/scripts/generate-plugin-reference.js), so they cover the shipped plugins only. Routes you 
add through `extraPluginDirs` are owned by their own manifests and are not listed here.

<!-- BEGIN GENERATED: default-plugins. DO NOT EDIT. Regenerate with `npm run generate:plugin-reference`. Source: backend/core/plugins/*/mdk-plugin.json -->

### `auth`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/userinfo` | Returns the authenticated user's profile from the validated JWT |
| `POST` | `/auth/token` | Issues a new JWT from an existing valid token, optionally scoping TTL and roles |
| `GET` | `/auth/permissions` | Returns the permission set encoded in the current token |
| `GET` | `/auth/ext-data` | Proxies an external data request to the Kernel network by type and optional query filter |

### `site-hashrate`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/site/hashrate-history` | Fans out telemetry.pull to every registered worker and returns site-level hashrate history aggregated by timestamp. Defaults to last 7 days when start/end are omitted |

### `site-monitor`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/site` | Returns the site name from the gateway config (common.json `site`) |
| `GET` | `/auth/featureConfig` | Returns the featureConfig object from the gateway config (common.json `featureConfig`) |
| `GET` | `/site-monitor/hashrate` | Pulls metrics telemetry from every READY worker's devices via the MDK protocol and returns per-device hashrate/power plus site totals |

### `telemetry`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/metrics/hashrate` | Returns daily hashrate history and summary for the site. Optionally groups by miner type or container |
| `GET` | `/auth/metrics/consumption` | Returns daily power consumption (W and MWh) history and summary for the site |
| `GET` | `/auth/metrics/efficiency` | Returns daily mining efficiency (W/TH) history and summary for the site |
| `GET` | `/auth/metrics/miner-status` | Returns daily online/offline/sleep/maintenance miner counts and averages |
| `GET` | `/auth/metrics/power-mode` | Returns miner count by power mode category (low/normal/high/sleep/offline) over time |
| `GET` | `/auth/metrics/power-mode/timeline` | Returns per-miner power mode segments over a time range, optionally filtered by container |
| `GET` | `/auth/metrics/temperature` | Returns max and average temperature per container over time, with site-level aggregates |
| `GET` | `/auth/metrics/containers/{id}` | Returns latest telemetry snapshot and miner list for a specific container |
| `GET` | `/auth/metrics/containers/{id}/history` | Returns historical telemetry log for a specific container |

<!-- END GENERATED: default-plugins -->

### The bundled auth plugin

`auth` ships in this package for reference. Adding its directory to `extraPluginDirs` mounts the routes but does not give you working endpoints:

- [`auth/controllers/permissions.js`](auth/controllers/permissions.js), [`auth/controllers/token.js`](auth/controllers/token.js), and
[`auth/controllers/ext-data.js`](auth/controllers/ext-data.js) all still declare a second `services` handler parameter and call `ctx.authLib` or
`ctx.dataProxy` on it, but [`plugin-adapter.js`](../gateway/workers/lib/plugin-adapter.js) invokes every handler with `req` alone, so
`services` arrives `undefined` — all three throw a `TypeError` on that, which the worker's `onError` hook returns as HTTP 400
- [`auth/controllers/userinfo.js`](auth/controllers/userinfo.js) returns `req._info.user`. Nothing populates `_info`, which 
[`plugin-adapter.js`](../gateway/workers/lib/plugin-adapter.js) defaults to `{}`, so the route answers with an empty body

Authentication is [yours to supply](../../../docs/guides/gateway/plugins.md#auth-and-permissions): bring an identity layer and implement the checks 
your routes need inside their controllers.

## Mounting plugins

```js
const { startGateway } = require('@tetherto/mdk')

await startGateway({
  kernel,
  extraPluginDirs: [
    path.join(__dirname, 'plugins/my-metrics')
  ]
})
```

### Manifest validation errors

The loader validates every manifest and handler at startup and throws on the first problem:

| Error | Cause |
| --- | --- |
| `ERR_PLUGIN_MANIFEST_MISSING` | No `mdk-plugin.json` found in the plugin directory |
| `ERR_PLUGIN_MANIFEST_INVALID` | JSON parse error, or missing required field (`name`, `version`, or `routes`) |
| `ERR_PLUGIN_ROUTE_DUPLICATE_ID` | Two routes in the same manifest share the same `id` |
| `ERR_PLUGIN_HANDLER_NOT_FOUND` | The `handler` file path does not exist or failed to load |
| `ERR_PLUGIN_HANDLER_NOT_FUNCTION` | The handler file exports something other than a function |

The codes and the checks behind them live in [`plugin-loader.js`](../gateway/workers/lib/plugin-loader.js).

## Directory layout

```
plugins/
├── auth/
│   ├── mdk-plugin.json
│   └── controllers/
│       ├── userinfo.js
│       ├── token.js
│       ├── permissions.js
│       └── ext-data.js
├── telemetry/
│   ├── mdk-plugin.json
│   ├── controllers/
│   │   ├── hashrate.js
│   │   ├── consumption.js
│   │   ├── efficiency.js
│   │   ├── miner-status.js
│   │   ├── power-mode.js
│   │   ├── temperature.js
│   │   └── containers.js
│   └── lib/
│       ├── client.js         # mdk client built from this plugin's ambient context
│       └── site-data.js      # worker-owned telemetry history over the mdk client
├── site-hashrate/
│   ├── mdk-plugin.json
│   ├── controllers/
│   │   └── hashrate-history.js
│   └── lib/
│       └── client.js         # mdk client built from this plugin's ambient context
├── site-monitor/
│   ├── mdk-plugin.json
│   ├── controllers/
│   │   ├── site.js
│   │   ├── feature-config.js
│   │   └── hashrate.js
│   └── lib/
│       └── client.js         # mdk client built from this plugin's ambient context
├── lib/
│   ├── constants.js
│   ├── metrics.utils.js
│   ├── period.utils.js
│   └── utils.js
└── package.json
```

## Regenerating the default-plugin tables

The default-plugin route tables under [Default plugins](#default-plugins) are generated from the manifests. Regenerate and commit them 
whenever a default plugin's routes change:

```bash
cd backend/core/plugins
npm run generate:plugin-reference
```

## Next steps

- [Build your first plugin](../../../docs/guides/gateway/plugins.md)
- See a working [`extraPluginDirs` setup](../../../examples/full-site/README.md)
- Review the [Gateway's extension model, data access, and security model](../gateway/README.md#extend-the-gateway)
- [Understand where plugins fit as an extension point](../../../docs/concepts/the-integration-model.md)
- See all [`startGateway()` options](../mdk/README.md)
