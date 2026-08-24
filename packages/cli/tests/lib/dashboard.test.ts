import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

const installDepsMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));
vi.mock('../../src/lib/npm.js', () => ({ installDeps: installDepsMock, npmBin: () => 'npm' }));

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((_signal?: string) => {
    this.exitCode = 0;
    this.emit('exit', 0, null);
    return true;
  });
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const {
  createDashboard,
  dashboardNameFromStack,
  findDashboardDir,
  runDashboard,
  shellTemplateUrl,
} = await import('../../src/lib/dashboard.js');

afterEach(() => {
  cleanupTmpDirs();
  vi.clearAllMocks();
});

describe('dashboardNameFromStack / shellTemplateUrl', () => {
  it('derives the dashboard package name from the stack name', () => {
    expect(dashboardNameFromStack('demo')).toBe('demo-dashboard');
  });

  it('builds the GitHub tree URL for a ref, defaulting to main', () => {
    expect(shellTemplateUrl()).toContain('/tree/main/examples/mdk-ui-shell-template');
    expect(shellTemplateUrl('v1.2.3')).toContain('/tree/v1.2.3/');
  });
});

describe('findDashboardDir', () => {
  it('returns null when there is no apps/ directory at all', () => {
    expect(findDashboardDir(makeTmpDir())).toBeNull();
  });

  it('finds the canonical apps/dashboard when it has a dev script', () => {
    const dir = makeTmpDir();
    const appPath = join(dir, 'apps', 'dashboard');
    mkdirSync(appPath, { recursive: true });
    writeFileSync(join(appPath, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    expect(findDashboardDir(dir)).toBe(appPath);
  });

  it('falls back to scanning apps/* for the first app with a dev script', () => {
    const dir = makeTmpDir();
    const noDev = join(dir, 'apps', 'aaa-no-dev');
    mkdirSync(noDev, { recursive: true });
    writeFileSync(join(noDev, 'package.json'), JSON.stringify({ scripts: {} }));
    const withDev = join(dir, 'apps', 'bbb-custom');
    mkdirSync(withDev, { recursive: true });
    writeFileSync(join(withDev, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    expect(findDashboardDir(dir)).toBe(withDev);
  });

  it('returns null when apps/ exists but nothing inside has a dev script', () => {
    const dir = makeTmpDir();
    const noDev = join(dir, 'apps', 'not-an-app');
    mkdirSync(noDev, { recursive: true });
    writeFileSync(join(noDev, 'package.json'), '{ not json');
    expect(findDashboardDir(dir)).toBeNull();
  });
});

describe('runDashboard', () => {
  it('resolves once the child process spawns, and stops it with SIGTERM', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runDashboard('/some/dir');
    child.emit('spawn');
    const handle = await promise;

    expect(spawnMock).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({ cwd: '/some/dir' }));
    await handle.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('resolves stop() immediately when the child already exited', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runDashboard('/some/dir');
    child.emit('spawn');
    const handle = await promise;

    Object.defineProperty(child, 'exitCode', { value: 0 });
    await handle.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects with a clear message when npm is missing (ENOENT)', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runDashboard('/some/dir');
    const err = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
    child.emit('error', err);
    await expect(promise).rejects.toThrow(/npm was not found on PATH/);
  });

  it('rejects with the underlying message for any other spawn error', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runDashboard('/some/dir');
    child.emit('error', new Error('kaboom'));
    await expect(promise).rejects.toThrow(/Failed to start the dashboard dev server: kaboom/);
  });
});

describe('createDashboard (monorepo template)', () => {
  it('refuses to overwrite an existing target without force', async () => {
    const parentDir = makeTmpDir();
    mkdirSync(join(parentDir, 'apps', 'dashboard'), { recursive: true });
    const result = await createDashboard({ name: 'x-dashboard', parentDir });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already exists/);
    expect(installDepsMock).not.toHaveBeenCalled();
  });

  it('scaffolds from the local monorepo template, installs, and configures the gateway URL', async () => {
    const parentDir = makeTmpDir();
    writeFileSync(
      join(parentDir, 'mdk.yaml'),
      'spec:\n  gateway:\n    port: 4001\n',
      'utf8',
    );
    const result = await createDashboard({ name: 'demo-dashboard', parentDir });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('monorepo');
    expect(existsSync(result.appPath!)).toBe(true);
    expect(installDepsMock).toHaveBeenCalledWith(result.appPath, true);

    const pkg = JSON.parse(readFileSync(join(result.appPath!, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('demo-dashboard');

    const env = readFileSync(join(result.appPath!, '.env'), 'utf8');
    expect(env).toContain('VITE_GATEWAY_URL=http://localhost:4001');
    expect(env).toContain('VITE_OAUTH_BASE_URL=http://localhost:4001');

    // Excluded scaffold artifacts never make it into the copy.
    expect(existsSync(join(result.appPath!, 'node_modules'))).toBe(false);
    expect(existsSync(join(result.appPath!, '_managed'))).toBe(false);
  });

  it('accepts an explicit gatewayUrl and an explicit subdir', async () => {
    const parentDir = makeTmpDir();
    const result = await createDashboard({
      name: 'demo-dashboard',
      parentDir,
      subdir: join('apps', 'custom'),
      gatewayUrl: 'http://localhost:9999',
    });
    expect(result.appPath).toBe(join(parentDir, 'apps', 'custom'));
    const env = readFileSync(join(result.appPath!, '.env'), 'utf8');
    expect(env).toContain('http://localhost:9999');
  });

  it('surfaces an install warning without failing the scaffold', async () => {
    installDepsMock.mockReturnValueOnce({ ok: false, message: 'npm exploded' });
    const parentDir = makeTmpDir();
    const result = await createDashboard({ name: 'demo-dashboard', parentDir });
    expect(result.ok).toBe(true);
    expect(result.installWarning).toBe('npm exploded');
  });

  it('overwrites an existing target with force', async () => {
    const parentDir = makeTmpDir();
    mkdirSync(join(parentDir, 'apps', 'dashboard'), { recursive: true });
    writeFileSync(join(parentDir, 'apps', 'dashboard', 'marker.txt'), 'stale', 'utf8');
    const result = await createDashboard({ name: 'demo-dashboard', parentDir, force: true });
    expect(result.ok).toBe(true);
    expect(existsSync(join(result.appPath!, 'marker.txt'))).toBe(false);
  });
});
