import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));

const { installDeps, installPackages, installScaffold, npmBin } = await import('../../src/lib/npm.js');

afterEach(() => {
  cleanupTmpDirs();
  spawnSyncMock.mockReset();
});

describe('npmBin', () => {
  it('is npm.cmd on win32 and npm otherwise', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(npmBin()).toBe('npm.cmd');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(npmBin()).toBe('npm');
    Object.defineProperty(process, 'platform', { value: original });
  });
});

describe('installDeps', () => {
  it('skips when run is false', () => {
    const result = installDeps(makeTmpDir(), false);
    expect(result).toEqual({ ok: true, skipped: true, message: 'install skipped (--no-install)' });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('skips when there is no package.json', () => {
    const result = installDeps(makeTmpDir());
    expect(result.skipped).toBe(true);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('runs npm install and reports success', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');
    spawnSyncMock.mockReturnValue({ status: 0 });
    const result = installDeps(dir);
    expect(result).toEqual({ ok: true });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm',
      ['install'],
      expect.objectContaining({ cwd: dir }),
    );
  });

  it('reports a missing npm binary distinctly from a generic spawn error', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');
    spawnSyncMock.mockReturnValue({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
    expect(installDeps(dir)).toEqual({
      ok: false,
      message: 'npm was not found on PATH — install dependencies manually.',
    });

    spawnSyncMock.mockReturnValue({ error: new Error('boom') });
    expect(installDeps(dir)).toEqual({
      ok: false,
      message: 'npm install failed to start: boom',
    });
  });

  it('reports a non-zero exit status', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');
    spawnSyncMock.mockReturnValue({ status: 1 });
    expect(installDeps(dir)).toEqual({ ok: false, message: 'npm install exited with code 1.' });
  });
});

describe('installPackages', () => {
  it('skips when run is false or the package list is empty', () => {
    expect(installPackages(makeTmpDir(), ['a'], false).skipped).toBe(true);
    expect(installPackages(makeTmpDir(), []).skipped).toBe(true);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('fails when there is no package.json', () => {
    const result = installPackages(makeTmpDir(), ['left-pad']);
    expect(result).toEqual({ ok: false, message: 'no package.json — run `mdk onboard` first' });
  });

  it('installs the given packages', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');
    spawnSyncMock.mockReturnValue({ status: 0 });
    expect(installPackages(dir, ['left-pad', 'right-pad'])).toEqual({ ok: true });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm',
      ['install', 'left-pad', 'right-pad'],
      expect.objectContaining({ cwd: dir }),
    );
  });

  it('reports a missing npm binary, a generic spawn error, and a non-zero exit', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');

    spawnSyncMock.mockReturnValue({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
    expect(installPackages(dir, ['a']).message).toMatch(/not found on PATH/);

    spawnSyncMock.mockReturnValue({ error: new Error('boom') });
    expect(installPackages(dir, ['a']).message).toBe('npm install failed to start: boom');

    spawnSyncMock.mockReturnValue({ status: 2 });
    expect(installPackages(dir, ['a']).message).toBe('npm install exited with code 2.');
  });
});

describe('installScaffold', () => {
  it('installs at the project root for a workspace member', () => {
    const projectDir = makeTmpDir();
    mkdirSync(join(projectDir, 'workers', 'demo'), { recursive: true });
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ workspaces: ['workers/*'] }),
      'utf8',
    );
    spawnSyncMock.mockReturnValue({ status: 0 });
    const result = installScaffold(projectDir, join(projectDir, 'workers', 'demo'));
    expect(result.dir).toBe(projectDir);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm',
      ['install'],
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it('installs in place for a package outside the workspaces (e.g. a dashboard)', () => {
    const projectDir = makeTmpDir();
    const appDir = join(projectDir, 'apps', 'dashboard');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'package.json'), '{}', 'utf8');
    spawnSyncMock.mockReturnValue({ status: 0 });
    const result = installScaffold(projectDir, appDir);
    expect(result.dir).toBe(appDir);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm',
      ['install'],
      expect.objectContaining({ cwd: appDir }),
    );
  });
});
