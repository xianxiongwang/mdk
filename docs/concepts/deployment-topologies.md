---
title: Deployment topologies
description: How to run MDK as a single process, as local same-machine services, or as distributed microservices — the footprint vs. isolation trade-off
---

This page explains the three supported deployment shapes and when to pick each.

## Overview

MDK's runtime pieces — the [Kernel][architecture], the Gateway, and one or more Workers — can run together 
in a single process or be split across several. This is a **packaging and operations** choice, and it's 
independent of how MDK [scales logically][scaling] (adding Workers, adding sites). 

> [!NOTE]
> If Kernel, Worker, manager, or thing are unfamiliar, read the [`glossary.md`][glossary] first.

## Connection model

Before choosing a shape, it helps to understand which components initiate connections:

- The Gateway dials Kernel — it is the active side of that connection, over [Hyperswarm RPC (HRPC)][hrpc-glossary] using the Kernel's public key (read from the well-known key file on the same host, or passed as `kernelKey` for a remote host)
- Kernel discovers Workers and initiates every RPC call — Workers are passive; they become reachable and wait
- Workers never initiate any connection

This directionality is what drives the transport and discovery configuration in each shape below.
For detail, see the [Workers discovery model][architecture-workers] and the [Gateway Kernel connection][gateway-kernel-connection].

## The three shapes

### Single process

```mermaid
flowchart LR
  classDef mdk fill:#F7931A,stroke:#1A1A1A,color:#1A1A1A
  sApp["Gateway"]:::mdk -->|"HRPC"| sKernel["Kernel"]:::mdk
  sKernel -.->|"in-process"| sW1["Worker A"]:::mdk
  sKernel -.->|"in-process"| sW2["Worker B"]:::mdk
```

*Solid arrow: active connection initiated by the source. Dashed arrow — Kernel-initiated discovery.*

Kernel, the Gateway, and every Worker run inside one Node.js heap and event loop. Lowest footprint, simplest to start, nothing external to supervise. This is the shape behind the [single-process site how-to][single-how-to].

### Local

```mermaid
flowchart LR
  classDef mdk fill:#F7931A,stroke:#1A1A1A,color:#1A1A1A
  lApp["Gateway"]:::mdk -->|"HRPC"| lKernel["Kernel"]:::mdk
  lKernel -.->|"shared dir"| lW1["Worker A"]:::mdk
  lKernel -.->|"shared dir"| lW2["Worker B"]:::mdk
```

*Solid arrow: active connection initiated by the source. Dashed arrow — Kernel-initiated discovery.*

Each service runs as its own OS process on the same machine. Kernel discovers Workers via a shared directory — no DHT configuration needed. The [supervised-services site guide][multi-how-to] demonstrates this as its default mode.

### Microservices

```mermaid
flowchart LR
  classDef mdk fill:#F7931A,stroke:#1A1A1A,color:#1A1A1A
  mApp["Gateway (host 1)"]:::mdk -->|"HRPC"| mKernel["Kernel (host 2)"]:::mdk
  mKernel -.->|"DHT"| mW1["Worker A (host 3)"]:::mdk
  mKernel -.->|"DHT"| mW2["Worker B (host N)"]:::mdk
```

*Solid arrow: active connection initiated by the source. Dashed arrow — Kernel-initiated discovery.*

Each service runs as its own OS process or container, potentially on separate hosts, supervised by pm2 or Docker and connected via DHT. The same guide's example switches to this shape by setting its `discovery` config field to `"dht"`.

## The trade-off

Pick **single-process** when:

- You are developing locally, running demos, or want a self-contained site for tests
- Footprint matters more than isolation (minimal or embedded deployments)
- You do not need supervisor-managed restarts

Pick **local** when:

- All services run on one machine and you want independent process restarts
- Outbound networking is restricted removing DHT as an option
- You want process isolation and independent restarts without the complexity of DHT

Pick **microservices** when:

- You want to allocate resources per service — CPU and memory limits per process or container
- Workers run on separate hosts from Kernel or the Gateway
- You are orchestrating many Workers across one or more hosts

## Where [`worker.js`][worker-entry] fits

The microservices shape is built on [`backend/core/mdk/worker.js`][worker-entry], a shared process entry compatible with pm2, Docker, or a direct `node worker.js`. It is driven by environment variables (`SERVICE`, and for a Worker `WORKER`/`TYPE`/`RACK`) rather than CLI flags. One [`worker.js`][worker-entry] runs per service, and the supervisor (pm2 or Docker) owns its lifecycle and resource limits. The [standalone `worker.js` install pattern][install-pattern] defines the per-Worker mechanics.

The single-process and local shapes both call the programmatic APIs directly: `getKernel()` and `startGateway()` from [`@tetherto/mdk`][mdk-readme],
and each Worker's own boot function (there is no single generic `startWorker`). Local mode passes `discovery: { mode: 'local' }` to `getKernel()` and
publishes each Worker's RPC key to the same shared directory with `publishWorkerKey()`. The [local Worker discovery][worker-discovery-local] section
covers how both sides resolve that directory and how Kernel picks up keys as they appear.

## Relationship to scaling

Topology is orthogonal to scale. [Logical scaling][scaling] is about *how many* Workers and Kernel kernels you run (parallel Workers, per-site kernels, multi-site oversight). Deployment topology is about *how those processes are packaged* on a given host. You choose both: for example, a production site typically runs multiple processes (this page) and multiple parallel Workers per kernel ([scaling][scaling]).

## Next steps

- Run a self-contained local site: [Single-process site][single-how-to]
- Run [same-machine services without DHT][worker-discovery-local]
- Run [a multi-Worker site as supervised services, from one machine up to a cross-host deployment][multi-how-to]
- Register [one miner before packaging a whole site][miner-how-to]

## Links

[architecture]: architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->

[architecture-workers]: architecture.md#the-three-tiers
<!-- docs@tether.io: architecture-workers → concepts/architecture#workers -->

[gateway-kernel-connection]: ../../backend/core/gateway/README.md#kernel-connection
<!-- docs@tether.io: gateway-kernel-connection → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md#kernel-connection -->

[scaling]: scalability.md
<!-- docs@tether.io: scaling → concepts/scalability -->

[worker-entry]: ../../backend/core/mdk/worker.js
<!-- docs@tether.io: worker-entry → https://github.com/tetherto/mdk/blob/main/backend/core/mdk/worker.js -->

[mdk-readme]: ../../backend/core/mdk/README.md
<!-- docs@tether.io: mdk-readme → https://github.com/tetherto/mdk/blob/main/backend/core/mdk/README.md -->

[install-pattern]: ../../backend/workers/docs/install-pattern.md#standalone-via-workerjs
<!-- docs@tether.io: install-pattern → https://github.com/tetherto/mdk/blob/main/backend/workers/docs/install-pattern.md#standalone-via-workerjs -->

[single-how-to]: ../guides/deployment/run-single-process-site.md
<!-- docs@tether.io: single-how-to → guides/deployment/run-single-process-site -->

[multi-how-to]: ../guides/deployment/run-all-workers-site.md
<!-- docs@tether.io: multi-how-to → guides/deployment/run-all-workers-site -->

[miner-how-to]: ../guides/miners/index.md
<!-- docs@tether.io: miner-how-to → guides/miners -->

[worker-discovery-local]: ../../backend/workers/docs/architecture.md#local-mode
<!-- docs@tether.io: worker-discovery-local → https://github.com/tetherto/mdk/blob/main/backend/workers/docs/architecture.md#local-mode -->

[glossary]: ../reference/glossary.md
<!-- docs@tether.io: glossary → reference/glossary -->

[hrpc-glossary]: ../reference/glossary.md#hyperswarm-rpc
<!-- docs@tether.io: hrpc-glossary → reference/glossary#hyperswarm-rpc -->