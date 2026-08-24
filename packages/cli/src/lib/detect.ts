import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Environment {
  nodeVersion: string;
  nodeOk: boolean;
  packageManager: string;
  git: boolean;
  existingSpec: boolean;
  agentClient: string;
}

/**
 * Lightweight, generic environment detection for the onboarding wizard.
 * Nothing here is MDK-specific — it only inspects the current working directory
 * and the running Node process.
 */
export function detectEnvironment(cwd: string = process.cwd()): Environment {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0] ?? '0');

  let packageManager = 'npm';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(cwd, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(cwd, 'bun.lockb'))) packageManager = 'bun';

  let agentClient = 'none';
  if (existsSync(join(cwd, '.cursor'))) agentClient = 'cursor';
  else if (existsSync(join(cwd, '.claude'))) agentClient = 'claude';
  else if (existsSync(join(cwd, '.codex'))) agentClient = 'codex';
  else if (existsSync(join(cwd, '.cline'))) agentClient = 'cline';

  return {
    nodeVersion,
    nodeOk: major >= 20,
    packageManager,
    git: existsSync(join(cwd, '.git')),
    existingSpec: existsSync(join(cwd, 'mdk.yaml')),
    agentClient,
  };
}
