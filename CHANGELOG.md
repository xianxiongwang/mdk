# Changelog: mdk-0.7.0

> For a high-level introduction, see the [release notes](./docs/reference/release-notes/0.7.0-release.md).

## v0.7.0

- Gives every plugin runtime — Gateway, MCP, and Worker — the same **per-plugin context**: plugins run together in one host process, but each imports
  its own config from the host module (`require('@tetherto/mdk-<host>/plugin')`) rather than the host passing it a `services` object — so a plugin
  sees only what the host puts in its context (breaking)
- Ships **`@tetherto/mdk-cli`**, the `mdk` command-line tool: an onboarding wizard, `create worker` / `plugin` / `dashboard` scaffolds, and `run` /
  `status` for the whole stack — `create dashboard` scaffolds a standalone Vite/React app from `examples/mdk-ui-shell-template`, and `run dashboard`
  runs it with `npm run dev`
- Ships **`@tetherto/mdk-agent`**, a conversational operator agent that runs a local model, calls fleet tools over MCP, and gates writes behind human
  approval — deployed behind the Gateway by **`@tetherto/mdk-plugin-agent`**, so enabling the agent brings its SSE (Server-Sent Events) chat API with
  it
- Separates **MDK's backend-agnostic UI core from the mining Gateway's vocabulary**: tags, selectors, query keys and the mining factories move to
  `@tetherto/mdk-ui-foundation/presets/mining`, and what remains on the root barrel is a promise that it works against any API (breaking)
- Replaces the ad-hoc session handling in the UI with a single replaceable **`AuthProvider`** seam, and makes the data source injectable so the same
  adapter hooks can drive a different backend
- Adds **`WorkerRuntimeV2`**: a Worker Plugin is now a package directory (`mdk-contract.json` + handler files) with no module to export and no
  `connect()` to call (breaking)
- Deletes the Gateway's **Kernel data proxy**: the Gateway keeps no Kernel connection of its own; its plugins talk to the Kernel and the Gateway
  aggregates what they return, and telemetry history comes from the Workers that own it (breaking)
- Adds a **performance and scalability benchmark harness** (a first pass) that boots a real multi-process fleet, drives load, runs failure drills and
  fills in the deployment sizing template from measurements

## Breaking changes

### Gateway plugins get a per-plugin context

`loadPlugin(dir, context)` gives each plugin a private module registry whereby `require('@tetherto/mdk-gateway/plugin')` resolves to that plugin's
own context. All plugins still run in the same Gateway process, but each sees only the context the Gateway hands it:

| Before | After |
|---|---|
| `module.exports = (req, services) => …` | `module.exports = (req) => …` |
| `services.conf` | `config` from `require('@tetherto/mdk-gateway/plugin')` |
| `services.mdkClient` | The plugin builds its own from `config.kernelKey` / `config.kernelBootstrap` |
| `services.dataProxy` | Removed with the data proxy |
| `services.authLib` | Removed in 0.6.0 |

The context is `{ config }`, where `config` is the Gateway conf with `kernelKey` and `kernelBootstrap` folded in, and the plugin's own config block
layered over the top key-by-key. Requiring the stub outside a plugin load throws `ERR_NO_PLUGIN_CONTEXT` with a pointer at `registerPlugin()`, rather
than leaving a handler with `undefined` where its context should be.

`@tetherto/mdk-gateway` now declares an `exports` map — `./plugin`, `./workers/lib/plugin-loader`, `./workers/lib/plugin-gateway`. Deep, relative
reaches into the package tree no longer resolve.

**Action required**: drop the second handler parameter; read `config` from the context module (the Gateway gives each plugin only the config it needs,
not blanket access to everything it holds); build your own MDK client for Kernel access (the bundled `site-monitor`, `site-hashrate`, and `telemetry`
plugins each ship a `lib/client.js` showing the pattern).

### Gateway Kernel data proxy removed

`workers/lib/data.proxy.js` — the RPC fan-out over `conf.kernels` to the legacy store nodes — is deleted, along with the shared `dataProxy`,
`isRpcMode`, and the in-process Kernel handle. The Gateway is a container that holds plugins; it no longer keeps a Kernel connection of its own. Each
plugin talks to the Kernel through its own MDK client, and the Gateway aggregates what the plugins return.

This backed a `conf.kernels` RPC plane that MDK deployments don't rely on. The telemetry itself lives in the Workers' own stores, and those history
routes are now served from there instead (see **Changed**).

### MCP plugins get a per-plugin context, and `createMcpServer` changed

`createMcpServer(root, port, config, pluginDirs)` takes `{ kernelKey, kernelBootstrap }` where it previously took a pre-built client. Each plugin
directory loads through a private module context in which `require('@tetherto/mdk-mcp/plugin')` resolves to a frozen `{ config, logger }`, and tool
handlers are plain `(args)` functions that author their own Kernel client. Shutdown no longer closes a client the server does not own.

Manifests may now declare optional `annotations` and `agent` objects per tool: `annotations` lands on the descriptor's own `annotations` field, and
`agent` is carried verbatim into the MCP descriptor's `_meta`. The loader validates their shape only — what the fields must contain belongs to the
consuming agent and is checked at admission, so the two definitions cannot drift.

**Action required**: pass the Kernel key/bootstrap instead of a client, and drop the `services` parameter from tool handlers.

### `createMdkClient` is now auto-connecting

`createMdkClient(config, opts)` takes the plugin's context config and returns a client whose methods connect on first use —
`await mdkClient.listWorkers()` just works, with no `connect()` / `ready()` step. The connect is memoized; a failure maps to `opts.errorCode` (default
`ERR_MDK_CLIENT_UNAVAILABLE`) and resets so the next request retries, which keeps a Gateway booted without a reachable Kernel serving its routes with
per-request errors rather than failing to boot.

The former function — explicit transport options, caller-owned `connect()` — is renamed **`createRawMdkClient`** and stays exported.

**Action required**: call sites that built a client with explicit transport options and connected it by hand should import `createRawMdkClient`;
everything else can drop its connect step.

### Worker Plugins are loaded from a package directory (`WorkerRuntimeV2`)

A Worker Plugin no longer exports a module. `mdk-contract.json` declares each handler by path, `src/` holds the handler modules, and the host points
the runtime at the directory:

```js
const runtime = new WorkerRuntimeV2(pkgDir, { workerId, kernelTopic, devices, env, config })
```

Each device gets its own plugin instance, so handlers are plain `(params)` functions that read `{ id, opts, env, config, workerId, logger }` from
their device context module (`require('@tetherto/mdk-worker/device')`) instead of taking a `ctx` argument. One HRPC server and one DHT identity per
process, as before; what fans out per device is the plugin's module registry.

Two behaviour differences from `WorkerRuntime`: there is no boot-time probe, so every declared device reports `online` and an unreachable one surfaces
as an error inside the telemetry payload rather than `ERR_DEVICE_UNAVAILABLE`; and there is no `disconnect`, so whatever a plugin opens at load time
lives until the process exits.

`WorkerRuntime` (v1) is unchanged and still exported — `WorkerRuntimeV2` extends it. New exports from `@tetherto/mdk-worker`: `WorkerRuntimeV2`,
`loadContract`, `createInstance`, `createModuleContext`.

The bundled sample Worker was restructured onto this model: `plugin/index.js`, `plugin/lib/device-client.js` and the `plugin/src/**` tree are gone,
replaced by a top-level `mdk-contract.json` and `src/{client,db,commands,telemetry}`. `@tetherto/mdk-worker-demo` therefore no longer exports `plugin`
or `openDb`, and its host no longer runs a sampler loop or owns a SQLite handle.

**Note**: `docs/guides/workers/build-a-worker.md` still documents the older model and now carries a warning saying so. Read the sample Worker and its
caller for the current shape.

### UI — the mining dialect, key registry and factories move to a preset

`@tetherto/mdk-ui-foundation` no longer exports one backend's vocabulary from its root or `./query` barrels. Everything specific to the mining Gateway
is reachable at the new **`@tetherto/mdk-ui-foundation/presets/mining`** subpath:

| Moved | Examples |
|---|---|
| Dialect | `t-*` device-tag helpers, `*_aggr` aggregate field names, `*_FIELDS` projections, Mongo selector composers, alert/dashboard mappers, container-tab and container-widget derivations |
| Query keys | `queryKeys`, `QueryKeyMap` |
| Factories | every read/write factory in `factories.ts` and `pool-factories.ts`, including `tailLogQuery`, `authTokenMutation` and the pool voting/approval writes |
| Gateway session flow | `gatewayRedirectAuth` |

What stays in the core is the engine: the client factory, the runtime it carries, the resource builders, the transport and the URL helpers.
`API_ENDPOINTS` deliberately stays too — it is the bundled default map the core falls back to, so a consumer must be able to read it and override it
selectively.

**Action required**: repoint imports of any moved name to `@tetherto/mdk-ui-foundation/presets/mining`. Nothing was renamed and no signature changed,
so the fix is the specifier only.

### UI — `Alerts` and `CurrentAlerts` take a flat row list

`Alerts.devices`, `CurrentAlerts.devices`, `getAlertsForDevices` and `getCurrentAlerts` take `Device[]` where they took `Device[][]`, and
`useCurrentAlertDevices` resolves a flat `ListThingsDevice[]` instead of the raw per-Kernel envelope.

The prop was the mining Gateway's nested response envelope, so a consumer on another backend had to wrap their rows in an extra array to satisfy a
component that renders a table. Unwrapping now happens once, in the data layer, where the envelope is known about.

**Action required**: pass rows straight through instead of wrapping them; each row carries its alerts at `last.alerts`.

### UI — header preference keys and `SiteMinerStats` field renamed

The legacy reference-app codename is gone from the public UI surface.

| Type | Before | After |
|---|---|---|
| `HeaderPreferences` (and `DEFAULT_HEADER_PREFERENCES`, `HEADER_ITEMS`) | `mosMiners`, `mosHashrate` | `appMiners`, `appHashrate` |
| `SiteMinerStats` | `mosTotal` | `appTotal` |

Stored preferences are now merged over the defaults, so a persisted object written under the old keys falls back to the default value rather than
leaving the renamed toggles `undefined`.

`WEBAPP_NAME`, `WEBAPP_SHORT_NAME` and `WEBAPP_DISPLAY_NAME` now originate in `@tetherto/mdk-ui-foundation` (`constants/app-constants.ts`) and are
re-exported by `@tetherto/mdk-react-devkit`, so a rebrand changes three values in one place.

### UI — `VITE_API_BASE_URL` deprecated in favour of `VITE_MDK_API_URL`

The same value had two names that worked in different layers: the shell template read `VITE_API_BASE_URL`, while `resolveApiBaseUrl` only ever looked
at `VITE_MDK_API_URL` — so setting either one worked in one place and silently did nothing in the other.

`VITE_MDK_API_URL` / `MDK_API_URL` is now the canonical pair, exported as `API_BASE_URL_ENV` so nothing has to hardcode the string.
`VITE_API_BASE_URL` / `API_BASE_URL` are still read for one more major and warn once per process, naming their replacement. The `VITE_MDK_` prefix
matters: a host app very often has its own `API_BASE_URL`, and MDK silently reading that is a hard bug to see.

`VITE_OAUTH_BASE_URL` is unchanged — it names a different value and has only ever had one name.

## Added

### `@tetherto/mdk-cli` — the `mdk` command-line tool

New package at `packages/cli/`, exposing an `mdk` binary. The full command tree is wired up; the lifecycle spine is implemented and the remaining
commands mark themselves `(stub)` in help.

| Group | Commands |
|---|---|
| Onboarding | `mdk onboard` — a guided wizard that detects the environment, asks the setup questions, and writes `mdk.yaml`, the root `package.json`, `.gitignore` and a project `README.md` |
| Scaffold | `mdk create worker <name>`, `mdk create plugin <name>`, `mdk create dashboard [name]` — each self-registering in the spec |
| Run & manage | `mdk run [target] [name]`, `mdk status`; `mdk get` / `describe` / `logs` are stubs |
| Discover | `mdk discover` (stub) |
| Agent enablement | `mdk skill add`; `mdk mcp register` (stub) |
| Meta | `mdk version`; `mdk manifest` (stub) |

A project is one role-grouped layout — `workers/<name>/` for Worker plugins, `plugins/<name>/` for gateway plugins, `apps/dashboard/` for the UI, and
a disposable `.mdk/` holding each component's data root plus the two cross-process handoff artifacts (`kernel.key`, `keys/`). Workers and gateway
plugins are npm workspaces because the runtime resolves them out of the project's `node_modules`; `apps/*` deliberately is not, so the dashboard's
React is never hoisted alongside the `file:`-linked MDK packages.

Notable behaviour:

- **`mdk run`** boots the Kernel, every Worker and the Gateway in one process by default, or one component at a time. It owns Ctrl+C and `SIGTERM`,
  stops components in reverse boot order, and exits regardless of how that goes — a stop that throws is skipped, a stop that wedges is abandoned after
  5s, and a second Ctrl+C exits immediately, so a run always releases its ports. `mdk run dashboard` starts the scaffolded UI's dev server as its own
  child process.
- **Mock ports are resolved at boot.** A configured port is used when free and relocated to the next free one when not, since it is a private contract
  between a simulator and the plugin that dials it. The Gateway port is never relocated — it is a published endpoint, so a conflict there fails fast
  before anything boots. Scaffolded Workers get a stack-unique port and device id, and `mdk run` rejects a spec that repeats a Worker name or device
  id, naming both offenders.
- **Gateway plugins install from a catalog with setup questions.** A plugin manifest's `setup` block drives typed questions (`string` / `secret` /
  `boolean` / `json`) asked up front, and the answers land under that plugin's `spec.gateway.plugins[].config` in `mdk.yaml`.
- **`mdk status`** is a one-shot read-only report covering the environment (Node version, package manager, `mdk.yaml` validity, package resolution)
  and the stack (Kernel, Gateway, each Worker with state, health and device count). Liveness is probed over HRPC and HTTP, never inferred from files,
  since the key files survive a shutdown by design. Exit codes make it scriptable: `0` healthy, `2` usage error, `4` precondition not met, `5` stack
  not fully up.
- **`mdk create dashboard`** scaffolds the UI shell from `examples/mdk-ui-shell-template` — copied locally inside the monorepo with MDK deps rewritten
  to workspace links, or downloaded from GitHub and pinned to a published range when standalone.

Bundled templates for `create worker` and `create plugin` ship in the package. Test suites cover the commands and libraries.

### `@tetherto/mdk-agent` — conversational operator agent

New package at `backend/core/agent/`: a library plus CLI that answers plain-language questions about a fleet. It runs a **local** model and calls MDK
fleet tools **over MCP** — the model routes and narrates, the tools compute, and nothing leaves the machine. Write actions stop and ask for human
approval.

| Piece | Description |
|---|---|
| `createAgent(config)` | Entry point; takes a provider, an optional MCP connection and an optional session store |
| `docs/CONTRACT.md` | The stable event contract every consumer (CLI, gateway, UI) builds against |
| `docs/TOOLS.md` | The tool-authoring contract an MCP tool must satisfy to be shown to the model |
| `bin/mdk-agent.js` | REPL and eval-battery runner |
| `bin/qvac-cache-reaper.js` | TTL eviction for the model server's KV cache, run beside the server |

**The tool authoring contract.** A tool is reliable for a small model only if the model never has to compute, classify or invent a value.
`validateTool` / `admitTools` make that checkable: a closed `verb_entity` taxonomy, parameters restricted to enums, bounded integers or id references,
routing metadata the model matches operator phrasings against, and a declared capability floor so a tool is withheld from a model too weak to use it.
Validation never throws and admission reports why a tool was skipped, so one non-compliant tool cannot take down the rest. The contract travels in the
MCP descriptor's `_meta`, because the SDK parses `annotations` with a closed schema and a client silently drops unknown keys there.

**Sessions live in a store.** A `SessionStore` interface a Redis or SQL implementation can satisfy, with a documented contract: every method async;
records handed out are copies; an expired session is indistinguishable from one that never existed, from `get` and `delete` alike, while `save`
against an expired id fails with `code: 'SESSION_GONE'`; and expiry is lazy on read, so correctness never depends on `sweep()` having run. Left
unconfigured the agent creates a `MemorySessionStore`. `resumeSession(id, { userId })` requires the caller's user id and has no default — a session id
travels in URLs an operator can see, so an id alone is not authority to read the conversation behind it.

**Measurement is part of the package.** An eval battery scores routing, the answer, the result contract and the approval gate on each question,
reading its expectations from the live fleet at run time so it works against any site. Separate runners cover multi-turn conversations (pronouns,
back-references, an action following a question, drifting out of scope) and per-turn latency; the conversation runner flags device ids an answer names
that the turn's tools never returned — a concrete hallucination check.

### `@tetherto/mdk-plugin-agent` — the agent behind the Gateway

New plugin at `backend/plugins/agent/` — the deployment path that mounts `@tetherto/mdk-agent` behind the Gateway as a chat API. It isn't a separate
product to adopt: enabling the agent brings these routes with it.

| Route | Method + path | Notes |
|---|---|---|
| `agent.session.create` | `POST /agent/sessions` | |
| `agent.session.message` | `POST /agent/sessions/:id/messages` | `text/event-stream`; events carry `turnId`, `seq`, and `approvalId` on `pending_approval` |
| `agent.approval.decide` | `POST /agent/sessions/:id/approvals/:approvalId` | Fail-safe timeout resolves to reject |
| `agent.session.delete` | `DELETE /agent/sessions/:id` | |

Its manifest `setup` block asks for the model provider and the approval timeout, so the CLI can configure it at onboarding. The plugin runs without
auth: when no auth plugin stamps the request, the Gateway serves a single `local` operator, so a perimeter-trusted deployment gets the full chat and
approval flow. A missing `config.agent` block answers `503 ERR_AGENT_UNAVAILABLE` per request rather than failing to load.

### Gateway — auto-generated MCP tools, stream routes, per-plugin config

- **Auto-generated MCP tools.** Exposing a plugin's HTTP routes to the agent used to mean hand-building a matching MCP tool per endpoint — duplicated
  effort against a route that already exists. Now an `extraPluginDirs` entry may be `{ dir, autoGenerateMcp: true }` instead of a plain path, which
  exposes that plugin's HTTP routes as MCP tools with no separate manifest. Each route becomes a tool named after its `id` (non-alphanumerics become
  underscores), with description, safety hint and input schema derived from the route's `http` block: path, query and header parameters plus the
  `requestBody`'s top-level properties become input fields, and the same bound handler serves both interfaces. The Gateway starts one in-process MCP
  server (Streamable HTTP, default port `opts.port + 100`) covering every auto-generated tool; configure it with `opts.mcp`.
- **Stream routes.** A route declaring `stream: true` owns the raw `ServerResponse` — the reply is hijacked so Fastify never serializes it. The
  boundary catch maps a pre-header throw to a JSON error carrying `err.statusCode`, while a mid-stream throw ends the socket instead of leaving it
  open.
- **Per-plugin config.** A stack spec can carry a `config` block per plugin (`spec.gateway.plugins[].config`); it is spread over the Gateway conf in
  that plugin's context, so a plugin's settings live with the plugin.
- `onError` now carries the handler's `statusCode` instead of flattening everything to 400.

### Worker — built-in `health` telemetry channel, Worker-scoped telemetry pulls

- Every device instance under `WorkerRuntimeV2` gets a `health` telemetry channel registered automatically, answering
  `TELEMETRY_PULL { query: { type: 'health' } }` with no contract changes. It routes through the same dispatch as any declared channel, and a contract
  that declares its own `health` channel wins.
- **`pullWorkerTelemetry(workerId, query)`** (`@tetherto/mdk-client`) resolves the Worker key from the registry and pulls telemetry Worker-direct over
  a short-lived client — the path for Worker-infra queries (`logs`, `logs_multi`, `list`, `stats`, `ext_data`) that aggregate over a Worker's own
  store rather than one device. It resolves with the bare payload, like the Kernel-side helpers.

### UI — the authentication seam

`AuthProvider` gathers into one replaceable object the four places that each reached for the same singleton: the QueryClient's 401 handling, the
transport's token read, the refresh cadence, and the host app's `?authToken=` capture.

| Export | From | Role |
|---|---|---|
| `AuthProvider`, `AuthTokenStore` | root, `./auth` | The seam itself; only `getToken` and `signOut` are required |
| `bearerTokenAuth()` | root, `./auth` | Generic default — bearer token in `authStore`, 401 ends the session |
| `noAuth()` | root, `./auth` | For an open API or a fixture-backed demo |
| `applySession`, `isSessionExpiredError`, `SESSION_EXPIRED_STATUS` | root, `./auth` | Shared session helpers |
| `gatewayRedirectAuth(options)` | `./presets/mining` | The mining Gateway flow: Google redirect, `?authToken=` capture and scrub, 250 s token refresh, role parsing |

`MdkProvider` gains `auth`, `endpoints`, `fetcher` and `onSessionExpired` props, runs `bootstrap()` before children render (so no route guard sees a
tokenless first paint), and publishes the provider through the new **`useMdkAuth()`** hook, which also works outside a provider.

### UI — declarative resources and an injectable data source

- **`createResourceQuery` / `createResourceMutation`** turn an endpoint plus a few mapping rules into a factory, with URL assembly, param
  serialisation, path encoding, abort-signal threading and transport selection all coming from the client's runtime. Most of the mining mutations (all
  but one) are converted onto it with signatures unchanged.
- **`createMdkQueryClient({ apiBaseUrl, endpoints, fetcher })`** repoints the same mining factories, and the adapter hooks above them, at another API.
  Mining stays the default and produces byte-identical URLs.
- New `query/runtime.ts` holds the domain-agnostic engine — `Fetcher`, `EndpointMap`, `MdkRuntime`, `resolvePath`, `buildUrl`, `appendQuery`,
  `createGetQueryFn`, and the readers that pull the runtime back off the `QueryClient`'s `meta`. Endpoints are `:name` path templates: `resolvePath`
  encodes every value and throws on a missing segment, where the four dynamic paths were previously string-concatenated at their call sites with
  encoding left to each caller.
- **`resourceKey(name, params?, scope?)`** is the generic key convention for resources declared this way; the mining preset keeps its hand-written
  keys, which mirror Gateway URL paths and decide what an invalidation reaches.
- **`AuthProvider`-aware exports** `API_BASE_URL_ENV` and `DEPRECATED_API_BASE_URL_ENV` so nothing hardcodes an env var name.

### UI — the bring-your-own-backend proof, and two new gates

- **A catalog page driven by a non-mining API.** `DataTable`, `LineChartCard` and `Alerts` are fed over a real HTTP GET from a response with nothing
  in common with the mining Gateway — a `page` envelope, `records[]` instead of a per-node array-of-arrays, nested `health.notices[]` instead of
  `last.alerts[]`, `atMs`/`value` samples, severities on a `level` field — using plain TanStack `useQuery`. The entire integration surface is ~40
  lines of pure mapping in `fleet-adapter.ts`: no `createMdkQueryClient`, no endpoint map, no adapter hook, no preset import.
- **`npm run check:byob`** walks that directory and fails on any import from `@tetherto/mdk-react-adapter` or `@tetherto/mdk-ui-foundation`, and fails
  if the directory disappears, so the "works with any backend" claim can't silently rot.
- **`npm run check:api-surface`** reads the built `.d.ts` for every subpath in `ui-foundation` and `react-adapter`'s `exports` maps and diffs the
  exported names against committed baselines in `ui/api-surface/`. Removals and kind changes are reported as breaking, additions as additive, and both
  fail the gate, so a moving surface stays a deliberate choice; `-- --update` accepts a change and the baseline diff becomes the record of what a
  release breaks.

Both are wired into `npm run fullcheck`.

### Performance and scalability benchmark harness

New at `backend/tests/benchmark/` — a first-pass performance and scalability harness — filling in the new
`docs/guides/deployment/capacity-metrics-template.md` from measured runs instead of by hand. It boots real Kernel, Gateway, Worker and mock-device
processes — every role its own OS process, as under a real deployment, never blended into one Node process — drives read/action/Gateway-request load,
samples CPU/RSS/open-FDs per process, runs failure drills (Worker restart, Kernel restart, a fleet-wide unreachable-device outage), and writes a
filled profile (JSON + Markdown) per run plus a comparison matrix across a sweep.

A single JSON config declares the fleet; `npm run benchmark` sweeps the Cartesian product of every family's device-count range, lowest total first,
stopping at the first combination that goes red. A fast 5-device correctness check is wired into `npm test`. Generated Markdown mirrors the template's
own headings and table shapes, using the template's `_` placeholder wherever the harness has no measurement.

### Elsewhere

- **`packages/` is its own npm workspace root** (`@tetherto/mdk-packages`), so the CLI and the skill suite can depend on each other locally and be
  published individually. It includes `backend/core/{client,mdk,mdk-worker}` as workspace members.
- **`@tetherto/mdk-skill` gained a programmatic entry point** — `installSkills()`, `assemble()`, `canAssemble()`, `isAssembled()`, `CLIENT_DIRS` —
  which is how `mdk skill add` resolves and installs the suite without path walking. A new **`mdk-gateway-plugin`** skill ships with
  `plugin-authoring` and `controller-patterns` references, and `mdk-ui-component` gained a `page-recipe` reference and a `ui-registry.json`.
- **Shell template**: `src/constants/permissions.ts` — a worked example of a permission policy, built from `USER_ROLE` / `AUTH_PERMISSIONS` /
  `AUTH_LEVELS`, plugged in through the provider's `getPermissions` seam. Plus `VITE_AUTH_BYPASS` (dev-only: skips the sign-in gate, seeds a stub
  token and disables refresh polling, so the shell runs with no OAuth backend) and `VITE_GATEWAY_URL` (what the Vite dev server proxies to, set by
  `mdk create dashboard` from the stack's Gateway port).
- **Hook contract tests**: a provider-backed `mdk-harness` plus contract suites in `react-adapter` that assert on the transport rather than on
  internals, so a hook may change how it fetches and still satisfy the contract.
- **`useNominalConfig`** and its `NominalConfig` type are exported through the `react-adapter` hooks barrel.

## Changed

- **Built-in Gateway plugins moved onto the per-plugin context.** `telemetry` reads its data access from the plugin module; `site-monitor` and
  `site-hashrate` author their own Kernel client in `lib/client.js` from `config.kernelKey` / `config.kernelBootstrap`, connecting lazily so a missing
  Kernel still degrades to `ERR_KERNEL_CLIENT_NOT_CONNECTED` / `ERR_MDK_CLIENT_UNAVAILABLE` per request. The bundled `auth` plugin is left unmigrated
  — it needs `ctx.authLib`, which no runtime supplies.
- **Telemetry history is sourced from the Workers.** The history routes read from the legacy store nodes over `conf.kernels` RPC, a plane MDK
  deployments don't rely on; the Kernel intentionally stores no telemetry. A plugin-local `site-data` module keeps the controllers' `requestData`
  surface and fans `telemetry.pull` Worker-infra queries across the registry via the plugin's own client. The Workers' `tailLog` speaks the same
  key/tag/range/`groupRange` vocabulary the store did, and store-era `<field>_aggr` names are aliased onto the Workers' base stat fields — one
  aggregation level now, same numbers. Workers without the queried bee answer error payloads and are skipped; an unreachable Kernel degrades to the
  routes' zero shapes.
- **The example site's MCP plugin follows the agent tool contract.** Six tools — `summarize_site`, `count_devices`, `list_devices`, `get_device`,
  `rank_devices`, `act_device` — with closed enums over shared axis vocabularies, device references, bounded limits with defaults, summary-first
  results, and `readOnlyHint` annotations. `act_device` validates the requested mode against the device before dispatch. The earlier hand-rolled tool
  set is replaced, and the example's HTTP plugin can now auto-generate its MCP surface instead.
- **Mock data scales with the seeded fleet.** The example site sizes its power-meter reading off the actual seeded miner count rather than a flat
  number, and the pool and temperature mocks derive their state from the device count instead of fixed values.
- **The skill suite was renamed and re-scoped**: `mdk-device-worker` → **`mdk-worker-plugin`** (references, assets and scripts move with it), and
  `mdk-app-plugin` is replaced by the fuller `mdk-gateway-plugin`.
- **`@tetherto/mdk-agent` joined `install-packages.sh`**, so a core install covers it.
- **Comment and documentation sweep**: residual references to the legacy reference-app codename in comments, SCSS notes, USAGE docs and guides are
  replaced with neutral wording. No runtime behaviour changes.
- **Link checking treats `401` as reachable** (`warn`, alongside `403` and `429`) — the server answered, so the link is not broken; auth-walled pages
  401 the unauthenticated CI crawler. Each status code now carries an inline rationale.
- **Dependency changes**: `@modelcontextprotocol/sdk` `^1.29.0` → `^1.30.0`, plus `zod` `^4` and `@tetherto/mdk-worker` added to `@tetherto/mdk-mcp`;
  `@tetherto/mdk-gateway` drops its direct `@tetherto/mdk-client` dependency and adds `@tetherto/mdk-mcp` and `@tetherto/mdk-worker`.

## Removed

- **The Gateway's Kernel data proxy** — `workers/lib/data.proxy.js`, the shared `dataProxy`, `isRpcMode`, the in-process Kernel handle, and the
  `conf.kernels` fan-out, plus their unit suite
- **The sample Worker's `plugin/` module tree** — `index.js`, `lib/device-client.js` and `src/**` — superseded by the contract-plus-`src/` directory
  layout, along with the caller's sampler loop and SQLite handle
- **The `mdk-app-plugin` skill**, superseded by `mdk-gateway-plugin`
- Four dead placeholder query factories (`authQuery`, `devicesQuery`, `deviceQuery`, `telemetryQuery`) and the bare-`Error` `defaultFetcher` that was
  their only user, plus the duplicate `appendQuery` / `appendCommaQuery` serialisers, collapsed into one
- `Session.warmup` in the agent, which prefilled a prompt prefix no real turn ever sends verbatim — it cost a model call per session and could never
  hit the cache

## Security

- **`brace-expansion` raised to `>= 5.0.9`.** The tree already pinned `>= 5.0.7`, which satisfied the advisory fixed in 5.0.8 — but a second advisory
  bypasses that mitigation and needs `>= 5.0.9`. The three override selectors move to `>= 5.0.9`, and the `<5.0.7` selector widens to `<5.0.9` so the
  5.0.7 and 5.0.8 copies already in the tree are caught. Everything now dedupes to a single 5.0.9.
- **`undici` and `fast-uri` high advisories cleared.** Both resolved from the existing overrides once the lockfile was regenerated; the `fast-uri`
  selectors are now split per major (`>=3.0.0 <3.1.5` → `3.1.5`, `>=4.0.0 <4.1.2` → `4.1.2`) and applied consistently across the root, `ui/`, the
  Gateway and the MCP server.
- **`js-yaml` pinned to `4.3.1`** in the root and `ui/` overrides, replacing the open `>=4.3.1 <5.0.0` range that let a fresh install drift.
- **`@hono/node-server` pinned to `2.0.12`** in the root overrides, matching the MCP server's own pin.
- A dependency-audit sweep regenerated every backend package lockfile against these overrides.

Note that the UI audit job runs on pull requests only, so the default branch is never audited and an advisory published mid-cycle surfaces on every
open PR at once rather than on the branch that introduced it.

## Fixed

- **Dashboard read hooks fetched while signed out.** They passed no `enabled`, unlike the rest, so they fired on mount with no token — and since the
  Gateway answers 401, the QueryClient's session guard read that as "the session ended", cleared the auth store and fired `onSessionExpired`. A
  dashboard mounting before sign-in completed could therefore bounce the user out of the sign-in flow they were halfway through. Gated:
  `useActiveIncidents`, `useConsumptionChartData`, `useHashrateChartData` (both queries), `usePoolRows`, `usePoolStats`, `usePowerModeTimelineData`,
  `useSiteConsumptionChartData`, `useSiteContainerCapacity`, `useSiteHashrate`, `useSiteMinerCounts`, `useSiteMinerStats`, `useSitePowerMeter`, each
  also gaining the `enabled?: boolean` option the others already carried.
- **List hooks returned rows from only the first responding Kernel.** They used `headOrEmpty` where their siblings used `flattenKernelEnvelope`, so a
  rack-sharded deployment silently lost every node after the first. Now flattened: `useActiveIncidents`, `useContainerUnits`, `useMinerDevices`,
  `usePoolManagerDashboard` (two sites), `useSiteMinerCounts`, `useSitePowerMeter`. The same first-node-only truncation inside `getAlertsForDevices`
  is fixed by the flat alerts contract above.
- **`flattenKernelEnvelope` threw on a non-array body.** It did `(envelope ?? []).filter(...)`, so an error envelope or a bare object reached
  `.filter` and threw where `headOrEmpty` returned `[]`. It now checks `Array.isArray` at both levels and returns `[]` for anything it cannot walk.
- **Two hooks passed a non-array payload straight through.** `data ?? []` only covers null and undefined, so an object arrived under a key typed as a
  row array and any component mapping over it threw. `useContainerPoolStats` and `usePoolConfigsData` now guard with `Array.isArray`.
- **`site-hashrate` read `.payload` off MDK client results**, which resolve with the bare payload.
- **The agent re-serialised assistant turns when replaying history**, so the conversation it sent differed from what the model produced and missed the
  model server's KV cache entirely — a verbatim replay costs 44% of a cold call, a re-serialised one 101%. Measured about 22% faster end to end, with
  routing and answers unchanged. The rejected-approval path replayed the same way and is fixed with it.
- **An agent turn was persisted only after the consumer drained the generator**, so a request whose client disconnected mid-stream lost the turn that
  had actually happened. The write moves into a `finally`, and both turn generators settle history in a `finally` of their own.
- **The agent decided a session record was gone by matching the store's error message**, making the wording an undocumented part of the interface — a
  persistent implementation phrasing it differently would retry an unlandable write every turn for the life of the session. `save` now throws
  `code: 'SESSION_GONE'`. Alongside it: `/new` no longer reports "could not reset" on a gone record and then work on the second attempt; `delete` no
  longer answers `true` for an expired record that `get` reports as never having existed, which made it an oracle for ids the null-for-both rule
  withholds; and a mistyped REPL command is rejected against the banner's own command list instead of being sent to the model as a question.
- **`renderTools` rejected an unadmitted tool by failing on a missing field.** `notFor` is optional for the author and filled in by admission, so a
  raw tool reached the renderer and surfaced as a property read on `undefined`; the guard now checks the block is normalised and names the contract.
- **The devkit's `LineChartCard` example built its x-axis in seconds** while `LineChart` divides by 1000 itself, so every point landed in January
  1970. The unit is now documented on the data type.
- **The UI CLI served a stale build after a template edit.** Its inputs live outside the turbo root, so no `inputs` glob could reach them and a cached
  build bundled an old template; `@tetherto/mdk-ui-cli#build` now sets `"cache": false`.
- **The scaffolded Dashboard page was missing its generated marker**, and nested shipped source under `presets/` was emitted with an unrewritten `@/`
  alias that no consumer could resolve — an ESLint override now exempts that tree from the alias rule.

> For previous releases, see the [changelog archive](./docs/reference/changelog-archive/2026-archive.md)
