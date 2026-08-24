import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDiscover } from '../../src/commands/discover.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDiscover(program);
  return program;
}

afterEach(() => vi.restoreAllMocks());

describe('mdk discover (stub)', () => {
  it('writes a not-implemented notice to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'discover']);
    expect(stderr.mock.calls.join('')).toContain('mdk discover: not implemented yet');
  });

  it('accepts --gateway and --out options without erroring', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync([
      'node',
      'mdk',
      'discover',
      '--gateway',
      'http://localhost:1234',
      '--out',
      'profile.json',
    ]);
    expect(stderr.mock.calls.join('')).toContain('not implemented yet');
  });
});
