# @tetherto/mdk-mcp

## Overview

MCP (Model Context Protocol) server for MDK. Exposes MDK data and actions to AI agents as declarative tools over a
`StreamableHTTPServerTransport`. `createMcpServer` below runs it as a standalone server — a separate process from the
[Gateway](../gateway/README.md), not a Gateway plugin — that talks to Kernel the same way the Gateway does, over
[`@tetherto/mdk-client`](../client/README.md). The Gateway also uses this package directly to start an in-process MCP
server when a plugin is mounted with `autoGenerateMcp: true` (see [Expose Gateway data to an agent](../../../docs/guides/agent/expose-data.md)).

## AI agents and the MCP server

An AI agent reaches fleet data through this server, not through the [Gateway](../gateway/README.md)'s HTTP surface — either
a standalone process started by `createMcpServer` below, or the one the Gateway auto-generates in-process from a mounted
plugin's routes. MDK's own operator agent, [`@tetherto/mdk-agent`](../agent/README.md), is one such client and uses the same
path any third-party agent would. (Separately, [`@tetherto/mdk-plugin-agent`](../../plugins/agent/README.md) mounts a chat API
on the Gateway so a human operator can talk to that agent — a different surface from the MCP endpoint described here.)

Agents sit in the same security envelope as every other consumer of this server: whatever checks front it apply equally to a
human caller and an agent, and an unprotected endpoint is open to both. Establishing that envelope is your work, since
neither Kernel nor this server performs user-level authentication on its own.

> [!WARNING]
> The MCP server's only built-in protection is its bind address: it listens on `127.0.0.1` and answers `POST /mcp`. Anything
> that can reach that port can drive the fleet, so an agent's tool calls carry whatever authority the loopback interface
> grants. Exposing the port beyond localhost means putting your own authentication in front of it.

The intended distinctive feature is **runtime tool derivation** from each registered Worker's `mdk-contract.json` — so a new
device type would give an agent new tools with no MCP server code change. That path is not wired up today: tools come from a
static, author-written `mcp-plugin.json` manifest ([`lib/plugin-loader.js`](./lib/plugin-loader.js)), or are auto-generated
from a Gateway plugin's HTTP routes when it sets `autoGenerateMcp: true`
([`lib/from-http-plugin.js`](./lib/from-http-plugin.js)) — neither reads a Worker's contract.

## `createMcpServer(root, port, config, pluginDirs)`

```js
const { createMcpServer } = require('@tetherto/mdk-mcp')

await createMcpServer(root, port, { kernelKey, kernelBootstrap }, pluginDirs)
```

| Param | Type | Description |
|---|---|---|
| `root` | `string` | Working directory for this server instance. Throws `ERR_INVALID_MCP_ROOT` if falsy |
| `port` | `number` | Port to listen on (`127.0.0.1` only). Throws `ERR_INVALID_MCP_PORT` if falsy |
| `config` | `object` | `{ kernelKey, kernelBootstrap }` (or any other config a tool needs). Frozen and handed to every plugin directory as the `config` in its context — the server builds no client of its own; each tool plugin builds its own [`@tetherto/mdk-client`](../client/README.md) from it |
| `pluginDirs` | `string[]` | Directories to load tools from (see below). Empty/omitted starts a server with no tools |

The server answers `POST /mcp` only; everything else gets a `404`. It builds a fresh `McpServer` per request (stateless
transport, no session id). `SIGINT`/`SIGTERM` are handled for you: they stop the HTTP server — there is no client of the
server's own to close.

## Plugin format

A plugin is a directory with an `mcp-plugin.json` manifest and one or more handler files — the same discovery pattern as
[a Gateway plugin](../plugins/README.md), but with `tools` instead of `routes`.

```json
{
  "name": "@your-scope/your-plugin",
  "version": "1.0.0",
  "tools": [
    { "id": "get_status", "handler": "./tools/get-status.js", "description": "Reports fleet status" }
  ]
}
```

Each handler file exports a `handler` function and an optional `schema` (a Zod shape — validated by the MCP SDK before your
handler runs). The handler takes only its tool args: build a client once from the
plugin's context (`require('@tetherto/mdk-mcp/plugin')` resolves to that plugin's frozen `{ config, logger }`) and
`require` it from every handler in the plugin, [the same pattern a Gateway plugin uses](../gateway/README.md#extend-the-gateway):

```js
const { z } = require('zod')
const mdkClient = require('../lib/client')

module.exports = {
  schema: { deviceId: z.string() },
  handler: async ({ deviceId }) => {
    const telemetry = await mdkClient.pullTelemetry(deviceId, 'metrics')
    return { content: [{ type: 'text', text: JSON.stringify(telemetry) }] }
  }
}
```

[`lib/client.js`](../../../examples/mvp-site/backend/mcp-plugins/site/lib/client.js) and
[`tools/get-device.js`](../../../examples/mvp-site/backend/mcp-plugins/site/tools/get-device.js) ship the production version
of this pattern.

[`loadPlugin()`](./lib/plugin-loader.js) validates the manifest and every handler at load time, throwing `ERR_PLUGIN_MANIFEST_MISSING`,
`ERR_PLUGIN_MANIFEST_INVALID`, `ERR_PLUGIN_HANDLER_NOT_FOUND`, `ERR_PLUGIN_HANDLER_NOT_FUNCTION`, or
`ERR_PLUGIN_TOOL_DUPLICATE_ID` on the first problem.

## Real usage

[`examples/mvp-site/deploy/run-process.js`](../../../examples/mvp-site/deploy/run-process.js) runs this as its own PM2-supervised process 
(`--role mcp`): it resolves the Kernel key using the same `.kernel-key` discovery the Gateway uses, then calls
`createMcpServer(root, port, { kernelKey }, MCP_PLUGIN_DIRS)`.

## Testing

`npm test` runs `standard` lint, unit tests ([`tests/unit/`](./tests/unit/)), and integration tests ([`tests/integration/`](./tests/integration/)) — the latter cover
schema enforcement, multi-plugin-dir merging, thrown-handler-error propagation, and the shutdown handlers.
