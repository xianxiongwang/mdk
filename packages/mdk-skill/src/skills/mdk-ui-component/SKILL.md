---
name: mdk-ui-component
description: >
  Build a UI page/panel that renders data from an MDK worker or Gateway
  plugin. Use when the task mentions "UI / component / widget / dashboard",
  "show telemetry", "chart / tile / heatmap", "render data from a
  worker/plugin", or prompts like "create a UI to show <metric> for <device>".
metadata:
  suite: mdk-developer-skill
  mdk_version: "0.5.0"
license: Apache-2.0
---

# Build an MDK UI page for worker/plugin data

MDK UI shells (`apps/dashboard/`, scaffolded by `mdk create dashboard` — or
`apps/<name>/` if named explicitly) are **composition only**. Data comes from
a Gateway route; shaping lives in a hook; visuals come from
`@tetherto/mdk-react-devkit`. Never invent component prop names — look them
up in [`references/ui-registry.json`](./references/ui-registry.json).

Real reference implementation, shipped in every scaffolded dashboard — copy
its shape for a new page, then delete it once you don't need the example
(see the shell's own [`USAGE.md`](../../../../../examples/mdk-ui-shell-template/USAGE.md), "Worked example: System Info"):

| Layer | File |
| --- | --- |
| Foundation query | `@tetherto/mdk-ui-foundation` [`src/query/factories.ts`](../../../../../ui/packages/ui-foundation/src/presets/mining/factories.ts) (`siteQuery`/`userInfoQuery`) |
| Hook | `@tetherto/mdk-react-adapter` [`src/hooks/use-system-info.ts`](../../../../../ui/packages/react-adapter/src/hooks/use-system-info.ts) |
| Page | [`apps/dashboard/src/pages/SystemInfo.tsx`](../../../../../examples/mdk-ui-shell-template/src/pages/SystemInfo.tsx) |
| Panel | [`apps/dashboard/src/components/SystemInfoPanel.tsx`](../../../../../examples/mdk-ui-shell-template/src/components/SystemInfoPanel.tsx) |
| Route | [`apps/dashboard/src/routes.ts`](../../../../../examples/mdk-ui-shell-template/src/routes.ts) |

## Prerequisites (do these first)

1. **Data source exists.** If no `/api/...` route returns the metric, stop and
   use `mdk-gateway-plugin` to create one. Confirm with `curl` that the JSON shape
   is stable.
2. **Contract units known.** Read the worker `mdk-contract.json` so labels/units
   match (`power` → `W`, etc.). Resolve it from `mdk.yaml` → `spec.workers`:
   local `package` → `<package>/mdk-contract.json` (or legacy
   `<package>/plugin/mdk-contract.json`); npm package → the same under
   `node_modules/<package>/`.
3. **Dashboard app exists.** If missing: `mdk create dashboard` (see
   `mdk-deployment`).

## Workflow

### 1. Pick the visual from the registry

Open [`references/ui-registry.json`](./references/ui-registry.json) (this skill). Use
`indexes.componentsByName` / `indexes.componentsByCategory`.

| Need | Typical component |
| --- | --- |
| Single numeric metric / total | `SingleStatCard` |
| Time-series | `LineChartCard` |
| Fallback text when null | `FALLBACK` constant |

Copy **exact** prop names and types from the registry entry. Example
`SingleStatCard`: `name`, `subtitle`, `value`, `unit`, `variant`, `flash`.

### 2. Add the page scaffold

Prefer the CLI so `routes.ts` stays tool-compatible:

```bash
cd <dashboard-app>
npx mdk-ui add page <PageName>
```

That appends a one-line entry to `src/routes.ts` above `// mdk:routes-end`.
If you edit `routes.ts` by hand, keep each route on a **single line** and
preserve the end marker.

### 3. Create the data hook (shape the payload)

For a **project-local plugin** (one scaffolded under `plugins/`, referenced by
its package name in `mdk.yaml` → `spec.gateway.plugins`), put the hook in the
app:

`src/hooks/use-<thing>.ts`

```ts
import { useQuery } from '@tetherto/mdk-react-adapter'

// types matching the plugin JSON schema
export const useThing = () => {
  const result = useQuery({
    queryKey: ['thing'],
    queryFn: async () => {
      const res = await fetch('/api/...')
      if (!res.ok) throw new Error(`Failed (HTTP ${res.status})`)
      const raw = await res.json()
      // shape → render-ready; never leave shaping to the panel
      return { /* ... */ }
    },
    refetchInterval: 5_000, // live tiles
  })
  return {
    info: result.data ?? EMPTY,
    isLoading: result.isLoading,
    error: result.error,
    refetch: () => { void result.refetch() },
  }
}
```

Rules:

- Import `useQuery` from `@tetherto/mdk-react-adapter`, **not** from
  `@tanstack/react-query` directly.
- Hook owns fetch + shaping; panel stays presentational.
- For reusable MDK-wide endpoints, prefer adding the hook to
  `@tetherto/mdk-react-adapter` (see dashboard [`USAGE.md`](../../../../../examples/mdk-ui-shell-template/USAGE.md) System Info flow).
  App-local hooks are correct for project-local plugins.

### 4. Create the presentational panel

`src/components/<Name>Panel.tsx`

- Props: already-shaped `info` + `isLoading` + `error`
- No `fetch`, no stores, no inline transforms beyond trivial display
  (`Math.round`)
- Handle three states: `error`, empty list, data
- Render registry components with verified props

### 5. Wire a thin page

`src/pages/<Name>.tsx` — mirror [`SystemInfo.tsx`](../../../../../examples/mdk-ui-shell-template/src/pages/SystemInfo.tsx) (the shipped reference page):

- Call the hook
- Wrap in `PageLayout` with title + optional Refresh action
- Pass hook outputs to the panel
- Page holds **no** fetch / shaping

### 6. Styles

Add a BEM block under the shell namespace in `src/App.scss`, e.g.
`.mdk-ui-shell-<name>`, matching the `className` on `PageLayout`. Reuse CSS
variables (`--mdk-color-*`). Mirror the `.mdk-ui-shell-system-info` block
already in the file.

## Composition rules (do not break)

From the dashboard [`USAGE.md`](../../../../../examples/mdk-ui-shell-template/USAGE.md):

```
Gateway plugin / foundation query
  → adapter or app hook   (fetch + shape)
    → thin page           (hook → panel)
      → presentational panel + @tetherto/mdk-react-devkit
```

Forbidden:

| Don't | Do |
| --- | --- |
| `fetch` inside a panel/component | Hook |
| Guess `SingleStatCard` props | [`references/ui-registry.json`](./references/ui-registry.json) |
| Import Ant Design / MUI | `@tetherto/mdk-react-devkit` |
| Edit `router.tsx` for feature pages | `routes.ts` via `mdk-ui add page` |
| Hard-code units ignoring the contract | Use `unit` from the API payload |

## Worked recipe: "UI to show `<metric>` for `<device family>`"

End-to-end chain this kind of prompt implies (router skill expands this):

1. `mdk-gateway-plugin` — ensure `GET /api/<domain>/<resource>` exists and
   returns a shaped payload (e.g. `{ unit, total, devices[] }`) grounded in
   the worker contract's telemetry channel.
2. This skill — hook + `SingleStatCard` grid (total + per-device) + page +
   route.
3. `mdk-deployment` — plugin listed in `mdk.yaml`, gateway running, worker
   online with a device.

Detailed file checklist: [`references/page-recipe.md`](./references/page-recipe.md).

## Hand-off

| Problem | Skill |
| --- | --- |
| No API route / wrong shape | `mdk-gateway-plugin` |
| Stack not running / plugin not loaded | `mdk-deployment` |
| Device / telemetry channel missing | `mdk-worker-plugin` |
