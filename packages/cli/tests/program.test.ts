import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/program.js';
import { pkg } from '../src/lib/pkg.js';

describe('buildProgram', () => {
  it('names the program mdk and sets the version from package.json', () => {
    const program = buildProgram();
    expect(program.name()).toBe('mdk');
    expect(program.version()).toBe(pkg.version);
  });

  it('registers every top-level command from the HLD command surface', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        'onboard',
        'create',
        'run',
        'get',
        'describe',
        'logs',
        'status',
        'discover',
        'skill',
        'mcp',
        'manifest',
        'version',
      ]),
    );
  });

  it('declares the global --output, --verbose and --debug options', () => {
    const program = buildProgram();
    const flags = program.options.map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--output', '--verbose', '--debug']));
  });
});
