# MDK UI Shell

This example provides a bare application shell built with MDK. It ships the **backbone** plus one
small, deletable **worked example** so a fresh app is wired end to end:

- **Google OAuth sign-in** — the `/signin` page and the token lifecycle
  (`useTokenPolling`, `RequireAuth`).
- **App frame** — header (logo + user/timezone/sign-out menu) and sidebar.
- **A Home landing page** — a placeholder that confirms auth + the frame work.
- **A System Info example page** — a minimal, working API-backed page that
  reads three read-only Gateway endpoints through the layered data flow. It is
  the reference to copy when wiring your own pages; delete it once you have.

There are **no other feature pages** out of the box. Add them from the command
line — including the full reference pages (Dashboard, Alerts, Pool Manager, …),
which ship as managed pages the CLI wires in on demand:

```bash
npx mdk-ui add page Dashboard        # the reference operations dashboard
npx mdk-ui add page <Component>      # a page from any devkit component
```

Everything you add respects the same boundaries this shell does: **API/state in
`@tetherto/mdk-ui-foundation`, hooks in `@tetherto/mdk-react-adapter`,
components in `@tetherto/mdk-react-devkit`**.

## Quick start

> [!NOTE]
> [`mdk create dashboard`](../../packages/cli/README.md) performs step 2 below automatically, including the `.env` values.
> `mdk run dashboard` then starts it. The manual steps here are for working on this template directly.

```bash
# 1. Backend: configure and start (one-time). The Gateway ships in the MDK
#    repo, so run this from your MDK checkout — not from this app.
cd <mdk-repo>/backend/core/gateway
./setup-config.sh
#  ↳ Google sign-in needs an identity plugin, which MDK does not ship
#    (see "Google OAuth setup" below).
npm install
npm start          # serves on http://localhost:3000

# 2. Frontend (this app)
cp .env.example .env   # already points at http://localhost:3000
npm install
npm run dev        # serves on http://localhost:3030
```

Then open `http://localhost:3030` and click **Sign in with Google**.

## Google OAuth setup

**MDK ships no OAuth implementation.** As of v0.6 the Gateway is a plugin host
with no API of its own, so sign-in is something you supply as a Gateway plugin
and mount with `startGateway({ extraPluginDirs: [...] })`. See
[`docs/guides/gateway/plugins.md`](../../docs/guides/gateway/plugins.md) in the MDK repo for the manifest and
controller contract.

This app needs that plugin to honour two ends of a redirect:

- a **start endpoint** at `${VITE_OAUTH_BASE_URL}/oauth/google`, which the
  sign-in button navigates to;
- a **return redirect** to `http://localhost:3030/?authToken=<jwt>` (the
  frontend port set in [`vite.config.ts`](./vite.config.ts)).

You will also need a Google OAuth 2.0 client:

1. Open <https://console.cloud.google.com/apis/credentials> → "Create
   credentials" → "OAuth client ID" → "Web application".
2. Add an **authorised redirect URI** — the callback URL your plugin serves.
   The conventional one is `http://localhost:3000/oauth/google/callback`.
3. Hand the client id and secret to your plugin, and allow your own Google
   account so it grants you a session.

## Environment variables

`cp .env.example .env` to start; the file is already wired for local
development against `miningos-gateway` on `localhost:3000`.

| Variable               | Required | Dev default                | What it controls                                                                                                                                                                                                                                            |
| ---------------------- | -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_MDK_API_URL`     | no       | *(empty)*                  | Base URL for authenticated XHRs (`/auth/*`, `/api/*`). Leave empty in dev — Vite's proxy keeps requests same-origin. Set this **only** when the production frontend lives on a different origin than the backend and no reverse proxy sits between them.   |
| `VITE_OAUTH_BASE_URL`  | yes      | `http://localhost:3000`    | Absolute base URL of the OAuth issuer (e.g. `http://localhost:3000` in dev, `https://api.your-site.com` in prod). Used by the Sign-In button, which issues a top-level navigation that the Vite proxy cannot rewrite — so this must always be absolute.    |
| `VITE_GATEWAY_URL`     | no       | `http://localhost:3000`    | Gateway URL the Vite dev server proxies `/auth`, `/oauth`, `/api` and `/pub` to. `mdk create dashboard` sets this from your stack's `mdk.yaml` gateway port; defaults to the mvp-site gateway (`:3000`) when unset.                                        |
| `VITE_AUTH_BYPASS`     | no       | `true`                     | Dev-only auth bypass. `true` skips the `/signin` gate and lands straight on the dashboard with a stub session (no OAuth backend needed) and disables token-refresh polling. Set to `false` (or delete) once auth is wired up. **Never enable in production.** |

`VITE_API_BASE_URL` is the former name of `VITE_MDK_API_URL`. It is still
read, with a one-time console warning, and stops being read in the next
major — the `VITE_MDK_` prefix keeps it from colliding with your own app's
API URL.

`VITE_MDK_API_URL`, `VITE_OAUTH_BASE_URL` and `VITE_AUTH_BYPASS` are read through [`src/constants/env.ts`](./src/constants/env.ts);
reach for that file (don't sprinkle raw `import.meta.env` lookups across the app) when adding new ones. The
accompanying [`src/vite-env.d.ts`](./src/vite-env.d.ts) declares the typed shape, so missing/misnamed variables
surface as type errors. `VITE_GATEWAY_URL` is a config-time-only variable read directly in
[`vite.config.ts`](./vite.config.ts) (it configures the dev-server proxy itself), so it isn't part of that runtime
`import.meta.env` shape.

## Known limitation: no data without miners

This only applies once you add a data-backed page (e.g. `mdk-ui add page
Dashboard`). `miningos-gateway` is the *API surface*, not the data source. It
expects Kernel clusters with real miners reporting in. **Without that, the
charts will render empty states.** This is the expected first-run experience
for a community demo — the pages are honest about no data being available.

To exercise those pages against simulated data, run the backend's integration
test harness or wire up a mock Kernel; both are out of scope for this template.

## Project layout

```
src/
  main.tsx               React entrypoint, wraps app in <MdkProvider>
  App.tsx                Authenticated shell: topbar + sidebar + <Outlet/>
                         Hosts useTokenPolling() at the top of the tree.
  router.tsx             Router config — /signin is public, everything else
                         is wrapped in <RequireAuth>.
  routes.ts              Feature pages live here (managed by `mdk-ui add
                         page`). Ships with the one System Info example entry.
  constants/
    env.ts               Typed import.meta.env accessors
    routes.ts            Route path literals
    navigation.tsx       Sidebar nav-icon lookup (managed by add/remove page)
  components/
    PageLayout.tsx       Shared page header + content wrapper
    SystemInfoPanel.tsx  Presentational panel for the System Info example
  pages/
    SignIn.tsx           Google OAuth landing — <SignInGoogleButton/>
    Home.tsx             The bare landing page (replace once you add pages)
    SystemInfo.tsx       Worked API example — reads /auth/{site,userinfo,
                         featureConfig} via useSystemInfo, renders a panel.
    NotFound.tsx
```

The **System Info page is the one to read first** — it's the smallest complete
example of the layered data flow (see [`USAGE.md`](./USAGE.md) → "Worked example"). Copy its
shape for a bespoke API page; use `mdk-ui add page` for the managed reference
pages.

## Adding a new page

Two flavours:

```bash
# A managed reference page — copies the full, hand-wired page + route + nav
npx mdk-ui add page Dashboard

# A page scaffolded around any devkit component
npx mdk-ui add page Devices --component DeviceExplorer
```

Either way the CLI writes `src/pages/<Name>.tsx` and appends an entry to
[`src/routes.ts`](./src/routes.ts); the sidebar updates automatically. New pages are
auth-gated by default because they live inside the `<RequireAuth>` wrapper
applied in [`src/router.tsx`](./src/router.tsx). Remove one with `npx mdk-ui remove page <Name>`.

## Troubleshooting

- **OAuth redirect lands at `localhost:3030` but the dashboard bounces back
  to `/signin`**: the backend issued a token but the FE rejected it.
  Inspect `Authorization: Bearer …` headers on the network tab — if every
  request is 401, the backend isn't recognising the token (check the
  backend's auth-cache TTL and its allowed-users list).
- **OAuth redirect lands at a wrong URL**: the redirect your identity plugin
  sends the token to doesn't match the FE port. The expected value is
  `http://localhost:3030` and the FE defaults to port 3030 — keep them aligned.
- **CORS errors**: the backend has no CORS plugin; you must use the Vite
  proxy. [`vite.config.ts`](./vite.config.ts) already proxies `/auth`, `/oauth`, `/api`, and
  `/pub` to `http://localhost:3000`. Do not call the backend directly from
  the FE.
- **Empty charts**: see "Known limitation" above. The backend is up but no
  miners are reporting in.

## Architecture rules

Read [`USAGE.md`](./USAGE.md) before extending this template. The composition rules
(which package owns which concern) matter — breaking them is the easiest
way to make the dashboard hard to maintain.

**Separation of concerns — the rule that holds everything together:**

- **Components render data; nothing else.** No `useQuery`, no `fetch`,
  no unit conversions, no `useMemo` that shapes telemetry inside JSX.
- **Hooks (`@tetherto/mdk-react-adapter`)** own the fetch + shape +
  format pipeline. They return chart-ready / table-ready payloads
  (e.g. `ChartCardData`).
- **All API + state interaction lives in `@tetherto/mdk-ui-foundation`** —
  query factories, query keys, query-param builders, Zustand stores,
  type contracts.
- **Pages are thin glue** — read hooks, pass output to components.

If you see a tag string (`t-miner`, `t-powermeter`) or an aggregate
field (`power_w_sum_aggr`, `site_power_w`) outside the data layer —
or a page building `ChartCardData` by hand — stop and refactor. Use
`<LineChartCard>` + the adapter chart hooks
(`useHashrateChartData`, `useSiteConsumptionChartData`) instead.

## Agent context

`mdk-ui init` seeded:

- `.mdk/context.md` — repo conventions for the agent.
- `.cursor/rules/mdk.mdc` — Cursor rule.
