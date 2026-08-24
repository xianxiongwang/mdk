import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createDashboard, dashboardNameFromStack } from '../lib/dashboard.js';
import { createWorker } from '../lib/worker-scaffold.js';
import { deviceId, deviceSerial } from '../lib/spec.js';
import { createPlugin } from '../lib/plugin-scaffold.js';
import { DIRS } from '../lib/project.js';
import { theme, tick, arrow } from '../lib/theme.js';

/**
 * Resolves the dashboard's package name and its location.
 *
 * With no name the app takes the canonical `apps/dashboard` path and a
 * `<stack>-dashboard` package name read from mdk.yaml — so the path never churns
 * when the stack is renamed. An explicit name gets its own `apps/<name>` slot,
 * which is how a project ends up with more than one app.
 */
function resolveDashboard(
  explicit: string | undefined,
  parentDir: string,
): { name: string; subdir: string } | null {
  if (explicit) return { name: explicit, subdir: join(DIRS.apps, explicit) };

  const specPath = resolve(parentDir, 'mdk.yaml');
  if (!existsSync(specPath)) return null;
  try {
    const doc = parseYaml(readFileSync(specPath, 'utf8')) as { metadata?: { name?: string } };
    const stack = doc.metadata?.name?.trim();
    return stack ? { name: dashboardNameFromStack(stack), subdir: DIRS.dashboard } : null;
  } catch {
    return null;
  }
}

// Group B — Scaffold
export function registerCreate(program: Command): void {
  const create = program
    .command('create')
    .description('Scaffold MDK components');

  create
    .command('worker <name>')
    .description('Scaffold a Worker Plugin package into <dir>/workers/<name>')
    .option('--org <scope>', 'npm scope/org for the generated package name')
    .option('--dir <path>', 'Project directory (worker is created under <dir>/workers/<name>)', '.')
    .option('--force', 'Overwrite the target if it already exists', false)
    .option('--no-install', 'Skip running `npm install` in the scaffolded worker')
    .option('--no-stack-entry', 'Skip adding the worker to mdk.yaml under spec.workers')
    .action(
      (
        name: string,
        opts: { org?: string; dir: string; force: boolean; install: boolean; stackEntry: boolean },
      ) => {
        const result = createWorker({
          name,
          parentDir: opts.dir,
          org: opts.org,
          force: opts.force,
          install: opts.install,
          updateStackFile: opts.stackEntry,
        });
        if (!result.ok) {
          process.stderr.write(`${theme.warn('error')}: ${result.message}\n`);
          if (result.detail) process.stderr.write(`${result.detail}\n`);
          process.exitCode = 1;
          return;
        }

        if (result.installWarning) {
          process.stderr.write(
            `${theme.warn('warning')}: ${result.installWarning} ` +
              `${theme.muted(`(run \`npm install\` in ${result.installDir})`)}\n`,
          );
        }

        let out =
          `${tick} Scaffolded worker ${theme.label(name)} ${arrow} ${theme.value(result.workerPath!)}\n` +
          `  ${theme.muted('package')} ${theme.value(result.packageName!)}\n`;

        // Report how mdk.yaml was touched, and fall back to the manual snippet
        // when it could not be updated automatically.
        const manualSnippet =
          `${theme.cmd(
            `    - name: ${name}\n` +
              `      package: ${result.relPackage}\n` +
              `      config:\n` +
              `        mock: true\n` +
              `        devices:\n` +
              `          - id: ${deviceId(name)}\n` +
              `            opts: { host: 127.0.0.1, port: ${result.mockPort}, serial: ${deviceSerial(name)} }`,
          )}\n`;

        switch (result.stackFile) {
          case 'added':
            out += `  ${tick} Added to ${theme.value('mdk.yaml')} under ${theme.key('spec.workers')}\n`;
            break;
          case 'exists':
            out += `  ${theme.muted(`spec.workers already has "${name}" in mdk.yaml — left unchanged`)}\n`;
            break;
          case 'no-file':
            out +=
              `\n${theme.warn('No mdk.yaml found')} in ${theme.value(opts.dir)}. Add this under ${theme.key('spec.workers')}:\n\n` +
              manualSnippet;
            break;
          case 'error':
            out +=
              `\n${theme.warn('Could not update mdk.yaml automatically')}. Add this under ${theme.key('spec.workers')}:\n\n` +
              manualSnippet;
            break;
          default:
            // --no-stack-entry
            out +=
              `\n${theme.muted('Add this to')} ${theme.value('mdk.yaml')} under ${theme.key('spec.workers')}:\n\n` +
              manualSnippet;
        }

        out +=
          `\n${theme.label('Next steps')}\n` +
          `  ${theme.muted('1.')} Customize ${theme.value('mdk-contract.json')}, ${theme.value('src/')} + ${theme.value('mock/server.js')} for your device.\n` +
          `  ${theme.muted('2.')} Run it: ${theme.cmd(`mdk run worker ${name}`)}\n`;

        process.stdout.write(out);
      },
    );

  create
    .command('plugin <name>')
    .description(`Scaffold a Gateway Plugin package into <dir>/${DIRS.plugins}/<name>`)
    .option('--org <scope>', 'npm scope/org for the generated package name')
    .option('--dir <path>', `Project directory (plugin is created under <dir>/${DIRS.plugins}/<name>)`, '.')
    .option('--force', 'Overwrite the target if it already exists', false)
    .option('--no-install', 'Skip running `npm install` in the scaffolded plugin')
    .option('--no-stack-entry', 'Skip adding the plugin to mdk.yaml under spec.gateway.plugins')
    .action(
      (
        name: string,
        opts: { org?: string; dir: string; force: boolean; install: boolean; stackEntry: boolean },
      ) => {
        const result = createPlugin({
          name,
          parentDir: opts.dir,
          org: opts.org,
          force: opts.force,
          install: opts.install,
          updateStackFile: opts.stackEntry,
        });
        if (!result.ok) {
          process.stderr.write(`${theme.warn('error')}: ${result.message}\n`);
          if (result.detail) process.stderr.write(`${result.detail}\n`);
          process.exitCode = 1;
          return;
        }

        if (result.installWarning) {
          process.stderr.write(
            `${theme.warn('warning')}: ${result.installWarning} ` +
              `${theme.muted(`(run \`npm install\` in ${result.installDir})`)}\n`,
          );
        }

        let out =
          `${tick} Scaffolded plugin ${theme.label(name)} ${arrow} ${theme.value(result.pluginPath!)}\n` +
          `  ${theme.muted('package')} ${theme.value(result.packageName!)}\n`;

        // Gateway plugins are referenced by package name (resolved via the
        // plugins/* workspace), so the manual snippet uses the package name too.
        const manualSnippet =
          `${theme.cmd(`    - package: ${result.packageName}\n` + `      config: {}`)}\n`;

        switch (result.stackFile) {
          case 'added':
            out += `  ${tick} Added to ${theme.value('mdk.yaml')} under ${theme.key('spec.gateway.plugins')}\n`;
            break;
          case 'exists':
            out += `  ${theme.muted(`spec.gateway.plugins already lists "${result.packageName}" — left unchanged`)}\n`;
            break;
          case 'no-file':
            out +=
              `\n${theme.warn('No mdk.yaml found')} in ${theme.value(opts.dir)}. Add this under ${theme.key('spec.gateway.plugins')}:\n\n` +
              manualSnippet;
            break;
          case 'error':
            out +=
              `\n${theme.warn('Could not update mdk.yaml automatically')}. Add this under ${theme.key('spec.gateway.plugins')}:\n\n` +
              manualSnippet;
            break;
          default:
            // --no-stack-entry
            out +=
              `\n${theme.muted('Add this to')} ${theme.value('mdk.yaml')} under ${theme.key('spec.gateway.plugins')}:\n\n` +
              manualSnippet;
        }

        out +=
          `\n${theme.label('Next steps')}\n` +
          `  ${theme.muted('1.')} Add routes in ${theme.value('mdk-plugin.json')} + ${theme.value('controllers/')}.\n` +
          `  ${theme.muted('2.')} Run it: ${theme.cmd('mdk run gateway')} ${theme.muted('(or `mdk run` to boot everything together)')}\n`;

        process.stdout.write(out);
      },
    );

  create
    .command('dashboard [name]')
    .description(
      `Scaffold the MDK UI shell into <dir>/${DIRS.dashboard}, named <stack>-dashboard from mdk.yaml. ` +
        'With a name it lands in <dir>/apps/<name> instead',
    )
    .option('--dir <path>', 'Project directory the app is created under', '.')
    .option('--ref <git-ref>', 'Branch or tag to fetch the UI shell from', 'main')
    .option('--force', 'Overwrite the target directory if it already exists', false)
    .option('--no-install', 'Skip running `npm install` in the scaffolded dashboard')
    .action(
      async (
        name: string | undefined,
        opts: { dir: string; ref: string; force: boolean; install: boolean },
      ) => {
        const app = resolveDashboard(name, opts.dir);
        if (!app) {
          process.stderr.write(
            'mdk create dashboard: pass a name, or run from a directory with mdk.yaml (uses <stack>-dashboard).\n',
          );
          process.exitCode = 1;
          return;
        }
        const result = await createDashboard({
          name: app.name,
          subdir: app.subdir,
          parentDir: opts.dir,
          ref: opts.ref,
          force: opts.force,
          install: opts.install,
        });
        if (result.ok) {
          if (result.installWarning) {
            process.stderr.write(
              `${theme.warn('warning')}: ${result.installWarning} ` +
                `${theme.muted(`(run \`npm install\` in ${result.appPath})`)}\n`,
            );
          }
          const from =
            result.source === 'monorepo' ? 'local monorepo template' : 'GitHub template';
          const out =
            `Scaffolded ${result.appPath} ${theme.muted(`(${from})`)}\n` +
            `\n${theme.label('Next steps')}\n` +
            `  ${theme.muted('1.')} Edit ${theme.value(`${result.appPath}/.env`)} if you need a different Gateway/OAuth URL.\n` +
            `  ${theme.muted('2.')} Run it: ${theme.cmd(`mdk run dashboard --dir ${opts.dir}`)}\n`;
          process.stdout.write(out);
          return;
        }
        process.stderr.write(`mdk create dashboard: ${result.message}\n`);
        if (result.detail) process.stderr.write(`${result.detail}\n`);
        process.exitCode = 1;
      },
    );
}
