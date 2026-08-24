---
title: See a plugin serve your data
description: "[⏱️ <2 min] Run one command and watch a Gateway plugin answer an HTTP request with live telemetry aggregated across two devices"
---

> [!NOTE]
> If Kernel, Gateway, Worker, or plugin are unfamiliar, read [terminology][terminology] first.

## Overview

From 0.6.0 the Gateway serves no data routes of its own. It is a plugin host, so every endpoint your application reads comes from a
plugin you mount. This tutorial runs the [plugin-authoring example][plugin-e2e] so you can watch that happen once before writing
your own.

What you'll have at the end:

- Two mock miners on `127.0.0.1:15101` and `:15102`, reporting different hashrate and power figures
- One `WorkerRuntime` hosting both devices behind a single RPC channel to the Kernel
- A Gateway on `:3210` with one mounted plugin serving `GET /api/fleet/summary`
- The JSON body of that request printed to your terminal, with the two devices aggregated into fleet totals

The example verifies its own arithmetic and exits, so there is nothing to clean up and nothing left running.

## Prerequisites

- Node.js >=24 (LTS)
- npm >=11

<Steps>

<Step>

### Clone and install

```bash
git clone git@github.com:tetherto/mdk.git
cd mdk
npm install
```

</Step>

<Step>

### Run the example

```bash
node examples/backend/mdk-plugin-e2e/run.js
```

The whole run takes a few seconds. The interesting part is the last block:

```text
GET /api/fleet/summary → {
  "deviceCount": 2,
  "totalHashrateThs": 240,
  "totalPowerW": 6200,
  "devices": [
    { "deviceId": "SIM-001", "hashrateThs": 100, "powerW": 3000 },
    { "deviceId": "SIM-002", "hashrateThs": 140, "powerW": 3200 }
  ]
}

E2E OK — aggregate combines 2 devices: 240 TH/s = 100 + 140, 6200 W = 3000 + 3200
```

That JSON is the point. It came from a route the Gateway did not have until the example mounted a plugin that declared it.

</Step>

<Step>

### Read the two files that produced it

The plugin is a directory with a manifest and a controller, and nothing else.

[`gateway-plugin/mdk-plugin.json`][plugin-manifest] declares the route: an `id`, the `handler` path, and an `http` block giving the
method and path. It also carries the response schema, `constraints`, `errors`, and `safety: "read-only"`, which is what makes the
route self-describing to both a reader and an agent.

[`gateway-plugin/controllers/fleet-summary.js`][plugin-controller] is the handler. Every controller is
`async function (req)` and returns a plain object, which the Gateway serialises. It never touches a response object:

```js
const mdkClient = require('../lib/client')

module.exports = async function fleetSummary (req) {
  const workersResp = await mdkClient.listWorkers()
  const deviceIds = (workersResp?.workers || []).flatMap(w => w.deviceIds || [])
  // fan out one telemetry pull per device, then combine
}
```

`mdkClient` — built once for the plugin in [`gateway-plugin/lib/client.js`][plugin-client] from
`require('@tetherto/mdk-gateway/plugin')` — is the same protocol client used everywhere else in MDK. **Aggregation lives here, in the
plugin.** Workers are structurally single-device, so a Worker can only ever answer for one device; combining them into a fleet total
is the plugin's job.

</Step>

<Step>

### See how it gets mounted

One option on `startGateway()` does it, in [`run.js`][plugin-run]:

```js
await startGateway({
  kernel,
  port: 3210,
  root: path.join(ROOT, 'gateway'),
  extraPluginDirs: [path.join(__dirname, 'gateway-plugin')]
})
```

`extraPluginDirs` is the whole mounting story. Point it at a directory holding an `mdk-plugin.json` and its routes are served.

> [!WARNING]
> The route you just called accepted the request without a token, and every plugin route behaves the same way: the Gateway applies no
> authentication of its own. Protection is something a controller does for itself, covered in
> [auth and permissions](../guides/gateway/plugins.md#auth-and-permissions).

</Step>

</Steps>

## What just happened

1. **Mock devices** started two `SimMinerMock` servers on ports `15101` and `15102`, each reporting its own hashrate and power so the totals are provably a sum rather than a single reading doubled.
2. **Worker runtime** constructed one `WorkerRuntime` from the example's worker plugin, hosting both devices over a single RPC channel to the Kernel. One runtime means one plugin type and N devices, not one process per device.
3. **Kernel** started and discovered the runtime, reporting `sim-rack-1 [READY] devices=SIM-001,SIM-002`.
4. **Gateway** started with `extraPluginDirs` pointing at the plugin directory, read its [`mdk-plugin.json`][plugin-manifest], and registered `GET /api/fleet/summary`. Without that option the Gateway would have served only the three built-in plugin routes ([`telemetry`][plugin-telemetry], [`site-hashrate`][plugin-site-hashrate], [`site-monitor`][plugin-site-monitor]), not your custom data route.
5. **The request** hit the controller, which called `listWorkers()` to enumerate device IDs, pulled `metrics` telemetry for each one, and summed `hashrate_rt` and `power` into fleet totals.
6. **The assertion** compared those totals against the mock configuration, printed `E2E OK`, shut the Kernel down, and exited zero.

## Cleanup

None. The example removes its own state directory on start and exits when the check passes.

## Next steps

- Write your own plugin by [building a Gateway plugin][plugins]: the manifest fields, the `services` bag, reading hardware, and sending commands
- Put a page in front of your route by [building a minimal single-page dashboard][build-a-dashboard]: the same shape with a React front end
- Integrate your own hardware by [building a third-party Worker][build-a-worker]
- See the whole stack instead of one route by [running a mining site end to end][run-a-site]

## Links

[terminology]: ../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[plugin-e2e]: ../../examples/backend/mdk-plugin-e2e/run.js
<!-- docs@tether.io: plugin-e2e → https://github.com/tetherto/mdk/tree/main/examples/backend/mdk-plugin-e2e -->

[plugin-manifest]: ../../examples/backend/mdk-plugin-e2e/gateway-plugin/mdk-plugin.json
<!-- docs@tether.io: plugin-manifest → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/gateway-plugin/mdk-plugin.json -->

[plugin-controller]: ../../examples/backend/mdk-plugin-e2e/gateway-plugin/controllers/fleet-summary.js
<!-- docs@tether.io: plugin-controller → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/gateway-plugin/controllers/fleet-summary.js -->

[plugin-client]: ../../examples/backend/mdk-plugin-e2e/gateway-plugin/lib/client.js
<!-- docs@tether.io: plugin-client → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/gateway-plugin/lib/client.js -->

[plugin-run]: ../../examples/backend/mdk-plugin-e2e/run.js
<!-- docs@tether.io: plugin-run → https://github.com/tetherto/mdk/blob/main/examples/backend/mdk-plugin-e2e/run.js -->

[plugins]: ../guides/gateway/plugins.md
<!-- docs@tether.io: plugins → guides/gateway/plugins -->

[build-a-dashboard]: build-a-dashboard.md
<!-- docs@tether.io: build-a-dashboard → tutorials/build-a-dashboard -->

[build-a-worker]: ../guides/workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->

[run-a-site]: run-a-site.md
<!-- docs@tether.io: run-a-site → tutorials/run-a-site -->

[plugin-telemetry]: ../../backend/core/plugins/telemetry
<!-- docs@tether.io: plugin-telemetry → https://github.com/tetherto/mdk/tree/main/backend/core/plugins/telemetry -->

[plugin-site-hashrate]: ../../backend/core/plugins/site-hashrate
<!-- docs@tether.io: plugin-site-hashrate → https://github.com/tetherto/mdk/tree/main/backend/core/plugins/site-hashrate -->

[plugin-site-monitor]: ../../backend/core/plugins/site-monitor
<!-- docs@tether.io: plugin-site-monitor → https://github.com/tetherto/mdk/tree/main/backend/core/plugins/site-monitor -->
