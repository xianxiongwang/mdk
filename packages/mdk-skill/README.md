# @tetherto/mdk-skill

The **MDK Developer Skill suite**: version-controlled procedural context, in
the universal Agent Skills format (`SKILL.md`), that makes any
skills-compatible coding agent (Cursor, Claude Code, …) fluent in MDK
conventions the moment the repo is cloned.

The suite ships five flat skills: the `mdk` router plus full workflows for
device workers, Gateway plugins, UI pages, and stack deployment. Composite
prompts (e.g. "create a UI to show \<metric\> for \<device family\>") are
routed as an ordered chain in [`mdk/SKILL.md`](./src/skills/mdk/SKILL.md).

## Layout

```text
src/
├── skills/                 # hand-authored suite content (flat: one dir per skill)
│   ├── mdk/                #   router + suite-wide references/
│   ├── mdk-worker-plugin/  #   worker plugin workflow + scripts/assets
│   ├── mdk-gateway-plugin/     #   Gateway plugin workflow (scaffold via `mdk create plugin`)
│   ├── mdk-ui-component/   #   dashboard page workflow + ui-registry
│   └── mdk-deployment/     #   mdk.yaml / mdk run workflow
├── mdk-contract.schema.json  # derived contract schema (owned here; see its $comment)
├── sources.map.json        # source-of-truth -> bundle mapping
├── index.mjs               # programmatic entry point (assemble / installSkills)
├── index.d.ts              # TypeScript types for the entry point
├── assemble.mjs            # CLI wrapper -> dist/skills/
└── install.mjs             # CLI wrapper: dist/skills/* -> .cursor|.claude/skills/
dist/skills/                # assembled suite — build output, gitignored, never hand-edited
```

Skills are assembled and installed **flat** — clients discover
`<skills-dir>/<name>/SKILL.md` one level deep, and each skill's `description`
frontmatter is its routing trigger. Copied artifacts (the worker template, the
contract schema) are taken from their owning packages by [`assemble.mjs`](./src/assemble.mjs), never
hand-maintained, so the bundle cannot drift from the source of truth.

## Build & install

```bash
node src/assemble.mjs        # build dist/skills/ (also runs on npm prepack)
npm run install:skills       # assemble + copy into the enclosing repo's
                             # .cursor/skills/ and .claude/skills/ (gitignored)
node src/install.mjs --client cursor   # one client only
```

## Programmatic API

Consume the package (e.g. from the MDK CLI) instead of shelling out to the
scripts. Resolution goes through node/npm, so it works both as a published
dependency and as a local workspace package.

```js
import { installSkills } from '@tetherto/mdk-skill'

// Copies the assembled skills into <target>/.cursor/skills and/or
// <target>/.claude/skills. Assembles on demand inside the monorepo.
const { skills, installed } = installSkills({ client: 'all', target: process.cwd() })
```

Also exported: `assemble()`, `isAssembled()`, `canAssemble()`, and `CLIENT_DIRS`.

## Try it — routing prompts

Open the repo in a skills-aware agent after installing, then check that each
prompt activates the matching skill(s):

| Example prompt | Skill(s) it should invoke |
| --- | --- |
| "Add a new power meter worker for our site" | `mdk-worker-plugin` |
| "I need to integrate a new miner device into MDK" | `mdk-worker-plugin` |
| "Author an mdk-contract.json for a temperature sensor" | `mdk-worker-plugin` |
| "Build a plugin that aggregates hashrate across all miners" | `mdk-gateway-plugin` |
| "Add a cross-worker endpoint that rolls up a site summary" | `mdk-gateway-plugin` |
| "Create a dashboard widget that shows live telemetry from a worker" | `mdk-ui-component` (and `mdk-gateway-plugin` if no `/api` route yet) |
| "Create a UI to show \<metric\> for \<device family\>" | discover → `mdk-gateway-plugin` → `mdk-deployment` → `mdk-ui-component` |
| "How do I deploy the MDK stack?" | `mdk-deployment` |
| "What is MDK and how is it structured?" | `mdk` (router) |

## Verify the device-worker skill

```bash
# contract validation (exit 0/1)
node dist/skills/mdk-worker-plugin/scripts/validate-contract.mjs \
  packages/cli/templates/worker/mdk-contract.json

# in-process smoke: telemetry sweep + command bounds, no Kernel, no DHT
node dist/skills/mdk-worker-plugin/scripts/worker-smoke.mjs <worker-dir>
```

The end-to-end proof of the skill is scaffolding a new worker from
[`dist/skills/mdk-worker-plugin/SKILL.md`](./src/skills/mdk-worker-plugin/SKILL.md) alone — contract validation, smoke
pass, and brittle unit tests all green before the worker ever meets a Kernel.
