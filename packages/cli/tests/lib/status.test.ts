import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

// status.ts lazily loads `@tetherto/mdk-client` via a native
// `createRequire(import.meta.url)` call, which bypasses the ESM module graph
// vi.mock normally patches — so the fake has to be injected at the
// `node:module` level, same technique as runtime.test.ts.
const mockClient = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn(),
}));
const createMdkClientMock = vi.hoisted(() => vi.fn(() => mockClient));

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const real = actual.createRequire(url);
      const fake = ((id: string) => {
        if (id === '@tetherto/mdk-client') return { createMdkClient: createMdkClientMock };
        return real(id);
      }) as NodeJS.Require;
      fake.resolve = real.resolve.bind(real);
      return fake;
    },
  };
});

// Every real failure inside `loadStackSpec` is wrapped as a `StackSpecError` —
// exercising the "some other error" rethrow branch needs a controllable fake.
const specControl = vi.hoisted(() => ({ throwGeneric: false }));
vi.mock('../../src/lib/spec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/spec.js')>();
  return {
    ...actual,
    loadStackSpec: (dir: string) => {
      if (specControl.throwGeneric) throw new Error('totally unexpected');
      return actual.loadStackSpec(dir);
    },
  };
});

const { collectStatus } = await import('../../src/lib/status.js');
const { kernelKeyFile } = await import('../../src/lib/runtime.js');

afterEach(() => {
  cleanupTmpDirs();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  specControl.throwGeneric = false;
});

function writeSpec(dir: string, content: string): void {
  writeFileSync(join(dir, 'mdk.yaml'), content, 'utf8');
}

describe('collectStatus', () => {
  it('reports a missing spec, a down kernel, and an unknown-gateway-port down state', async () => {
    const dir = makeTmpDir();
    vi.stubGlobal('fetch', vi.fn());

    const report = await collectStatus(dir);

    expect(report.environment.spec.found).toBe(false);
    expect(report.environment.spec.valid).toBe(false);
    expect(report.environment.spec.error).toMatch(/No mdk\.yaml found/);
    expect(report.stack.kernel.state).toBe('down');
    expect(report.stack.gateway.state).toBe('down');
    expect(report.stack.gateway.error).toMatch(/gateway port unknown/);
    expect(report.health).toBe('down');
    expect(report.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rethrows a non-StackSpecError raised while loading the spec', async () => {
    const dir = makeTmpDir();
    specControl.throwGeneric = true;
    await expect(collectStatus(dir)).rejects.toThrow('totally unexpected');
  });

  it('marks declared packages as missing when they cannot be resolved', async () => {
    const dir = makeTmpDir();
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '    plugins:',
        '      - package: not-installed-anywhere',
        '  workers:',
        '    - name: a',
        '      package: ./workers/missing',
      ].join('\n'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), {})),
    );

    const report = await collectStatus(dir);
    expect(report.environment.dependencies.ok).toBe(false);
    expect(report.environment.dependencies.missing).toEqual([
      './workers/missing',
      'not-installed-anywhere',
    ]);
  });

  it('resolves a local worker package path that exists on disk', async () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, 'workers', 'a'), { recursive: true });
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '  workers:',
        '    - name: a',
        '      package: ./workers/a',
      ].join('\n'),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const report = await collectStatus(dir);
    expect(report.environment.dependencies.missing).toEqual([]);
  });

  it('probes the gateway as up on a 2xx response, and down (no error) on ECONNREFUSED', async () => {
    const dir = makeTmpDir();
    writeSpec(dir, 'kind: Stack\napiVersion: mdk/v1\nspec:\n  gateway:\n    port: 3847\n');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    let report = await collectStatus(dir);
    expect(report.stack.gateway.state).toBe('up');
    expect(report.stack.gateway.error).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3847')));
    report = await collectStatus(dir);
    expect(report.stack.gateway.state).toBe('down');
    expect(report.stack.gateway.error).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    report = await collectStatus(dir);
    expect(report.stack.gateway.state).toBe('down');
    expect(report.stack.gateway.error).toBe('HTTP 500');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    report = await collectStatus(dir);
    expect(report.stack.gateway.error).toBe('boom');
  });

  it('reports the kernel down (no error) when there is no key file', async () => {
    const dir = makeTmpDir();
    writeSpec(dir, 'kind: Stack\napiVersion: mdk/v1\nspec:\n  gateway:\n    port: 3847\n');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const report = await collectStatus(dir);
    expect(report.stack.kernel.state).toBe('down');
    expect(report.stack.kernel.error).toBeNull();
    expect(createMdkClientMock).not.toHaveBeenCalled();
  });

  it('reports the kernel down with an error when the key file cannot be read', async () => {
    const dir = makeTmpDir();
    writeSpec(dir, 'kind: Stack\napiVersion: mdk/v1\nspec:\n  gateway:\n    port: 3847\n');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    // A directory in place of the key file makes readFileSync throw (EISDIR).
    mkdirSync(kernelKeyFile(dir), { recursive: true });

    const report = await collectStatus(dir);
    expect(report.stack.kernel.state).toBe('down');
    expect(report.stack.kernel.error).toBeTruthy();
  });

  it('reports the kernel up with its live worker registry, merging declared + extra workers', async () => {
    const dir = makeTmpDir();
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '  workers:',
        '    - name: declared-a',
        '      package: ./workers/a',
        '    - name: declared-missing',
        '      package: ./workers/b',
      ].join('\n'),
    );
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.getStatus.mockResolvedValue({
      workers: [
        { workerId: 'declared-a', state: 'READY', healthState: 'OK', deviceCount: 2 },
        { workerId: 'extra-worker', state: 'READY', deviceIds: ['x', 'y', 'z'] },
      ],
      totalDevices: 5,
    });

    const report = await collectStatus(dir);
    expect(report.stack.kernel.state).toBe('up');
    expect(report.stack.workers.declared).toBe(2);
    expect(report.stack.workers.registered).toBe(2);
    expect(report.stack.workers.totalDevices).toBe(5);

    const byName = new Map(report.stack.workers.items.map((w) => [w.name, w]));
    expect(byName.get('declared-a')).toMatchObject({ declared: true, registered: true, devices: 2 });
    expect(byName.get('declared-missing')).toMatchObject({ declared: true, registered: false, devices: 0 });
    expect(byName.get('extra-worker')).toMatchObject({ declared: false, registered: true, devices: 3 });

    expect(mockClient.close).toHaveBeenCalled();
    expect(report.health).toBe('degraded'); // declared-missing is not registered
  });

  it('reports the kernel down with the connect error message, and always closes the client', async () => {
    const dir = makeTmpDir();
    writeSpec(dir, 'kind: Stack\napiVersion: mdk/v1\nspec:\n  gateway:\n    port: 3847\n');
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mockClient.connect.mockRejectedValue(new Error('handshake failed'));

    const report = await collectStatus(dir);
    expect(report.stack.kernel.state).toBe('down');
    expect(report.stack.kernel.error).toBe('handshake failed');
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('stringifies non-Error throws from the gateway probe and the kernel connect call, and swallows a close() rejection', async () => {
    const dir = makeTmpDir();
    writeSpec(dir, 'kind: Stack\napiVersion: mdk/v1\nspec:\n  gateway:\n    port: 3847\n');
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    // eslint-disable-next-line prefer-promise-reject-errors
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('plain string rejection'));
    mockClient.connect.mockRejectedValue('handshake blew up');
    mockClient.close.mockRejectedValueOnce(new Error('close failed'));

    const report = await collectStatus(dir);
    expect(report.stack.gateway.error).toBe('plain string rejection');
    expect(report.stack.kernel.error).toBe('handshake blew up');
  });

  it('defaults a live worker missing state/health/device fields to null/0, including one outside the declared set', async () => {
    const dir = makeTmpDir();
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '  workers:',
        '    - name: a',
        '      package: ./workers/a',
      ].join('\n'),
    );
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.getStatus.mockResolvedValue({
      workers: [{ workerId: 'a' }, { workerId: 'unlisted' }],
      totalDevices: 0,
    });

    const report = await collectStatus(dir);
    const byName = new Map(report.stack.workers.items.map((w) => [w.name, w]));
    expect(byName.get('a')).toMatchObject({ state: null, health: null, devices: 0 });
    expect(byName.get('unlisted')).toMatchObject({ declared: false, state: null, health: null, devices: 0 });
    // A registered worker with no `state` is still "serving" (no mismatch to flag).
    expect(report.health).toBe('healthy');
  });

  it('reports healthy when the kernel, gateway and every declared worker are all up', async () => {
    const dir = makeTmpDir();
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '  workers:',
        '    - name: a',
        '      package: ./workers/a',
      ].join('\n'),
    );
    mkdirSync(join(dir, 'workers', 'a'), { recursive: true });
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.getStatus.mockResolvedValue({
      workers: [{ workerId: 'a', state: 'READY', healthState: 'OK', deviceCount: 1 }],
      totalDevices: 1,
    });

    const report = await collectStatus(dir);
    expect(report.health).toBe('healthy');
    expect(report.ok).toBe(true);
  });

  it('treats a DEAD/SICK or non-READY worker as not serving (degraded)', async () => {
    const dir = makeTmpDir();
    writeSpec(
      dir,
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '  workers:',
        '    - name: a',
        '      package: ./workers/a',
      ].join('\n'),
    );
    mkdirSync(join(dir, '.mdk'), { recursive: true });
    writeFileSync(kernelKeyFile(dir), 'deadbeef', 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.getStatus.mockResolvedValue({
      workers: [{ workerId: 'a', state: 'READY', healthState: 'DEAD', deviceCount: 1 }],
      totalDevices: 1,
    });

    const report = await collectStatus(dir);
    expect(report.health).toBe('degraded');
  });
});
