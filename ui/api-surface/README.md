# Public API-surface baselines

Committed snapshots of the exported names reachable through each package's
`exports` map. Generated and verified by
[`scripts/check-api-surface.mts`](../scripts/check-api-surface.mts).

## Why this exists

`check:agent-ready` guards the devkit's **documentation** contract — tiers,
JSDoc, `USAGE.md`, examples. Nothing guarded the **shape** contract: the set of
names a consumer can import. An export could be renamed or deleted and only a
downstream app would find out.

These baselines cover the two packages a consumer wires their own backend into:

| Baseline | Package |
| --- | --- |
| [`ui-foundation.json`](./ui-foundation.json) | `@tetherto/mdk-ui-foundation` |
| [`react-adapter.json`](./react-adapter.json) | `@tetherto/mdk-react-adapter` |

The devkit is excluded — `check:agent-ready` already gates its exports.

## Usage

```bash
npm run build                            # baselines are read from dist/, not src/
npm run check:api-surface                # verify; exits 1 on any drift
npm run check:api-surface -- --update    # accept the current surface
```

`check:api-surface` is part of `npm run fullcheck`.

## Reading a failure

```
✗ @tetherto/mdk-ui-foundation: public surface drifted
  ./query
    - REMOVED  someHelper (function)      ← breaking: consumers lose an import
    ~ CHANGED  API_ENDPOINTS: const → type ← breaking: value became type-only
    + added    createResourceQuery (function) ← additive
```

Removals and kind changes are breaking. Additions are safe but still reported,
so a growing surface stays a deliberate choice rather than an accident.

## Updating

Re-run with `-- --update` and **review the baseline diff in the PR** — that diff
is the record of what the release breaks. Do not update it in the same commit as
unrelated work.

## Note on `npm run api:surface`

That is a **different, older, and currently broken** script
([`scripts/generate-public-surface.mjs`](../scripts/generate-public-surface.mjs)): it emits rich TypeDoc reflection dumps
into `ui/api/`, which is gitignored, and it imports `ui/api/schema.mjs` — a file
that was never committed, so the script exits with `ERR_MODULE_NOT_FOUND`. It is
unrelated to this gate.
