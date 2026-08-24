---
title: Install the CLI
description: "[⏱️ ~3 min] Get `mdk` installed and verified from a tagged source checkout"
docs@tether_slug: guides/cli/install
---

`mdk` is MDK's command-line tool for standing up and operating a stack from your terminal.
It scaffolds a stack (`mdk create`), boots it (`mdk run`), and reports its health (`mdk status`),
all driven by the `mdk.yaml` spec `mdk onboard` writes for you.

## Prerequisites

- [Node.js][node] >= 24
- [git][git]

> [!NOTE]
> `@tetherto/mdk-cli` isn't published to npm yet — install from a tagged source checkout.

## Install

```bash
git clone --branch v0.7.0 https://github.com/tetherto/mdk.git && cd mdk/packages
npm install
cd cli && npm run build && npm link
```

## Verify

```bash
mdk --version
# 0.7.0
```

## Command groups

| Group             | Commands                                                    |
| ----------------- | ------------------------------------------------------------ |
| Onboarding        | `mdk onboard`                                                |
| Scaffold          | `mdk create worker\|plugin\|dashboard`                       |
| Run & manage      | `mdk run [target]`, `mdk status`                             |
| Agent enablement  | `mdk skill add`                                              |
| Meta              | `mdk version`                                                |

The [CLI's command surface][cli-reference] documents the full flag reference.

## Update

```bash
git pull && npm install && npm run build
```

## Uninstall

```bash
npm rm -g @tetherto/mdk-cli
```

## Next steps

- Try the [demo][try-the-demo] to see a stack running end to end

## Links

[node]: https://nodejs.org/
<!-- docs@tether.io: external link — preserve URL -->

[git]: https://git-scm.com/
<!-- docs@tether.io: external link — preserve URL -->

[cli-reference]: ../../../packages/cli/README.md#command-surface
<!-- docs@tether.io: cli-reference → https://github.com/tetherto/mdk/blob/main/packages/cli/README.md#command-surface -->
<!-- mdk-monorepo: temp — points at the package README's command table until Stage 5's generated /reference/tooling/cli lands, then repoint to that -->

[try-the-demo]: ../../tutorials/run-a-site.md
<!-- docs@tether.io: try-the-demo → tutorials/run-a-site -->
<!-- mdk-monorepo: temp — retarget to start/your-first-app once Stage 2 lands -->
