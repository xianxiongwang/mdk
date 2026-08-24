import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Package root of the CLI itself — the anchor for finding the MDK checkout. */
const CLI_ROOT = resolve(__dirname, '..', '..');

export interface CatalogPlugin {
  /** npm package name — what `mdk.yaml` references when it resolves from the registry. */
  value: string;
  label: string;
  hint: string;
  /**
   * Location inside the MDK checkout, for a package that ships with MDK but is
   * not on npm yet. When the CLI runs from the checkout, the project depends on
   * it via a `file:` reference to that checkout path — `npm install` symlinks
   * it straight into `node_modules/<package>`, exactly as it would a published
   * package. No project folder is created for it: `workers/*` and `plugins/*`
   * are reserved for packages the user actually owns (`mdk create ...`).
   *
   * A `file:` link (rather than a copy) also keeps in-checkout relative
   * resolution working: Node resolves a symlinked package from its real
   * location, so a device mock finds its shared framework and a gateway
   * plugin finds the deps in its own node_modules.
   */
  repoPath?: string;
}

export interface CatalogWorker extends CatalogPlugin {
  /** Worker-level config the plugin reads, beyond its device list. */
  config?: Record<string, unknown>;
  /**
   * Per-device opts beyond the `host`/`port`/`serial` every seed device gets.
   *
   * One object is handed to both the plugin's `connect()` and the device mock,
   * so it has to satisfy both at once.
   */
  deviceOpts?: Record<string, unknown>;
  /** Boot a device simulator from `<pkg>/mock/server.js`, so no hardware is needed. */
  mock?: boolean;
}

/**
 * Worker plugins offered by `mdk onboard`.
 *
 * Entries with a `repoPath` are real and runnable. The rest are placeholders for
 * packages we have not published, kept so the shape of the catalog is visible —
 * selecting one writes a valid spec entry but its install will 404 and its
 * device config has to be filled in by hand.
 */
export const WORKER_CATALOG: CatalogWorker[] = [
  {
    value: '@tetherto/mdk-worker-antminer',
    label: 'mdk-worker-antminer',
    hint: 'Bitmain Antminer S19/S21 — bundled, runs against a simulator',
    repoPath: join('backend', 'workers', 'miners', 'antminer'),
    mock: true,
    deviceOpts: {
      // The mock rejects a type outside s19xp|s19xp_h|s21|s21pro and picks its
      // route table from it; the plugin strips a `miner-am-` prefix off the same
      // value to key model-specific response parsing. `s19xp` satisfies both.
      //
      // It is also the only one of the four that stays healthy against the mock:
      // for the others the plugin reads power from a `/miner_power` endpoint the
      // mock does not implement, so every poll records a device error. The
      // tradeoff is that an S19XP reports no power figure (and so no
      // efficiency) — that is the model's own API, not a gap in this config.
      type: 's19xp',
      // The plugin's connect() reads `address` where the mock reads `host`. Both
      // name the same loopback device, so they are written as a matched pair.
      address: '127.0.0.1',
      username: 'root',
      password: 'root',
      // Passed explicitly because the plugin's efficiency table is keyed by the
      // prefixed model name (`miner-am-s19xp`), which the mock would reject —
      // without it the reported efficiency would silently be 0.
      nominalEfficiencyWThs: 21,
    },
  },
  {
    value: '@tetherto/mdk-worker-powermeter',
    label: 'mdk-worker-powermeter',
    hint: 'power meters (stub — not published yet)',
  },
  {
    value: '@org/mdk-worker-modbus',
    label: 'mdk-worker-modbus',
    hint: 'generic Modbus devices (stub — not published yet)',
  },
];

/**
 * Gateway plugins offered by `mdk onboard`. Entries with a `repoPath` are real
 * and runnable from the MDK checkout; the rest are placeholders for packages we
 * have not published — selecting one writes a valid spec entry but its install
 * will 404.
 */
export const GATEWAY_CATALOG: CatalogPlugin[] = [
  {
    value: '@tetherto/mdk-plugin-agent',
    label: 'mdk-plugin-agent',
    hint: 'auth-gated operator agent chat (sessions, SSE, approvals) — bundled',
    repoPath: join('backend', 'plugins', 'agent'),
  },
  {
    value: '@tetherto/mdk-plugin-summary',
    label: 'mdk-plugin-summary',
    hint: 'fleet summary (stub — not published yet)',
  },
  {
    value: '@tetherto/mdk-plugin-alerts',
    label: 'mdk-plugin-alerts',
    hint: 'alerting (stub — not published yet)',
  },
];

export function findCatalogWorker(pkg: string): CatalogWorker | undefined {
  return WORKER_CATALOG.find((entry) => entry.value === pkg);
}

export function findCatalogGatewayPlugin(pkg: string): CatalogPlugin | undefined {
  return GATEWAY_CATALOG.find((entry) => entry.value === pkg);
}

/**
 * Absolute path to `repoPath` in the MDK checkout, found by walking up from the
 * CLI's own location. Returns null when the CLI is installed standalone from
 * npm, where there is no checkout to point at.
 */
function findInCheckout(repoPath: string): string | null {
  let dir = CLI_ROOT;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, repoPath);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    dir = dirname(dir);
  }
  return null;
}

export interface ResolvedCatalogPackage {
  /** npm package name — what `mdk.yaml` references and what lands in node_modules. */
  packageName: string;
  /** True when the package is `file:`-linked from the checkout rather than the registry. */
  bundled: boolean;
  /** Set when the entry wanted the checkout but the CLI is running standalone. */
  unavailable?: boolean;
  /** Absolute checkout path — present when bundled and resolvable. */
  checkoutDir?: string;
}

/**
 * Decides how a selected catalog entry (worker or gateway plugin) should be
 * installed. A bundled package is declared as a `file:`-linked dependency
 * pointing at its checkout path; everything else is installed from the
 * registry.
 */
export function resolveCatalogPackage(entry: CatalogPlugin): ResolvedCatalogPackage {
  const packageName = entry.value;
  if (!entry.repoPath) return { packageName, bundled: false };

  const dir = findInCheckout(entry.repoPath);
  if (dir) return { packageName, bundled: true, checkoutDir: dir };
  return { packageName, bundled: false, unavailable: true };
}
