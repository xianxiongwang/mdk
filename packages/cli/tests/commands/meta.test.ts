import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerManifest, registerVersion } from '../../src/commands/meta.js';
import { pkg } from '../../src/lib/pkg.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerManifest(program);
  registerVersion(program);
  return program;
}

afterEach(() => vi.restoreAllMocks());

describe('mdk manifest (stub)', () => {
  it('writes a not-implemented notice, and responds to its json-help alias', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'manifest']);
    expect(stderr.mock.calls.join('')).toContain('mdk manifest: not implemented yet');

    stderr.mockClear();
    await buildProgram().parseAsync(['node', 'mdk', 'json-help']);
    expect(stderr.mock.calls.join('')).toContain('mdk manifest: not implemented yet');
  });
});

describe('mdk version', () => {
  it('prints the package name and version to stdout', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'version']);
    expect(stdout).toHaveBeenCalledWith(`${pkg.name} ${pkg.version}\n`);
  });
});
