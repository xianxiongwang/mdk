import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchTemplate } from './fetch-template.js';
import { installDeps, npmBin } from './npm.js';
import { DIRS } from './project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Template subtree name — a runnable Vite app that doubles as the CLI template. */
const TEMPLATE_DIR_NAME = 'mdk-ui-shell-template';

/** Package root of the CLI (from `dist/lib/*.js` and `src/lib/*.ts` alike). */
const CLI_ROOT = resolve(__dirname, '..', '..');

/**
 * Builds the GitHub tree URL for the UI shell template at a given ref. Standalone
 * (published) installs scaffold from here since the heavy Vite app is not bundled
 * into the CLI package.
 */
export function shellTemplateUrl(ref = 'main'): string {
  return `https://github.com/tetherto/mdk/tree/${ref}/examples/${TEMPLATE_DIR_NAME}`;
}

/** Folder + package.json name for a stack's dashboard app. */
export function dashboardNameFromStack(stackName: string): string {
  return `${stackName}-dashboard`;
}

export interface DashboardOptions {
  /** Package + display name for the generated shell (e.g. `my-stack-dashboard`). */
  name: string;
  /** Project root the app is created under. */
  parentDir: string;
  /**
   * Where the app lands, relative to `parentDir` (default `apps/dashboard`).
   * Kept separate from `name` so the path stays stable while the package keeps a
   * descriptive, stack-derived name.
   */
  subdir?: string;
  /** Branch/tag to fetch from GitHub when not inside the monorepo (default: `main`). */
  ref?: string;
  /** Overwrite the target directory if it already exists (default: false). */
  force?: boolean;
  /** Run `npm install` in the scaffolded dashboard (default: true). */
  install?: boolean;
  /**
   * Gateway base URL the dev server proxies to (`http://localhost:<port>`).
   * When omitted it is read from `<parentDir>/mdk.yaml`'s `spec.gateway.port`.
   */
  gatewayUrl?: string;
}

export interface DashboardResult {
  ok: boolean;
  message: string;
  detail?: string;
  appPath?: string;
  /** Where the template came from: the local monorepo checkout or GitHub. */
  source?: 'monorepo' | 'github';
  /** Warning surfaced when `npm install` could not complete (scaffold still ok). */
  installWarning?: string;
}

/** The MDK UI library packages the template links via `file:` (monorepo-local). */
const MDK_DEP_SCOPE = '@tetherto/';

/**
 * Locates the runnable UI shell template inside the monorepo by walking up from
 * the CLI's own location to a `examples/mdk-ui-shell-template`. Returns the
 * template dir (and monorepo root) when the CLI is run from the monorepo, else
 * null (published/standalone — scaffold from GitHub instead).
 */
function findLocalTemplate(): { templateDir: string; monorepoRoot: string } | null {
  let dir = CLI_ROOT;
  while (dir !== dirname(dir)) {
    const templateDir = join(dir, 'examples', TEMPLATE_DIR_NAME);
    if (existsSync(join(templateDir, 'package.json'))) {
      return { templateDir, monorepoRoot: dir };
    }
    dir = dirname(dir);
  }
  return null;
}

/** The published range to pin standalone MDK deps to (`^<cliVersion>`, else `latest`). */
function publishedMdkRange(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (pkg.version) return `^${pkg.version}`;
  } catch {
    /* fall through */
  }
  return 'latest';
}

/**
 * Disk artifacts the runnable template accrues in place (it is a real app you can
 * `npm run dev`) that must never land in a scaffolded copy.
 */
const COPY_EXCLUDES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.env',
  '.env.local',
  '.vite',
  'package-lock.json',
]);

function isCopyExcluded(src: string): boolean {
  const base = src.split('/').pop() ?? '';
  return COPY_EXCLUDES.has(base) || base.endsWith('.log') || base.endsWith('.tsbuildinfo');
}

/**
 * Scaffolds the MDK UI shell (dashboard) into a project directory.
 *
 * When the CLI runs from the monorepo, it copies the local
 * `examples/mdk-ui-shell-template` (no network). Otherwise it downloads the
 * template subtree from GitHub. Either way it finalizes the copy for its target:
 * sets the app name, rewrites the template's monorepo-local `file:` MDK deps
 * (→ absolute local links in the monorepo, → a published range standalone),
 * injects the display name, and strips the on-demand `_managed/` demo pages.
 */
export async function createDashboard(opts: DashboardOptions): Promise<DashboardResult> {
  const appPath = resolve(opts.parentDir, opts.subdir ?? DIRS.dashboard);
  if (existsSync(appPath) && !opts.force) {
    return { ok: false, message: `${appPath} already exists (use --force to overwrite).` };
  }

  const local = findLocalTemplate();
  const gatewayUrl = opts.gatewayUrl ?? readGatewayUrl(opts.parentDir);

  try {
    if (local) {
      rmSync(appPath, { recursive: true, force: true });
      cpSync(local.templateDir, appPath, {
        recursive: true,
        filter: (src) => !isCopyExcluded(src),
      });
      finalizeShell(appPath, opts.name, { templateDir: local.templateDir, isMonorepo: true, gatewayUrl });
    } else {
      await fetchTemplate(shellTemplateUrl(opts.ref), appPath, opts.force ?? false);
      finalizeShell(appPath, opts.name, { templateDir: appPath, isMonorepo: false, gatewayUrl });
    }

    // Installed in place, not at the project root: the dashboard is deliberately
    // outside the npm workspaces (see project.ts WORKSPACES) so its Vite/React
    // tree is never hoisted alongside the `file:`-linked MDK UI packages.
    const install = installDeps(appPath, opts.install !== false);
    return {
      ok: true,
      message: '',
      appPath,
      source: local ? 'monorepo' : 'github',
      installWarning: install.ok ? undefined : install.message,
    };
  } catch (error) {
    return {
      ok: false,
      message: local
        ? 'Could not scaffold the UI shell from the local monorepo template.'
        : 'Could not fetch the UI shell (check your network connection and the ref).',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Finalize the freshly copied tree for the new runnable-template conventions:
 *  - remove a stale `package-lock.json` and the on-demand `_managed/` demo pages.
 *  - copy `.env.example` → `.env` so the app loads its config out of the box.
 *  - set package.json `name` + rewrite the template's `file:` MDK deps for the
 *    target context (absolute local links in the monorepo; a published range
 *    standalone) so `npm install` resolves them from the new location.
 *  - inject the chosen name into the `APP_NAME` display constant.
 */
function finalizeShell(
  dir: string,
  appName: string,
  {
    templateDir,
    isMonorepo,
    gatewayUrl,
  }: { templateDir: string; isMonorepo: boolean; gatewayUrl?: string | null },
): void {
  rmSync(join(dir, '_managed'), { recursive: true, force: true });
  rmSync(join(dir, 'package-lock.json'), { force: true });

  // Activate the env file: Vite loads `.env`, not `.env.example`. Copied rather
  // than renamed so the example stays in the repo as the committed reference —
  // the generated `.env` is machine-local and gitignored.
  const envExample = join(dir, '.env.example');
  const envFile = join(dir, '.env');
  if (existsSync(envExample) && !existsSync(envFile)) {
    copyFileSync(envExample, envFile);
  }

  // Point the dev-server proxy + OAuth at this stack's gateway (mdk.yaml port).
  if (gatewayUrl && existsSync(envFile)) {
    let env = readFileSync(envFile, 'utf8');
    env = setEnvVar(env, 'VITE_GATEWAY_URL', gatewayUrl);
    env = setEnvVar(env, 'VITE_OAUTH_BASE_URL', gatewayUrl);
    writeFileSync(envFile, env, 'utf8');
  }

  rewritePackageJson(join(dir, 'package.json'), { appName, templateDir, isMonorepo });
  setDisplayName(dir, appName);
}

/** Reads `http://localhost:<gateway.port>` from `<parentDir>/mdk.yaml`, else null. */
function readGatewayUrl(parentDir: string): string | null {
  const specPath = resolve(parentDir, 'mdk.yaml');
  if (!existsSync(specPath)) return null;
  try {
    const doc = parseYaml(readFileSync(specPath, 'utf8')) as {
      spec?: { gateway?: { port?: number } };
    };
    const port = doc.spec?.gateway?.port;
    if (typeof port === 'number' && port > 0) return `http://localhost:${port}`;
  } catch {
    /* not fatal — fall back to the template default */
  }
  return null;
}

/** Sets `KEY=value` in a dotenv string, replacing an existing line or appending. */
function setEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  return `${content}${content.endsWith('\n') ? '' : '\n'}${line}\n`;
}

/**
 * Rewrite the scaffolded package.json for its target context. The app takes the
 * chosen bare name (the `@tetherto/` scope belongs to the MDK library packages).
 * The template links MDK packages via `file:` so it runs in place; a copy must
 * not inherit those now-broken relative links:
 *   - MONOREPO → resolve each `file:` link against the template dir to an
 *     absolute local path (works from any scaffold location, no workspace needed).
 *   - STANDALONE → rewrite `file:` MDK deps to a published range.
 */
function rewritePackageJson(
  pkgJsonPath: string,
  { appName, templateDir, isMonorepo }: { appName: string; templateDir: string; isMonorepo: boolean },
): void {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    name?: string;
    dependencies?: Record<string, string>;
  };
  pkg.name = appName;

  const deps = pkg.dependencies;
  if (deps) {
    const range = publishedMdkRange();
    for (const [name, spec] of Object.entries(deps)) {
      if (!spec.startsWith('file:') || !name.startsWith(MDK_DEP_SCOPE)) continue;
      deps[name] = isMonorepo
        ? `file:${resolve(templateDir, spec.slice('file:'.length))}`
        : range;
    }
  }
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/**
 * The shell centralises its human-facing name in an `APP_NAME` constant
 * (src/constants/env.ts) — the browser tab + Home heading read it. Rewrite it to
 * the chosen name. No-op for templates without that constant.
 */
function setDisplayName(dir: string, appName: string): void {
  const envPath = join(dir, 'src', 'constants', 'env.ts');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  const next = content.replace(/(export const APP_NAME\s*=\s*)(['"]).*?\2/, `$1'${appName}'`);
  if (next !== content) writeFileSync(envPath, next, 'utf8');
}

/** True when `dir` has a package.json declaring an npm `dev` script. */
function hasDevScript(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.dev === 'string';
  } catch {
    return false;
  }
}

/**
 * Locates a scaffolded dashboard app in a project. Tries the canonical
 * `apps/dashboard` first (what `mdk create dashboard` uses with no `--name`);
 * failing that, scans `apps/*` for the first app with a `dev` script, so a
 * dashboard created with a custom name is still found without extra plumbing.
 * Returns null when no app is found.
 */
export function findDashboardDir(projectDir: string): string | null {
  const canonical = resolve(projectDir, DIRS.dashboard);
  if (hasDevScript(canonical)) return canonical;

  const appsRoot = resolve(projectDir, DIRS.apps);
  if (!existsSync(appsRoot)) return null;
  for (const name of readdirSync(appsRoot).sort()) {
    const dir = join(appsRoot, name);
    if (hasDevScript(dir)) return dir;
  }
  return null;
}

/** A running dashboard dev server and how to stop it. */
export interface DashboardHandle {
  process: ChildProcess;
  stop: () => Promise<void>;
}

/**
 * Runs the dashboard's dev server (`npm run dev`) in `dir`, streaming its
 * output directly to this process's stdio.
 *
 * Unlike the Kernel, Gateway and Workers — all booted in-process — the
 * dashboard is a separate Vite/React app with its own dependency tree (kept out
 * of the project's npm workspaces precisely so its React is never hoisted
 * alongside anyone else's, see `project.ts`), so it can only run as its own
 * process. The returned promise resolves once the process has actually spawned
 * (Node's `'spawn'` event) and rejects if it never could (e.g. `npm` missing).
 */
export function runDashboard(dir: string): Promise<DashboardHandle> {
  return new Promise((resolveHandle, reject) => {
    const child = spawn(npmBin(), ['run', 'dev'], {
      cwd: dir,
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error('npm was not found on PATH — cannot start the dashboard dev server.')
          : new Error(`Failed to start the dashboard dev server: ${error.message}`),
      );
    });

    child.once('spawn', () => {
      resolveHandle({
        process: child,
        stop: () =>
          new Promise((resolveStop) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolveStop();
              return;
            }
            child.once('exit', () => resolveStop());
            child.kill('SIGTERM');
          }),
      });
    });
  });
}
