---
title: Run an MDK site
description: Choose and run an MDK site deployment topology, from one Node.js process to supervised services.
docs@tether_slug: guides/deployment
---

## Overview

Use these guides to choose a site deployment shape.

> [!NOTE]
> If Kernel, Gateway, Worker, manager, or thing are unfamiliar, read [terminology][terminology] first.
> If you are choosing between topologies, read [deployment topologies][deployment-topologies].

## Choose a guide

- Run Kernel, Gateway, and Workers in one Node.js process with the [single-process topology][single-process]
- Run a multi-Worker site as separate, PM2-supervised processes, from one machine up to a cross-host deployment, using [supervised services][all-workers]

## Next steps

- Understand the trade-offs before you choose your [deployment topology][deployment-topologies]
- Browse the [functions][mdk-functions] that wire together the [Kernel][kernel-concept], [device Workers][workers-concept], and the [Gateway][gateway-concept] HTTP

## Links

[terminology]: ../../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[deployment-topologies]: ../../concepts/deployment-topologies.md
<!-- docs@tether.io: deployment-topologies → https://github.com/tetherto/mdk/blob/main/backend/core/docs/README.md#connection-and-deployment-model -->

[single-process]: run-single-process-site.md
<!-- docs@tether.io: single-process → guides/deployment/run-single-process-site -->

[all-workers]: run-all-workers-site.md
<!-- docs@tether.io: all-workers → guides/deployment/run-all-workers-site -->

[mdk-functions]: ../../../backend/core/mdk/README.md
<!-- docs@tether.io: mdk-functions → https://github.com/tetherto/mdk/blob/main/backend/core/mdk/README.md -->

[kernel-concept]: ../../../backend/core/kernel/README.md
<!-- docs@tether.io: kernel-concept → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/README.md -->

[workers-concept]: ../../../backend/workers/README.md
<!-- docs@tether.io: workers-concept → https://github.com/tetherto/mdk/blob/main/backend/workers/README.md -->

[gateway-concept]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-concept → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->
