import { describe, expect, it } from 'vitest';
import { badge, banner, cmdBlock, dot, kvBlock, theme, tick, arrow } from '../../src/lib/theme.js';

describe('theme', () => {
  it('exposes styling functions that return strings containing the input', () => {
    for (const fn of Object.values(theme)) {
      expect(fn('hello')).toContain('hello');
    }
  });

  it('badge wraps the label with spaces', () => {
    expect(badge('MDK')).toContain('MDK');
  });

  it('banner includes the tagline', () => {
    expect(banner()).toContain('tether.');
  });

  it('kvBlock aligns keys to the widest column', () => {
    const out = kvBlock([
      ['a', '1'],
      ['bbb', '2'],
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1');
    expect(lines[1]).toContain('2');
  });

  it('kvBlock handles an empty row list', () => {
    expect(kvBlock([])).toBe('');
  });

  it('cmdBlock renders a comment when given, and omits it otherwise', () => {
    const out = cmdBlock([
      ['mdk run', 'boots the stack'],
      ['mdk status', undefined],
    ]);
    expect(out).toContain('# boots the stack');
    const lines = out.split('\n');
    expect(lines[1]).not.toContain('#');
  });

  it('exports the tick, dot and arrow glyphs', () => {
    expect(typeof tick).toBe('string');
    expect(typeof dot).toBe('string');
    expect(typeof arrow).toBe('string');
  });
});
