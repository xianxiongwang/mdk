# Page recipe — API-backed metric page

Checklist for a new dashboard page that shows live worker/plugin data.

## Files to add or touch

```
<dashboard>/
├── src/hooks/use-<thing>.ts          # fetch + shape (useQuery)
├── src/components/<Thing>Panel.tsx   # presentational
├── src/pages/<Thing>.tsx             # thin PageLayout glue
├── src/routes.ts                     # one-line route entry
└── src/App.scss                      # .mdk-ui-shell-<thing> block
```

Optional: `src/constants/navigation.tsx` only if you need a custom nav icon
(default explorer icon is fine).

## Layer responsibilities

| Layer | Owns | Must not |
| --- | --- | --- |
| Hook | `fetch`, JSON → typed `info`, polling | JSX |
| Panel | Markup, loading/empty/error UI, registry components | `fetch`, business rules |
| Page | Hook call, `PageLayout`, Refresh button | Shaping, direct HTTP |
| Plugin (backend) | Aggregation across workers | UI concerns |

## Minimal page skeleton

```tsx
import { PageLayout } from '../components/PageLayout'
import { ThingPanel } from '../components/ThingPanel'
import { useThing } from '../hooks/use-thing'

const Thing = () => {
  const { info, isLoading, error, refetch } = useThing()
  return (
    <PageLayout
      title="Thing"
      className="mdk-ui-shell-thing"
      actions={(
        <button type="button" onClick={refetch} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    >
      <ThingPanel info={info} isLoading={isLoading} error={error} />
    </PageLayout>
  )
}

export default Thing
```

## Route entry

```ts
{ path: '/thing', label: 'Thing', page: () => import('./pages/Thing') },
// mdk:routes-end
```

Keep on one line. Path becomes the sidebar href.

## Component lookup

Before writing JSX:

1. Open [`ui-registry.json`](./ui-registry.json)
2. Find the component by name
3. Use only documented `props[]` names/types
4. Prefer `tier: "agent-ready"` / `public: true` components

## Reference implementation in this project

| Page | Why copy it |
| --- | --- |
| `SystemInfo` + `SystemInfoPanel` (shipped in every scaffolded dashboard) | Thinnest official vertical slice — see the shell's own [`USAGE.md`](../../../../../../examples/mdk-ui-shell-template/USAGE.md) |
