import { afterEach, describe, expect, it, vi } from 'vitest';
import { stub } from '../../src/lib/stub.js';

describe('stub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a not-implemented notice for the command to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stub('discover');
    expect(write).toHaveBeenCalledWith('mdk discover: not implemented yet (stub).\n');
  });

  it('writes an additional hint line when given', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stub('mcp register', 'try `mdk skill add` instead');
    expect(write).toHaveBeenNthCalledWith(1, 'mdk mcp register: not implemented yet (stub).\n');
    expect(write).toHaveBeenNthCalledWith(2, '  -> try `mdk skill add` instead\n');
  });
});
