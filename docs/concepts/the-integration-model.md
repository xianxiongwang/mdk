---
title: The integration model
description: What MDK can be extended with, and by which of its two extension points
docs@tether_slug: concepts/the-integration-model
---

## MDK integration

Kernel is extended by building Worker and Gateway capabilities:

| | Worker plugin | Gateway plugin |
| --- | --- | --- |
| Extends | The Worker tier | The Gateway tier |
| Declares itself with | `mdk-contract.json` (the Worker contract) | `mdk-plugin.json` |
| That declaration is read by | Kernel today (routing, validation); no other reader exists in this repo today | The Gateway loader (routes, auth flag) |
| Job | Speak one device family's native protocol; expose it as telemetry + commands | Add an HTTP route: aggregate, authenticate, or otherwise sit between a caller and `@tetherto/mdk-client` |

## `mdk-plugin.json` gets the same treatment, for Gateway plugins

A Gateway plugin's manifest declares its routes (`id`, `handler`, `http.method`/`http.path`, response schema,
constraints, examples, errors, `safety`). The Gateway's plugin loader reads it to mount routes and validate the
manifest shape at load time; nothing about it is hand-wired into the Gateway's own code path per plugin.

## Workers are not only hardware

A Worker plugin wraps whatever answers to "one device, one connection, one set of telemetry/commands"; that's
just as often a non-hardware integration:

- A **pool API** Worker: telemetry is your hashrate/earnings from the pool's own API, "commands" might be switching
  workers between pools; no physical device involved at all.
- An **accounting sync** Worker: telemetry is a ledger balance or a sync status pulled from a third-party service,
  with no ASIC anywhere in the picture.

Both get the exact same treatment from Kernel as a physical miner: identity, capabilities, telemetry pull, command
dispatch. Kernel does not know or care that there is no hardware behind either one.

## What this buys you

Write the integration once (one Worker plugin per device family, one Gateway plugin per route you need) and
every consumer built against the standard round trip works with it for free: the same dashboard code, the same
agent tooling, the same Gateway auth model, regardless of which device family or which route it's actually talking
to underneath.

## Next steps

- [Build a Worker plugin][build-a-worker] for a new device family
- Understand the [Gateway plugin authoring flow][gateway-plugins]
- Understand [the storage model][storage-model]: what a Worker plugin decides to persist
- Understand [architecture][architecture]: where both extension points sit in the round trip

## Links

[architecture]: architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->

[storage-model]: the-storage-model.md
<!-- docs@tether.io: storage-model → concepts/the-storage-model -->

[build-a-worker]: ../guides/workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->

[gateway-plugins]: ../guides/gateway/plugins.md
<!-- docs@tether.io: gateway-plugins → guides/gateway/plugins -->
