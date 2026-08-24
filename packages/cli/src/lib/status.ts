import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectEnvironment } from './detect.js';
import { StackSpecError, loadStackSpec, STACK_FILE, type StackSpec } from './spec.js';
import { kernelKeyFile } from './runtime.js';

const require = createRequire(import.meta.url);

/**
 * Read-only state collection for `mdk status`. Nothing here starts, stops or
 * repairs anything: it inspects the environment, validates the spec, and probes
 * the running stack.
 *
 * Liveness is deliberately probe-based, never file-based. Both `.mdk/kernel.key`
 * and `.mdk/keys/*.key` survive a shutdown by design (the keys are stable across
 * restarts), so their presence proves only that a component once ran. The Kernel
 * is therefore probed over HRPC and the Gateway over HTTP.
 */

// --- @tetherto/mdk-client (typeless CommonJS, lazily required) --------------

interface RegisteredWorker {
  workerId: string;
  state?: string;
  healthState?: string;
  deviceIds?: string[];
  deviceCount?: number;
}
interface KernelStatus {
  workers: RegisteredWorker[];
  totalDevices: number;
}
interface MdkClient {
  connect(opts?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
  getStatus(opts?: Record<string, unknown>): Promise<KernelStatus>;
}
interface MdkClientModule {
  createMdkClient(opts: { hrpc: { key: string } }): MdkClient;
}

function mdkClientModule(): MdkClientModule {
  return require('@tetherto/mdk-client') as MdkClientModule;
}

// --- report shape (the `-o json|yaml` contract) ----------------------------

export type Health = 'healthy' | 'degraded' | 'down';
export type ComponentState = 'up' | 'down';

export interface EnvironmentReport {
  node: { version: string; ok: boolean; required: string };
  packageManager: string;
  git: boolean;
  spec: {
    found: boolean;
    path: string;
    valid: boolean;
    error: string | null;
    stack: string | null;
  };
  dependencies: { ok: boolean; checked: number; missing: string[] };
}

export interface WorkerReport {
  name: string;
  /** Listed in `spec.workers` (false = registered with the Kernel but not in the spec). */
  declared: boolean;
  /** Present in the Kernel's live worker registry. */
  registered: boolean;
  state: string | null;
  health: string | null;
  devices: number;
}

export interface StackReport {
  kernel: { state: ComponentState; keyFile: string; key: string | null; error: string | null };
  gateway: { state: ComponentState; url: string | null; error: string | null };
  workers: {
    declared: number;
    registered: number;
    totalDevices: number;
    items: WorkerReport[];
  };
}

export interface StatusReport {
  project: string;
  environment: EnvironmentReport;
  stack: StackReport;
  health: Health;
  ok: boolean;
}

const NODE_REQUIRED = '>=20';
const GATEWAY_TIMEOUT_MS = 1500;
const KERNEL_TIMEOUT_MS = 3000;

/**
 * True when `pkg` can be resolved the way the runtime resolves it: a local path
 * relative to the project, or an installed package in the project's node_modules.
 */
function isResolvable(projectDir: string, pkg: string): boolean {
  if (pkg.startsWith('.') || pkg.startsWith('/')) {
    return existsSync(resolve(projectDir, pkg));
  }
  try {
    require.resolve(`${pkg}/package.json`, { paths: [resolve(projectDir)] });
    return true;
  } catch {
    return false;
  }
}

/** Probes the Gateway's unauthenticated site route — cheap and always present. */
async function probeGateway(port: number): Promise<{ state: ComponentState; url: string; error: string | null }> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${url}/auth/site`, {
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) return { state: 'down', url, error: `HTTP ${res.status}` };
    return { state: 'up', url, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A refused connection is the normal "not running" case, not a fault.
    return { state: 'down', url, error: /ECONNREFUSED|fetch failed/i.test(message) ? null : message };
  }
}

/**
 * Probes the Kernel over HRPC using the published key file, returning its live
 * worker registry. The client owns its own DHT node, so it is always closed.
 */
async function probeKernel(
  projectDir: string,
): Promise<{ kernel: StackReport['kernel']; status: KernelStatus | null }> {
  const keyFile = kernelKeyFile(projectDir);
  if (!existsSync(keyFile)) {
    return {
      kernel: { state: 'down', keyFile, key: null, error: null },
      status: null,
    };
  }

  let key: string;
  try {
    key = readFileSync(keyFile, 'utf8').trim();
  } catch (error) {
    return {
      kernel: {
        state: 'down',
        keyFile,
        key: null,
        error: error instanceof Error ? error.message : String(error),
      },
      status: null,
    };
  }

  const client = mdkClientModule().createMdkClient({ hrpc: { key } });
  try {
    await client.connect();
    const status = await client.getStatus({ retries: 1, timeoutMs: KERNEL_TIMEOUT_MS });
    return { kernel: { state: 'up', keyFile, key, error: null }, status };
  } catch (error) {
    return {
      kernel: {
        state: 'down',
        keyFile,
        key,
        error: error instanceof Error ? error.message : String(error),
      },
      status: null,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Merges the workers declared in the spec with the Kernel's live registry. */
function buildWorkers(spec: StackSpec | null, status: KernelStatus | null): StackReport['workers'] {
  const declared = spec ? spec.spec.workers.map((w) => w.name) : [];
  const registered = new Map((status?.workers ?? []).map((w) => [w.workerId, w]));

  const items: WorkerReport[] = declared.map((name) => {
    const live = registered.get(name);
    return {
      name,
      declared: true,
      registered: live != null,
      state: live?.state ?? null,
      health: live?.healthState ?? null,
      devices: live?.deviceCount ?? live?.deviceIds?.length ?? 0,
    };
  });

  // Workers the Kernel knows about that the spec does not — surfaced rather than
  // hidden, since they are real processes serving traffic.
  for (const [workerId, live] of registered) {
    if (declared.includes(workerId)) continue;
    items.push({
      name: workerId,
      declared: false,
      registered: true,
      state: live.state ?? null,
      health: live.healthState ?? null,
      devices: live.deviceCount ?? live.deviceIds?.length ?? 0,
    });
  }

  return {
    declared: declared.length,
    registered: registered.size,
    totalDevices: status?.totalDevices ?? 0,
    items,
  };
}

/** A worker counts as serving when the Kernel has it READY and not DEAD/SICK. */
function workerServing(w: WorkerReport): boolean {
  if (!w.registered) return false;
  if (w.state && w.state !== 'READY') return false;
  return !(w.health === 'DEAD' || w.health === 'SICK');
}

/** Collects the full status report for a project directory. */
export async function collectStatus(projectDir: string): Promise<StatusReport> {
  const dir = resolve(projectDir);
  const env = detectEnvironment(dir);

  // Spec ------------------------------------------------------------------
  const specPath = resolve(dir, STACK_FILE);
  let spec: StackSpec | null = null;
  let specError: string | null = null;
  try {
    spec = loadStackSpec(dir);
  } catch (error) {
    if (error instanceof StackSpecError) specError = error.message;
    else throw error;
  }

  // Declared packages must resolve the way the runtime resolves them, or
  // `mdk run` fails at boot — a precondition worth reporting up front.
  const packages = spec
    ? [
        ...spec.spec.workers.map((w) => w.package),
        ...spec.spec.gateway.plugins.map((p) => p.package),
      ]
    : [];
  const missing = packages.filter((p) => !isResolvable(dir, p));

  const environment: EnvironmentReport = {
    node: { version: env.nodeVersion, ok: env.nodeOk, required: NODE_REQUIRED },
    packageManager: env.packageManager,
    git: env.git,
    spec: {
      found: existsSync(specPath),
      path: specPath,
      valid: spec != null,
      error: specError,
      stack: spec?.metadata.name ?? null,
    },
    dependencies: { ok: missing.length === 0, checked: packages.length, missing },
  };

  // Stack -----------------------------------------------------------------
  const [{ kernel, status }, gateway] = await Promise.all([
    probeKernel(dir),
    spec
      ? probeGateway(spec.spec.gateway.port)
      : Promise.resolve({
          state: 'down' as ComponentState,
          url: null,
          error: `no ${STACK_FILE} — gateway port unknown`,
        }),
  ]);

  const workers = buildWorkers(spec, status);
  const stack: StackReport = { kernel, gateway, workers };

  // Aggregate -------------------------------------------------------------
  const envOk = environment.node.ok && environment.spec.valid && environment.dependencies.ok;
  let health: Health;
  if (kernel.state === 'down') {
    health = 'down';
  } else if (gateway.state === 'down' || !workers.items.every(workerServing)) {
    health = 'degraded';
  } else {
    health = 'healthy';
  }

  return { project: dir, environment, stack, health, ok: envOk && health === 'healthy' };
}
