import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

const installScaffoldMock = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, dir: '/does/not/matter' })),
);
vi.mock('../../src/lib/npm.js', () => ({ installScaffold: installScaffoldMock }));

const { createPlugin } = await import('../../src/lib/plugin-scaffold.js');

afterEach(() => {
  cleanupTmpDirs();
  installScaffoldMock.mockClear();
});

describe('createPlugin', () => {
  it('rejects an invalid plugin name', () => {
    const result = createPlugin({ name: 'Bad Name', parentDir: makeTmpDir() });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid plugin name/);
  });

  it('scaffolds the bundled template and sets both manifests', () => {
    const dir = makeTmpDir();
    const result = createPlugin({ name: 'summary2', parentDir: dir });
    expect(result.ok).toBe(true);
    expect(existsSync(result.pluginPath!)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(result.pluginPath!, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('summary2');
    const manifest = JSON.parse(readFileSync(join(result.pluginPath!, 'mdk-plugin.json'), 'utf8'));
    expect(manifest.name).toBe('summary2');
  });

  it('scopes the package name under --org', () => {
    const dir = makeTmpDir();
    const result = createPlugin({ name: 'summary2', parentDir: dir, org: 'demo' });
    expect(result.packageName).toBe('@demo/summary2');
  });

  it('refuses to overwrite without --force, and allows it with --force', () => {
    const dir = makeTmpDir();
    createPlugin({ name: 'summary2', parentDir: dir });
    const blocked = createPlugin({ name: 'summary2', parentDir: dir });
    expect(blocked.ok).toBe(false);

    const forced = createPlugin({ name: 'summary2', parentDir: dir, force: true });
    expect(forced.ok).toBe(true);
  });

  it('surfaces an install warning without failing the scaffold', () => {
    installScaffoldMock.mockReturnValueOnce({ ok: false, message: 'boom', dir: '/x' });
    const result = createPlugin({ name: 'summary2', parentDir: makeTmpDir() });
    expect(result.ok).toBe(true);
    expect(result.installWarning).toBe('boom');
  });

  it('links the project manifest when parentDir has an mdk.yaml', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'metadata:\n  name: my-stack\n', 'utf8');
    createPlugin({ name: 'summary2', parentDir: dir });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.workspaces).toContain('plugins/*');
  });

  it('adds the plugin under spec.gateway.plugins in mdk.yaml', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'mdk.yaml'),
      ['kind: Stack', 'apiVersion: mdk/v1', 'spec:', '  gateway:', '    port: 3847', ''].join('\n'),
      'utf8',
    );
    const result = createPlugin({ name: 'summary2', parentDir: dir });
    expect(result.stackFile).toBe('added');
    const content = readFileSync(join(dir, 'mdk.yaml'), 'utf8');
    expect(content).toContain('summary2');
  });

  it('reports "exists" when the plugin package is already listed', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'mdk.yaml'),
      [
        'kind: Stack',
        'apiVersion: mdk/v1',
        'spec:',
        '  gateway:',
        '    port: 3847',
        '    plugins:',
        '      - package: summary2',
        '        config: {}',
      ].join('\n'),
      'utf8',
    );
    const result = createPlugin({ name: 'summary2', parentDir: dir, force: true });
    expect(result.stackFile).toBe('exists');
  });

  it('reports "no-file" with no mdk.yaml, and skips entirely via updateStackFile:false', () => {
    const dir = makeTmpDir();
    const result = createPlugin({ name: 'summary2', parentDir: dir });
    expect(result.stackFile).toBe('no-file');

    const dir2 = makeTmpDir();
    const skipped = createPlugin({ name: 'summary2', parentDir: dir2, updateStackFile: false });
    expect(skipped.stackFile).toBeUndefined();
  });

  it('reports "error" when mdk.yaml cannot be stringified back', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), '{ not: valid: yaml', 'utf8');
    const result = createPlugin({ name: 'summary2', parentDir: dir });
    expect(result.stackFile).toBe('error');
  });
});
