---
title: Deploy the agent behind the Gateway
description: Mount the conversational operator agent behind the Gateway as a chat API, and drive a session through an approval-gated write.
docs@tether_slug: guides/agent/gateway-deployment
---

## Overview

`@tetherto/mdk-plugin-agent` mounts [`@tetherto/mdk-agent`][agent-core-readme] behind the Gateway as a chat API. It is not a
separate product to adopt: enabling the plugin brings session, message, and approval routes with it, and every write the agent
proposes pauses for an operator's decision. The agent itself still reaches fleet data the way [any AI agent does][ai-agents-mcp],
over an MCP server reachable at `agent.mcp.url` — standalone, or the Gateway's own auto-generated one; this plugin only gives a
human operator a chat surface to talk to it through. This is one of
two ways to run the agent: for the standalone CLI path, or to compare the two, start from [the agent guide chooser][agent-guides-index].

## Prerequisites

- The [Gateway is running][run-gateway]
- The plugin is selected during `mdk onboard`, or mounted directly through `extraPluginDirs`
- `config.agent` is populated with a model provider, an MCP server url, and an approval timeout
- An MCP tool server is reachable, so the agent has fleet tools to call

<Steps>

<Step>

### Mount the plugin

#### 1.1 Select it during onboarding

`mdk onboard` lists `mdk-plugin-agent` in its Gateway plugin catalog. Its entry carries a real `repoPath`
([`backend/plugins/agent`][agent-plugin-readme]), not a stub, so selecting it installs a working plugin rather than a placeholder.

#### 1.2 Or mount it directly

Pass its directory through `extraPluginDirs`, with the model provider, the MCP url, and the approval timeout under `agent`.
Once published, that directory is `node_modules/@tetherto/mdk-plugin-agent`; in this monorepo checkout it is
[`backend/plugins/agent`][agent-plugin-readme]:

```js
const path = require('path')
const { startGateway } = require('@tetherto/mdk/backend/core/mdk')

await startGateway({
  kernel,
  port: 3000,
  extraPluginDirs: [
    {
      dir: path.join(__dirname, '<path to mdk-plugin-agent>'), // backend/plugins/agent in this checkout
      config: {
        agent: {
          // 'qvac' is the only implemented provider kind, required even for a non-QVAC endpoint;
          // 'external' mode just wraps any OpenAI-compatible chat-completions endpoint at baseURL
          provider: { kind: 'qvac', mode: 'external', model: 'qwen3-4b', baseURL: 'http://127.0.0.1:11500/v1' },
          mcp: { url: 'http://127.0.0.1:3008/mcp' },
          approvalTimeoutMs: 120000
        }
      }
    }
  ]
})
```

> [!IMPORTANT]
> No auth plugin means every request binds to a single `local` operator, so a perimeter-trusted deployment gets the full chat and
> approval flow with no identity setup at all. A missing `config.agent` block answers `503 ERR_AGENT_UNAVAILABLE` instead of
> failing to load.

</Step>

<Step>

### Create a session and send a message

Use the port `startGateway({ port })` was given: `3000` in the snippet above, `3007` if this is mounted alongside the
[full-site example][full-site-example].

```bash
curl -X POST http://localhost:<port>/agent/sessions
# {"sessionId":"..."}

curl -N -X POST http://localhost:<port>/agent/sessions/<id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"how many miners are on the site?"}'
```

The response streams as `text/event-stream`. A read-only question ends in `tool_call`, `tool_result`, `token`, and `done`
events, each stamped with the turn's `turnId` and a monotonic `seq`.

</Step>

<Step>

### Approve a write

A write action pauses the turn instead of running it:

```text
event: pending_approval
data: {"type":"pending_approval","name":"act_device","args":{"ref":"whatsminer-0","action":"reboot"},"approvalId":"..."}
```

Decide it from the paused stream's `approvalId`:

```bash
curl -X POST http://localhost:<port>/agent/sessions/<id>/approvals/<approvalId> \
  -H 'Content-Type: application/json' \
  -d '{"approved":true}'
```

Approving resumes the same stream: the tool runs for real, and the turn continues to its `token` and `done` events. Rejecting,
or letting the approval window expire, resolves to false, and the write never runs.

</Step>

</Steps>

## Next steps

- [Read the agent plugin's route reference][agent-plugin-readme]: session, message, and approval routes, plus the manifest's `setup` fields
- [Understand the underlying agent][agent-core-readme]: the model, its fleet tools, and the eval battery that scores it
- [Submit and approve write actions][write-actions] from a React app, for the UI-driven shape of this same approval gate

## Links

[run-gateway]: ../gateway/run.md
<!-- docs@tether.io: run-gateway → guides/gateway/run -->

[write-actions]: ../gateway/write-actions.md
<!-- docs@tether.io: write-actions → guides/gateway/write-actions -->

[ai-agents-mcp]: ../../../backend/core/mcp/README.md#ai-agents-and-the-mcp-server
<!-- docs@tether.io: ai-agents-mcp → https://github.com/tetherto/mdk/blob/main/backend/core/mcp/README.md#ai-agents-and-the-mcp-server -->

[agent-plugin-readme]: ../../../backend/plugins/agent/README.md
<!-- docs@tether.io: agent-plugin-readme → https://github.com/tetherto/mdk/blob/main/backend/plugins/agent/README.md -->

[agent-core-readme]: ../../../backend/core/agent/README.md
<!-- docs@tether.io: agent-core-readme → https://github.com/tetherto/mdk/blob/main/backend/core/agent/README.md -->

[full-site-example]: ../../../examples/full-site/README.md
<!-- docs@tether.io: full-site-example → https://github.com/tetherto/mdk/blob/main/examples/full-site/README.md -->

[agent-guides-index]: index.md
<!-- docs@tether.io: agent-guides-index → guides/agent -->
