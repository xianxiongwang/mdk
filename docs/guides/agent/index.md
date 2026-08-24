---
title: Operator agent how-to guides
description: Task guides for running MDK's conversational operator agent, standalone or behind the Gateway.
docs@tether_slug: guides/agent
---

## Overview

`@tetherto/mdk-agent` is a conversational operator agent that answers plain-language questions about a mining fleet, calls
fleet tools over MCP, and gates writes behind human approval. [What the agent is and how it fits the stack][agent-concept]
covers the concepts; these guides cover running it.

> [!NOTE]
> If Gateway, Kernel, or plugin are unfamiliar, read [terminology][terminology] first.

## Choose a guide

| Goal | Guide |
| --- | --- |
| Run the agent as a standalone CLI, for local development or evaluation | [`backend/core/agent/README.md`][agent-core-readme] |
| Deploy the agent behind the Gateway as a chat API for an operator UI | [Deploy the agent behind the Gateway][gateway-deployment] |
| Expose a plugin's own routes to the agent as tools | [Expose data to the agent][expose-data] |

## Next steps

- [Understand the agent as a stack component][agent-concept]
- [Understand the Gateway as a development surface][gateway-concept]

## Links

[agent-concept]: ../../../backend/core/agent/README.md
<!-- docs@tether.io: agent-concept → https://github.com/tetherto/mdk/blob/main/backend/core/agent/README.md -->

[terminology]: ../../reference/glossary.md
<!-- docs@tether.io: terminology → reference/glossary -->

[agent-core-readme]: ../../../backend/core/agent/README.md
<!-- docs@tether.io: agent-core-readme → https://github.com/tetherto/mdk/blob/main/backend/core/agent/README.md -->

[gateway-deployment]: gateway-deployment.md
<!-- docs@tether.io: gateway-deployment → guides/agent/gateway-deployment -->

[expose-data]: expose-data.md
<!-- docs@tether.io: expose-data → guides/agent/expose-data -->

[gateway-concept]: ../../../backend/core/gateway/README.md
<!-- docs@tether.io: gateway-concept → https://github.com/tetherto/mdk/blob/main/backend/core/gateway/README.md -->
