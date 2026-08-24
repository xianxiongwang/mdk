---
title: The storage model
description: Where MDK data actually lives, what's authoritative versus cached, and what that means as you grow
docs@tether_slug: concepts/the-storage-model
---

## Where data lives

Workers own their own telemetry storage. Kernel's Hyperbee holds three things only: the
Worker/device registry, published capabilities, and the write-command log.

| Data | Lives where | Engine |
| --- | --- | --- |
| Live device state | The device itself | None |
| Worker registry, device capabilities, command log | Kernel's own store | [Hyperbee][hyperbee], via `@tetherto/hp-svc-facs-store` |
| Historical telemetry | Each Worker, in its own store | [Worker-defined][integration-model] |
| Credentials and per-device config | Wherever the Worker plugin author put them |  [Worker-defined][integration-model] |

## What's authoritative, and what's cached

The physical device is the one source of truth. Everything above it is a view:

- A **Worker** is the authoritative record of its own device's state
- **Kernel's registry** is authoritative for *routing* (which Worker owns which device), not for device state itself
- **Kernel's command log** is authoritative for write-command lifecycle: every state transition (`QUEUED` →
  `DISPATCHED` → `EXECUTING` → `SUCCESS`/`FAILED`/`TIMEOUT`) is written to a write-ahead log (WAL) before it takes effect,
  so a crash mid-command recovers cleanly on restart. This WAL guarantee is scoped to that one component: the
  registry and capability stores next to it are plain Hyperbee, not WAL-backed.
- Every telemetry read anywhere above Kernel (a Gateway plugin, a dashboard, an agent) is a live pull through the
  chain back to the Worker, never a read from a Kernel-side cache. Kernel caches nothing on your behalf.

## Why this model?

MDK's storage choices favor **local-first, zero-external-dependency operation** over the query flexibility that
alternatives such as a dedicated time-series database or a managed cloud store would give you: a site can run fully 
offline, with no database server to provision, back up, or pay for beyond the process itself. The [cost][scalability] is that 
cross-device queries (a time range across every miner on a site) are the caller's job, not a stored-procedure or index 
the platform gives you for free.

## Retention

Kernel's command log and registry retain what they need for correctness (routing state, in-flight command
lifecycle) with no separate pruning policy documented today. Telemetry retention is entirely up to whatever a
Worker plugin's author implemented: MDK does not impose or enforce a retention window.

## Can you swap the backend?

Not today. Kernel's stores are Hyperbee via `@tetherto/hp-svc-facs-store` with no alternate-backend interface: a
different storage engine is not a supported extension point the way a Worker plugin or Gateway plugin is.

## Getting data out

There is no built-in export or streaming-to-a-warehouse path today. Anything you need outside of a live pull
through a Gateway plugin (a scheduled export, a mirror into another system) is code you write yourself against
`@tetherto/mdk-client`, the same way a plugin controller would.

## Failure

A full disk or an unreachable Worker degrades the specific read that touches it: `telemetryCollector.pull()`
returns nothing for that device rather than blocking every other request. A Kernel restart replays its command WAL
(`recover()` sweeps non-terminal command states) but does not need to reconstruct device state, since it never
owned it.

Each Kernel instance keeps its own separate store: there is no shared or federated storage across multiple
Kernels. A [multi-site deployment][scalability] means multiple independent stores, one per site,
with no cross-site consistency to reason about.

## Next steps

- Understand [the integration model][integration-model]: what a Worker plugin decides to persist, and how
- Understand [architecture][architecture]: the round trip a read or write actually takes
- Understand [scalability][scalability]: what changes about storage as a fleet grows 

## Links

[hyperbee]: https://github.com/holepunchto/hyperbee
<!-- docs@tether.io: external link — preserve URL -->

[integration-model]: the-integration-model.md
<!-- docs@tether.io: integration-model → concepts/the-integration-model -->

[architecture]: architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->

[scalability]: scalability.md
<!-- docs@tether.io: scalability → concepts/scalability -->
