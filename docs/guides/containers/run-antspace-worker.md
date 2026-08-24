---
title: Run an Antspace Worker
description: Start an MDK Worker for a Bitmain Antspace container (HK3, immersion) against a mock or a real container
docs@tether_slug: guides/containers/run-antspace-worker
---

## Overview

This page details how to run the Bitmain Antspace container Worker. Select the development (mock) or real-container path.

## Prerequisites

- Review the [common deployment prerequisites][container-guide-assumptions] before you start

Deployment-specific requirements:

- A Node.js service or script in your deployment that runs the MDK Worker and registers containers
- A supported Antspace container reachable from the machine or container running the Worker over its REST HTTP API, typically port `8000`

<Steps>

<Step>

### Development

<details>
<summary>Run against a mock</summary>

To support development, this repo ships a runnable example that starts the bundled mock, boots the Worker against it, starts a Kernel, and registers the container:

```bash
node examples/backend/containers/antspace/index.js
```

It prints the Kernel HRPC key and the registered device ID, then stays running until Ctrl+C. For the mock's model and port options, see [the Antspace README][antspace-readme].

</details>

</Step>

<Step>

### Connect a container

#### 2.1 Pick your model

Use [the Antspace README][antspace-readme] to confirm the `model` value for your container: `hk3` or `immersion`. This guide uses `hk3`, replace it with the value for your container.

#### 2.2 Register your container

Add this code to the Node.js service or script that runs the MDK Worker in your deployment. The snippet shows the minimum boot call seeding one Antspace container, replace the example address and credentials with your container's values:

```js
const { getKernel } = require('@tetherto/mdk/backend/core/mdk')
const { startAntspaceWorker } = require('@tetherto/mdk-worker-antspace')

const kernel = await getKernel()

const worker = await startAntspaceWorker({
  workerId: 'antspace-rack-1',
  model: 'hk3',
  storeDir: './store/antspace-rack-1',
  seedDevices: [{
    info: { serialNum: 'HK3-A', container: 'container-A', location: 'site-a-01.container' },
    opts: { address: '192.168.1.100', port: 18001 }
  }]
})
await kernel.registerWorker(worker.runtime.getPublicKey())
```

> [!WARNING]
> Make sure each container's address is reachable from the machine or container running the Worker before registering. Commands affect live cooling for racks of miners, prioritize thermal safety.

`seedDevices` only seeds a fresh, empty `storeDir`, once persisted, the device set survives restarts on its own. To add a container to an already-running fleet, send the `registerThing` command to the live Worker instead:

```js
const { createMdkClient } = require('@tetherto/mdk/backend/core/client')

const client = createMdkClient({ kernelKey: kernel.getPublicKey() })
await client.connect()
await client.sendWorkerCommand('antspace-rack-1', null, 'registerThing', {
  id: 'HK3-B',
  info: { serialNum: 'HK3-B', container: 'container-A' },
  opts: { address: '192.168.1.101', port: 18001 }
})
```

> [!IMPORTANT]
> `registerThing` persists the container config immediately, but the running Worker does not pick it up until it is stopped and restarted (`await worker.stop()`, then call `startAntspaceWorker` again with the same `storeDir` and no `seedDevices`), there is no hot-add.

For the full `seedDevices` and `registerThing` option reference, the telemetry and command tables, and the shared install pattern, see [the Antspace README][antspace-readme] and [install pattern][install-pattern].

</Step>

</Steps>

## Troubleshooting

The development example on this page is [`examples/backend/containers/antspace/index.js`](../../../examples/backend/containers/antspace/index.js). A working run prints the Kernel HRPC key and the registered device ID, then stays running until Ctrl+C.

If it does not print those values, or if the mock port is already in use, the network and port checks in [miner troubleshooting][miner-troubleshooting] apply here too, the underlying HRPC and DHT requirements are the same across every Worker.

## Next steps

- Decide how to run the Worker service, [Deployment topologies][deployment-topologies]
- Review telemetry units, command shapes, and error codes, [the Antspace README][antspace-readme]

## Links

[terminology]: ../../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[container-guide-assumptions]: index.md#prerequisites
<!-- docs@tether.io: container-guide-assumptions → guides/containers#prerequisites -->

[antspace-readme]: ../../../backend/workers/containers/antspace/README.md
<!-- docs@tether.io: antspace-readme → https://github.com/tetherto/mdk/blob/main/backend/workers/containers/antspace/README.md -->

[install-pattern]: ../../../backend/workers/docs/install-pattern.md
<!-- docs@tether.io: install-pattern → https://github.com/tetherto/mdk/blob/main/backend/workers/docs/install-pattern.md -->

[deployment-topologies]: ../deployment/index.md
<!-- docs@tether.io: deployment-topologies → guides/deployment -->

[miner-troubleshooting]: ../miners/troubleshooting.md
<!-- docs@tether.io: miner-troubleshooting → guides/miners/troubleshooting -->
