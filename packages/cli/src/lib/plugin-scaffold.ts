import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isMap, isSeq, parseDocument, YAMLSeq, type YAMLMap } from 'yaml';
import { installScaffold } from './npm.js';
import { DIRS, ensureProjectManifest, readStackName } from './project.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Placeholder baked into `templates/plugin/**`, replaced at scaffold time. */
const NAME_TOKEN = '__PLUGIN_NAME__';

/**
 * Absolute path to the bundled gateway-plugin template (`templates/plugin`).
 * Resolves the same from `dist/lib` (built) and `src/lib` (tsx dev) since both
 * sit one level under the package root.
 */
function templateDir(): string {
  return resolve(__dirname, '..', '..', 'templates', 'plugin');
}

export interface PluginScaffoldOptions {
  /** Plugin name — used for the folder, route ids/paths, and the package name. */
  name: string;
  /** Project directory; the plugin is created under `<parentDir>/plugins/<name>`. */
  parentDir: string;
  /** npm scope/org for the generated package name (e.g. `demo` -> `@demo/<name>`). */
  org?: string;
  /** Overwrite the target if it already exists (default: false). */
  force?: boolean;
  /** Run `npm install` after scaffolding (default: true). */
  install?: boolean;
  /** Add the plugin to `<parentDir>/mdk.yaml` under `spec.gateway.plugins` (default: true). */
  updateStackFile?: boolean;
}

/** Outcome of writing the plugin into `mdk.yaml`. */
export type StackFileUpdate = 'added' | 'exists' | 'no-file' | 'error';

export interface PluginScaffoldResult {
  ok: boolean;
  message?: string;
  detail?: string;
  /** Absolute path of the scaffolded plugin. */
  pluginPath?: string;
  /** Resolved package.json `name` — the value referenced in mdk.yaml. */
  packageName?: string;
  /** Warning surfaced when `npm install` could not complete (scaffold still ok). */
  installWarning?: string;
  /** Directory `npm install` ran in (the workspace root for a linked plugin). */
  installDir?: string;
  /** How the `mdk.yaml` update went (so the caller can guide the user). */
  stackFile?: StackFileUpdate;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Appends the new plugin to `spec.gateway.plugins` in `<parentDir>/mdk.yaml`,
 * preserving the file's existing formatting/comments (edits the parsed document
 * rather than re-serializing). Unlike workers, gateway plugins are referenced by
 * **package name** (resolved from node_modules via the `plugins/*` workspace),
 * not a local path. No-ops (`'exists'`) when the package is already listed.
 */
function addPluginToStackFile(parentDir: string, packageName: string): StackFileUpdate {
  const specPath = resolve(parentDir, 'mdk.yaml');
  if (!existsSync(specPath)) return 'no-file';

  try {
    const doc = parseDocument(readFileSync(specPath, 'utf8'));

    if (!isMap(doc.getIn(['spec', 'gateway']))) {
      doc.setIn(['spec', 'gateway'], doc.createNode({ plugins: [] }));
    }
    if (!isSeq(doc.getIn(['spec', 'gateway', 'plugins']))) {
      doc.setIn(['spec', 'gateway', 'plugins'], new YAMLSeq());
    }
    const plugins = doc.getIn(['spec', 'gateway', 'plugins']) as YAMLSeq;

    for (const item of plugins.items) {
      if (isMap(item) && (item as YAMLMap).get('package') === packageName) return 'exists';
    }

    plugins.add(doc.createNode({ package: packageName, config: {} }));
    writeFileSync(specPath, doc.toString(), 'utf8');
    return 'added';
  } catch {
    return 'error';
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Reads a JSON file, sets its `name`, and writes it back (2-space indented). */
function setJsonName(file: string, name: string): void {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  json.name = name;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}

/**
 * Scaffolds a new Gateway Plugin package from the bundled template into
 * `<parentDir>/plugins/<name>` — the workspace-linked layout `mdk run gateway`
 * resolves from node_modules. Substitutes the name token, sets the package.json
 * and manifest `name`, links the workspace, and registers the plugin in mdk.yaml.
 */
export function createPlugin(opts: PluginScaffoldOptions): PluginScaffoldResult {
  const name = opts.name.trim();
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      message: `Invalid plugin name "${opts.name}". Use lowercase letters, digits, '.', '_' or '-'.`,
    };
  }

  const src = templateDir();
  if (!existsSync(src)) {
    return { ok: false, message: `Plugin template not found at ${src}.` };
  }

  const pluginPath = resolve(opts.parentDir, DIRS.plugins, name);
  if (existsSync(pluginPath) && !opts.force) {
    return { ok: false, message: `${pluginPath} already exists (use --force to overwrite).` };
  }

  try {
    mkdirSync(resolve(opts.parentDir, DIRS.plugins), { recursive: true });
    cpSync(src, pluginPath, { recursive: true });

    for (const file of walk(pluginPath)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes(NAME_TOKEN)) {
        writeFileSync(file, content.replaceAll(NAME_TOKEN, name), 'utf8');
      }
    }

    // Scope the package name when an org is given; the manifest name mirrors it
    // so logs and the mdk.yaml entry agree.
    const packageName = opts.org ? `@${opts.org.replace(/^@/, '')}/${name}` : name;
    setJsonName(join(pluginPath, 'package.json'), packageName);
    setJsonName(join(pluginPath, 'mdk-plugin.json'), packageName);

    // `mdk run gateway` resolves plugins through the project's node_modules,
    // which the root manifest's workspace globs provide — link before installing.
    const stackName = readStackName(opts.parentDir);
    if (stackName) ensureProjectManifest(opts.parentDir, stackName);

    const install = installScaffold(opts.parentDir, pluginPath, opts.install !== false);

    const stackFile =
      opts.updateStackFile === false ? undefined : addPluginToStackFile(opts.parentDir, packageName);

    return {
      ok: true,
      pluginPath,
      packageName,
      installWarning: install.ok ? undefined : install.message,
      installDir: install.dir,
      stackFile,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Could not scaffold the plugin.',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
