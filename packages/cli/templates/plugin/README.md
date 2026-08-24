# __PLUGIN_NAME__

An MDK **Gateway Plugin** — HTTP endpoints served by the Gateway that aggregate
data from your workers' devices over the MDK protocol. A plugin is a manifest
([`mdk-plugin.json`](./mdk-plugin.json)) plus one controller module per route; the Gateway loads the
directory and mounts each route. There is no boot hook or root export.

## Layout

```
mdk-plugin.json      # route manifest: id, handler, http.method + http.path
controllers/*.js     # one module per route: async (req, services) => result
```

Each controller receives `(req, services)`:

- `req` — `{ params, query, body, headers }`
- `services.mdkClient` — the MDK client to the Kernel (null until connected)

The return value is sent as JSON (HTTP 200). Throw `Error('ERR_...')` to return a 400.

## Run it

This plugin is registered in your stack's `mdk.yaml` by **package name** and
resolved from `node_modules` (the `plugins/*` workspace links it):

```yaml
spec:
  gateway:
    plugins:
      - package: __PLUGIN_NAME__
        config: {}
```

Then boot the Gateway:

```bash
mdk run gateway     # just the gateway
# or `mdk run` to boot the whole stack together
```

Call it: `GET http://localhost:<gatewayPort>/api/__PLUGIN_NAME__/summary`.
