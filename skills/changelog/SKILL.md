---
name: changelog
description: Generate the changelog for the next MDK release by carefully diffing the previous release tag against the current tree, rotating the existing CHANGELOG.md into the year archive, and drafting the matching high-level release-notes file. Use when cutting a release, preparing release docs, or when asked to "update the changelog" / "write the changelog for vX.Y.Z".
argument-hint: "[target-version e.g. 0.5.0] — optional; inferred/asked if omitted"
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
---

# MDK release changelog

Produce the changelog for the **next** release by investigating what actually
changed between the previous release tag and the current working tree — one
categorized entry per real change, anchored to concrete paths — then rotate the
old changelog into the archive (re-nested, prose untouched) and draft the
high-level release notes.

Target version: **$ARGUMENTS** (e.g. `0.5.0`). If empty, infer and confirm (see
Step 1). **Never** guess the version silently.

## Golden rules

- **Describe the release outcome, not the PR/commit narrative.** The changelog
  documents the *net difference* between the two release endpoints — what a consumer
  gets in the new version — not the sequence of PRs/commits that produced it. The
  linear `BASE..TARGET` tree diff is the source of truth for *what* changed; commits
  only explain *why* and reveal what to collapse. Two consequences you must enforce:
  - **Landed then reverted within the cycle → omit entirely.** Net effect is zero, so
    for this release it never happened. It will not appear in the tree diff; do not
    resurrect it from the commit log.
  - **Landed then refactored / renamed / superseded within the cycle → one entry for
    the final state only.** Never "added X (#1), then reworked X's API (#2)" — describe
    the X that actually ships, as a single entry.
- **Diff, don't paraphrase commit subjects.** Commit messages lie, squash, and
  omit. Read the real `git diff` for each area and describe what the code/docs
  actually do now. Commit history is only a map of *where* to look and *what to drop*.
- **The archived content is never rewritten, only re-nested.** When you rotate the
  current [`CHANGELOG.md`](../../CHANGELOG.md) into the archive, the *prose is untouched* — same wording,
  bullets, tables, links, and `#PR` refs. The only permitted changes are the
  mechanical re-nesting described in Step 3 (drop the title, reposition the
  release-notes blockquote, add an `### Overview` header, demote every heading one
  level). Never re-summarize or "improve" archived content.
- **Match the house depth.** Existing entries use file paths, module/responsibility
  tables, and dependency lists. Aim for that specificity, not one-liners.
- **The changelog and release notes are prose — apply the docs style guide.**
  [`CHANGELOG.md`](../../CHANGELOG.md) and `docs/reference/release-notes/*.md` are not exempt from
  [`docs/reference/maintainers/style.md`](../../docs/reference/maintainers/style.md). In particular wrap prose lines to
  **150–180 chars** (tables and fenced code are exempt), and follow its link and
  wording conventions. Read `style.md` before writing these files.
- **The changelog is a published artifact — no internal references.** Never cite
  PR/issue numbers, branch names, internal ticket ids, or contributor handles: to an
  outside reader they are dead links that mislink to unrelated items and expose internal
  development activity. Describe every change by its **outcome and code paths** only.
  Public identifiers (GHSA advisory ids, published package names/versions, the release
  tag) are fine. (Old archived entries may still contain such refs — leave them verbatim
  per the archive rule, but never add new ones.)
- **Keep confidential material out.** No real customer/site/device names or telemetry,
  no third-party/partner names, no unreleased or internal-only features or flag names,
  and no internal identifiers. Run whatever pre-publish leak check your project provides
  before handing off.
- **Draft only — do not commit, tag, or push.** Leave the files staged-but-uncommitted
  for the user to review.

## Layout this skill owns

| File | Role |
|---|---|
| [`CHANGELOG.md`](../../CHANGELOG.md) (repo root) | Detailed changelog for the **current** release. Header `# Changelog: mdk-X.Y.Z` → `## vX.Y.Z` → sections. |
| `docs/reference/changelog-archive/<year>-archive.md` | Past releases, appended in **ascending** order (newest at the bottom). Each entry is nested one level below the live changelog — top header `## vX.Y.Z`, sections `### …`, subsections `#### …` (see Step 3). |
| `docs/reference/release-notes/<X.Y.Z>-release.md` | High-level per-version summary, cross-linked from the changelog. |
| `linkinator.config.json` (repo root) | Link-check config. One `skip` entry per release-tag URL — see Step 5. |

## Step 1 — Establish the range and versions

```bash
git fetch --tags --quiet 2>/dev/null || true
PREV_TAG=$(git describe --tags --abbrev=0)      # previous release tag
echo "Previous tag: $PREV_TAG"
```

- **BASE** = the tag/ref you diff *from* (usually `$PREV_TAG`). **TARGET** = the ref you
  diff *to* — HEAD, or an explicit ref (e.g. a remote release branch) if the release is
  being cut there rather than on your checkout.
- **Range to investigate:** `BASE..TARGET`. If the user named two tags, use them.
- **`CUR_VERSION`** = version parsed from the existing [`CHANGELOG.md`](../../CHANGELOG.md) first line
  (`# Changelog: mdk-X.Y.Z`) **on TARGET** — `git show TARGET:CHANGELOG.md | head -1`,
  not necessarily your working copy. This is the release about to be archived.
- **`NEW_VERSION`** = `$ARGUMENTS` if given; else propose a bump from `$PREV_TAG`
  (patch/minor/major) and **ask the user to confirm** before writing anything.

**Guard against a divergent BASE — this is mandatory, not optional.** A tree diff
across two branches that have diverged is garbage: the commits unique to BASE show up
as *deletions*, so the changelog would list the previous release's own work as
"Removed." Verify BASE is a true ancestor of TARGET first:

```bash
git merge-base --is-ancestor "$BASE" "$TARGET" && echo "OK: linear" || echo "DIVERGENT — STOP"
git rev-list --count "$TARGET".."$BASE"    # commits in BASE missing from TARGET — must be 0
```

If it reports DIVERGENT (or the count is non-zero), **stop and report** — do not
generate from that range. Offer the fixes: pick a BASE that *is* an ancestor
(`git describe --tags TARGET`), or rebase/merge TARGET onto BASE first so the range
becomes linear.

Then sanity-check and report the plan before proceeding:
- If `NEW_VERSION == CUR_VERSION`, do **not** archive — the current CHANGELOG already
  targets this version; you are only refreshing it.
- If a `## vCUR_VERSION` header already exists in the archive, skip archiving (idempotent)
  and say so.

## Step 2 — Investigate the history carefully

Build a map of the surface area first, then read the real diffs.

```bash
git log --oneline --no-merges "$BASE".."$TARGET"        # what happened
git diff --stat "$BASE".."$TARGET"                       # where, how big
git diff "$BASE".."$TARGET" -- backend/ | head -400      # read per domain
git diff "$BASE".."$TARGET" -- ui/       | head -400
git diff "$BASE".."$TARGET" -- examples/ docs/
```

**The net tree diff is the truth; the log is the map.** `git diff BASE..TARGET`
already reflects the *outcome* — work that was added and later reverted in the cycle
simply isn't in it, and work that was reworked shows only its final form. So describe
what the diff shows, and use the log only to (a) understand intent and (b) spot churn
to collapse. When a commit subject describes something you can't find in the net diff
(e.g. "add Foo" but there's no Foo), it was reverted or superseded later — **leave it
out**. When several commits touch the same surface ("add Foo", "rename Foo", "fix Foo
types"), write **one** entry for the Foo that ships.

Then dig into each meaningful area with focused `git diff`/`git show` and, where the
diff is ambiguous, open the current file with Read to confirm present-day behavior.
Pay special attention to:

- **Breaking changes** — removed/renamed exports, moved files, changed `package.json`
  `exports`/`files`/`engines`, protocol version bumps, required consumer migration steps.
- **New public API** — new packages, hooks, components, CLI commands, protocol actions,
  workers, plugins. Note the import path and the gating (permissions, flags).
- **Dependency changes** — added/removed/bumped deps and *why* (feature vs. security).
- **Security** — pinned/overridden deps clearing advisories (cite the GHSA id).

Categorize every real change into: **Breaking changes / Added / Changed / Removed /
Security / Fixed**. Drop noise (formatting-only, internal churn with no consumer impact)
unless it changes a documented contract.

## Step 3 — Rotate the current changelog into the archive

Only if Step 1 said to archive. The archive nests each release one heading level
**below** the live changelog, so it reads as one long document. This is a mechanical
re-nesting — the prose never changes. Reproduce the shape of the most recent existing
archive entry exactly (read it first: `grep -nE '^#{1,2} v[0-9]' <archive>` then look at
the newest block).

The live [`CHANGELOG.md`](../../CHANGELOG.md) looks like:

```markdown
# Changelog: mdk-X.Y.Z
> For a high-level introduction, see the [release notes](./docs/reference/release-notes/X.Y.Z-release.md).
## vX.Y.Z
- summary bullets…
## Breaking changes
### <subsection>
…
> For previous releases, see the [changelog archive](...)
```

The archived entry must become:

```markdown
## vX.Y.Z
> For a high-level introduction, see the [vX.Y.Z release notes](../release-notes/X.Y.Z-release.md).
### Overview
- summary bullets…
### Breaking changes
#### <subsection>
…
```

The exact transform (apply in order):

1. **Drop** the `# Changelog: mdk-X.Y.Z` title line.
2. **Keep** `## vX.Y.Z` as the entry's top header (h2 — do *not* demote this one).
3. **Reposition + rewrite** the release-notes blockquote to sit right under `## vX.Y.Z`,
   changing its text to `[vX.Y.Z release notes]` and its path from
   `./docs/reference/release-notes/…` to the archive-relative `../release-notes/…`.
4. **Insert** an `### Overview` header before the summary bullets.
5. **Demote every other heading one level:** `## Section` → `### Section`,
   `### Sub` → `#### Sub`, `#### …` → `##### …`. (Guard against `#` lines inside fenced
   code blocks — track fence state and never demote those. Verify first with
   `grep -c '```' CHANGELOG.md`.)
6. **Drop** the trailing `> For previous releases…` archive blockquote.
7. Leave all prose, bullets, tables, links, and `#PR` refs byte-identical otherwise.

Then append the transformed entry at the **bottom** of the year archive
(`docs/reference/changelog-archive/<year>-archive.md`; create it if missing), separated
by one blank line. **Do not touch any other archived entry** — the verify step confirms
the diff is append-only. A small transform script (drop/reorder/demote over the lines,
respecting fences) is more reliable than hand-editing a long changelog.

## Step 4 — Write the new [`CHANGELOG.md`](../../CHANGELOG.md)

Overwrite [`CHANGELOG.md`](../../CHANGELOG.md) for `NEW_VERSION`, following the existing shape exactly:

```markdown
# Changelog: mdk-<NEW_VERSION>

> For a high-level introduction, see the [release notes](./docs/reference/release-notes/<NEW_VERSION>-release.md)

## v<NEW_VERSION>

- 3–5 bullets summarizing the release's theme

## Breaking changes
...
## Added
...
## Changed
...
## Removed
...
## Security
...
## Fixed
...

> For previous releases, see the [changelog archive](./docs/reference/changelog-archive/<year>-archive.md)
```

- Omit any section that has no entries (the existing files do).
- Use concrete paths, tables, and dependency lists as the existing entries do.
- Keep the leading release-notes blockquote and the trailing archive blockquote.

## Step 5 — Draft the release notes

Create `docs/reference/release-notes/<NEW_VERSION>-release.md`, matching the existing
files' structure (`# Release v<NEW_VERSION>` → `## Overview` → `## Breaking changes` →
`## What's new` → `## Removed` → `## Fixed` → `## Downloads`). This is the *high-level*
audience-facing summary — distill the changelog, don't copy it. End with:

```markdown
## Downloads

- Git tag: v<NEW_VERSION>
```

Format the release/tag link exactly as the previous `docs/reference/release-notes/*.md`
file does — copy its convention rather than hardcoding a URL here.

### Allow the not-yet-published tag URL through the link check

**Do this in the same changeset, or CI fails.** That Downloads link points at a release
tag that does not exist until the release is actually cut, so the repo's link checker
404s on it — on the very PR that adds the notes. It is one broken link out of ~50, and it
is the *only* thing that fails, so the job's red is easy to misread as a real problem
with the changelog.

Add the new tag's URL to the `skip` array in `linkinator.config.json`, directly after the
previous release's entry:

```jsonc
"https://github.com/tetherto/mdk/releases/tag/v<PREV_VERSION>",
"https://github.com/tetherto/mdk/releases/tag/v<NEW_VERSION>",   // ← add this
```

This is the standing convention, not a workaround: every tag from `v0.2.0` onward already
has an identical entry for the same reason. Match the existing style — a plain literal
string, and no `_skip_notes` entry (the tag entries deliberately carry none).

Read the file first and copy the real URL shape from the neighbouring entries; the host
and path are the *public mirror's*, which is not the repo you are working in.

## Step 6 — Verify and hand off

- Confirm the archive still parses (version headers in ascending order, newest at the
  bottom, old entries unchanged): `git diff --numstat docs/reference/changelog-archive/`
  should show **`N  0`** (additions only, zero deletions), and the single hunk header
  should sit at the end of the file — never edits inside prior versions.
- Confirm cross-links resolve (release-notes path in CHANGELOG.md points to the file
  you created; archive link year is correct).
- Confirm the new release-tag URL is in `linkinator.config.json`'s `skip` array and that
  the config still parses — a trailing-comma slip there fails the link job just as loudly
  as the 404 it exists to prevent:

  ```bash
  node -e 'const c=require("./linkinator.config.json");
    const u="https://github.com/tetherto/mdk/releases/tag/v<NEW_VERSION>";
    console.log(c.skip.some(s=>new RegExp(s).test(u)) ? "OK: skipped" : "MISSING")'
  ```
- Run a quick content check for confidential material before handing off (real
  customer/site/device names, partner names, internal-only features or flag names),
  using whatever pre-publish leak check your project provides.
- Summarize to the user: version range diffed, what was archived, section counts in the
  new changelog, and the files written. **Do not commit** — leave everything for review.
