import type { Command } from 'commander';
import { stub } from '../lib/stub.js';
import { pkg } from '../lib/pkg.js';

// Group G — Meta & agent discovery
export function registerManifest(program: Command): void {
  program
    .command('manifest')
    .alias('json-help')
    .description('Emit the machine-readable command manifest (stub)')
    .action(() => stub('manifest'));
}

export function registerVersion(program: Command): void {
  program
    .command('version')
    .description('Print version information')
    .action(() => {
      // Data command: the version string goes to stdout.
      process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    });
}
