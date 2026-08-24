import { describe, expect, it, vi } from 'vitest';

const installSkillsMock = vi.hoisted(() => vi.fn());
vi.mock('@tetherto/mdk-skill', () => ({ installSkills: installSkillsMock }));

const { installSkill } = await import('../../src/lib/skill.js');

describe('installSkill', () => {
  it('reports success with a count and the installed clients', () => {
    installSkillsMock.mockReturnValue({
      skills: [{ id: 'a' }, { id: 'b' }],
      installed: [{ client: 'cursor' }, { client: 'claude' }],
    });
    const result = installSkill('all', '/tmp/project');
    expect(installSkillsMock).toHaveBeenCalledWith({ client: 'all', target: '/tmp/project' });
    expect(result).toEqual({ ok: true, message: 'Installed 2 skill(s) for cursor, claude.' });
  });

  it('reports failure with the error message', () => {
    installSkillsMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    const result = installSkill('cursor', '/tmp/project');
    expect(result).toEqual({ ok: false, message: 'disk full' });
  });

  it('stringifies a non-Error throw', () => {
    installSkillsMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'nope';
    });
    const result = installSkill('cursor', '/tmp/project');
    expect(result).toEqual({ ok: false, message: 'nope' });
  });
});
