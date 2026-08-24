import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

const createWorkerMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/worker-scaffold.js', () => ({ createWorker: createWorkerMock }));

const createPluginMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/plugin-scaffold.js', () => ({ createPlugin: createPluginMock }));

const createDashboardMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/dashboard.js', () => ({
  createDashboard: createDashboardMock,
  dashboardNameFromStack: (name: string) => `${name}-dashboard`,
}));

const { registerCreate } = await import('../../src/commands/create.js');

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerCreate(program);
  return program;
}

afterEach(() => {
  cleanupTmpDirs();
  vi.clearAllMocks();
});

describe('mdk create worker', () => {
  it('prints the scaffolded path, package name and "added" stack-file status', async () => {
    createWorkerMock.mockReturnValue({
      ok: true,
      workerPath: '/proj/workers/a',
      relPackage: './workers/a',
      packageName: 'a',
      stackFile: 'added',
      mockPort: 18080,
    });
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'worker', 'a']);
    expect(createWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a', parentDir: '.' }),
    );
    expect(stdout.mock.calls.join('')).toContain('Added to');
  });

  it('reports a warning for "exists", "no-file" and "error" stack-file outcomes', async () => {
    const program = buildProgram();
    for (const stackFile of ['exists', 'no-file', 'error', undefined] as const) {
      createWorkerMock.mockReturnValue({
        ok: true,
        workerPath: '/proj/workers/a',
        relPackage: './workers/a',
        packageName: 'a',
        stackFile,
        mockPort: 18080,
      });
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await program.parseAsync(['node', 'mdk', 'create', 'worker', 'a']);
      stdout.mockRestore();
    }
  });

  it('surfaces an install warning', async () => {
    createWorkerMock.mockReturnValue({
      ok: true,
      workerPath: '/proj/workers/a',
      relPackage: './workers/a',
      packageName: 'a',
      stackFile: 'added',
      mockPort: 18080,
      installWarning: 'npm blew up',
      installDir: '/proj',
    });
    const program = buildProgram();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'worker', 'a']);
    expect(stderr.mock.calls.join('')).toContain('npm blew up');
  });

  it('exits with code 1 and prints the error on failure', async () => {
    createWorkerMock.mockReturnValue({ ok: false, message: 'bad name', detail: 'details' });
    const program = buildProgram();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'worker', 'a']);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('bad name');
    expect(stderr.mock.calls.join('')).toContain('details');
    process.exitCode = 0;
  });
});

describe('mdk create plugin', () => {
  it('prints the scaffolded path and reports each stack-file outcome', async () => {
    const program = buildProgram();
    for (const stackFile of ['added', 'exists', 'no-file', 'error', undefined] as const) {
      createPluginMock.mockReturnValue({
        ok: true,
        pluginPath: '/proj/plugins/a',
        packageName: 'a',
        stackFile,
      });
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await program.parseAsync(['node', 'mdk', 'create', 'plugin', 'a']);
      stdout.mockRestore();
    }
  });

  it('surfaces an install warning and a failure', async () => {
    const program = buildProgram();
    createPluginMock.mockReturnValue({
      ok: true,
      pluginPath: '/proj/plugins/a',
      packageName: 'a',
      stackFile: 'added',
      installWarning: 'boom',
      installDir: '/proj',
    });
    let stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'plugin', 'a']);
    expect(stderr.mock.calls.join('')).toContain('boom');
    stderr.mockRestore();

    createPluginMock.mockReturnValue({ ok: false, message: 'bad', detail: 'd' });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'plugin', 'a']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('mdk create dashboard', () => {
  it('fails when there is no name and no mdk.yaml to infer one from', async () => {
    const program = buildProgram();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dir = makeTmpDir();
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', '--dir', dir]);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('pass a name');
    process.exitCode = 0;
  });

  it('infers the name from mdk.yaml when none is given', async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'metadata:\n  name: my-stack\n', 'utf8');
    createDashboardMock.mockResolvedValue({ ok: true, appPath: join(dir, 'apps', 'dashboard'), source: 'monorepo' });
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', '--dir', dir]);
    expect(createDashboardMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-stack-dashboard' }),
    );
    expect(stdout.mock.calls.join('')).toContain('local monorepo template');
  });

  it('uses an explicit name under apps/<name>', async () => {
    createDashboardMock.mockResolvedValue({ ok: true, appPath: '/proj/apps/custom', source: 'github' });
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', 'custom']);
    expect(createDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'custom' }));
    expect(stdout.mock.calls.join('')).toContain('GitHub template');
  });

  it('surfaces an install warning and a failure', async () => {
    const program = buildProgram();
    createDashboardMock.mockResolvedValue({
      ok: true,
      appPath: '/proj/apps/custom',
      source: 'github',
      installWarning: 'boom',
    });
    let stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', 'custom']);
    expect(stderr.mock.calls.join('')).toContain('boom');
    stderr.mockRestore();

    createDashboardMock.mockResolvedValue({ ok: false, message: 'nope', detail: 'd' });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', 'custom']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('returns null (falls through to the error path) when mdk.yaml cannot be parsed', async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), '{ not: valid: yaml', 'utf8');
    const program = buildProgram();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', '--dir', dir]);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('pass a name');
    process.exitCode = 0;
  });

  it('falls through to the error path when mdk.yaml has no stack name to infer from', async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'metadata:\n  name: "  "\n', 'utf8');
    const program = buildProgram();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'create', 'dashboard', '--dir', dir]);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('pass a name');
    process.exitCode = 0;
  });
});
