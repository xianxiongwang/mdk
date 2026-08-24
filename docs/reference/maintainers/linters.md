# Linters

Maintainer-facing inventory of the lint tooling that guards this monorepo's documentation. Two layers:

- 🚧 Project-specific IA gates 🚧 — five **proposed** gates defined in [`ia.md`](ia.md#qa-gates) (`check:contract`, `check:facets-fresh`, `check:agent-ready`, `check:port-signals`, `check:integrations-fresh`). **If adopted**, they would enforce the contract between code, the docs catalogue, and the port pipeline. None are wired today; engineering decides per-gate, and docs maintainers absorb the upkeep manually for any gate not adopted.
- **General docs hygiene** — the rest of this file. Link verification, anchor validation, spelling. These guard the docs themselves, not the IA contract.

## Nightly and PR diff link verification — linkinator

To hand run ahead of the nightly, from the repo root:

```bash
npm run link-check
```

If your shell routes `npm` through Socket Firewall (`sfw`) and this hangs retrying every single file, that's `sfw` blocking
`localhost` — linkinator serves the repo from an ephemeral local HTTP server (a new random port every run — `sfw` matches
on hostname, so the port doesn't matter), then crawls every external URL it finds in the Markdown, and `sfw` blocks
unrecognized hosts by default.

[`scripts/sfw-env.sh`](../../../scripts/sfw-env.sh) holds the full allowlist as one `SFW_CUSTOM_REGISTRIES` export
(comma-delimited `bypass:<host>` entries — see the
[SFW configuration wiki](https://github.com/SocketDev/firewall-release/wiki/Configuration) for the full syntax), with a
comment on every host explaining which doc/link put it there. Source it once from your shell profile:

```bash
[ -f "/absolute/path/to/mdk-prv/scripts/sfw-env.sh" ] && source "/absolute/path/to/mdk-prv/scripts/sfw-env.sh"
```

This only allowlists these specific, already-known-good hosts — it does not set `SFW_UNKNOWN_HOST_ACTION`, so `sfw`
still blocks everywhere else by default. If `link-check` starts blocking a *new* host (a fresh doc links to a domain
not in the file yet), add a `bypass:<host>` entry to [`sfw-env.sh`](../../../scripts/sfw-env.sh) rather than reaching for `SFW_UNKNOWN_HOST_ACTION=warn`
— that flag silences the check for *every* unknown host, not just the one you're trying to unblock. Use it only as a
scoped, one-off prefix while diagnosing which host is blocked, never persisted:

```bash
SFW_UNKNOWN_HOST_ACTION=warn npm run link-check   # scoped to this one command
```

**Why this isn't folded into [`linkinator.config.json`](../../../linkinator.config.json).** Its `skip` list (below) tells linkinator to never check a
URL at all — the request is never made. [`sfw-env.sh`](../../../scripts/sfw-env.sh) does the opposite: it lets a request through so linkinator's
check can actually run and get a real answer. A host that needs `bypass` is, by definition, one we still want
checked — merging the two lists would risk someone "allowlisting" a host by moving it to `skip` instead, which
silently stops verifying it rather than just unblocking it. They stay separate files for that reason, cross-referenced
in comments on both sides.

This runs [`scripts/link-check.mjs`](../../../scripts/link-check.mjs) — a thin wrapper, same shape as `check:example-paths`
below — that resolves the file list via `git ls-files '*.md'` (tracked files only) and passes it to
`linkinator --config linkinator.config.json`, so the config is still the single source of truth for fragment checking
and every skip pattern; nothing is repeated on the command line. The nightly CI runs the same script.

**Why `git ls-files`, not a `**/*.md` glob.** A raw glob also matches gitignored `.md` files physically sitting in your
working directory — a personal scratch checklist, local notes — that CI's clean checkout never has. Locally that shows
up as a false "broken link" (or a Socket Firewall block on some host only *that* file references) for content that
isn't part of the doc corpus and that no one else will ever see. Scoping to tracked files makes local runs match what
CI checks, exactly.

[Linkinator](https://github.com/JustinBeckwith/linkinator) checks Markdown files for broken links and (optionally) broken heading anchors. Two cadences run today, both off the same config: a **nightly cron at 02:00 UTC** (full sweep) and a **PR diff gate** that scopes the linkinator crawl to only the changed `.md` files — both via [`.github/workflows/link-check.yml`](../../../.github/workflows/link-check.yml). See [CI wiring](#ci-wiring) for the split. The [`check:directory-links`](#stale-directory-skip-entries--checkdirectory-links) sub-check always runs in full on both cadences, regardless of diff scope — see that section for why.

Pin `linkinator@^7.6.0` or newer. Earlier versions silently passed same-page fragment links even when the heading didn't exist; fixed in [#771](https://github.com/JustinBeckwith/linkinator/pull/771) and shipped in 7.6.0.

### How it works

[`linkinator.config.json`](../../../linkinator.config.json) at repo root:

Hand maintained skip list:

`skip` entries are regex matched against **link targets**, not source file paths. A few representative entries:

| Pattern | Why |
|---|---|
| `node_modules` | Excludes installed-dependency markdown from local runs. No-op in CI (the runner installs nothing), but a maintainer's checkout has `node_modules`, and without this the local `**/*.md` glob would scan thousands of vendored files. |
| `^https://github\.com/tetherto/mdk/blob/main/` | **Temporary.** These links point at the public mirror and already use the *predicted* post-reorg paths; they `404` until the same reorg lands on the public repo. Remove this entry once that ships so the links are validated again. |
| `backend/workers/miners/[^/]+/examples/?$` | Bare example directories (no `index`/`README` to serve) — see the bare-directory false-positive note below. `$`-anchored so it matches only the directory itself, never deeper files. Fully qualified from repo root (not just `workers/miners/...`) — see [`check:directory-links`](#stale-directory-skip-entries--checkdirectory-links) below for why. |

The rest of the current list (directory-shaped entries, temporary upstream-mirror exceptions, auth-walled hosts) live directly in [`linkinator.config.json`](../../../linkinator.config.json) with a paired `_skip_notes` explanation — that file is the source of truth for the full, current list; this table is illustrative, not exhaustive.

Add new entries only when the broken target can't be fixed in the source — a temporary upstream 404 is something to push back on, not a skip-list entry. Keep directory-target skips `$`-anchored and fully qualified from repo root (see below).

### Known false positive: bare directory targets

Markdown links that point at a bare directory (for example ``[`backend/core/gateway/`](../../../backend/core/gateway/)``) are reported as `404` by linkinator. They are not actually broken — GitHub renders directory URLs as a tree view — but linkinator serves the repo via an ephemeral local HTTP server, and there is no `index.html` inside those folders for the server to return.

Do **not** silence these by adding the directory prefix to `skip`. Skip patterns are regex matched against link targets without implicit anchoring; an entry like [`ui/`](../../../ui/README.md) would also silence every deeper link ([`ui/README.md`](../../../ui/README.md), `ui/docs/USAGE.md`, ...), creating false negatives that hide real breakage. Anchored exact-match patterns (`^http://localhost:[0-9]+/ui/$`) work in theory but are fragile across linkinator versions and accumulate.

The convention is to point such links at a concrete file inside the directory — a [`README.md`](./README.md), `USAGE.md`, `index.js`, or the canonical entry source — so the link checker and the human reader both land somewhere meaningful. If the directory has no obvious landing file, keep the directory link: it resolves correctly on GitHub, so delinking it would strip working navigation just to satisfy a linkinator false positive. Treat the resulting local `404` as an accepted false positive instead — and add it to `skip`, following [`check:directory-links`](#stale-directory-skip-entries--checkdirectory-links) below.

### Stale directory-skip entries — `check:directory-links`

A `skip` entry is a regex, applied blindly forever. If a skip-listed directory is later renamed or deleted, nothing notices on its own — linkinator would keep "passing" on a now-dead reference indefinitely, since it can't tell "exists, no index file" apart from "doesn't exist at all" (that's the whole reason the entry is there in the first place).

[`scripts/check-directory-links.mjs`](../../../scripts/check-directory-links.mjs) closes that gap with a direct check against `git ls-files` (not raw `fs` calls — a local checkout can have untracked cruft, like a stray `node_modules/` left over from a package that used to live somewhere, that would make a directory look like it still exists locally when a clean CI checkout never would). It runs as part of `npm run link-check` (see [`scripts/link-check.mjs`](../../../scripts/link-check.mjs)), as a second, independent subprocess alongside linkinator — both must pass for the command to succeed.

**Classification is note-based, not just shape-based.** An entry in `skip` is treated as a directory-false-positive candidate when it matches a shape regex (a path of literal segments, at most one `[^/]+` wildcard segment, ending in the usual `/?$` anchor) *and* excludes the other kinds of entries in the list (generic exclusions like `node_modules`/`dist/`/`coverage/`, and URLs). Every entry classified as a candidate **must** have a paired [`_skip_notes`](../../../linkinator.config.json) entry containing the phrase `"bare directory path"` — a candidate with no note makes the script throw and fail CI hard, by design, same discipline [`example-paths.config.json`](../../../example-paths.config.json)'s loader already enforces for `check:example-paths`. This is also why every directory-shaped skip entry must be **fully qualified from repo root** (e.g. `backend/workers/miners/[^/]+/examples/?$`, not just `workers/miners/...`): the check verifies each entry with one direct, local lookup — a literal path is checked directly, a wildcard segment is resolved by listing just that one parent directory's tracked children — never a repo-wide search, which only works if the entry's own text already says exactly where to look.

### Fragment checking — enabled

`checkFragments: true` is now on. It was deliberately rolled out in two stages:

1. The first nightlies ran with `checkFragments: false` to surface the basic signal — broken external URLs, redirect chains, the known directory false positives — without anchor noise layered on top. That was the calibration baseline.
2. Once that baseline was clean (verified repo-wide: every internal `.md`-to-`.md` anchor resolves), the flag was flipped to `true`.

The silent-failure mode it catches is exactly the one you most need it for: a heading rename in (say) [`ia.md`](ia.md) invalidates every inbound `#derived-vocabulary` reference, and without anchor validation the link still returns OK because the target file exists.

One linkinator quirk worth knowing when reading reports: a **valid** fragment is folded into its base-file `OK` entry and never listed separately. Only **broken** fragments appear as their own `#`-bearing `BROKEN` line. So "no `#` links in the report" means all anchors passed, not that none were checked.

### CI wiring

[`.github/workflows/link-check.yml`](../../../.github/workflows/link-check.yml) runs in two modes, both off the same [`linkinator.config.json`](../../../linkinator.config.json).

**Nightly full sweep** (`linkinator` job — `schedule` + `workflow_dispatch`):

- Cron `0 2 * * *` (02:00 UTC) plus `workflow_dispatch` for manual triggering. Gated with `if: github.event_name != 'pull_request'` so it never runs the full sweep on a PR.
- Runs `npm run link-check` (the same script maintainers use locally), which invokes `linkinator@^7.6.0` against `**/*.md` using the root config; no project dependencies are installed in the runner.
- On failure, opens a tracking issue labelled `link-check` via the pre-installed `gh` CLI. If an open `link-check` issue already exists, the run **comments on it** instead of opening a duplicate — daily failures collapse into one thread, not a daily new issue.
- Surfaces the failure in the Actions run history (`exit 1`) after the issue is composed, so the repo's main page shows red.

**PR diff gate** (`link-check-diff` job — `pull_request`, gated with `if: github.event_name == 'pull_request'`):

- Triggered only when a PR touches `**/*.md`, [`linkinator.config.json`](../../../linkinator.config.json), or the workflow itself (path filter on the `pull_request` trigger).
- Checks out with `fetch-depth: 0`, then computes the added/modified `.md` files in the diff (`git diff --diff-filter=ACMR …`, which drops deleted files) and passes that explicit list straight to `npm run link-check -- <files...>` — [`scripts/link-check.mjs`](../../../scripts/link-check.mjs) accepts an optional file-list argument for exactly this: when given, it scopes the linkinator crawl to just those files (plus [`README.md`](../../../README.md), always included as a server-root anchor — see the comment in the script for why); with no argument at all (the nightly job, and a plain local run) it crawls every tracked `.md` file. **`check:directory-links` always runs in full either way** — it isn't a per-file crawl, just a handful of `git ls-files` lookups against [`linkinator.config.json`](../../../linkinator.config.json)'s skip list, so there's no meaningful "diff-scoped" version of it and no cost to running it every time.
- A broken link (in the scoped crawl) or a stale directory-skip entry (always checked in full) fails the check — no issue is opened; that's the nightly's job.
- If the PR changes the config or either checker script ([`scripts/link-check.mjs`](../../../scripts/link-check.mjs), [`scripts/check-directory-links.mjs`](../../../scripts/check-directory-links.mjs)) or the workflow itself, it falls back to a **full** `npm run link-check` sweep (no file-list argument), since a weakened skip rule or a change to how either check works can expose breakage outside the diff.
- **Known gap:** the linkinator half of the diff gate only validates links *originating from* changed files. A PR that renames a heading breaks inbound `#anchor` references in *other* (unchanged) files, which this job won't see — the nightly full sweep is the backstop for that. Treat the PR gate as a fast first line, not a replacement for the nightly.

## 🚧 Nightly example-path verification (CI wiring not yet implemented)

To hand run ahead of the nightly, from the repo root:

```bash
npm run check:example-paths
```

This wraps [`scripts/check-example-paths.mjs`](../../../scripts/check-example-paths.mjs), a plain Node script with no new dependency — the same shape as `link-check` being a thin wrapper over one tool and one config.

**What it checks.** Linkinator only resolves Markdown links (`[text](target)`). A bare `examples/...` path named in prose or inside a fenced code block — `node examples/backend/miners/whatsminer/index.js` in a ```bash``` fence, for instance — is invisible to it by design allowing dead references in prose and fences, not links. `check:example-paths` closes that gap by walking every tracked `.md` file (`git ls-files '*.md'`), extracting `examples/...`-shaped tokens from the raw text, and confirming each one resolves to a real file or directory.

**Resolve-relative-then-root.** A candidate path is checked two ways: relative to the directory of the Markdown file that names it, then relative to the repo root. A miss on both is a finding. This matters because some packages document their own bundled examples using a path that's only correct relative to the package itself — [`backend/workers/miners/whatsminer/USAGE.md`](../../../backend/workers/miners/whatsminer/USAGE.md) names its runtime-parity example relative to itself, which resolves to [`backend/workers/miners/whatsminer/examples/run-runtime-parity.js`](../../../backend/workers/miners/whatsminer/examples/run-runtime-parity.js) (a root-relative miss, a file-relative hit).

**Skip policy — [`example-paths.config.json`](../../../example-paths.config.json) at repo root**, mirroring [`linkinator.config.json`](../../../linkinator.config.json)'s shape:

- `skipFiles` — whole Markdown files excluded from scanning (glob patterns): historical records (`docs/reference/changelog-archive/**`, `docs/reference/release-notes/**`, [`CHANGELOG.md`](../../../CHANGELOG.md)) that correctly name paths as they existed at the time they were written, not as they exist today.
- `skipPaths` — specific `examples/...` paths excluded wherever named: tutorial output the reader builds from scratch (`examples/minimal-dashboard`, built by [`docs/tutorials/build-a-dashboard.md`](../../tutorials/build-a-dashboard.md)) and gitignored runtime state created on first run (`examples/mvp-site/.site-data`, `examples/full-site/.mdk-data`).
- `_skip_notes` — mandatory sibling object, one entry per `skipFiles`/`skipPaths` pattern, explaining why. The checker refuses to run if any skip entry lacks a note. An unexplained skip is a silent false negative waiting to happen — the same lesson the linkinator skip list already enforces by convention; here it's enforced by the script itself.
- Placeholders are dropped automatically, not via the skip list: any candidate token immediately followed by `<`, `>`, `*`, `{`, `}`, or `…` (for example `examples/run-<scenario>.js` or `` examples/run-*.js ``) is treated as unresolved template text, not a real path.

**CI wiring** — not implemented. A nightly-only job (deliberately unlike [`link-check.yml`](../../../.github/workflows/link-check.yml)'s nightly-plus-PR split), running `npm run check:example-paths` and opening or commenting on an `example-paths`-labelled tracking issue on failure, would mirror `link-check.yml`'s nightly job. No PR gate is planned either way — this check would stay nightly-only even once wired. Runs locally on demand today; CI wiring is a follow-on.

## 🚧 Spelling — Vale

Vale catches accidental misspellings and enforces a project word list. Configured via `.vale.ini` at the repo root when present. Runs locally on demand today; CI wiring is a follow-on.

## 🚧 Style — Markdownlint (deferred)

[`markdownlint-cli2`](https://github.com/DavidAnson/markdownlint-cli2) would enforce structural consistency (heading hierarchy, list indentation, fenced code block style). Not wired today; revisit when style drift across the corpus becomes a real friction.

## See also

- [`ia.md`](ia.md#qa-gates) — the five proposed IA-specific lint gates that would enforce contract / catalogue / port-signal correctness if adopted by engineering.
- [`single-source-of-truth.md`](single-source-of-truth.md) — the link-routing comment vocabulary that `check:port-signals` reads, plus UI manifest generation workflow.
