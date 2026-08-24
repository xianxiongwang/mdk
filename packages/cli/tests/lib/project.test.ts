import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIRS,
  WORKSPACES,
  WORKSPACE_VERSION,
  addFileDependency,
  addWorkspaceDependency,
  ensureProjectGitignore,
  ensureProjectManifest,
  ensureProjectReadme,
  isWorkspaceMember,
  readStackName,
} from '../../src/lib/project.js';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

afterEach(() => cleanupTmpDirs());

describe('DIRS / WORKSPACES / WORKSPACE_VERSION', () => {
  it('declares the expected component directories and workspace globs', () => {
    expect(DIRS.workers).toBe('workers');
    expect(DIRS.plugins).toBe('plugins');
    expect(DIRS.apps).toBe('apps');
    expect(DIRS.dashboard).toBe(join('apps', 'dashboard'));
    expect(WORKSPACES).toEqual(['workers/*', 'plugins/*']);
    expect(WORKSPACE_VERSION).toBe('*');
  });
});

describe('ensureProjectManifest', () => {
  it('creates a manifest when none exists', () => {
    const dir = makeTmpDir();
    const action = ensureProjectManifest(dir, 'My Stack!');
    expect(action).toBe('created');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-stack');
    expect(pkg.workspaces).toEqual(WORKSPACES);
    expect(pkg.private).toBe(true);
  });

  it('slugifies an unusual stack name, falling back to mdk-stack if empty', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, '   ');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('mdk-stack');
  });

  it('adds workspaces to an existing manifest that lacks them', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'existing' }), 'utf8');
    const action = ensureProjectManifest(dir, 'stack');
    expect(action).toBe('updated');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('existing');
    expect(pkg.workspaces).toEqual(WORKSPACES);
  });

  it('leaves an existing manifest with workspaces untouched', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'existing', workspaces: ['custom/*'] }),
      'utf8',
    );
    const action = ensureProjectManifest(dir, 'stack');
    expect(action).toBe('present');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.workspaces).toEqual(['custom/*']);
  });

  it('leaves an unparseable manifest untouched', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');
    expect(ensureProjectManifest(dir, 'stack')).toBe('present');
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{ not json');
  });
});

describe('isWorkspaceMember', () => {
  it('is false when the project has no workspaces field', () => {
    const dir = makeTmpDir();
    expect(isWorkspaceMember(dir, join(dir, 'workers', 'a'))).toBe(false);
  });

  it('is true for a package under a declared workspace glob', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    expect(isWorkspaceMember(dir, join(dir, 'workers', 'demo'))).toBe(true);
    expect(isWorkspaceMember(dir, join(dir, 'plugins', 'demo'))).toBe(true);
  });

  it('is false for a package outside every declared glob', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    expect(isWorkspaceMember(dir, join(dir, 'apps', 'dashboard'))).toBe(false);
  });

  it('is false for a path outside the project entirely', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    const outside = makeTmpDir();
    expect(isWorkspaceMember(dir, outside)).toBe(false);
  });

  it('is false for a nested path that does not match glob segment count', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    expect(isWorkspaceMember(dir, join(dir, 'workers', 'demo', 'nested'))).toBe(false);
  });
});

describe('addFileDependency', () => {
  it('throws when there is no package.json', () => {
    const dir = makeTmpDir();
    expect(() => addFileDependency(dir, '@tetherto/mdk-worker-antminer', '/fake/checkout')).toThrow(
      /no package.json/,
    );
  });

  it('adds the package as an absolute file: dependency, creating no workers/ folder', () => {
    const dir = makeTmpDir();
    const checkout = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    addFileDependency(dir, '@tetherto/mdk-worker-antminer', checkout);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@tetherto/mdk-worker-antminer']).toBe(`file:${resolve(checkout)}`);
    expect(() => readFileSync(join(dir, 'workers', 'antminer'))).toThrow();
  });

  it('is idempotent when the dependency is already declared at that path', () => {
    const dir = makeTmpDir();
    const checkout = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    addFileDependency(dir, '@tetherto/mdk-worker-antminer', checkout);
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    addFileDependency(dir, '@tetherto/mdk-worker-antminer', checkout);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
  });

  it('preserves other dependencies already present', () => {
    const dir = makeTmpDir();
    const checkout = makeTmpDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { lodash: '^4.0.0' } }),
      'utf8',
    );
    addFileDependency(dir, '@tetherto/mdk-worker-antminer', checkout);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies.lodash).toBe('^4.0.0');
    expect(pkg.dependencies['@tetherto/mdk-worker-antminer']).toBe(`file:${resolve(checkout)}`);
  });
});

describe('addWorkspaceDependency', () => {
  it('throws when there is no package.json', () => {
    const dir = makeTmpDir();
    expect(() => addWorkspaceDependency(dir, '@tetherto/mdk-worker-antminer')).toThrow(
      /no package.json/,
    );
  });

  it('adds the package at the workspace version', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    addWorkspaceDependency(dir, '@tetherto/mdk-worker-antminer');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@tetherto/mdk-worker-antminer']).toBe('*');
  });

  it('is idempotent when the dependency is already declared at "*"', () => {
    const dir = makeTmpDir();
    ensureProjectManifest(dir, 'stack');
    addWorkspaceDependency(dir, '@tetherto/mdk-worker-antminer');
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    addWorkspaceDependency(dir, '@tetherto/mdk-worker-antminer');
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
  });

  it('preserves other dependencies already present', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { lodash: '^4.0.0' } }),
      'utf8',
    );
    addWorkspaceDependency(dir, '@tetherto/mdk-worker-antminer');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies.lodash).toBe('^4.0.0');
    expect(pkg.dependencies['@tetherto/mdk-worker-antminer']).toBe('*');
  });
});

describe('readStackName', () => {
  it('returns null when there is no mdk.yaml', () => {
    const dir = makeTmpDir();
    expect(readStackName(dir)).toBeNull();
  });

  it('reads metadata.name from mdk.yaml', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'metadata:\n  name: my-stack\n', 'utf8');
    expect(readStackName(dir)).toBe('my-stack');
  });

  it('falls back to the directory basename when metadata.name is absent', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'kind: Stack\n', 'utf8');
    expect(readStackName(dir)).toBe(dir.split('/').pop());
  });

  it('falls back to the directory basename on unparseable YAML', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), '{ not: valid: yaml', 'utf8');
    expect(readStackName(dir)).toBe(dir.split('/').pop());
  });
});

describe('ensureProjectGitignore', () => {
  it('creates a .gitignore with the MDK block when absent', () => {
    const dir = makeTmpDir();
    expect(ensureProjectGitignore(dir)).toBe('created');
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(content).toContain('.mdk/');
  });

  it('appends the MDK block to an existing .gitignore without it', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.gitignore'), 'dist/', 'utf8');
    expect(ensureProjectGitignore(dir)).toBe('updated');
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(content).toContain('dist/');
    expect(content).toContain('.mdk/');
  });

  it('leaves a .gitignore that already has the MDK block untouched', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.gitignore'), '.mdk/\n', 'utf8');
    expect(ensureProjectGitignore(dir)).toBe('present');
  });
});

describe('ensureProjectReadme', () => {
  it('does not overwrite an existing README', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'README.md'), 'custom content', 'utf8');
    expect(ensureProjectReadme(dir, { stackName: 'x', workerNames: [] })).toBe('present');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('custom content');
  });

  it('writes a README with both the together-run and per-component run flows', () => {
    const dir = makeTmpDir();
    const action = ensureProjectReadme(dir, { stackName: 'my-stack', workerNames: ['a'] });
    expect(action).toBe('created');
    const content = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(content).toContain('# my-stack');
    expect(content).toContain('mdk run');
    expect(content).toContain('mdk run kernel');
    expect(content).toContain('mdk run worker a');
    expect(content).not.toContain('Dashboard');
  });

  it('lists each worker in the per-component commands, or a placeholder with none', () => {
    const dir = makeTmpDir();
    ensureProjectReadme(dir, { stackName: 'my-stack', workerNames: ['a', 'b'] });
    const content = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(content).toContain('mdk run kernel');
    expect(content).toContain('mdk run worker a');
    expect(content).toContain('mdk run worker b');

    const dir2 = makeTmpDir();
    ensureProjectReadme(dir2, { stackName: 'my-stack', workerNames: [] });
    expect(readFileSync(join(dir2, 'README.md'), 'utf8')).toContain('mdk run worker <name>');
  });

  it('includes a Dashboard section when dashboardDir is given', () => {
    const dir = makeTmpDir();
    ensureProjectReadme(dir, {
      stackName: 'my-stack',
      workerNames: [],
      dashboardDir: 'apps/dashboard',
    });
    const content = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(content).toContain('## Dashboard');
    expect(content).toContain('cd apps/dashboard');
  });
});
