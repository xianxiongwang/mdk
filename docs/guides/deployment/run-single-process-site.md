---
title: Run a single-process site
description: Start Kernel, Gateway, and multiple miner Workers inside one Node.js process for local development or small deployments
docs@tether_slug: guides/deployment/run-single-process-site
notes: in mdk detailed operational changes are kept in package docs to prevent drift from the runnable source
---

This thin page directs you to the correct location for the prerequisites, config fields, run command, smoke test, and troubleshooting.

## Overview

Use the **single-process** site example when you want Kernel, the Gateway, and Worker to share one Node.js process.

> [!NOTE]
> This page is the task guide for the single-process topology.
> The [deployment topologies][deployment-topologies] concept explains when to choose single-process instead of a supervised, multi-process deployment.

<!-- This guide runs [`examples/full-site`][single-example], not [`examples/mvp-site`][mvp-site-example] like the [supervised-services guide][all-workers] or the [get-started tutorial][get-started-run] — `mvp-site` has no single-process boot path, so `full-site`'s `start.js` is the only example
demonstrating this topology today.
-->

## Use this topology when

- You are developing locally, running demos, or writing self-contained tests
- You want a minimal-footprint deployment
- You do not need per-service restart isolation

## Run the example

Follow the [single-process site example][single-example]:

- Start with its [prerequisites][single-example-prerequisites]
- Use the example [quick smoke test and full run][single-example-quickstart]

## Next steps

- Compare the supported shapes: [Deployment topologies][deployment-topologies]
- Run the supervised topology — [Run a multi-Worker site as supervised services][all-workers]
- Register a single miner before building a site config — [Run a miner Worker][miner-guide]

## Links

[deployment-topologies]: index.md
<!-- docs@tether.io: deployment-topologies → guides/deployment -->

[all-workers]: run-all-workers-site.md
<!-- docs@tether.io: all-workers → guides/deployment/run-all-workers-site -->

[get-started-run]: ../../tutorials/run-a-site.md
<!-- docs@tether.io: get-started-run → tutorials/run-a-site -->

[mvp-site-example]: ../../../examples/mvp-site/README.md
<!-- docs@tether.io: mvp-site-example → https://github.com/tetherto/mdk/tree/main/examples/mvp-site -->

[miner-guide]: ../miners/index.md
<!-- docs@tether.io: miner-how-to → guides/miners -->

[single-example]: ../../../examples/full-site/README.md
<!-- docs@tether.io: single-example → https://github.com/tetherto/mdk/tree/main/examples/full-site -->

[single-example-prerequisites]: ../../../examples/full-site/README.md#prerequisites
<!-- docs@tether.io: single-example-prerequisites → https://github.com/tetherto/mdk/tree/main/examples/full-site#prerequisites -->

[single-example-quickstart]: ../../../examples/full-site/README.md#quick-smoke-test-recommended-first-run
<!-- docs@tether.io: single-example-quickstart → https://github.com/tetherto/mdk/tree/main/examples/full-site#quick-smoke-test-recommended-first-run -->
