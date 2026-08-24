import { createRequire } from 'node:module';
import { once, type EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isLocalPackagePath, type StackSpec, type WorkerInstance } from './spec.js';
import { DEFAULT_HOST, findFreePort, isPortFree } from './ports.js';
import { theme, tick, arrow } from './theme.js';

const require = createRequire(import.meta.url);

// --- @tetherto/mdk-core runtime -------------------------------------------
// The backend runtime is a typeless CommonJS package. It is `require`d lazily
// (inside the boot functions, never at module top level) so the heavy backend
// deps are only loaded when a `run` target actually boots — not on every CLI
// invocation. These interfaces type just the surface `mdk run` touches.

/** Handle returned by `getKernel`. */
export interface KernelHandle {
  getPublicKey?: () => Buffer | string;
  _cleanup: Array<() => unknown>;
  stop: () => Promise<void>;
  [key: string]: unknown;
}

/** Handle returned by `startGateway`. */
export interface GatewayHandle {
  mdkClient?: unknown;
  stop: (cb?: () => void) => void;
  [key: string]: unknown;
}

interface GetKernelOpts {
  root?: string;
  keyFile?: string | false;
  discovery?: { mode: 'local' | 'dht'; dir?: string; topic?: string };
  [key: string]: unknown;
}

interface StartGatewayOpts {
  root?: string;
  port?: number;
  kernel?: KernelHandle;
  kernelKey?: unknown;
  keyFile?: string;
  extraPluginDirs?: Array<string | { dir: string; config?: Record<string, unknown> }>;
  /** Overrides merged into the gateway's `config/common.json`. */
  common?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MdkCore {
  getKernel(opts?: GetKernelOpts): Promise<KernelHandle>;
  startGateway(opts?: StartGatewayOpts): Promise<GatewayHandle>;
  [key: string]: unknown;
}

/** Lazily loads the `@tetherto/mdk-core` runtime (a workspace dependency). */
function mdkCore(): MdkCore {
  return require('@tetherto/mdk-core') as MdkCore;
}

// --- @tetherto/mdk-worker runtime -----------------------------------------
// Same lazy-`require` contract as `mdkCore` above: the WorkerRuntimeV2 host
// lives in the backend and is only loaded when a worker actually boots. `mdk
// run` plays the "caller" role (the way examples/backend/demo-worker-caller
// does) — it constructs the runtime from the package's directory, seeds
// devices, and owns the lifecycle, while the worker *package* ships only its
// `mdk-contract.json` + handlers and an optional mock.

/** A booted WorkerRuntimeV2 host instance. */
interface WorkerRuntimeV2Instance {
  start(): Promise<{ publicKey: Buffer }>;
  stop(): Promise<void>;
  getPublicKey(): Buffer;
  [key: string]: unknown;
}
interface WorkerRuntimeV2Ctor {
  new (dir: string, opts: Record<string, unknown>): WorkerRuntimeV2Instance;
}
interface MdkWorker {
  WorkerRuntimeV2: WorkerRuntimeV2Ctor;
  [key: string]: unknown;
}

/** Lazily loads the `@tetherto/mdk-worker` runtime host (a workspace dependency). */
function mdkWorker(): MdkWorker {
  return require('@tetherto/mdk-worker') as MdkWorker;
}

/** Local-discovery helpers from mdk-core — how a worker publishes its RPC key. */
interface LocalDiscovery {
  publishWorkerKey(dir: string, workerId: string, rpcKeyHex: string): void;
}
function localDiscovery(): LocalDiscovery {
  return require('@tetherto/mdk-core/lib/local-discovery') as LocalDiscovery;
}

// --- project-local runtime state ------------------------------------------
// Everything `mdk run` writes lives under `<project>/.mdk` — gitignored and safe
// to delete. Each component gets its own data root so no two of them share a
// directory, while the two cross-process handoff artifacts sit at the top level
// where either side can find them: `kernel.key` (read by the gateway) and
// `keys/` (written by workers, watched by the kernel). This leaves room for
// `logs/` and `run/` when `mdk logs` and `mdk status` land.

/** Absolute runtime-state root for a project — `<project>/.mdk`. */
export function mdkDir(projectDir: string): string {
  return resolve(projectDir, '.mdk');
}

/** A path under `.mdk`, e.g. `componentDir(dir, 'workers', name)`. */
function componentDir(projectDir: string, ...parts: string[]): string {
  return join(mdkDir(projectDir), ...parts);
}

/** Shared Kernel HRPC key file — how a separate gateway process discovers the Kernel. */
export function kernelKeyFile(projectDir: string): string {
  return componentDir(projectDir, 'kernel.key');
}

/**
 * Shared worker-key dir for `discovery: { mode: 'local' }`, passed *explicitly*
 * to both sides. mdk-core otherwise defaults it to `<root>/.worker-keys`, which
 * would nest it inside whichever component's data root was passed — the Kernel
 * and its workers must agree on one path independent of their own roots.
 */
export function workerKeysDir(projectDir: string): string {
  return componentDir(projectDir, 'keys');
}

/**
 * Resolves an installed package's root directory from the target project's
 * `node_modules` (via its `package.json`). Throws an actionable error naming the
 * missing package — gateway plugins must be installed into the project first.
 */
export function resolveProjectPackageDir(projectDir: string, pkgName: string): string {
  try {
    const manifest = require.resolve(`${pkgName}/package.json`, { paths: [resolve(projectDir)] });
    return dirname(manifest);
  } catch {
    throw new Error(
      `Gateway plugin package "${pkgName}" is not installed in ${resolve(projectDir)}.\n` +
        `Install it first, e.g.: npm install ${pkgName}`,
    );
  }
}

/** Boots the Kernel (local discovery, project-local state), logging its key. */
export async function runKernel(projectDir: string): Promise<KernelHandle> {
  const core = mdkCore();
  const root = componentDir(projectDir, 'kernel');
  mkdirSync(root, { recursive: true });

  process.stderr.write(`${theme.muted('Starting kernel')} ${arrow} ${theme.value(root)}\n`);
  const kernel = await core.getKernel({
    root,
    keyFile: kernelKeyFile(projectDir),
    discovery: { mode: 'local', dir: workerKeysDir(projectDir) },
  });

  const key = typeof kernel.getPublicKey === 'function' ? kernel.getPublicKey() : undefined;
  const keyHex = key ? key.toString('hex') : '(unknown)';
  process.stderr.write(`${tick} ${theme.label('kernel')} ready ${theme.muted(keyHex)}\n`);
  return kernel;
}

/**
 * Unlike a mock port, the gateway's port is a published endpoint (the dashboard
 * proxies to it, `mdk status` probes it), so it is never relocated behind the
 * operator's back — fail with the fix instead of a bare EADDRINUSE from deep
 * inside the server. Exported so `run all` can check it before booting anything.
 */
export async function assertGatewayPortFree(port: number): Promise<void> {
  if (await isPortFree(port)) return;
  throw new Error(
    `Gateway port ${port} is already in use.\n` +
      'Another stack is probably running — stop it, or change `spec.gateway.port` in mdk.yaml.',
  );
}

/**
 * Boots the Gateway. When `kernel` is provided the connection is in-process
 * (target `all`); otherwise the Kernel key is resolved from the shared key
 * file written by a separate `mdk run kernel` process.
 */
export async function runGateway(
  projectDir: string,
  spec: StackSpec,
  kernel?: KernelHandle,
): Promise<GatewayHandle> {
  const core = mdkCore();

  // Resolve every path to an absolute one *before* the chdir below, so nothing
  // depends on the (about-to-change) working directory.
  const keyFile = kernelKeyFile(projectDir);
  const root = componentDir(projectDir, 'gateway');
  // Each plugin travels with its own config block (spec.gateway.plugins[].config)
  // so its settings reach that plugin alone, not the gateway-wide conf.
  const extraPluginDirs = spec.spec.gateway.plugins.map((p) => ({
    dir: resolveProjectPackageDir(projectDir, p.package),
    ...(Object.keys(p.config ?? {}).length ? { config: p.config } : {}),
  }));

  // Out-of-process gateway: the Kernel must already be running so its HRPC key
  // is on disk. Fail early with an actionable message instead of silently
  // booting a gateway that can never reach a Kernel.
  if (!kernel && !existsSync(keyFile)) {
    throw new Error(
      'Kernel is not running (no key file found).\nStart it first: `mdk run kernel`.',
    );
  }

  await assertGatewayPortFree(spec.spec.gateway.port);

  mkdirSync(root, { recursive: true });

  // The gateway's corestore (`store/http`) is created relative to the working
  // directory (tether-wrk-base convention — the mvp-site example likewise runs
  // each process with its own `cwd`). Run from the gateway state root so that
  // store nests under `.mdk/gateway/` instead of polluting the project.
  process.chdir(root);

  process.stderr.write(
    `${theme.muted('Starting gateway')} ${arrow} ${theme.value(`:${spec.spec.gateway.port}`)}\n`,
  );
  const gateway = await core.startGateway({
    root,
    port: spec.spec.gateway.port,
    ...(kernel ? { kernel } : { keyFile }),
    ...(extraPluginDirs.length ? { extraPluginDirs } : {}),
    ...(Object.keys(spec.spec.gateway.config ?? {}).length ? { common: spec.spec.gateway.config } : {}),
  });

  const connected = gateway.mdkClient != null;
  process.stderr.write(
    `${tick} ${theme.label('gateway')} listening on ${theme.value(`http://localhost:${spec.spec.gateway.port}`)} ` +
      `${theme.muted(connected ? '(kernel connected)' : '(kernel pending)')}\n`,
  );
  return gateway;
}

// --- worker boot ----------------------------------------------------------

/** A seed device from a worker's `config.devices` — `opts` is plugin-defined. */
interface SeedDevice {
  id: string;
  opts?: Record<string, unknown>;
}

/** A running mock device server (the shape mvp-site / demo-worker mocks return). */
interface MockServer {
  /**
   * The listening object, whose type depends on the mock's transport: a
   * `net.Server` for the TCP/Modbus mocks, a Fastify instance for the HTTP ones.
   * Only the members both share can be relied on here.
   */
  server?: {
    on?: (event: string, cb: () => void) => void;
    /** Present on a `net.Server`; a Fastify instance nests it under `.server`. */
    listening?: boolean;
    /** Node >= 18.2 — drops lingering keep-alive sockets so the port frees now. */
    closeAllConnections?: () => void;
    /** Fastify's underlying `http.Server`. */
    server?: { closeAllConnections?: () => void };
  };
  /** Resolves once the transport is bound — the mock framework's own signal. */
  ready?: Promise<unknown>;
  exit: () => void;
}
interface MockModule {
  createServer(opts: Record<string, unknown>): MockServer;
}

/**
 * Waits until a freshly created mock is actually accepting connections.
 *
 * The mock framework binds differently per transport, so neither signal alone is
 * enough: HTTP mocks hand back a Fastify instance and expose the bind as a
 * `ready` promise, while TCP mocks hand back a `net.Server` that has already
 * been told to listen and reports it by emitting `'listening'`. Waiting on the
 * event alone would hang forever on a Fastify instance (it never emits it), and
 * waiting on `ready` alone would return before a TCP mock is bound.
 */
async function awaitMockReady(mock: MockServer): Promise<void> {
  if (mock.ready) await mock.ready;

  const server = mock.server;
  // `listening` is the tell for a real net.Server; guarding on it also avoids
  // waiting for an event that has already fired.
  if (server?.on && server.listening === false) {
    await once(server as unknown as EventEmitter, 'listening');
  }
}

/** Frees the listener now, whether the mock is Fastify-shaped or net.Server-shaped. */
function dropMockConnections(mock: MockServer): void {
  mock.server?.closeAllConnections?.();
  mock.server?.server?.closeAllConnections?.();
}

/**
 * Resolves each seed device's mock port to one that is actually bindable.
 *
 * A mock port is a private contract between the simulator this CLI starts and
 * the plugin that dials it — nothing outside the process cares which number it
 * is. So when the configured port is taken (a second stack on the machine, a
 * worker left running, two devices sharing a port), relocating beats refusing to
 * boot. The configured port is always tried first, so a free one stays stable
 * and matches mdk.yaml. Real (non-mock) devices are never touched: their port
 * belongs to the hardware.
 */
async function resolveMockPorts(
  workerName: string,
  seeds: SeedDevice[],
  reserved?: Iterable<number>,
): Promise<Array<Record<string, unknown>>> {
  // Seeded with the ports later workers have declared but not yet bound, so one
  // squatter cannot cascade: a relocated worker steps over its neighbours'
  // ports instead of pushing each of them along in turn.
  const claimed = new Set<number>(reserved ?? []);
  const resolved: Array<Record<string, unknown>> = [];

  for (const d of seeds) {
    const opts = { ...(d.opts ?? {}) };
    const wanted = opts.port;
    if (typeof wanted === 'number') {
      const host = typeof opts.host === 'string' ? opts.host : DEFAULT_HOST;
      const available = !claimed.has(wanted) && (await isPortFree(wanted, host));
      const port = available ? wanted : await findFreePort({ start: wanted + 1, host, taken: claimed });
      if (port !== wanted) {
        process.stderr.write(
          theme.muted(
            `  mock port ${wanted} is in use — device "${d.id}" of "${workerName}" moved to ${port}\n`,
          ),
        );
      }
      opts.port = port;
      claimed.add(port);
    }
    resolved.push(opts);
  }

  return resolved;
}

/** Mock ports a worker's seed devices ask for — what a later boot must avoid. */
export function declaredMockPorts(worker: WorkerInstance): number[] {
  const config = worker.config as { mock?: boolean; devices?: SeedDevice[] };
  if (!config.mock || !Array.isArray(config.devices)) return [];
  return config.devices
    .map((d) => d.opts?.port)
    .filter((port): port is number => typeof port === 'number');
}

/** A handle over a booted worker: its runtime plus any mock servers it owns. */
export interface WorkerHandle {
  runtime: WorkerRuntimeV2Instance;
  mocks: MockServer[];
  stop: () => Promise<void>;
}

/**
 * Resolves a worker package's directory. `package` in `mdk.yaml` may be a
 * **local path** (starts with `.` or `/`, resolved against the project dir —
 * the common case, since worker plugins live beside the stack and are not
 * published to npm) or an installed npm package name.
 */
function resolveWorkerPackageDir(projectDir: string, pkg: string): string {
  if (isLocalPackagePath(pkg)) {
    const dir = resolve(projectDir, pkg);
    if (!existsSync(dir)) {
      throw new Error(`Worker package path "${pkg}" does not exist (looked in ${dir}).`);
    }
    return dir;
  }
  try {
    return dirname(require.resolve(`${pkg}/package.json`, { paths: [resolve(projectDir)] }));
  } catch {
    throw new Error(
      `Worker package "${pkg}" is not installed in ${resolve(projectDir)}.\n` +
        `Install it, or use a local path (e.g. package: ./workers/${pkg}).`,
    );
  }
}

/** Marks a contract-first Worker Plugin package — see `resolveWorkerContractDir`. */
const CONTRACT_FILE = 'mdk-contract.json';

/**
 * Resolves a worker package to its directory, and confirms it is a
 * contract-first Worker Plugin (an `mdk-contract.json` at its root) — the only
 * shape `mdk run worker` supports. Checked here, rather than left to surface
 * as `WorkerRuntimeV2`'s own `ERR_CONTRACT_NOT_FOUND`/`ERR_WORKER_DIR_REQUIRED`,
 * so a misshapen package gets a message that names the fix.
 */
function resolveWorkerContractDir(projectDir: string, pkg: string): string {
  const dir = resolveWorkerPackageDir(projectDir, pkg);
  if (!existsSync(join(dir, CONTRACT_FILE))) {
    throw new Error(
      `Worker package "${pkg}" has no ${CONTRACT_FILE} — mdk run only supports contract-first ` +
        'Worker Plugins (a directory with mdk-contract.json at its root; see backend/workers/samples/demo-worker).',
    );
  }
  return dir;
}

/**
 * Boots one worker on WorkerRuntimeV2, exactly the way the mvp-site example
 * does: start a mock device server per seed device (so the plugin talks to a
 * simulator instead of hardware), build the runtime's device set from
 * `config.devices`, then register with the Kernel.
 *
 * Discovery follows the same contract as the rest of MDK: an in-process
 * `kernel` handle registers the worker by key (target `all`); otherwise the
 * worker publishes its RPC key to the shared keys dir for a separately-running
 * local-mode Kernel to pick up.
 */
export async function runWorker(
  projectDir: string,
  worker: WorkerInstance,
  kernel?: KernelHandle,
  opts: { reservedPorts?: Iterable<number> } = {},
): Promise<WorkerHandle> {
  const dir = resolveWorkerContractDir(projectDir, worker.package);

  const config = worker.config as {
    devices?: SeedDevice[];
    mock?: boolean;
  };
  const seeds = Array.isArray(config.devices) ? config.devices : [];
  if (seeds.length === 0) {
    throw new Error(
      `Worker "${worker.name}" has no \`config.devices\` in mdk.yaml — nothing to run.`,
    );
  }

  // Per-worker persistent state: plugin SQLite under storeDir, DHT/RPC seeds
  // under storeDir/identity so the worker's public key survives restarts.
  const storeDir = componentDir(projectDir, 'workers', worker.name);
  mkdirSync(storeDir, { recursive: true });
  const dbPath = join(storeDir, 'data.db');
  const identityDir = join(storeDir, 'identity');
  mkdirSync(identityDir, { recursive: true });

  process.stderr.write(
    `${theme.muted('Starting worker')} ${arrow} ${theme.value(worker.name)} ` +
      `${theme.muted(`(${seeds.length} device${seeds.length === 1 ? '' : 's'})`)}\n`,
  );

  // Per-device options, with mock ports resolved to something actually bindable
  // before anything starts. Both the mock and the plugin read from this same
  // list, so they cannot disagree about which port the device is on.
  const deviceOpts = config.mock
    ? await resolveMockPorts(worker.name, seeds, opts.reservedPorts)
    : seeds.map((d) => ({ ...(d.opts ?? {}) }));

  // Mock device servers — one per seed device, from `<pkg>/mock/server`.
  const mocks: MockServer[] = [];
  if (config.mock) {
    const mockPath = join(dir, 'mock', 'server.js');
    if (!existsSync(mockPath)) {
      throw new Error(`config.mock is set but ${worker.package} has no mock/server.js.`);
    }
    const mockMod = require(mockPath) as MockModule;
    for (const [i, d] of seeds.entries()) {
      const opts = deviceOpts[i];
      try {
        const m = mockMod.createServer(opts);
        mocks.push(m);
        // Wait until the mock is actually listening — the plugin's connect()
        // probes the device on boot, so a not-yet-bound port would fail startup.
        await awaitMockReady(m);
      } catch (error) {
        throw new Error(
          `Could not start the mock device for worker "${worker.name}", device "${d.id}" ` +
            `on ${String(opts.host ?? DEFAULT_HOST)}:${String(opts.port)}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Device set: `config.devices[].opts` is the plugin's own per-device config;
  // dbPath is threaded through for the sample plugin's SQLite persistence.
  const devices = seeds.map((d, i) => ({ deviceId: d.id, config: { ...deviceOpts[i], dbPath } }));

  const { WorkerRuntimeV2 } = mdkWorker();
  const runtime = new WorkerRuntimeV2(dir, {
    workerId: worker.name,
    devices,
    env: worker.env ?? {},
    storeDir: identityDir,
  });
  await runtime.start();

  const rpcKeyHex = runtime.getPublicKey().toString('hex');
  if (kernel) {
    await (kernel as unknown as { registerWorker: (k: Buffer) => Promise<void> }).registerWorker(
      runtime.getPublicKey(),
    );
    if (Array.isArray(kernel._cleanup)) kernel._cleanup.push(() => runtime.stop());
  } else {
    const { publishWorkerKey } = localDiscovery();
    publishWorkerKey(workerKeysDir(projectDir), worker.name, rpcKeyHex);
  }

  process.stderr.write(
    `${tick} ${theme.label('worker')} ${theme.value(worker.name)} ready ${theme.muted(rpcKeyHex.slice(0, 16))}\n`,
  );

  // Signals are owned by the `run` command (see lib/shutdown.ts), which stops
  // every component in reverse boot order and exits even if one of them wedges.
  const stop = async (): Promise<void> => {
    await runtime.stop();
    for (const m of mocks) {
      try {
        m.exit();
        // `server.close()` only stops new connections; a keep-alive socket from
        // the plugin's poller would hold the listener (and its port) open.
        dropMockConnections(m);
      } catch {
        /* best-effort */
      }
    }
  };

  return { runtime, mocks, stop };
}
