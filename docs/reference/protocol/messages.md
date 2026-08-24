---
title: Protocol messages
description: Envelope schema and a worked request and response example for the MDK Protocol
docs@tether_slug: reference/protocol/messages
---

## Overview

Every MDK Protocol message uses the same envelope regardless of which layers are talking. This page shows the envelope shape and one worked example.

## Envelope

```json
{
  "id":        "uuid-v4",
  "version":   "0.2.0",
  "type":      "request | response | event",
  "action":    "<protocol action>",
  "sender":    "<component identity>",
  "target":    "<component identity> | null",
  "deviceId":  "string | null",
  "timestamp": 1711640000000,
  "payload":   {}
}
```

External consumers (UI or AI agents) only provide `deviceId`. [Kernel][kernel-package] resolves the target Worker identity internally.

A concrete request and response pair, end to end:

```json
// request: Gateway asks Kernel to reboot device wm-001
{
  "id": "8d1c-e3a4",
  "version": "0.2.0",
  "type": "request",
  "action": "command.request",
  "sender": "gateway",
  "target": null,
  "deviceId": "wm-001",
  "timestamp": 1711640000000,
  "payload": { "command": "reboot" }
}

// response: Kernel relays the Worker's terminal result
{
  "id": "1f9b-77c2",
  "version": "0.2.0",
  "type": "response",
  "action": "command.result",
  "sender": "kernel:kernel:shard-1",
  "target": "gateway",
  "deviceId": "wm-001",
  "timestamp": 1711640002145,
  "payload": { "status": "SUCCESS", "elapsedMs": 2145 }
}
```

## Next steps

- Learn more about actions and command targeting:
  - The [Kernel README][kernel-protocol] holds the full action catalogue (worker discovery, scheduled polling, command dispatch, kernel queries, and the 
write action lifecycle) and [command targeting rules][kernel-command-control] (`payload.scope`'s `device`, `worker`, and `rack` values, and the 
1024-target cap)
  - [Approval-gated writes][control-plane-writes] details the write action lifecycle's full cross-layer flow, and use [the write-actions how-to][write-actions] to submit and approve actions from a Gateway consumer
- [How MDK works][architecture]: for the architectural narrative explaining when each action fires
- See the [Kernel MDK Protocol spec][kernel-protocol] for every action, direction, and purpose
- [Kernel modules][kernel-modules]: the per-module specs that route and execute these actions
- [Build a Worker][build-a-worker]: implement the Worker side of this protocol

## Links

[architecture]: ../../concepts/architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->

[kernel-package]: ../../../backend/core/kernel/index.js
<!-- docs@tether.io: kernel-package → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/index.js -->

[kernel-protocol]: ../../../backend/core/kernel/README.md#mdk-protocol
<!-- docs@tether.io: kernel-protocol → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/README.md#mdk-protocol -->

[kernel-command-control]: ../../../backend/core/kernel/README.md#command-control
<!-- docs@tether.io: kernel-command-control → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/README.md#command-control -->

[control-plane-writes]: ../../concepts/control-plane.md#approval-gated-writes
<!-- docs@tether.io: control-plane-writes → https://github.com/tetherto/mdk/blob/main/docs/concepts/control-plane.md#approval-gated-writes -->

[write-actions]: ../../guides/gateway/write-actions.md
<!-- docs@tether.io: write-actions → guides/gateway/write-actions -->

[kernel-modules]: ../kernel/modules.md
<!-- docs@tether.io: kernel-modules → reference/kernel/modules -->

[terminology]: ../glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[build-a-worker]: ../../guides/workers/build-a-worker.md
<!-- docs@tether.io: build-a-worker → guides/workers/build-a-worker -->
