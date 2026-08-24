---
title: Run a Bitdeer Worker
description: Start an MDK Worker for a Bitdeer D40 immersion container (A1346, M30, M56, S19XP) against a mock or a real container
docs@tether_slug: guides/containers/run-bitdeer-worker
---

## Overview

This page details how to run the Bitdeer D40 container Worker. Select the development (mock) or real-container path.

The Bitdeer D40 speaks MQTT, and the Worker embeds the broker (one per Worker process) that a container publishes into, rather than the Worker connecting out to the container. Device specs are keyed by `containerId`, not by an address and port.

## Prerequisites

- Review the [common deployment prerequisites][container-guide-assumptions] before you start

Deployment-specific requirements:

- A Node.js service or script in your deployment that runs the MDK Worker and registers containers
- A supported D40 container configured to publish into the Worker's embedded MQTT broker, reachable on that broker's port (default `10883`)

<Steps>

<Step>

### Development

<details>
<summary>Run against a mock</summary>

To support development, this repo ships a runnable example that starts the Worker (embedding its MQTT broker), points a mock D40 container at that broker as an MQTT client, starts a Kernel, and registers the container:

```bash
node examples/backend/containers/bitdeer/index.js
```

It prints the Kernel HRPC key and the registered device ID, then stays running until Ctrl+C. For the mock's model and container ID options, see [the Bitdeer README][bitdeer-readme].

</details>

</Step>

<Step>

### Connect a container

#### 2.1 Pick your model

Use [the Bitdeer README][bitdeer-readme] to confirm the `model` value for your D40 variant: `a1346`, `m30`, `m56`, or `s19xp`. This guide uses `m56`, replace it with the value for your container.

#### 2.2 Register your container

Add this code to the Node.js service or script that runs the MDK Worker in your deployment. The snippet shows the minimum boot call seeding one D40 container, replace the example container ID with your container's value:

```js
const { getKernel } = require('@tetherto/mdk/backend/core/mdk')
const { startBitdeerWorker } = require('@tetherto/mdk-worker-bitdeer')

const kernel = await getKernel()

const worker = await startBitdeerWorker({
  workerId: 'bitdeer-rack-1',
  model: 'm56',
  storeDir: './store/bitdeer-rack-1',
  mqttPort: 10883,
  seedDevices: [{
    info: { serialNum: 'D40-M56-001', container: 'container-A' },
    opts: { containerId: 'D40-M56-001' }
  }]
})
await kernel.registerWorker(worker.runtime.getPublicKey())
```

> [!WARNING]
> Make sure the container is configured to publish into this Worker's broker port before registering. Commands act on 
> physical cooling and power hardware, prioritize thermal safety.

`seedDevices` only seeds a fresh, empty `storeDir`, once persisted, the device set survives restarts on its own. 
To add a container to an already-running fleet, send the `registerThing` command to the live Worker instead:

```js
const { createMdkClient } = require('@tetherto/mdk/backend/core/client')

const client = createMdkClient({ kernelKey: kernel.getPublicKey() })
await client.connect()
await client.sendWorkerCommand('bitdeer-rack-1', null, 'registerThing', {
  id: 'D40-M56-002',
  info: { serialNum: 'D40-M56-002', container: 'container-A' },
  opts: { containerId: 'D40-M56-002' }
})
```

> [!IMPORTANT]
> `registerThing` persists the container config immediately, but the running Worker does not pick it up until it is stopped 
> and restarted (`await worker.stop()`, then call `startBitdeerWorker` again with the same `storeDir` and no `seedDevices`), 
> there is no hot-add.

For the full `seedDevices` and `registerThing` option reference, the telemetry and command tables, and the shared install pattern, see [the Bitdeer README][bitdeer-readme] and [install pattern][install-pattern].

</Step>

</Steps>

## Troubleshooting

The development example on this page is [`examples/backend/containers/bitdeer/index.js`](../../../examples/backend/containers/bitdeer/index.js). A working run prints the Kernel HRPC key and the registered device ID, then stays running until Ctrl+C.

If it does not print those values, or if the broker port is already in use, the network and port checks in [miner troubleshooting][miner-troubleshooting] apply here too, the underlying HRPC and DHT requirements are the same across every Worker.

## Next steps

- Decide  your [deployment topology][deployment-topologies] to run the Worker service
- [Review telemetry units, command shapes, and error codes][bitdeer-readme]

## Links

[terminology]: ../../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[container-guide-assumptions]: index.md#prerequisites
<!-- docs@tether.io: container-guide-assumptions → guides/containers#prerequisites -->

[bitdeer-readme]: ../../../backend/workers/containers/bitdeer/README.md
<!-- docs@tether.io: bitdeer-readme → https://github.com/tetherto/mdk/blob/main/backend/workers/containers/bitdeer/README.md -->

[install-pattern]: ../../../backend/workers/docs/install-pattern.md
<!-- docs@tether.io: install-pattern → https://github.com/tetherto/mdk/blob/main/backend/workers/docs/install-pattern.md -->

[deployment-topologies]: ../deployment/index.md
<!-- docs@tether.io: deployment-topologies → guides/deployment -->

[miner-troubleshooting]: ../miners/troubleshooting.md
<!-- docs@tether.io: miner-troubleshooting → guides/miners/troubleshooting -->
