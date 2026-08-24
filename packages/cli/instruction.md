# Agent instructions — `@tetherto/mdk-cli`

Guidance for AI coding agents working on this package. Read this **before**
making changes. The goal of this package is to grow from a scaffold into the
real `mdk` developer CLI, one command at a time, without churning the wiring.

## What this package is

The `mdk` command-line tool. Today it is a **scaffold**:

- The **entire command surface** (names, arguments, options, help text) is
  already wired up with Commander.js — that wiring is the source of truth.
- **`mdk onboard` is fully implemented**: a guided, colorful wizard that detects
  the environment, asks setup questions (pre-filled defaults), writes `mdk.yaml`,
  and prints the commands to run the stack.
- **Every other command is a no-op stub** ([`src/lib/stub.ts`](./src/lib/stub.ts)). Your job is to
  replace `stub(...)` calls with real behavior.

## Golden rule

**Implement behavior by replacing the `stub(...)` call inside a command's
`.action(...)`. Do not change the command's name, arguments, options, or help
unless the command surface is intentionally redesigned.** The wiring is the
contract; keep it stable so commands can be filled in independently and in
parallel.

## Project layout

```
src/
  index.ts            # entry point (shebang); parses argv, maps errors -> exit 1
  program.ts          # builds the Commander tree; registers every command group
  commands/           # one file per command group (A–G in the HLD)
    onboard.ts        # Group A — implemented reference for style & UX
    create.ts         # Group B — create worker | plugin | dashboard
    run.ts            # Group C — run
    inspect.ts        # Group C — status (implemented); get | describe | logs (stub)
    discover.ts       # Group D — discover (stub)
    agent.ts          # Group F — skill add | mcp register (stub)
    meta.ts           # Group G — manifest (stub) | version (implemented)
  lib/
    stub.ts           # the placeholder every unimplemented action calls
    pkg.ts            # reads package.json (name, version)
    detect.ts         # environment detection used by onboard
    spec.ts           # builds + loads the mdk.yaml stack spec
    project.ts        # the emitted layout: root manifest, .gitignore, README
    runtime.ts        # boots kernel/gateway/workers; owns the .mdk state paths
    status.ts         # read-only status: env + spec + probes kernel/gateway/workers
    worker-scaffold.ts# create worker: template copy + mdk.yaml registration
    plugin-scaffold.ts# create plugin: template copy + mdk.yaml registration
    dashboard.ts      # create dashboard: UI shell template -> apps/dashboard
    fetch-template.ts # degit wrapper for fetching a GitHub subtree
    npm.ts            # `npm install` helpers (workspace-aware)
    skill.ts          # installs the @tetherto/mdk-skill suite
    theme.ts          # colors, badge, banner, aligned kv/cmd blocks
```

Each `commands/*.ts` file exports `register<Name>(program)` functions that
[`program.ts`](./src/program.ts) calls. To add a command group, create a `register*` and call it in
`buildProgram()`.

## Tech stack & conventions

- **Node.js >= 24, TypeScript, ESM.** [`tsconfig.json`](./tsconfig.json) uses `NodeNext` module
  resolution, so **relative imports must include the `.js` extension** (e.g.
  `import { stub } from '../lib/stub.js'`), even though the source is `.ts`.
- **Commander.js** for the command tree, parsing, and help.
- **`@clack/prompts`** for interactive wizard steps (see [`onboard.ts`](./src/commands/onboard.ts)).
- **`picocolors`** for color; go through [`src/lib/theme.ts`](./src/lib/theme.ts) for a consistent
  look and correct `NO_COLOR` / non-TTY fallback. Do not hardcode ANSI codes
  outside [`theme.ts`](./src/lib/theme.ts).
- **`yaml`** for reading/writing `mdk.yaml`.
- Keep the code `strict`-clean: no new TypeScript or lint errors.

## Build, run, test

```bash
npm install                  # from this directory (backend/core/cli)
npm run dev -- <args>        # run from source via tsx, e.g. npm run dev -- onboard
npm run build                # compile to dist/
node dist/index.js <args>    # run the built CLI
npm run clean                # remove dist/
```

At the monorepo root, `npm run setup:core` installs this package's deps (it is
listed in [`backend/core/install-packages.sh`](../../backend/core/install-packages.sh)).

Always `npm run build` after changes and smoke-test the affected command before
finishing. There is no test suite yet; if you add one, keep it runnable via
`npm test` and wire it into the core `test:packages` loop.

## CLI behavior rules (agent- and pipe-friendly)

- **stdout is for machine-facing data; stderr is for humans.** Data that a user
  might pipe (`get`, `describe`, `manifest`, ...) goes to stdout; status notices,
  prompts, and errors go to stderr. [`stub.ts`](./src/lib/stub.ts) already follows this.
- **Respect `-o, --output <table|json|yaml>`** for any command that emits data.
  Default is `table`; `json`/`yaml` output must be clean and parseable.
- **Exit codes are semantic:** `0` success, non-zero on failure. Unexpected
  errors surface via [`index.ts`](./src/index.ts) as exit `1`; use `--debug` to decide whether to
  print stack traces.
- **Guard interactivity:** anything that prompts must check `process.stdin.isTTY`
  and fail with a clear message when not attached to a terminal (see [`onboard.ts`](./src/commands/onboard.ts)).
- **Honor `NO_COLOR` and non-TTY** — always color through [`theme.ts`](./src/lib/theme.ts).
- **`mdk.yaml` is the declarative source of truth** for the stack. Build/modify
  it via [`lib/spec.ts`](./src/lib/spec.ts) (`buildStackSpec`) rather than string-templating YAML. When
  editing an existing spec, go through the `yaml` document API (see
  [`worker-scaffold.ts`](./src/lib/worker-scaffold.ts)) so the user's formatting and comments survive.
- **The emitted layout lives in [`lib/project.ts`](./src/lib/project.ts)** (`DIRS`, `WORKSPACES`). A new
  scaffold command belongs in one of those role directories — never hardcode a
  path, and never invent a new top-level directory without updating `DIRS`,
  the generated README, and the package README together.
- **Runtime state belongs under `.mdk/`** via the helpers in [`lib/runtime.ts`](./src/lib/runtime.ts).
  Nothing a command writes at run time may land in the project root.

## Coding style

- Match the existing style in [`onboard.ts`](./src/commands/onboard.ts) and [`program.ts`](./src/program.ts).
- **Do not add narrating comments** (e.g. `// import x`, `// loop over items`).
  Comments should explain non-obvious intent, trade-offs, or constraints only.
- Prefer small, pure helpers (see [`lib/spec.ts`](./src/lib/spec.ts)) so logic is testable without a
  TTY.
- When adding a dependency, use the package manager (`npm install <pkg>`) so the
  lockfile updates; do not hand-edit versions.

## Where to look for domain context

- **CLI design:** the command wiring in [`src/program.ts`](./src/program.ts) and `src/commands/*.ts`
  is the source of truth (see [Project layout](#project-layout) above).
- **MDK architecture** (Kernel, Gateway, Worker) lives in the backend core
  packages ([`../../backend/core/kernel`](../../backend/core/kernel/README.md), [`../../backend/core/gateway`](../../backend/core/gateway/README.md),
  [`../../backend/core/mdk`](../../backend/core/mdk/README.md)) and [`../../backend/core/docs`](../../backend/core/docs/README.md). Commands like `run`,
  `status`, and `discover` integrate against these.
- **Liveness is always probed, never read from files.** `.mdk/kernel.key` and
  `.mdk/keys/*.key` intentionally survive shutdown (the keys are stable across
  restarts), so their presence proves only that a component once ran. [`status.ts`](./src/lib/status.ts)
  probes the Kernel over HRPC (`@tetherto/mdk-client`) and the Gateway over HTTP.

## Definition of done for a command

1. `stub(...)` replaced with the real action; wiring untouched (unless HLD changed).
2. Output obeys the stdout/stderr split and `--output` format.
3. Sensible exit codes; interactivity guarded; color via [`theme.ts`](./src/lib/theme.ts).
4. `npm run build` passes with no new type/lint errors.
5. The command was smoke-tested (happy path + one failure path).
6. [`README.md`](./README.md) command table updated if behavior/status changed.
