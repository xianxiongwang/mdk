import { describe, expect, it } from 'vitest';
import { pkg } from '../../src/lib/pkg.js';

describe('pkg', () => {
  it('resolves the CLI package.json name and version', () => {
    expect(pkg.name).toBe('@tetherto/mdk-cli');
    expect(typeof pkg.version).toBe('string');
    expect(pkg.version.length).toBeGreaterThan(0);
  });
});
