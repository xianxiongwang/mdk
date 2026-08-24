Style guide for MDK

Context: globs: docs/**/*.md, **/README.md, backend/**/docs/**/*.md, ui/**/docs/**/*.md

# Style

- US English
- Sentence case headings (first word and proper nouns only)
- Proper nouns for MDK components, capitalize in prose (plurals too): Gateway, Worker, Worker Plugin, Kernel
- Present tense, direct voice (e.g. "This page walks through…", not "This page will walk through…")
- Code identifiers in backticks (package names, file names, function names, etc.)
- Title lives in frontmatter only; don't repeat it as an H2
- Restrict line length to 150-180 chars (context is prose; tables are an exception)
- Bullet lists no stop  (e.g. - Avalon not - Avalon.)
- Numbered lists stop (e.g. 1. Do this action.)
- Diataxis ia
- No positional references ("Swap the filename for any other model from the table” NOT "Swap the filename for any other model from the table above,”)
- No --- divider, use headings H1, H2, H3 etc to impose structure
- No em dash; people may use those, not llms
- Colons go **outside of bullets**: as this example is written, notice bullet NOT emdash

## Frontmatter and linking strategy

Links are from relevent text NOT "see ..." (do "The [Worker install pattern][install-pattern] defines the per-Worker mechanics." NOT "See the Worker [install pattern][install-pattern] for the per-Worker mechanics.").

The link text is the concept or action being described, never the page name or location.

If a file is being referenced also link to it (do [`README.md`](../../README.md) Not `README.md`)

Mechanically:

- Start the bullet with a verb phrase ("Understand...", "Learn how...", "Choose a...", "Start...")
- Wrap the concept or outcome in the link: the thing the reader will learn or do

Ask maintainer if the page you are building is to be ported to user docs `tether.io`, if so follow reference-style link definitions plus routing comments [porting signals](single-source-of-truth.md).

## Fixed sections, in order

1. `## TL;DR` (optional): only when the page's core fact fits in a few lines. Comes before `## Overview` when present.
2. `## Overview`: one paragraph, or `## How it works` followed by a sentence starting "This page ..."
3. `## Next steps`: bullet list, each item `[Label](path): description` (no bold, no em dash)

## Admonitions

- `> [!NOTE]`: context, side info
- `> [!TIP]`: an easier or optional way to do something
- `> [!IMPORTANT]`: common failure modes and their fix
- `> [!WARNING]`: security or destructive action
- `> [!CAUTION]`: a risk or pitfall that falls short of WARNING but still needs the reader's care

## Code blocks

- Always fenced with language tag (`bash`, `js`, etc.) except terminal session output which uses plain ` ``` `
- Expected output blocks are plain ` ``` ` with a preceding "Expected output" sentence

## Tutorial style

Inherits from above

description: Style guide for MDK tutorials
context: globs: docs/tutorials/**/*.md

## Frontmatter

```yaml
title: Verb-first, outcome-focused title
description: From X to Y in Z minutes
docs@tether_slug: tutorials/<path>/
```

## Fixed sections, in order

1. `> [!NOTE]` linking to prerequisite concepts (if needed).
2. `## Overview`: one paragraph + "What you'll have at the end" bullet list + orienting sentence pointing at the example.
3. `## Prerequisites`: plain bullet list (`- Tool vX`).
4. `<Steps>` … `</Steps>`: see [Steps structure](#steps-structure).
5. `## What just happened`: numbered list, **bold term** then explanation.
6. `## Cleanup`: how to stop and remove state.
7. `## Next steps`: bullet list, each item `[Label](path): description` (no bold, no em dash).

## Steps structure

```md
<Steps>

<Step>

### Step title

#### N.M Sub-step title

content

</Step>

</Steps>
```

- `###` for each `<Step>` title: no "Step N:" prefix (component numbers automatically)
- `####` for sub-steps: keep the `N.M` prefix
- Optional steps: `### (Optional) Title`
