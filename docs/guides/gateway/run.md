---
title: Run the Gateway
description: Start the MDK Gateway programmatically, as a standalone process, or connected to a remote Kernel over HRPC
docs@tether_slug: guides/gateway/run
---

## Overview

This guide covers three ways to run the Gateway: programmatically via `startGateway()` (the standard production path), connected to
a remote Kernel over HRPC (cross-host deployments), and as a standalone process from the source tree (for contributors).

> [!NOTE]
> If Gateway, Kernel, or plugin are unfamiliar, read [terminology][terminology] first. For a deeper explanation of what the Gateway
> owns and how it connects to Kernel, read the [Gateway concept page][gateway-concept].

## Prerequisites

- Node.js >=24 (LTS)
- npm >=11
- Commands are run from the repository root
- A Kernel instance running and reachable, or `kernelKey: false` to start without a Kernel connection (development only)

<Steps>

<Step>

### Programmatic path

Most teams embed `startGateway()` in their own Node.js application rather than running the Gateway as a separate process.
This is the standard production path.

```js
const { getKernel, startGateway } = require('@tetherto/mdk/backend/core/mdk')

const kernel = await getKernel()
const server = await startGateway({ kernel, port: 3000 })
// HTTP server is up at http://localhost:3000
```

> [!WARNING]
> The Gateway ships no built-in authentication, so every route it serves is unauthenticated. Supply your own identity layer and call it from the
> controllers that need protecting, as [auth and permissions][plugins-auth] describes. The [`@tetherto/mdk-plugin-auth`][auth-plugin] plugin bundled
> with MDK is not a substitute: the Gateway neither registers it nor provides what its controllers expect.

The full configuration reference, including all `startGateway()` options, is in the [Gateway API reference][gateway-readme].

</Step>

<Step>

### Cross-host path (HRPC)

Use this path when Kernel runs on a separate host. Pass the Kernel HRPC listener public key to `startGateway()` instead of a Kernel instance.
(On a single host, neither is needed: `startGateway()` reads the key from the well-known key file that `getKernel()` publishes —
see the [key resolution order][gateway-readme].)

#### 2.1 Obtain the Kernel listener key

On the host running Kernel, start Kernel and print its public key:

```js
const { getKernel } = require('@tetherto/mdk/backend/core/mdk')

const kernel = await getKernel()
console.log('Kernel listener key:', kernel.getPublicKey().toString('hex'))
```

Share that hex string with the Gateway host.

#### 2.2 Start the Gateway with `kernelKey`

```js
const { startGateway } = require('@tetherto/mdk/backend/core/mdk')

const server = await startGateway({
  kernelKey: '<kernel-listener-pubkey-hex>',
  port: 3000
})
```

> [!NOTE]
> Pre v1.0, Kernel's allowlist `auth.whitelist` defaults to empty and admits any HRPC caller. For production deployments, add the Gateway's
> DHT public key to Kernel's allowlist — see the [Gateway concept page][gateway-concept] and [`opts.kernelKey` reference][mdk-readme].

</Step>

<Step>

### Standalone path

To run the Gateway directly from the source tree without embedding it:

```bash
cd backend/core/gateway
npm install
npm run dev
```

For production mode:

```bash
npm start
```

> [!NOTE]
> The standalone path is intended for contributors working on the Gateway itself. For application development, embed `startGateway()`
> in your own project rather than running it standalone.

</Step>

</Steps>

## Next steps

- [Add routes with the plugin system][plugins-how-to]
- [Review all configuration options][gateway-readme]
- Understand the [extension model, auth design, and Kernel connection][gateway-concept]
- Choose a [deployment shape][deployment-topologies]

## Links

[terminology]: ../../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[gateway-concept]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-concept → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->

[gateway-readme]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-readme → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->

[plugins-how-to]: plugins.md
<!-- docs@tether.io: plugins-how-to → guides/gateway/plugins -->

[auth-plugin]: ../../../backend/core/plugins/README.md#the-bundled-auth-plugin
<!-- docs@tether.io: auth-plugin → https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#the-bundled-auth-plugin -->

[plugins-auth]: plugins.md#auth-and-permissions
<!-- docs@tether.io: plugins-auth → guides/gateway/plugins#auth-and-permissions -->

[deployment-topologies]: ../deployment/index.md
<!-- docs@tether.io: deployment-topologies → guides/deployment -->

[mdk-readme]: ../../../backend/core/mdk/README.md
<!-- docs@tether.io: mdk-readme → https://github.com/tetherto/mdk/blob/main/backend/core/mdk/README.md -->
