import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Project scaffolding shared by `mdk onboard` and `mdk create` — the files that
 * describe the *project* rather than any one component.
 *
 * The emitted layout is role-grouped, mirroring MDK's own component model, so a
 * path in `mdk.yaml` says what it is:
 *
 *   mdk.yaml          the stack spec
 *   package.json      private root manifest; workers/ + plugins/ are workspaces
 *   workers/<name>/   worker plugins   (mdk create worker)
 *   plugins/<name>/   gateway plugins  (mdk create plugin)
 *   apps/dashboard/   the UI dashboard (mdk create dashboard)
 *   .mdk/             runtime state written by `mdk run` (gitignored)
 */

/** Component directories, relative to the project root. */
export const DIRS = {
  workers: 'workers',
  plugins: 'plugins',
  apps: 'apps',
  /** Canonical dashboard location — a stable path, unlike the app's package name. */
  dashboard: join('apps', 'dashboard'),
} as const;

/**
 * npm workspace globs for the root manifest.
 *
 * Workers and gateway plugins are workspaces because the runtime resolves them
 * from the project's `node_modules` (`resolveProjectPackageDir`), which a
 * workspace symlink satisfies for free — and one root `npm install` then covers
 * every component. `apps/*` is deliberately excluded: the dashboard links the
 * MDK UI packages by `file:` path, and hoisting its React through the root
 * alongside those links is a well-known way to end up with two Reacts.
 */
export const WORKSPACES = [`${DIRS.workers}/*`, `${DIRS.plugins}/*`];

/** npm workspace-local version — links to a sibling under `workers/*` or `plugins/*`. */
export const WORKSPACE_VERSION = '*';

export type FileAction = 'created' | 'updated' | 'present';

/** Coerces a stack name into a valid npm package name. */
function npmName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[-._]+$/g, '');
  return slug || 'mdk-stack';
}

/**
 * Ensures the project has a private root `package.json` declaring the component
 * workspaces. Creates one if absent; if a manifest already exists it only adds
 * the missing `workspaces` field (the project may be a pre-existing app — its
 * name, deps and scripts are never touched).
 */
export function ensureProjectManifest(targetDir: string, stackName: string): FileAction {
  const path = join(targetDir, 'package.json');

  if (!existsSync(path)) {
    const manifest = {
      name: npmName(stackName),
      version: '0.1.0',
      private: true,
      workspaces: WORKSPACES,
      scripts: { dev: 'mdk run' },
    };
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return 'created';
  }

  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (Array.isArray(pkg.workspaces) || pkg.workspaces) return 'present';
    pkg.workspaces = WORKSPACES;
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    return 'updated';
  } catch {
    // Unparseable manifest is the user's to fix — never overwrite it.
    return 'present';
  }
}

/** The project's declared workspace globs (empty when it is not a workspace root). */
function readWorkspaces(targetDir: string): string[] {
  const path = join(targetDir, 'package.json');
  if (!existsSync(path)) return [];
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { workspaces?: unknown };
    return Array.isArray(pkg.workspaces) ? pkg.workspaces.filter((w) => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * True when `packageDir` is covered by one of the project's workspace globs —
 * i.e. a root `npm install` would actually install it. Only such components may
 * be installed from the root; anything else (the dashboard, which is
 * intentionally outside the workspaces) has to install in its own directory.
 */
export function isWorkspaceMember(targetDir: string, packageDir: string): boolean {
  const globs = readWorkspaces(targetDir);
  if (!globs.length) return false;

  const rel = relative(resolve(targetDir), resolve(packageDir));
  if (!rel || rel.startsWith('..')) return false;
  const segments = rel.split(sep);

  return globs.some((glob) => {
    const parts = glob.split('/');
    return (
      parts.length === segments.length && parts.every((p, i) => p === '*' || p === segments[i])
    );
  });
}

/** Sets one `dependencies` entry in the project root manifest, if not already set. */
function setDependency(targetDir: string, packageName: string, versionSpec: string): void {
  const path = join(targetDir, 'package.json');
  if (!existsSync(path)) throw new Error('no package.json');

  const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  if (!pkg.dependencies) pkg.dependencies = {};
  if (pkg.dependencies[packageName] === versionSpec) return;
  pkg.dependencies[packageName] = versionSpec;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/** Declares a workspace-linked package (a scaffold under `workers/*`/`plugins/*`). */
export function addWorkspaceDependency(targetDir: string, packageName: string): void {
  setDependency(targetDir, packageName, WORKSPACE_VERSION);
}

/**
 * Declares a `file:`-linked dependency pointing directly at `absPath` — used
 * for catalog workers that ship with the MDK checkout but are not published to
 * npm. `npm install` symlinks it straight into `node_modules/<packageName>`,
 * the same as a real registry package; no `workers/<name>` folder is created; that
 * directory stays reserved for packages the user owns via `mdk create worker`.
 */
export function addFileDependency(targetDir: string, packageName: string, absPath: string): void {
  setDependency(targetDir, packageName, `file:${resolve(absPath)}`);
}

/**
 * The stack name from `<dir>/mdk.yaml` (falling back to the directory name), or
 * null when there is no spec — i.e. when the directory is not an MDK project and
 * nothing should be scaffolded into it.
 */
export function readStackName(targetDir: string): string | null {
  const specPath = join(targetDir, 'mdk.yaml');
  if (!existsSync(specPath)) return null;
  try {
    const doc = parseYaml(readFileSync(specPath, 'utf8')) as { metadata?: { name?: string } };
    const name = doc?.metadata?.name?.trim();
    if (name) return name;
  } catch {
    /* fall through to the directory name */
  }
  return basename(resolve(targetDir));
}

const GITIGNORE_HEADER = '# MDK';
const GITIGNORE_BLOCK = [
  `${GITIGNORE_HEADER} runtime state — kernel/gateway stores, worker DBs, discovery keys`,
  '.mdk/',
  '',
  '# Dependencies & build output',
  'node_modules/',
  'dist/',
  'coverage/',
  '.vite/',
  '*.tsbuildinfo',
  '',
  '# Local environment (commit .env.example instead)',
  '.env',
  '.env.local',
  '*.log',
  '',
].join('\n');

/**
 * Ensures the project has a `.gitignore` covering MDK runtime state and the
 * build output of the components it scaffolds. Creates one if absent; if a
 * `.gitignore` already exists without the MDK block, appends it (never clobbers
 * user content).
 */
export function ensureProjectGitignore(targetDir: string): FileAction {
  const path = join(targetDir, '.gitignore');
  if (!existsSync(path)) {
    writeFileSync(path, GITIGNORE_BLOCK, 'utf8');
    return 'created';
  }
  const current = readFileSync(path, 'utf8');
  if (current.includes(GITIGNORE_HEADER) || current.includes('.mdk/')) return 'present';
  appendFileSync(path, `${current.endsWith('\n') ? '' : '\n'}\n${GITIGNORE_BLOCK}`, 'utf8');
  return 'updated';
}

export interface ReadmeOptions {
  stackName: string;
  /** Worker names from the spec, for the per-component run commands. */
  workerNames: string[];
  /** Dashboard path relative to the project root, when one was scaffolded. */
  dashboardDir?: string;
}

function runSection({ workerNames }: ReadmeOptions): string {
  const workers = workerNames.length
    ? workerNames.map((name) => `mdk run worker ${name}`)
    : ['mdk run worker <name>'];
  return [
    '```bash',
    'npm install   # once, links workers/ and plugins/',
    'mdk run       # boots Kernel + Gateway + workers together',
    '```',
    '',
    'Or run each component in its own terminal:',
    '',
    '```bash',
    'mdk run kernel',
    'mdk run gateway',
    ...workers,
    '```',
  ].join('\n');
}

/**
 * Writes a project README describing the emitted layout and how to run the
 * stack. Never overwrites an existing README.
 */
export function ensureProjectReadme(targetDir: string, opts: ReadmeOptions): FileAction {
  const path = join(targetDir, 'README.md');
  if (existsSync(path)) return 'present';

  const dashboard = opts.dashboardDir
    ? [
        '## Dashboard',
        '',
        '```bash',
        `cd ${opts.dashboardDir}`,
        'npm install',
        'npm run dev',
        '```',
        '',
        'It proxies `/auth`, `/api` and `/pub` to the Gateway, so start the stack first.',
        '',
        '',
      ].join('\n')
    : '';

  const content = `# ${opts.stackName}

An MDK stack — a Kernel, a Gateway and its Workers — described declaratively in
\`mdk.yaml\`. Edit that file to change ports, gateway plugins, workers or the
devices each worker manages.

## Layout

\`\`\`
mdk.yaml           the stack spec: ports, gateway plugins, workers, devices
workers/<name>/    worker plugins — device contract, handlers and a mock device
plugins/<name>/    gateway plugins — HTTP aggregation endpoints
apps/dashboard/    the UI dashboard (Vite app)
.mdk/              runtime state written by \`mdk run\` — disposable, gitignored
\`\`\`

\`workers/*\` and \`plugins/*\` are npm workspaces of this project: one
\`npm install\` at the root wires them all up, which is also how the Gateway
resolves its plugins. Component directories appear as you add components.

## Run it

${runSection(opts)}

## Add components

\`\`\`bash
mdk create worker <name>      # scaffolds workers/<name> and registers it in mdk.yaml
mdk create dashboard          # scaffolds apps/dashboard
\`\`\`

${dashboard}## Runtime state

\`.mdk/\` holds the Kernel and Gateway stores, each worker's database and identity
keys, and the local discovery keys. Delete it to reset the stack — every
component then comes back with a new identity; it is never committed.
`;

  writeFileSync(path, content, 'utf8');
  return 'created';
}
