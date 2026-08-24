import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isMap, isSeq, parseDocument, YAMLSeq, type YAMLMap } from 'yaml';
import { installScaffold } from './npm.js';
import { DIRS, ensureProjectManifest, readStackName } from './project.js';
import { deviceId, deviceSerial, MOCK_PORT_BASE } from './spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Placeholder baked into `templates/worker/**`, replaced at scaffold time. */
const NAME_TOKEN = '__WORKER_NAME__';

/**
 * Absolute path to the bundled worker template (`templates/worker`), a mirror of
 * the monorepo's `backend/workers/samples/demo-worker`. Resolves the same from
 * `dist/lib` (built) and `src/lib` (tsx dev) since both sit one level under the
 * package root.
 */
function templateDir(): string {
  return resolve(__dirname, '..', '..', 'templates', 'worker');
}

export interface WorkerScaffoldOptions {
  /** Worker name — used for the folder, the mdk.yaml entry, and the package name. */
  name: string;
  /** Project directory; the worker is created under `<parentDir>/workers/<name>`. */
  parentDir: string;
  /** npm scope/org for the generated package name (e.g. `demo` → `@demo/<name>`). */
  org?: string;
  /** Overwrite the target if it already exists (default: false). */
  force?: boolean;
  /** Run `npm install` in the scaffolded worker (default: true). */
  install?: boolean;
  /** Add the worker entry to `<parentDir>/mdk.yaml` under `spec.workers` (default: true). */
  updateStackFile?: boolean;
}

/** Outcome of writing the worker into `mdk.yaml`. */
export type StackFileUpdate = 'added' | 'exists' | 'no-file' | 'error';

export interface WorkerScaffoldResult {
  ok: boolean;
  message?: string;
  detail?: string;
  /** Absolute path of the scaffolded worker. */
  workerPath?: string;
  /** Local path to reference in mdk.yaml (`./workers/<name>`). */
  relPackage?: string;
  /** Resolved package.json `name`. */
  packageName?: string;
  /** Warning surfaced when `npm install` could not complete (scaffold still ok). */
  installWarning?: string;
  /** Directory `npm install` ran in (the workspace root for a linked worker). */
  installDir?: string;
  /** How the `mdk.yaml` update went (so the caller can guide the user). */
  stackFile?: StackFileUpdate;
  /** Mock port the seed device was given — so a printed snippet matches the file. */
  mockPort?: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Lowest mock port from `MOCK_PORT_BASE` up that no device in this project's
 * spec already claims, so scaffolding a second worker cannot collide with the
 * first. Only covers *this* project — a port taken by another stack on the
 * machine is resolved at boot (see `resolveMockPorts` in runtime.ts).
 */
function nextMockPort(doc: ReturnType<typeof parseDocument>): number {
  const spec = doc.toJS() as {
    spec?: { workers?: Array<{ config?: { devices?: Array<{ opts?: { port?: unknown } }> } }> };
  };

  const used = new Set<number>();
  for (const worker of spec?.spec?.workers ?? []) {
    for (const device of worker?.config?.devices ?? []) {
      const port = device?.opts?.port;
      if (typeof port === 'number') used.add(port);
    }
  }

  let port = MOCK_PORT_BASE;
  while (used.has(port)) port++;
  return port;
}

/** Outcome of the `mdk.yaml` edit, plus the mock port the entry was given. */
interface StackFileResult {
  update: StackFileUpdate;
  port: number;
}

/**
 * Appends the new worker to `spec.workers` in `<parentDir>/mdk.yaml`, preserving
 * the file's existing formatting/comments (edits the parsed document rather than
 * re-serializing from scratch). Seeds a `mock: true` config with one sample
 * device on an unclaimed port so the entry is runnable immediately. No-ops
 * (returns `'exists'`) when a worker of the same name is already present.
 */
function addWorkerToStackFile(
  parentDir: string,
  name: string,
  relPackage: string,
): StackFileResult {
  const specPath = resolve(parentDir, 'mdk.yaml');
  if (!existsSync(specPath)) return { update: 'no-file', port: MOCK_PORT_BASE };

  try {
    const doc = parseDocument(readFileSync(specPath, 'utf8'));
    const port = nextMockPort(doc);

    const existing = doc.getIn(['spec', 'workers']);
    if (!isSeq(existing)) {
      doc.setIn(['spec', 'workers'], new YAMLSeq());
    }
    const workers = doc.getIn(['spec', 'workers']) as YAMLSeq;

    // An empty stack is written as `workers: []` — a *flow* sequence. Appending
    // to it as-is would render the whole worker inline (valid YAML, unreadable
    // in the file people are told to edit), and nothing nested inside a flow
    // collection can use block style. Switch it to block before adding.
    workers.flow = false;

    for (const item of workers.items) {
      if (isMap(item) && (item as YAMLMap).get('name') === name) {
        return { update: 'exists', port };
      }
    }

    // Flow-style opts to match the compact form the scaffold documents. The
    // device identity is derived from the (project-unique) worker name: the
    // Kernel registers device ids globally, so a shared `dev-0` would leave the
    // second worker silently unregistered.
    const opts = doc.createNode({ host: '127.0.0.1', port, serial: deviceSerial(name) });
    (opts as unknown as { flow: boolean }).flow = true;

    const worker = doc.createNode({
      name,
      package: relPackage,
      config: { mock: true, devices: [{ id: deviceId(name) }] },
    }) as YAMLMap;
    worker.setIn(['config', 'devices', 0, 'opts'], opts);

    workers.add(worker);
    writeFileSync(specPath, doc.toString(), 'utf8');
    return { update: 'added', port };
  } catch {
    return { update: 'error', port: MOCK_PORT_BASE };
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Scaffolds a new Worker Plugin package from the bundled `demo-worker` template
 * into `<parentDir>/workers/<name>` — the local-path layout `mdk run worker`
 * expects. Substitutes the name token and sets the package.json `name`.
 */
export function createWorker(opts: WorkerScaffoldOptions): WorkerScaffoldResult {
  const name = opts.name.trim();
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      message: `Invalid worker name "${opts.name}". Use lowercase letters, digits, '.', '_' or '-'.`,
    };
  }

  const src = templateDir();
  if (!existsSync(src)) {
    return { ok: false, message: `Worker template not found at ${src}.` };
  }

  const workerPath = resolve(opts.parentDir, DIRS.workers, name);
  if (existsSync(workerPath) && !opts.force) {
    return { ok: false, message: `${workerPath} already exists (use --force to overwrite).` };
  }

  try {
    mkdirSync(resolve(opts.parentDir, DIRS.workers), { recursive: true });
    cpSync(src, workerPath, { recursive: true });

    for (const file of walk(workerPath)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes(NAME_TOKEN)) {
        writeFileSync(file, content.replaceAll(NAME_TOKEN, name), 'utf8');
      }
    }

    const packageName = opts.org ? `@${opts.org.replace(/^@/, '')}/${name}` : name;
    const pkgPath = join(workerPath, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    pkg.name = packageName;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

    // `mdk run` resolves workers through the project's node_modules, which the
    // root manifest's workspace globs provide — so link the project before
    // installing. Only for a real MDK project (one with an mdk.yaml).
    const stackName = readStackName(opts.parentDir);
    if (stackName) ensureProjectManifest(opts.parentDir, stackName);

    const install = installScaffold(opts.parentDir, workerPath, opts.install !== false);

    const relPackage = `./${DIRS.workers}/${name}`;
    const stackFile =
      opts.updateStackFile === false
        ? undefined
        : addWorkerToStackFile(opts.parentDir, name, relPackage);

    return {
      ok: true,
      workerPath,
      relPackage,
      packageName,
      installWarning: install.ok ? undefined : install.message,
      installDir: install.dir,
      stackFile: stackFile?.update,
      mockPort: stackFile?.port ?? MOCK_PORT_BASE,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Could not scaffold the worker.',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
