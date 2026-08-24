# A single source of truth vision

## TL;DR

1. UI manifests:
cd ui && npm run build:registry

2. Worker hardware catalogue:
cd backend/workers && npm run generate:catalogue

3. Gateway plugin reference:
cd backend/core/plugins && npm run generate:plugin-reference

4. Porting pages to user docs: requires [port signal](#port-signals) on source page and access to private repo.

## Overview

This monorepo attempts to enforce a single source of truth vision. With GHFM, this is challenging, but there are steps that
can be taken to move the docs in this direction.

What is easier is to ensure that the user docs [https://docs.mdk.tether.io/](https://docs.mdk.tether.io/), consume this monorepo's 
data rather than risk drift between the two sites.

This page lists the strategies that are in place to enforce a single source of truth philosophy.

1. [Port signals](#port-signals): Entire pages are given porting signals in this repo and a script is available for maintainers to sync the monorepo docs with the user docs.

2. [UI manifests](#ui-manifests): The UI packages generate machine-readable manifests from JSDoc tags and USAGE.md files.

3. [Generation scripts](#generation-scripts): Several scripts read source-of-truth files (mdk-contract.json, mdk-plugin.json, JSDoc) and regenerate documentation so it never drifts from the code.

## Port signals

Authoring conventions for the comment-driven hints that travel with Markdown in this monorepo and drive the future port pipeline to [https://docs.mdk.tether.io/](https://docs.mdk.tether.io/).

This file is the source-of-truth for that vocabulary. Two consumers read it:

- The `check:port-signals` lint gate (see [`ia.md`](ia.md#qa-gates)) — runs in mdk-prv pre-commit / CI and warns when a non-anchor link definition has no routing comment.
- The port-sync transforms in the downstream fumadocs build — rewrite link targets and convert GFM alerts to `<Callout>` JSX on port.

Authoring rule: add the appropriate comment beside each cross-reference or alert. Authors do not need to read this file to write user-facing prose; the only time you need it is when adding a new `[slug]: …` definition or callout block.

### Link slug routing

Reference-style link definitions in `## Links` blocks (or anywhere in Markdown) carry an adjacent HTML comment that tells the port pipeline how to handle the target:

| Comment on the lines immediately below `[slug]: …` | Pipeline action |
|---|---|
| `<!-- docs@tether.io: <slug> → <upstream-path> -->` | Rewrite target to the upstream docs path on tether.io |
| `<!-- docs@tether.io: external link — preserve URL -->` | Keep the URL verbatim (non-Tether external URL) |
| `<!-- docs@tether.io: no parity link -->` | Drop the link; render anchor text as plain text and emit a build warning |
| `<!-- mdk-monorepo: <note> -->` | Internal-only flag (e.g. temp link awaiting a code/README destination); pipeline ignores entirely |
| _(no comment) on `[slug]: #anchor`_ | In-page anchor — preserve verbatim alongside the parent page-to-page mapping |

A non-anchor link definition with **no signal at all** is a pipeline error: the slug has no routing rule. The `check:port-signals` lint gate catches this in mdk-prv before it reaches the port-sync.

A definition may carry **multiple comment lines** (e.g. one `docs@tether.io:` and one `mdk-monorepo:`) — each is read independently.

#### Examples

Outbound mapping to an upstream docs page:

```markdown
[architecture]: ../architecture.md
<!-- docs@tether.io: architecture → concepts/architecture -->
```

Preserving a non-Tether external URL:

```markdown
[hypercore]: https://github.com/holepunchto/hypercore
<!-- docs@tether.io: external link — preserve URL -->
```

Monorepo source file — local relative path for IDE navigation, GitHub URL on port:

```markdown
[kernel-package]: ../../backend/core/kernel/index.js
<!-- docs@tether.io: kernel-package → https://github.com/tetherto/mdk/blob/main/backend/core/kernel/index.js -->
```

Engineer-facing code link with no upstream parity:

```markdown
[envelope-impl]: ../../backend/core/kernel/lib/protocol/envelope.js
<!-- docs@tether.io: no parity link -->
```

Code link with a temp flag (target not yet populated):

```markdown
[client-package]: ../../backend/core/client/
<!-- docs@tether.io: no parity link -->
<!-- mdk-monorepo: temp — backend/core/client/ is empty (.gitkeep only) until the SDK port lands -->
```

In-page anchor (uncommented by design):

```markdown
[architecture-section]: #the-kernel
```

### GFM alert → fumadocs `<Callout>`

GitHub renders `> [!TYPE]` blockquote alerts natively; fumadocs uses `<Callout type="…">` JSX. Source files in mdk-prv use GFM so they read correctly on GitHub; the port-sync maps:

| GFM source (mdk-prv) | Fumadocs output (tether.io) |
|---|---|
| `> [!NOTE]`      | `<Callout type="info">`    |
| `> [!TIP]`       | `<Callout type="idea">`    |
| `> [!IMPORTANT]` | `<Callout type="warn">`    |
| `> [!WARNING]`   | `<Callout type="warning">` |
| `> [!CAUTION]`   | `<Callout type="error">`   |

Fumadocs also ships `<Callout type="success">`, which has no GFM equivalent. When an author needs `success` (or wants to override a default mapping for a single block), drop an override comment immediately above the alert:

```markdown
<!-- callout: success -->
> [!NOTE]
> Deployment finished cleanly.
```

The port-sync reads `<!-- callout: <type> -->` directly above `> [!TYPE]` and uses that type instead of the default mapping. Without an override, the table applies. The override comment is invisible on GitHub (HTML comments do not render) so authoring stays GitHub-native.

## UI manifests

Maintainer-facing guide to the UI manifest generation system. For the **agent/consumer** perspective (what the manifests contain, how to query them), read [`ui/AGENTS.md`](../../../ui/AGENTS.md) first. This file covers only the **maintainer workflow** — what gets committed vs. generated, when to regenerate, and how to verify the contract holds.

### What ships vs. what's tracked

The UI packages ship four machine-readable manifests under `dist/`:

| Manifest | Package | What it describes |
|----------|---------|-------------------|
| `registry.json` | `@tetherto/mdk-react-devkit` | Every public component + hook (props, JSDoc, tier, indexes) |
| `blueprints.json` | `@tetherto/mdk-react-devkit` | Intent → recipe map (markdown body included) |
| `hooks.json` | `@tetherto/mdk-react-adapter` | React hooks (store / utility / permission / ui / external) + provider |
| `stores.json` | `@tetherto/mdk-ui-foundation` | Zustand stores (state + actions) and TanStack Query helpers |

See [`ui/AGENTS.md`](../../../ui/AGENTS.md#machine-readable-artifacts) for the full table with subpath imports and CLI commands.

**These are build artifacts, not source files.** The `ui/packages/*/dist/` directories are gitignored — manifests are generated from source on every `npm run build` and never committed to version control. They **are** included in the published npm packages so consumers get manifests that match the installed version.

**Source of truth:**

- `registry.json` / `blueprints.json` — read from JSDoc tags (`@tier`, `@category`, `@domain`, `@kernelCapability`) in component source files, plus co-located `USAGE.md` and `*.example.tsx` files. See the export contract at [`ui/packages/react-devkit/AGENT_READY.md`](../../../ui/packages/react-devkit/AGENT_READY.md).
- `hooks.json` — read from JSDoc in [`ui/packages/react-adapter/src/`](../../../ui/packages/react-adapter/src/index.ts) hooks.
- `stores.json` — read from JSDoc in [`ui/packages/ui-foundation/src/`](../../../ui/packages/ui-foundation/src/index.ts) stores.

### When to regenerate

Manifests regenerate automatically as part of `npm run build` in the [`ui/`](../../../ui/README.md) workspace. Turbo's task graph runs `build:registry` as the final step of each package's build, after TypeScript compilation and SCSS bundling complete.

As a maintainter, **you can manually regenerate** before syncing with the user docs.

```bash
cd ui
npm run build:registry
```

To regenerate **and** verify the agent-ready contract holds:

```bash
cd ui
npm run check:agent-ready --workspace @tetherto/mdk-react-devkit
```

This is the same gate that runs in CI on every PR touching [`ui/packages/react-devkit`](../../../ui/packages/react-devkit/README.md). See [`ui/packages/react-devkit/AGENT_READY.md`](../../../ui/packages/react-devkit/AGENT_READY.md) for the rules it enforces.

### Socket Firewall note

If your shell routes `npm` through Socket Firewall (`sfw`) and `npm run build:registry` hangs, you may need to source the repo's allowlist. The build process itself doesn't make outbound requests, but if you're running a broader `npm run build` (which includes dev tooling like linkinator during checks), socket.dev will block unrecognized hosts.

Setup instructions: [`linters.md § Nightly and PR diff link verification — linkinator`](linters.md#nightly-and-pr-diff-link-verification--linkinator) (lines 16–28). The same [`scripts/sfw-env.sh`](../../../scripts/sfw-env.sh) allowlist applies.

### PR workflow

When a PR changes component source files (adds JSDoc tags, modifies props, updates `USAGE.md`), the manifests will reflect those changes the next time someone runs `npm run build` — locally or in CI.

**Do not commit `dist/*.json` files.** They're gitignored for a reason: committing them creates merge conflicts and drift. CI rebuilds the manifests fresh on every run, and published packages include the build output automatically.

The IA system described in [`ia.md`](ia.md) references these manifests as the source of truth for UI component tiers, categories, domains, and Kernel capabilities. The proposed `check:facets-fresh` gate (see [`ia.md § QA gates`](ia.md#qa-gates)) would read `dist/registry.json` and emit `dist/facets.json` for catalogue membership.

Until that gate lands (if it lands — adoption is engineering's call), docs maintainers track new agent-ready components manually during IA audits.

## Generation scripts

The repo includes several scripts that regenerate documentation from engineering source-of-truth files. Each reads contract manifests or code annotations and produces markdown tables or manifest files, ensuring the docs never drift from what ships.

### Worker hardware catalogue

Generates the supported hardware tables from Worker contract files.

**Source:** `backend/workers/**/mdk-contract.json` (validated against [`backend/core/mdk-worker/mdk-contract.schema.json`](../../../backend/core/mdk-worker/mdk-contract.schema.json))

**Output:** [`backend/workers/docs/supported-hardware.md`](../../../backend/workers/docs/supported-hardware.md)

**Command:** Run from [`backend/workers`](../../../backend/workers/README.md):
```bash
npm run generate:catalogue
```

See [`ia.md § check:integrations-fresh`](ia.md#checkintegrations-fresh) for details on the validation and catalogue generation process.

### Gateway plugin reference

Generates the route tables for default Gateway plugins from their manifest files.

**Source:** `backend/core/plugins/*/mdk-plugin.json`

**Output:** [`backend/core/plugins/README.md`](../../../backend/core/plugins/README.md) (within `BEGIN GENERATED` / `END GENERATED` markers)

**Command:** Run from [`backend/core/plugins`](../../../backend/core/plugins/README.md):
```bash
npm run generate:plugin-reference
```

## Next steps

- [`ui/AGENTS.md`](../../../ui/AGENTS.md): agent/consumer guide for UI manifests (CLI commands, what they contain)
- [`ui/packages/react-devkit/AGENT_READY.md`](../../../ui/packages/react-devkit/AGENT_READY.md): export contract every public component must satisfy
- [`agent-ready-sdk.md`](agent-ready-sdk.md): backend/Workers contract (mdk-contract.json, USAGE.md, examples)
- [`ia.md`](ia.md): information architecture and QA gates (check:port-signals, check:facets-fresh, check:integrations-fresh, check:plugin-reference-fresh)
- [`linters.md`](linters.md): link verification and example-path checking gates already wired in CI
