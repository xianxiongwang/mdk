---
title: Security boundaries
description: Security model, trust boundaries, and isolation between MDK components
todo: "Gap: no user-authentication boundary exists to document; do not describe the Gateway path as authenticated. Needs a proper treatment of what an integrator must build, and where. There is also no how-to for wiring an identity layer into plugin controllers, and no MDK-defined roles or role strings to document: the only permission vocabulary the stack enforces is Kernel's device-family write perms (miner:w, container:w) read from authPerms."
---

> [!NOTE]
> 🚧 This page is under construction: more data to follow.

> [!WARNING]
> MDK enforces no user identity at any tier. The Gateway serves its plugin routes to any caller, Kernel inspects no user identity, and
> `WorkerRuntime` applies no caller allowlist. Wherever this page says consumers enter through the Gateway, that path carries only the
> authentication you build into your plugin controllers. Until you build it, network policy and process isolation are the only boundaries
> protecting the fleet.


## Worker security boundary

`WorkerRuntime` listens over HyperswarmRPC. Its underlying HyperDHT connection uses encrypted Noise transport, and the
Worker's HRPC public key identifies and addresses that Worker endpoint. This authenticates the endpoint to the
connecting backend peer; it does **not** establish a human or application identity, grant command permission, or
substitute for the application-level authentication you implement above it.

The current `WorkerRuntime` does not enforce a caller allowlist before dispatching supported envelopes. Any backend
peer that can reach the Worker and address its public key may send requests. Kernel's HRPC caller allowlist protects
clients connecting to Kernel; it does not authorize direct callers to a Worker endpoint. Consumers must enter through
the Gateway → Kernel path, with request authentication implemented in the Gateway's plugin controllers, and direct
Worker reachability must be restricted to trusted backend networks. Treat Worker public keys and DHT topics as
deployment configuration, distribute them through an authenticated control plane, apply host/container firewall
policy, and never expose device management interfaces publicly. DHT topics provide rendezvous only; they are not credentials or authorization tokens.

The minimal host passes `services: null`. It therefore does not provide first-party service built-ins or
`write.calls.request` approval integration; the
[Worker Runtime legacy services][worker-runtime-legacy-services] page covers the full built-in
surface an `opts.services` object can activate. Direct `command.request` dispatch still reaches plugin command handlers.
Production command paths must authenticate the requester at the Gateway/control plane, authorize each device and
command, optionally require approval for high-impact actions, validate again in the handler, rate-limit, and create
an audit record containing actor, target, requested parameters, outcome, and correlation ID. The handler context does
not currently include actor identity, so actor-level auditing belongs upstream; handler logs supplement it. The
[control-plane security model](control-plane.md) covers the production trust path.

Inject credentials through the host process from a secret manager or protected environment, pass only the minimum
device-specific values in `config`, never place secrets in `mdk-contract.json`, and redact credentials and device
responses from errors, debug logs, telemetry, and audit records.

## Next steps

- [Understand the Gateway's security model][gateway-auth-design]: where user identity checks are meant to live
- [Review the control-plane security model](control-plane.md): the production trust path for approval-gated writes
- [Read the Worker Runtime legacy services reference][worker-runtime-legacy-services]: the full built-in surface `opts.services` can activate

## Links

[gateway-auth-design]: ../../backend/core/gateway/README.md#security-model
<!-- docs@tether.io: gateway-auth-design → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md#security-model -->

[worker-runtime-legacy-services]: ../reference/maintainers/worker-runtime-legacy-services.md
<!-- docs@tether.io: worker-runtime-legacy-services → https://github.com/tetherto/mdk/blob/main/docs/reference/maintainers/worker-runtime-legacy-services.md -->
