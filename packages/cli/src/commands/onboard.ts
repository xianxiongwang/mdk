import type { Command } from 'commander';
import {
  intro,
  outro,
  text,
  select,
  multiselect,
  confirm,
  spinner,
  note,
  log,
  isCancel,
  cancel,
} from '@clack/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { detectEnvironment } from '../lib/detect.js';
import { buildStackSpec, isLocalPackagePath } from '../lib/spec.js';
import {
  findCatalogGatewayPlugin,
  findCatalogWorker,
  resolveCatalogPackage,
  GATEWAY_CATALOG,
  WORKER_CATALOG,
  type CatalogPlugin,
} from '../lib/catalog.js';
import { installSkill as installSkillSuite, type SkillClient } from '../lib/skill.js';
import { installDeps, installPackages } from '../lib/npm.js';
import {
  applySetupAnswers,
  applySetupAnswersToStackFile,
  promptSetup,
  readSetupQuestions,
} from '../lib/plugin-setup.js';
import { resolveProjectPackageDir } from '../lib/runtime.js';
import { createDashboard, dashboardNameFromStack } from '../lib/dashboard.js';
import {
  addFileDependency,
  ensureProjectGitignore,
  ensureProjectManifest,
  ensureProjectReadme,
  WORKSPACES,
} from '../lib/project.js';
import { theme, badge, banner, kvBlock, cmdBlock, tick } from '../lib/theme.js';
import { pkg } from '../lib/pkg.js';

const AGENT_CLIENTS = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'all', label: 'Both (Cursor + Claude)' },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bail(): never {
  cancel('Onboarding cancelled — no files were changed.');
  process.exit(0);
}

/** Lightweight section divider so related prompts read as a group. */
function section(title: string): void {
  log.step(theme.brand(title));
}

function shortLabel(pkgName: string): string {
  return pkgName.split('/').pop() ?? pkgName;
}

// Group A — Onboarding & project lifecycle
export function registerOnboard(program: Command): void {
  program
    .command('onboard')
    .description('Guided setup wizard: detect, configure, write mdk.yaml, print run commands')
    .action(runOnboard);
}

async function runOnboard(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write('mdk onboard needs an interactive terminal (TTY).\n');
    process.exit(1);
  }

  console.log(banner());
  intro(`${badge('MDK')}  ${theme.brand('developer onboarding')}  ${theme.muted(`v${pkg.version}`)}`);
  log.message(
    theme.muted('A few quick questions — each has a sensible default. Press Enter to accept.'),
  );

  // 1. Detect environment ---------------------------------------------------
  const s = spinner();
  s.start('Detecting environment');
  await delay(500);
  const env = detectEnvironment();
  s.stop(`${tick} Environment detected`);

  note(
    kvBlock([
      [
        'Node',
        env.nodeOk ? theme.ok(env.nodeVersion) : theme.warn(`${env.nodeVersion} (need >= 20)`),
      ],
      ['Package manager', theme.value(env.packageManager)],
      ['Git repo', env.git ? theme.ok('yes') : theme.muted('no')],
      ['Existing spec', env.existingSpec ? theme.warn('mdk.yaml present') : theme.muted('none')],
      ['Agent client', env.agentClient === 'none' ? theme.muted('none') : theme.ok(env.agentClient)],
    ]),
    theme.accent('environment'),
  );

  // 2. Project --------------------------------------------------------------
  section('Project');

  const projectDir = await text({
    message: 'Project directory',
    placeholder: '.',
    defaultValue: '.',
    initialValue: '.',
  });
  if (isCancel(projectDir)) bail();

  const stackName = await text({
    message: 'Stack name',
    placeholder: 'my-stack',
    defaultValue: 'my-stack',
    initialValue: 'my-stack',
  });
  if (isCancel(stackName)) bail();

  // 3. Runtime — fixed defaults, not prompted --------------------------------
  // Ports land in `mdk.yaml`, but are not a real upfront decision: whether you
  // run everything together (`mdk run`) or split it across terminals
  // (`mdk run kernel` / `gateway` / `worker <name>`) is just which command(s)
  // you type later, not a spec setting. Custom ports are a one-line edit to
  // `mdk.yaml` if the defaults ever collide with something.
  const gatewayPort = 3847;
  const kernelPort = 3848;
  const workerBasePort = 3850;

  // 4. Plugins --------------------------------------------------------------
  section('Plugins');

  const workerPackages = await multiselect({
    message: 'Worker plugins to install',
    options: WORKER_CATALOG.map(({ value, label, hint }) => ({ value, label, hint })),
    required: false,
  });
  if (isCancel(workerPackages)) bail();

  // A bundled worker is only runnable from an MDK checkout — its device mock
  // loads a framework that sits beside it in the source tree. Say so now rather
  // than letting `mdk run` fail on a package that was never installable.
  for (const pkg of workerPackages as string[]) {
    const entry = findCatalogWorker(pkg);
    if (entry && resolveCatalogPackage(entry).unavailable) {
      log.warn(
        `${shortLabel(pkg)} ships with the MDK source tree, which is not present here — ` +
          'so it cannot be linked, and installing it from the registry will fail.',
      );
    }
  }

  const gatewayPackages = await multiselect({
    message: 'Gateway plugins to install',
    options: GATEWAY_CATALOG.map(({ value, label, hint }) => ({ value, label, hint })),
    required: false,
  });
  if (isCancel(gatewayPackages)) bail();

  for (const pkg of gatewayPackages as string[]) {
    const entry = findCatalogGatewayPlugin(pkg);
    if (entry && resolveCatalogPackage(entry).unavailable) {
      log.warn(
        `${shortLabel(pkg)} ships with the MDK source tree, which is not present here — ` +
          'so it cannot be linked, and installing it from the registry will fail.',
      );
    }
  }

  // Bundled plugins' manifests are readable from the checkout before any
  // install, so their setup questions are asked now and the answers (defaults
  // included) are part of mdk.yaml from the first write — each plugin's
  // answers under its own `spec.gateway.plugins[].config` block, the spec the
  // source of truth and the plugin's built-in defaults only a fallback.
  const pluginConfigs: Record<string, Record<string, unknown>> = {};
  const askedUpfront = new Set<string>();
  for (const pkg of gatewayPackages as string[]) {
    const entry = findCatalogGatewayPlugin(pkg);
    const resolved = entry ? resolveCatalogPackage(entry) : undefined;
    if (!resolved?.bundled || !resolved.checkoutDir) continue;
    let questions;
    try {
      questions = readSetupQuestions(resolved.checkoutDir);
    } catch {
      continue; // malformed manifest — surfaces at load time, not here
    }
    if (!questions.length) continue;
    section(`${shortLabel(pkg)} setup`);
    pluginConfigs[pkg] = applySetupAnswers({}, await promptSetup(questions, bail));
    askedUpfront.add(pkg);
  }

  // 5. Developer experience -------------------------------------------------
  section('Developer experience');

  const addUi = await confirm({
    message: 'Add the UI dashboard (MDK UI shell)?',
    initialValue: true,
  });
  if (isCancel(addUi)) bail();

  const installSkill = await confirm({
    message: 'Install the MDK Developer Skill (makes your coding agent MDK-aware)?',
    initialValue: true,
  });
  if (isCancel(installSkill)) bail();

  let client: string =
    env.agentClient === 'cursor' || env.agentClient === 'claude' ? env.agentClient : 'all';
  if (installSkill) {
    const picked = await select({
      message: 'Coding-agent client',
      options: AGENT_CLIENTS,
      initialValue: client,
    });
    if (isCancel(picked)) bail();
    client = picked as string;
  }

  // 6. Build spec + review --------------------------------------------------
  const spec = buildStackSpec({
    stackName: stackName as string,
    gatewayPort,
    kernelPort,
    workerBasePort,
    workerPackages: workerPackages as string[],
    gatewayPackages: gatewayPackages as string[],
    pluginConfigs,
  });
  const workers = spec.spec.workers;

  const targetDir = resolve(projectDir as string);
  const specPath = resolve(targetDir, 'mdk.yaml');
  const specExists = existsSync(specPath);

  // Summarise by what the user picked, not by the resolved `package` — a bundled
  // worker resolves to a checkout path, which is noise in a review panel.
  const workerSummary = (workerPackages as string[]).length
    ? (workerPackages as string[])
        .map((pkg) => {
          const entry = findCatalogWorker(pkg);
          const bundled = entry ? resolveCatalogPackage(entry).bundled : false;
          return bundled ? `${shortLabel(pkg)} ${theme.muted('(bundled, with mock)')}` : shortLabel(pkg);
        })
        .join(', ')
    : theme.muted('none');
  const gatewaySummary = (gatewayPackages as string[]).length
    ? (gatewayPackages as string[])
        .map((pkg) => {
          const entry = findCatalogGatewayPlugin(pkg);
          const bundled = entry ? resolveCatalogPackage(entry).bundled : false;
          return bundled ? `${shortLabel(pkg)} ${theme.muted('(bundled)')}` : shortLabel(pkg);
        })
        .join(', ')
    : theme.muted('none');

  note(
    kvBlock([
      ['Stack', theme.value(stackName as string)],
      ['Ports', theme.value(`gateway ${gatewayPort} · kernel ${kernelPort} · workers ${workerBasePort}+`)],
      ['Workers', workerSummary],
      ['Gateway plugins', gatewaySummary],
      ['UI dashboard', addUi ? theme.ok('yes') : theme.muted('no')],
      ['Developer Skill', installSkill ? theme.ok(`yes (${client})`) : theme.muted('no')],
      ['Spec file', specExists ? theme.warn(`${specPath} (overwrite)`) : theme.value(specPath)],
    ]),
    theme.accent('review'),
  );

  const proceed = await confirm({
    message: specExists
      ? 'Overwrite mdk.yaml with these settings?'
      : 'Write mdk.yaml with these settings?',
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) bail();

  // 7. Write the project files ----------------------------------------------
  const w = spinner();
  w.start('Writing project files');
  await delay(400);
  try {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(specPath, toYaml(spec), 'utf8');
    const manifest = ensureProjectManifest(targetDir, stackName as string);
    const gitignore = ensureProjectGitignore(targetDir);
    w.stop(`${tick} Wrote ${theme.value(specPath)}`);
    if (manifest !== 'present') {
      log.message(
        theme.muted(
          `${manifest === 'created' ? 'Created' : 'Updated'} package.json — ` +
            `${WORKSPACES.join(' and ')} are npm workspaces`,
        ),
      );
    }
    if (gitignore !== 'present') {
      log.message(
        theme.muted(
          `${gitignore === 'created' ? 'Created' : 'Updated'} .gitignore — ignores .mdk/ runtime state`,
        ),
      );
    }
  } catch (error) {
    w.stop(theme.warn('Could not write the project files'));
    log.error(error instanceof Error ? error.message : String(error));
    bail();
  }

  // 8. Side-effects ---------------------------------------------------------
  // Install the selected plugins so the runtime can resolve them from the
  // project's node_modules. A bundled worker is declared as a `file:`-linked
  // dependency pointing at its checkout path — `npm install` symlinks it
  // straight into `node_modules` under its package name, same as a published
  // package would be; no `workers/<name>` folder is created for it (that
  // directory is only for packages the user owns via `mdk create worker`).
  // Registry packages install normally. Local-path packages (scaffolded
  // workers) are skipped — they are linked by the workspace globs instead.
  // Best-effort: a failed install is a warning, never a hard stop (the spec is
  // already valid).
  const registryPackages: string[] = [];
  let linkedBundled = false;

  const selections: Array<[string, CatalogPlugin | undefined]> = [
    ...spec.spec.workers.map((wk): [string, CatalogPlugin | undefined] => [
      wk.package,
      findCatalogWorker(wk.package),
    ]),
    ...spec.spec.gateway.plugins.map((p): [string, CatalogPlugin | undefined] => [
      p.package,
      findCatalogGatewayPlugin(p.package),
    ]),
  ];

  for (const [pkgName, entry] of selections) {
    if (entry) {
      const resolved = resolveCatalogPackage(entry);
      if (resolved.bundled && resolved.checkoutDir) {
        try {
          addFileDependency(targetDir, pkgName, resolved.checkoutDir);
          linkedBundled = true;
        } catch (error) {
          log.warn(
            `Could not link ${shortLabel(pkgName)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        continue;
      }
    }
    if (!isLocalPackagePath(pkgName)) registryPackages.push(pkgName);
  }
  const npmPlugins = [...new Set(registryPackages)];
  const needsInstall = linkedBundled || npmPlugins.length > 0;

  if (needsInstall) {
    const count = (linkedBundled ? 1 : 0) + npmPlugins.length;
    log.step(theme.brand(`Installing ${count} plugin package${count === 1 ? '' : 's'}`));
    const result = npmPlugins.length
      ? installPackages(targetDir, npmPlugins)
      : installDeps(targetDir);
    if (result.ok) {
      log.success(`${tick} Plugins installed`);
    } else {
      log.warn(`Plugin install skipped: ${result.message}`);
      log.message(
        theme.muted(
          npmPlugins.length
            ? `Install manually: npm install ${npmPlugins.join(' ')}`
            : 'Install manually: npm install',
        ),
      );
    }
  }

  // Registry-installed gateway plugins may declare their own setup questions —
  // only readable now that their packages are in node_modules. Answers are
  // patched into the already-written mdk.yaml under the plugin's own entry in
  // `spec.gateway.plugins[].config`. Bundled plugins were asked before the
  // spec was written.
  for (const pluginPkg of spec.spec.gateway.plugins.map((p) => p.package)) {
    if (askedUpfront.has(pluginPkg)) continue;
    let questions;
    try {
      questions = readSetupQuestions(resolveProjectPackageDir(targetDir, pluginPkg));
    } catch {
      continue; // not installed or malformed manifest — nothing to ask
    }
    if (!questions.length) continue;
    section(`${shortLabel(pluginPkg)} setup`);
    const answers = await promptSetup(questions, bail);
    if (Object.keys(answers).length && !applySetupAnswersToStackFile(targetDir, pluginPkg, answers)) {
      log.warn(`Could not write ${shortLabel(pluginPkg)} setup answers to mdk.yaml — add them manually under its config in spec.gateway.plugins.`);
    }
  }

  if (installSkill) {
    const sk = spinner();
    sk.start(`Installing MDK Developer Skill (${client})`);
    const result = installSkillSuite(client as SkillClient, targetDir);
    if (result.ok) {
      sk.stop(`${tick} Developer Skill installed`);
      if (result.message) log.message(theme.muted(result.message));
    } else {
      sk.stop(theme.warn(`Skill install skipped: ${result.message}`));
      if (result.detail) log.message(theme.muted(result.detail));
    }
  } else {
    log.message(theme.muted('Skipped skill install. Later: mdk skill add'));
  }

  let dashboardPath: string | undefined;
  if (addUi) {
    const ui = spinner();
    ui.start('Downloading UI dashboard (MDK UI shell)');
    const result = await createDashboard({
      name: dashboardNameFromStack(stackName as string),
      parentDir: targetDir,
    });
    if (result.ok) {
      dashboardPath = result.appPath;
      ui.stop(`${tick} UI dashboard scaffolded${dashboardPath ? ` at ${theme.value(dashboardPath)}` : ''}`);
    } else {
      ui.stop(theme.warn(`UI dashboard skipped: ${result.message}`));
      if (result.detail) log.message(theme.muted(result.detail));
    }
  }

  // The README documents the layout, so it is written last — once it is known
  // whether this project has a dashboard.
  const readme = ensureProjectReadme(targetDir, {
    stackName: stackName as string,
    workerNames: workers.map((wk) => wk.name),
    dashboardDir: dashboardPath ? relative(targetDir, dashboardPath) : undefined,
  });
  if (readme === 'created') {
    log.message(theme.muted('Created README.md — project layout and commands'));
  }

  // 9. Next steps -----------------------------------------------------------
  const runRows: Array<[string, string?]> = [
    ['mdk run', 'boots Kernel + Gateway + workers together'],
  ];
  const perComponentHint = workers.length
    ? workers.map((wk) => `mdk run worker ${wk.name}`).join(' · ')
    : 'mdk run worker <name>';

  // A worker is bootable only once its devices are declared. Bundled workers were
  // seeded with one already, so the spec is runnable as written — tell the user
  // which of the two situations they are in.
  const seeded = workers.filter((wk) => Array.isArray((wk.config as { devices?: unknown }).devices));
  const specHint =
    seeded.length === workers.length && workers.length > 0
      ? `${seeded.length === 1 ? 'a seed device is' : 'seed devices are'} already declared — runnable as-is`
      : 'add devices & plugin config, then save';

  const parts = [
    theme.label('1. Review your spec'),
    cmdBlock([['mdk.yaml', specHint]]),
    '',
    theme.label('2. Start the stack'),
    cmdBlock(runRows),
    theme.muted(`Or separately: mdk run kernel · mdk run gateway · ${perComponentHint}`),
    '',
    theme.label('3. Manage it'),
    cmdBlock([
      ['mdk status', 'check the stack'],
      ['mdk create worker', 'scaffold a new worker plugin'],
    ]),
  ];
  if (dashboardPath) {
    const rel = relative(process.cwd(), dashboardPath) || dashboardPath;
    parts.push(
      '',
      theme.label('4. Start the dashboard'),
      cmdBlock([[`cd ${rel}`], ['npm run dev', 'dependencies are already installed']]),
    );
  }

  note(parts.join('\n'), theme.accent('next steps'));

  outro(`${tick} ${theme.brand('MDK is ready.')} ${theme.muted('Happy building.')}`);
}
