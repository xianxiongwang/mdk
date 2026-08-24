# @tetherto/mdk-agent

A conversational operator agent for MDK: a small library + CLI that answers plain-language
questions about a mining fleet. It runs on a **local** model (QVAC) and calls **MDK fleet
tools over MCP** — it never invents fleet data, and write actions require human approval.

The model routes and narrates; the tools compute. Nothing leaves the machine.

> [!NOTE]
> The following steps run the library directly for local development. In production, this agent is deployed behind the
> Gateway by [`@tetherto/mdk-plugin-agent`](../../plugins/agent/README.md), which mounts it as a chat API instead; the
> [agent guide chooser](../../../docs/guides/agent/index.md) covers both paths, including that one.

## Prerequisites

- Node.js ≥ 24
- A GPU (the model runs locally via QVAC — Vulkan, not CUDA)
- `npm install` in this directory

`npm install` covers talking to a model over HTTP (`--base-url`, the default). Serving one
on this machine additionally needs `@qvac/cli` — see step 1.

## 1. Serve the model (the brain)

The agent needs a language model listening locally. QVAC serves one with an
OpenAI-compatible API — start it first, in its own terminal:

```bash
npm i --no-save @qvac/cli@^0.9.0 --legacy-peer-deps   # once; ~4.9 GB of prebuilt inference engines
npx qvac serve openai --config qvac-runtime/qvac.config.json --port 11500 --verbose
```

`@qvac/cli` is an optional peer dependency, so it is not installed by default — the agent
only needs it to *serve* a model, not to talk to one. Skip this step if a QVAC server is
already running elsewhere (another host, or Windows alongside WSL) and point `--base-url`
at it. Note the `qvac` binary comes from `@qvac/cli`; there is no `qvac` package on npm,
so a bare `npx qvac` without the install above fails with a 404.

**Use 0.9.0 or newer.** 0.8.x never passes `kvCache` to the SDK, so every request
re-prefills the whole conversation — measured at ~2.4 s for a 7k-word prompt, with an
exact repeat costing the same as a cold one. 0.9.0 enables it and a follow-up turn drops
to ~44% of cold. `--legacy-peer-deps` is needed until `@qvac/ai-sdk-provider` is bumped:
0.3.0 caps the peer at `^0.8.0`, and 0.4.0 (which allows `^0.9.0`) requires `ai@^7`.

- [`qvac-runtime/qvac.config.json`](./qvac-runtime/qvac.config.json) pins the model (Qwen3-4B, 4-bit quantized, 16k context).
- The first run downloads the model into `~/.qvac/models`; after that it is cached.
- `--verbose` shows the load and the GPU offload. Wait until it is listening on `11500`.

## 2. Start the demo fleet + tools (optional)

To try it end-to-end, boot the full-site example. It brings up a simulated fleet (miners,
containers, powermeters, sensors, pools) and exposes the MDK tools over MCP on port `3008`:

```bash
cd ../../../examples/full-site
npm install    # first time only
npm start      # kernel + workers + gateway + MCP server on :3008
```

Leave it running. (If you already have an MCP tool server, skip this and point the agent
at its URL in step 3.)

## 3. Start the agent and ask

In a third terminal, start the CLI — pointing it at the model (step 1) and the MCP tool
server (step 2):

```bash
node bin/mdk-agent.js --model qwen3-4b --mcp-url http://127.0.0.1:3008/mcp
```

Then ask, in plain language:

```
you › how many miners are on the site?
  → tool   count_devices({"family":"miner","state":"all"})
  ← data   { "summary": "15 miners.", "count": 15 }
  ▌ There are 15 miners on the site.

you › list the devices that are not ready
you › reboot antminer-3          ← a write: the agent stops and asks you to approve
```

REPL commands: `/about` (what this is) · `/tools` · `/info` · `/new` · `/exit`.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--model` | `qwen3-600m` | model id served by QVAC (use `qwen3-4b`) |
| `--mode` | `external` | how the provider reaches the model; `external` talks to `--base-url` |
| `--base-url` | `http://127.0.0.1:11500/v1` | the QVAC model endpoint from step 1 |
| `--mcp-url` | *(none)* | MCP tool server; omit for plain grounded chat, no tools |
| `--eval` | off | run the eval battery instead of the REPL (needs `--mcp-url`) |
| `--reps` | `1` | repetitions per question; 3+ exposes unstable routing |
| `--only` | *(all)* | restrict the run to case ids containing this string |
| `--tag` | *(all)* | restrict the run to cases carrying this tag |
| `--concurrency` | `1` | run this many cases at once; 6 is ~4× faster |
| `--out` | *(none)* | write the JSON report to this path |

### Measuring the agent

The battery asks the questions an operator asks, and scores routing, the answer, the result
contract and the approval gate on each. Expectations are read from the live fleet at run time,
so it works against any site.

```sh
node bin/mdk-agent.js --model qwen3-4b --mcp-url http://127.0.0.1:3008/mcp \
  --eval --reps 2 --concurrency 6 --out eval-report.json
```

259 questions × 2 reps takes about twenty minutes at `--concurrency 6`, and over an hour
without it. Use `--tag rank` or `--only decline-` while iterating.

It exits non-zero on any failure. A new tool ships with a passing report — see
[docs/TOOLS.md](docs/TOOLS.md) for the authoring pipeline.

### Beyond single questions

The battery opens a fresh session per question, so two things it cannot reach have their own
runners. Both need the model and an MCP server up, and neither is part of `npm test`.

```sh
node eval/threads.mjs    # 264 operator conversations, 1018 turns, one session per thread
node eval/latency.mjs    # where a turn's time goes: model, tools, time to first token
```

[`threads.mjs`](./eval/threads.mjs) is what a conversation exposes and a single question does not: pronouns and
back-references, an action following a question, and drifting out of scope mid-thread. It
writes a transcript per turn and flags device ids an answer names that the turn's tools never
returned — which is how "does it hallucinate" becomes a number rather than an impression.

> **WSL note:** if you run the agent inside WSL while the model runs on Windows, use
> [`./run.sh`](./run.sh) instead of `node` — it forces the native Linux node the deps were built with.

## Without the demo

Point `--mcp-url` at any MCP server that exposes MDK-style tools, or omit it entirely for a
plain grounded chat against the model with no fleet access.

## Reclaiming the KV cache

From 0.9.0 `qvac serve` caches each conversation's attention state to
`~/.qvac/kv-cache`, which is what makes a follow-up model call skip prefill. Each entry is
a dump of the KV tensors — **~144 MB** for a 1.7k-token conversation — and the server
writes one per conversation and never removes any. The runtime's own `deleteCache()` is an
in-process RPC that the HTTP API does not expose, so nothing reclaims this on its own.

Run the reaper **where `qvac serve` runs** — the cache is the server's disk, and in the
shared-inference shape that is a different machine from the agent:

```bash
node bin/qvac-cache-reaper.js --ttl 24h --dry-run              # see what would go
node bin/qvac-cache-reaper.js --ttl 6h --interval 30m --quiet  # or leave it sweeping
```

`--help` lists the rest.

Evicting a live entry is safe: the next turn misses the cache and re-prefills, costing
latency and never correctness.

A directory holding no data is usually an aborted turn, but the server creates a
conversation's directory before it writes the blob — so a brand-new empty one may be a turn
still in flight. Those are left alone until they are older than `--empty-grace` (default 5m).
An entry whose files cannot be read is never evicted at all: failing to measure something is
not evidence that it is stale.

## Where conversations live

A CLI holds one conversation in a variable and exits. A gateway serves many people across many
requests and has to find a conversation again between them, so history lives in a **session
store** behind an interface a Redis or SQL implementation can satisfy.

```js
const agent = await createAgent({ provider, mcp, store })   // store is optional

const session = await agent.createSession({ userId, metadata })
const resumed = await agent.resumeSession(id, { userId })   // null if gone, expired, or not theirs
```

Nothing is required to use it. Left out, the agent creates a `MemorySessionStore` — correct for
one process and no use beyond it: a restart loses every conversation, and two instances share
none. The CLI needs no configuration and works as before, with one visible change: a session id
is now a uuid rather than `sess_001`, and that is printed at startup and in `/info`.

**`resumeSession` requires the `userId` of whoever is asking, and there is no default.** A
session id travels in URLs an operator can see, so an id alone is not authority to read the
conversation behind it. A session belonging to somebody else returns `null`, exactly like one
that never existed — telling those apart would confirm the id exists, which is the thing the
check protects.

**The contract a persistent implementation satisfies.** Four rules, each of them a way the
in-memory version could otherwise be more forgiving than the real one — and so let a bug pass
locally that only appears in production:

| | |
| --- | --- |
| `create({ userId, metadata })` | → record. Throws without a `userId` |
| `get(id)` | → record or `null` — **`null` for expired and never-existed alike** |
| `save(record)` | → the stored record, trimmed and re-stamped. Throws `err.code === 'SESSION_GONE'` for an id it does not hold |
| `delete(id)` | → whether there was anything to remove |
| `listByUser(userId)` | → live records, newest first |
| `sweep()` | → how many expired records it reclaimed |

1. **Every method is async.** A `Map` does not need it; a network round trip does, and callers
   written against a synchronous store all break the day it is not one.
2. **Records handed out are copies.** Return the live object and `record.messages.push(...)`
   silently writes to the store here and silently writes to nothing over a network.
3. **An expired session is indistinguishable from one that never existed** — from `get` and from
   `delete` alike — and `save` against an expired id fails rather than resurrecting a conversation
   the system already discarded. That failure carries `code: 'SESSION_GONE'`, which is how a
   session tells "this conversation is over" from "this write did not land this time" and either
   detaches or retries. An implementation that omits the code gets the retry path forever.
4. **Expiry is lazy, on read.** Correctness never depends on `sweep()` having run — it only
   reclaims memory. Deliberately not a timer: a library that starts an interval nobody clears is
   a leak, and Redis returns 0 from it.

Expiry on read is enough for correctness and **not** enough for memory: a session nobody resumes
is never read, so it is never expired and never freed. The in-memory store therefore reclaims by
itself every `sweepEvery` creates (100 by default), and drops the expired records `listByUser`
walks past. `sweep()` remains for a host that would rather schedule it — and a persistent store
with native expiry can return 0 from it and do nothing.

Writes are last-one-wins. Serialising concurrent writes to one session belongs to the caller —
a gateway knows about requests and users; a store does not.

Defaults are **30 minutes idle**, reset by every write so an active conversation never dies
under the operator, and **200 messages**, a memory guard rather than the model's context window.
Trimming keeps the newest and never leaves the history opening on an assistant turn, since a
reply whose question has been dropped reads as something the model said unprompted.

## Layout

```
index.js                   createAgent(config) — the entry point
src/                       provider (local model) · session (charter + turns) · loop (tool loop)
src/session-store.js       where conversations live; the contract Redis/SQL must satisfy
src/eval.js                the battery runner, its expectation grammar and the report
eval/battery.json          the questions themselves
eval/threads.mjs           multi-turn conversations, for what a single question cannot reach
eval/conversations.json    the operator threads that harness replays
eval/latency.mjs           where a turn's time actually goes
bin/mdk-agent.js           the CLI
bin/qvac-cache-reaper.js   KV-cache eviction; runs next to `qvac serve`
docs/CONTRACT.md           the event contract every consumer (CLI, gateway, UI) builds against
docs/TOOLS.md              the tool authoring contract MCP tools must satisfy to be shown to the model
qvac-runtime/              local-model config for `qvac serve` (qvac.config.json)
```
