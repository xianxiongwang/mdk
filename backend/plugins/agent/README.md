# @tetherto/mdk-plugin-agent

Gateway plugin that mounts [`@tetherto/mdk-agent`](../../core/agent/README.md) as an auth-gated chat API: sessions, SSE
message streams, and approval round-trips for its write tools.

> [!TIP]
> The [Gateway agent guide][agent-guide] covers enabling this plugin and driving a session end to end.

## Configuration

The manifest's `setup` block asks for these values, read from `config.agent` at `require('@tetherto/mdk-gateway/plugin')`:

| Key | Status | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `agent.provider` | Required | `object` | None | The model the agent talks to. See the [provider shape](#provider-shape) |
| `agent.mcp` | Optional | `object` | None | The MCP tool server the agent calls fleet tools through. Omitting this, or its `url`, still loads the plugin: the agent runs as a grounded chat with no fleet tools (see [Troubleshooting](#troubleshooting)) |
| `agent.approvalTimeoutMs` | Optional | `number` | `120000` | How long a paused write waits for a decision before it resolves to rejected |

### Provider shape

`agent.provider` ([`provider.js`](../../core/agent/src/provider.js)):

| Key | Status | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | Required | `string` | None | `'qvac'` is currently the only implemented provider, required even when `baseURL` points at a non-QVAC endpoint |
| `model` | Required | `string` | None | The model id served or connected to |
| `mode` | Optional | `'external'` or `'managed'` | `'external'` if `baseURL` is set, else `'managed'` | Picks how the agent reaches the model |
| `baseURL` | Optional | `string` | None | Required in `external` mode: the URL of an already-running OpenAI-compatible server |
| `apiKey` | Optional | `string` | `'qvac'` | Used only in `external` mode |
| `modelConfig` | Optional | `object` | `{ ctx_size: 16384, reasoning_budget: 0 }` | Used only in `managed` mode; overrides `qvac serve`'s own defaults, which are too small to use as-is |

**`external`** connects to an already-running OpenAI-compatible server at `baseURL`, any such server and not only QVAC's own.
**`managed`** has the agent spawn and own the QVAC server itself for `model`, which needs the agent and the GPU on the same OS.

## Routes

| Route | Method + path | Notes |
| --- | --- | --- |
| `agent.session.create` | `POST /agent/sessions` | |
| `agent.session.message` | `POST /agent/sessions/:id/messages` | `text/event-stream`; events carry `turnId`, `seq`, and `approvalId` on `pending_approval` |
| `agent.approval.decide` | `POST /agent/sessions/:id/approvals/:approvalId` | Fail-safe timeout resolves to reject |
| `agent.session.delete` | `DELETE /agent/sessions/:id` | |

Sessions bind to the caller's identity from `req._info.user`, or to a single `local` operator when no auth plugin stamps one.
A session id and its approvals are only reachable by the identity that created them; a foreign id reads as missing rather than
forbidden, so existence never leaks.

[`tests/plugin.test.js`](tests/plugin.test.js) is the executable spec for this contract: envelope stamping, the approval
pause and resume order, the timeout-rejects path, and the per-identity isolation rules above.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every route answers `503 ERR_AGENT_UNAVAILABLE` | `config.agent` is missing entirely | Add the `agent` block to this plugin's config |
| Sessions and messages work, but the agent never calls a tool | `agent.mcp` (or its `url`) is omitted | Set `agent.mcp.url` to a reachable MCP server; [`createAgent`](../../core/agent/README.md) only connects to MCP when `config.mcp.url` is set, and without it the agent runs as a grounded chat with no fleet tools |

## Next steps

- [Enable the agent through the Gateway][agent-guide]: onboarding, mounting, and driving a session with curl
- [Understand the underlying agent](../../core/agent/README.md): the model, its tools, and the eval battery

[agent-guide]: ../../../docs/guides/agent/gateway-deployment.md
<!-- docs@tether.io: agent-guide → guides/agent/gateway-deployment -->
