import { Command } from 'commander';
import { pkg } from './lib/pkg.js';
import { registerOnboard } from './commands/onboard.js';
import { registerCreate } from './commands/create.js';
import { registerRun } from './commands/run.js';
import {
  registerGet,
  registerDescribe,
  registerLogs,
  registerStatus,
} from './commands/inspect.js';
import { registerDiscover } from './commands/discover.js';
import { registerSkill, registerMcp } from './commands/agent.js';
import { registerManifest, registerVersion } from './commands/meta.js';

/**
 * Builds the full `mdk` command tree.
 *
 * Every command is registered with its real name, arguments, options, and help
 * text. `onboard`, `create`, `run`, `status`, `skill add` and `version` are
 * implemented; the rest are no-op stubs (see `lib/stub.ts`) and mark themselves
 * "(stub)" in help. Implement one by replacing its `stub(...)` call with the real
 * behavior — no wiring changes required.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mdk')
    .description(
      'MDK command-line tool — onboard, scaffold, run and inspect an MDK stack. ' +
        'Commands marked "(stub)" are wired up but not implemented yet.',
    )
    .version(pkg.version, '--version', 'Print the CLI version')
    .option('-o, --output <fmt>', 'Output format for data: table | json | yaml', 'table')
    .option('-v, --verbose', 'Increase log detail', false)
    .option('--debug', 'Print stack traces for unexpected failures', false)
    .showHelpAfterError();

  // Group A — Onboarding & project lifecycle
  registerOnboard(program);

  // Group B — Scaffold (backend only)
  registerCreate(program);

  // Group C — Run & manage
  registerRun(program);
  registerGet(program);
  registerDescribe(program);
  registerLogs(program);
  registerStatus(program);

  // Group D — Discover
  registerDiscover(program);

  // Group F — Agent enablement
  registerSkill(program);
  registerMcp(program);

  // Group G — Meta & agent discovery
  registerManifest(program);
  registerVersion(program);

  return program;
}
