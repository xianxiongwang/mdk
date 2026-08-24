import { describe, expect, it, vi } from 'vitest';

const cloneMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const degitMock = vi.hoisted(() => vi.fn(() => ({ clone: cloneMock })));
vi.mock('degit', () => ({ default: degitMock }));

const { fetchTemplate, toDegitSrc } = await import('../../src/lib/fetch-template.js');

describe('toDegitSrc', () => {
  it('converts a GitHub tree URL into a degit source spec', () => {
    expect(toDegitSrc('https://github.com/tetherto/mdk/tree/main/examples/mdk-ui-shell-template')).toBe(
      'tetherto/mdk/examples/mdk-ui-shell-template#main',
    );
  });

  it('handles a trailing slash', () => {
    expect(toDegitSrc('https://github.com/tetherto/mdk/tree/main/examples/foo/')).toBe(
      'tetherto/mdk/examples/foo#main',
    );
  });

  it('throws for a non-tree GitHub URL', () => {
    expect(() => toDegitSrc('https://github.com/tetherto/mdk')).toThrow(/Not a GitHub tree URL/);
  });
});

describe('fetchTemplate', () => {
  it('builds a degit emitter from the parsed source and clones into dest', async () => {
    await fetchTemplate('https://github.com/tetherto/mdk/tree/main/examples/foo', '/tmp/dest', true);
    expect(degitMock).toHaveBeenCalledWith('tetherto/mdk/examples/foo#main', {
      cache: false,
      force: true,
      verbose: false,
    });
    expect(cloneMock).toHaveBeenCalledWith('/tmp/dest');
  });

  it('defaults force to false', async () => {
    await fetchTemplate('https://github.com/tetherto/mdk/tree/main/examples/foo', '/tmp/dest');
    expect(degitMock).toHaveBeenCalledWith(
      'tetherto/mdk/examples/foo#main',
      expect.objectContaining({ force: false }),
    );
  });
});
