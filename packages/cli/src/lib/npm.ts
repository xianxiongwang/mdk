import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isWorkspaceMember } from './project.js';

export interface InstallResult {
  ok: boolean;
  /** Skipped when there is nothing to install (no package.json) or `run: false`. */
  skipped?: boolean;
  message?: string;
}

export interface ScaffoldInstall extends InstallResult {
  /** The directory npm actually ran in — the workspace root, or the package. */
  dir: string;
}

/** The npm executable name for the current platform. */
export function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Runs `npm install` in `dir` (best-effort). Streams npm's output so progress is
 * visible. Never throws: a missing `package.json`, a missing `npm`, or a
 * non-zero exit is reported via the result so the scaffold still succeeds and
 * the user can install manually.
 */
export function installDeps(dir: string, run = true): InstallResult {
  if (!run) return { ok: true, skipped: true, message: 'install skipped (--no-install)' };
  if (!existsSync(join(dir, 'package.json'))) {
    return { ok: true, skipped: true, message: 'no package.json — nothing to install' };
  }

  const res = spawnSync(npmBin(), ['install'], {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
  });

  if (res.error) {
    const missing = (res.error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ok: false,
      message: missing
        ? 'npm was not found on PATH — install dependencies manually.'
        : `npm install failed to start: ${res.error.message}`,
    };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return { ok: false, message: `npm install exited with code ${res.status}.` };
  }
  return { ok: true };
}

/**
 * Adds one or more packages to `dir`'s `dependencies` and installs them
 * (`npm install <pkg>...`), so the runtime can later resolve them from the
 * project's `node_modules`. Same best-effort, never-throw contract as
 * `installDeps`: a missing `npm`, a missing manifest, or a non-zero exit is
 * reported via the result rather than thrown. No-ops when `packages` is empty.
 */
export function installPackages(dir: string, packages: string[], run = true): InstallResult {
  if (!run) return { ok: true, skipped: true, message: 'install skipped (--no-install)' };
  if (packages.length === 0) {
    return { ok: true, skipped: true, message: 'no packages to install' };
  }
  if (!existsSync(join(dir, 'package.json'))) {
    return { ok: false, message: 'no package.json — run `mdk onboard` first' };
  }

  const res = spawnSync(npmBin(), ['install', ...packages], {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
  });

  if (res.error) {
    const missing = (res.error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ok: false,
      message: missing
        ? 'npm was not found on PATH — install the plugins manually.'
        : `npm install failed to start: ${res.error.message}`,
    };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return { ok: false, message: `npm install exited with code ${res.status}.` };
  }
  return { ok: true };
}

/**
 * Installs dependencies for a freshly scaffolded component. For a workspace
 * member npm must run at the project root: installing inside the package would
 * create a nested `node_modules` plus a second lockfile, and the workspace
 * symlink the runtime relies on to resolve the component would never appear.
 * Everything else installs in its own directory.
 */
export function installScaffold(
  projectDir: string,
  packageDir: string,
  run = true,
): ScaffoldInstall {
  const dir = isWorkspaceMember(projectDir, packageDir) ? projectDir : packageDir;
  return { ...installDeps(dir, run), dir };
}
