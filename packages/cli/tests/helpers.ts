import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

/** A fresh temp directory, auto-registered for cleanup via `cleanupTmpDirs`. */
const created: string[] = [];

export function makeTmpDir(prefix = 'mdk-cli-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  while (created.length) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Thrown by the mocked `process.exit` below, so a "never returns" call site really doesn't. */
export class ProcessExitSignal extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

/** Replaces `process.exit` with one that throws instead of tearing down the test worker. */
export function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitSignal(code);
  }) as typeof process.exit);
}
