import type { Command } from 'commander';
import { stub } from '../lib/stub.js';

// Group D — Discover (Gateway capability)
export function registerDiscover(program: Command): void {
  program
    .command('discover')
    .description('Query the Gateway for live capabilities and write a profile (stub)')
    .option('--gateway <url>', 'Gateway URL', 'http://127.0.0.1:3847')
    .option('--out <path>', 'Output path for the capability profile')
    .action(() => stub('discover'));
}
