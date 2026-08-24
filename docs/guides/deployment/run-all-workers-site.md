---
title: Run a multi-Worker site as supervised services
description: Boot multiple backend Workers under PM2, each connected to mock hardware, for a complete end-to-end site with supervisor-managed restarts
docs@tether_slug: guides/deployment/run-all-workers-site
notes: in mdk detailed operational changes are kept in package docs to prevent drift from the runnable source
---

This page directs you to the correct location for the prerequisites, run command, smoke test, and troubleshooting.

## Overview

Use this example when you want to run a demo for multiple configured Workers across device families - a miner, a mining pool, and a
powermeter - each supervised as its own separate process. Each talks to mock hardware that speaks the real wire protocol. The site
Gateway plugin surfaces all device data through a single `/site` HTTP API.

This example runs the [local topology][deployment-topologies] under PM2 supervision. Use this when:

- You want to explore a multi-Worker site and its telemetry in one running system
- You need supervisor-managed restarts and logs, and want to restart or scale one service without restarting the others
- You are testing PM2 orchestration before deploying to hardware, or want a production-like layout for Gateway and Workers
- You want real driver code running its full connect, collect, and command paths (only the endpoints are localhost mocks instead of hardware)
- You want the site Gateway plugin as a starting point for your own `/site` API

> [!NOTE]
> You have a choice of [deployment topologies][deployment-topologies] from single-process to distributed microservices.

> [!NOTE]
> This example's [`config/site.deploy.json`][site-backend-config] sets `discovery` to `"local"` by default (Kernel and Workers share
> one machine, discovery via shared directory). Setting it to `"dht"` moves discovery onto Hyperswarm so Workers can run on separate
> hosts, but the example's own README doesn't walk through that mode end-to-end. For a worked cross-host walkthrough today, see
> [`examples/full-site`'s `cli.js --discovery dht`][full-site-dht].

## Run the example

Follow the [Starter site example][site-backend-example]:

- Start with the [prerequisites][site-backend-prerequisites]
- Use [PM2][site-backend-pm2] for local process supervision on one host
- [Verify][site-backend-verify] the fleet is up

## Next steps

- Understand the trade-offs between [deployment topologies][deployment-topologies]
- Run [a single-process site][single-process] for the simpler single-process topology
- [Register a single miner][miner-how-to] before building a site config
- Extend the Gateway HTTP API with [custom plugins][plugins]
- Browse the [functions][mdk-functions] that wire together the [Kernel][kernel-concept], [device Workers][workers-concept], and the [Gateway][gateway-concept] HTTP
- Build your own [Worker from scratch][build-a-worker]

## Links

[deployment-topologies]: index.md
<!-- docs@tether.io: deployment-topologies → guides/deployment -->

[single-process]: run-single-process-site.md
<!-- docs@tether.io: single-process → guides/deployment/run-single-process-site -->

[miner-how-to]: ../miners/index.md
<!-- docs@tether.io: miner-how-to → guides/miners -->

[plugins]: ../gateway/plugins.md
<!-- docs@tether.io: plugins → guides/gateway/plugins -->

[site-backend-example]: ../../../examples/mvp-site/README.md
<!-- docs@tether.io: site-backend-example → https://github.com/tetherto/mdk/tree/main/examples/mvp-site -->

[site-backend-prerequisites]: ../../../examples/mvp-site/README.md#prerequisites
<!-- docs@tether.io: site-backend-prerequisites → https://github.com/tetherto/mdk/tree/main/examples/mvp-site#prerequisites -->

[site-backend-pm2]: ../../../examples/mvp-site/README.md#start-the-site
<!-- docs@tether.io: site-backend-pm2 → https://github.com/tetherto/mdk/tree/main/examples/mvp-site#start-the-site -->

[site-backend-verify]: ../../../examples/mvp-site/README.md#start-the-site
<!-- docs@tether.io: site-backend-verify → https://github.com/tetherto/mdk/tree/main/examples/mvp-site#start-the-site -->

[site-backend-config]: ../../../examples/mvp-site/config/site.deploy.json.example
<!-- docs@tether.io: site-backend-config → https://github.com/tetherto/mdk/blob/main/examples/mvp-site/config/site.deploy.json.example -->

[full-site-dht]: ../../../examples/full-site/README.md#how-out-of-process-workers-find-the-kernel
<!-- docs@tether.io: full-site-dht → https://github.com/tetherto/mdk/blob/main/examples/full-site/README.md#how-out-of-process-workers-find-the-kernel -->

[mdk-functions]: ../../../backend/core/mdk/README.md
<!-- docs@tether.io: mdk-functions → https://github.com/tetherto/mdk/blob/main/backend/core/mdk/README.md -->

[kernel-concept]: ../../../backend/core/kernel/README.md
<!-- docs@tether.io: kernel-concept → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/README.md -->

[workers-concept]: ../../../backend/workers/README.md
<!-- docs@tether.io: workers-concept → https://github.com/tetherto/mdk/blob/main/backend/workers/README.md -->

[gateway-concept]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-concept → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->

[build-a-worker]: ../workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->
