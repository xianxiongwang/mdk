import type { Command } from 'commander';
import { stringify as toYaml } from 'yaml';
import { stub } from '../lib/stub.js';
import { collectStatus, type StatusReport, type WorkerReport } from '../lib/status.js';
import { STACK_FILE } from '../lib/spec.js';
import { theme, tick } from '../lib/theme.js';

// Group C — Run & manage (read-only inspection commands)
export function registerGet(program: Command): void {
  program
    .command('get <resource>')
    .description('List live resources: workers | devices | plugins (stub)')
    .action((resource: string) => stub(`get ${resource}`));
}

export function registerDescribe(program: Command): void {
  program
    .command('describe <resource> <name>')
    .description('Detailed view of a single resource (stub)')
    .action((resource: string, name: string) => stub(`describe ${resource} ${name}`));
}

export function registerLogs(program: Command): void {
  program
    .command('logs <target>')
    .description('Stream logs for a service or worker (stub)')
    .option('-f, --follow', 'Follow log output', false)
    .option('--since <time>', 'Show logs since a timestamp or duration')
    .option('--tail <n>', 'Number of lines to show from the end')
    .action((target: string) => stub(`logs ${target}`));
}

const OUTPUT_FORMATS = ['table', 'json', 'yaml'];

/** Green when healthy, yellow otherwise — the same convention across sections. */
function flag(ok: boolean, label: string): string {
  return ok ? theme.ok(label) : theme.warn(label);
}

/**
 * Renders a probe failure for humans. Bare error codes (`ERR_MDK_STATUS_TIMEOUT`,
 * `CHANNEL_CLOSED: channel closed`) mean nothing on their own, so they get a
 * plain-English lead-in; anything already written as prose is shown as-is. The
 * untouched value stays in `-o json` for scripts.
 */
function humanError(error: string | null): string | null {
  if (!error) return null;
  const first = error.split('\n')[0] ?? '';
  const code = (first.split(':')[0] ?? '').trim();
  return /^[A-Z][A-Z0-9_]*$/.test(code) ? `unreachable (${code})` : first;
}

/**
 * Left-aligned columns padded to the widest cell, with an optional header row.
 * Padding counts raw string length, so only the last column may carry color.
 */
function columns(headers: string[] | null, rows: string[][]): string {
  const count = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: count }, (_, i) =>
    Math.max(headers?.[i]?.length ?? 0, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => (i === count - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();

  const body = rows.map((r) => `  ${line(r)}`);
  return headers ? [`  ${theme.muted(line(headers))}`, ...body].join('\n') : body.join('\n');
}

function workerRows(items: WorkerReport[]): string[][] {
  return items.map((w) => [
    w.name,
    w.registered ? 'yes' : 'no',
    w.state ?? '-',
    w.health ?? '-',
    String(w.devices),
    w.declared ? '' : 'not in spec',
  ]);
}

/** Human-readable report: environment first, then the running stack. */
function renderTable(report: StatusReport): string {
  const { environment: env, stack } = report;
  const out: string[] = [];

  const title = [
    theme.brand('MDK status'),
    env.spec.stack ? theme.value(env.spec.stack) : theme.muted('(no stack)'),
  ]
    .filter(Boolean)
    .join('  ');
  // The project path goes on its own line so it cannot stretch the table below.
  out.push('', title, theme.muted(report.project), '');

  out.push(theme.label('Environment'));
  out.push(
    columns(null, [
      [
        'Node',
        `v${env.node.version}`,
        flag(env.node.ok, env.node.ok ? 'ok' : `need ${env.node.required}`),
      ],
      ['Package manager', env.packageManager, ''],
      [
        'Spec',
        STACK_FILE,
        env.spec.valid ? theme.ok('ok') : theme.warn(env.spec.found ? 'invalid' : 'missing'),
      ],
      [
        'Dependencies',
        `${env.dependencies.checked} declared`,
        flag(
          env.dependencies.ok,
          env.dependencies.ok ? 'ok' : `${env.dependencies.missing.length} not installed`,
        ),
      ],
    ]),
  );
  if (env.spec.error) {
    for (const line of env.spec.error.split('\n')) out.push(theme.muted(`    ${line}`));
  }
  for (const pkg of env.dependencies.missing) {
    out.push(theme.muted(`    not installed: ${pkg}`));
  }

  // Only the trailing cell is colored, so the columns stay aligned.
  const detail = (component: { state: string; error: string | null }, upDetail: string): string => {
    const note =
      component.state === 'up' ? upDetail : humanError(component.error) ?? 'not running';
    return `${flag(component.state === 'up', component.state.padEnd(4))}  ${theme.muted(note)}`;
  };

  out.push('', theme.label('Stack'));
  out.push(
    columns(null, [
      ['Kernel', detail(stack.kernel, stack.kernel.key?.slice(0, 16) ?? '')],
      ['Gateway', detail(stack.gateway, stack.gateway.url ?? '')],
      [
        'Workers',
        `${stack.workers.registered}/${stack.workers.declared} registered  ` +
          theme.muted(
            `${stack.workers.totalDevices} device${stack.workers.totalDevices === 1 ? '' : 's'}`,
          ),
      ],
    ]),
  );

  if (stack.workers.items.length) {
    out.push(
      '',
      columns(
        ['WORKER', 'REGISTERED', 'STATE', 'HEALTH', 'DEVICES', ''],
        workerRows(stack.workers.items),
      ),
    );
  }

  const health =
    report.health === 'healthy'
      ? theme.ok('healthy')
      : report.health === 'degraded'
        ? theme.warn('degraded')
        : theme.warn('down');
  out.push('', `${report.ok ? tick : theme.warn('!')} Health: ${health}`, '');

  return out.join('\n');
}

/**
 * Exit codes are part of the CLI contract (see the HLD §3.3):
 *   4 — precondition not met (old Node, missing/invalid spec, packages not installed)
 *   5 — stack not fully up (Kernel/Gateway unreachable, or a declared worker is
 *       not registered/serving)
 */
function exitCodeFor(report: StatusReport): number {
  const env = report.environment;
  if (!env.node.ok || !env.spec.valid || !env.dependencies.ok) return 4;
  return report.health === 'healthy' ? 0 : 5;
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description(
      'One-shot, read-only check of the environment and every component ' +
        '(Kernel, Gateway, workers + device counts). Never repairs',
    )
    .option('-d, --dir <path>', 'Project directory containing mdk.yaml', '.')
    .action(async (options: { dir: string }, cmd: Command) => {
      const output = String(cmd.optsWithGlobals().output ?? 'table');
      if (!OUTPUT_FORMATS.includes(output)) {
        process.stderr.write(
          `${theme.warn('error')}: unknown --output "${output}". Use one of: ${OUTPUT_FORMATS.join(' | ')}.\n`,
        );
        process.exit(2);
      }

      let report: StatusReport;
      try {
        report = await collectStatus(options.dir);
      } catch (error) {
        process.stderr.write(
          `${theme.warn('error')}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      }

      if (output === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else if (output === 'yaml') process.stdout.write(toYaml(report));
      else process.stdout.write(`${renderTable(report)}\n`);

      process.exitCode = exitCodeFor(report);
    });
}
