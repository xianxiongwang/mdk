import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

const installSkillMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/skill.js', () => ({ installSkill: installSkillMock }));

const { registerSkill, registerMcp } = await import('../../src/commands/agent.js');

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSkill(program);
  registerMcp(program);
  return program;
}

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
});

describe('mdk skill add', () => {
  it('rejects an unknown client', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'skill', 'add', '--client', 'nope']);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain("unknown client 'nope'");
  });

  it('installs successfully and prints the result message', async () => {
    installSkillMock.mockReturnValue({ ok: true, message: 'Installed 3 skill(s) for cursor.' });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'skill', 'add', '--client', 'cursor']);
    expect(installSkillMock).toHaveBeenCalledWith('cursor', expect.stringContaining(''));
    expect(stdout.mock.calls.join('')).toContain('Installed 3 skill(s)');
    expect(stderr.mock.calls.join('')).toContain('MDK Developer Skill installed.');
  });

  it('reports a failure with exit code 1 and an optional detail', async () => {
    installSkillMock.mockReturnValue({ ok: false, message: 'no target', detail: 'more info' });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'skill', 'add']);
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('no target');
    expect(stderr.mock.calls.join('')).toContain('more info');
  });
});

describe('mdk mcp register (stub)', () => {
  it('writes a not-implemented notice', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildProgram().parseAsync(['node', 'mdk', 'mcp', 'register']);
    expect(stderr.mock.calls.join('')).toContain('mdk mcp register: not implemented yet');
  });
});
