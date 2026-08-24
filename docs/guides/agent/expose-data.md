---
title: Expose data to the agent
description: Turn a Gateway plugin's HTTP routes into MCP tools the operator agent can call, with no separate MCP manifest.
docs@tether_slug: guides/agent/expose-data
---

## Overview

The operator agent calls fleet data and actions as MCP tools. A Gateway plugin's routes become those tools automatically when
mounted with `autoGenerateMcp: true`, with no separate MCP manifest to author and keep in sync with the plugin's own routes.

## Prerequisites

- The [Gateway is running][run-gateway]
- A [Gateway plugin][gateway-plugins] already mounted via `extraPluginDirs`

<Steps>

<Step>

### Auto-generate tools from a plugin

Pass `{ dir, autoGenerateMcp: true }` instead of a plain path to also expose a plugin's HTTP routes as MCP tools:

```js
await startGateway({
  kernel,
  port: 3000,
  extraPluginDirs: [
    { dir: path.join(__dirname, 'plugins/custom-metrics'), autoGenerateMcp: true }
  ],
  mcp: { port: 3100 }
})
```

Each route becomes a tool named after its `id` (dots and other non-alphanumeric characters become underscores), with the
description, safety hint, and input schema derived from the route's `http` block. Path, query, and header parameters and the
`requestBody`'s top-level properties become the tool's input fields, and the same route handler and live `mdkClient`
connection serve both interfaces. The Gateway starts one in-process MCP server (Streamable HTTP, default port
`opts.port + 100`) covering every auto-generated tool across all mounted plugins.

</Step>

<Step>

### Write tools by hand instead

A plugin that needs a different tool granularity, richer descriptions, or direct `mdkClient` calls can still author an
`mcp-plugin.json` by hand and run it with a standalone [MCP server][mcp-server].

</Step>

</Steps>

## Next steps

- [Build the plugin whose routes you want to expose][gateway-plugins]
- [Enable the operator agent][gateway-deployment] to call the tools this produces
- [Understand the agent as a stack component][agent-concept]

## Links

[run-gateway]: ../gateway/run.md
<!-- docs@tether.io: run-gateway → guides/gateway/run -->

[gateway-plugins]: ../gateway/plugins.md
<!-- docs@tether.io: gateway-plugins → guides/gateway/plugins -->

[gateway-deployment]: gateway-deployment.md
<!-- docs@tether.io: gateway-deployment → guides/agent/gateway-deployment -->

[agent-concept]: ../../../backend/core/agent/README.md
<!-- docs@tether.io: agent-concept → https://github.com/tetherto/mdk/blob/main/backend/core/agent/README.md -->

[mcp-server]: ../../../examples/full-site/docs/mcp-server.md
<!-- docs@tether.io: mcp-server → https://github.com/tetherto/mdk/blob/main/examples/full-site/docs/mcp-server.md -->
