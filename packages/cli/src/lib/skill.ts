import { installSkills } from '@tetherto/mdk-skill';

export type SkillClient = 'cursor' | 'claude' | 'all';

export interface SkillResult {
  ok: boolean;
  message: string;
  detail?: string;
}

/**
 * Installs the MDK Developer Skill suite into the target project via the
 * `@tetherto/mdk-skill` package's programmatic entry point. The package is a
 * regular dependency (resolved through node/npm), so this works the same when
 * the CLI is installed from npm and when it runs inside the monorepo workspace.
 */
export function installSkill(client: SkillClient, targetDir: string): SkillResult {
  try {
    const result = installSkills({ client, target: targetDir });
    const clients = result.installed.map((entry) => entry.client).join(', ');
    return {
      ok: true,
      message: `Installed ${result.skills.length} skill(s) for ${clients}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
