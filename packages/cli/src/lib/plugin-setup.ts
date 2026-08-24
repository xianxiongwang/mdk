import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMap, isSeq, parseDocument } from 'yaml';
import { confirm, isCancel, password, text } from '@clack/prompts';

/**
 * One interactive setup question a gateway plugin declares in its
 * `mdk-plugin.json` under `setup`. `key` is a dot-path under the plugin's own
 * `config` block in `spec.gateway.plugins[]` — delivered to that plugin alone
 * at runtime, merged over the gateway conf in its ambient context.
 */
export interface SetupQuestion {
  key: string;
  prompt: string;
  type: 'string' | 'secret' | 'boolean' | 'json';
  required?: boolean;
  default?: string | boolean;
}

const SETUP_TYPES = new Set(['string', 'secret', 'boolean', 'json']);

class PluginSetupError extends Error {}

function fail(message: string): never {
  throw new PluginSetupError(message);
}

/**
 * Reads and validates the `setup` questions of a plugin package directory.
 * Returns `[]` when the package has no manifest or declares no questions;
 * throws a `PluginSetupError` naming the offender when the block is malformed,
 * so a broken manifest surfaces as a skippable warning rather than bad prompts.
 */
export function readSetupQuestions(pkgDir: string): SetupQuestion[] {
  const manifestPath = join(pkgDir, 'mdk-plugin.json');
  if (!existsSync(manifestPath)) return [];

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    fail(`${manifestPath} is not valid JSON.`);
  }

  const setup = manifest.setup;
  if (setup == null) return [];
  if (!Array.isArray(setup)) fail(`${manifestPath}: \`setup\` must be an array.`);

  return setup.map((raw, i) => {
    const q = raw as Record<string, unknown>;
    if (typeof q?.key !== 'string' || !q.key) fail(`${manifestPath}: setup[${i}].key must be a non-empty string.`);
    if (typeof q.prompt !== 'string' || !q.prompt) fail(`${manifestPath}: setup[${i}].prompt must be a non-empty string.`);
    const type = q.type ?? 'string';
    if (typeof type !== 'string' || !SETUP_TYPES.has(type)) {
      fail(`${manifestPath}: setup[${i}].type must be one of string, secret, boolean, json.`);
    }
    return {
      key: q.key,
      prompt: q.prompt,
      type: type as SetupQuestion['type'],
      required: q.required === true,
      default: typeof q.default === 'string' || typeof q.default === 'boolean' ? q.default : undefined,
    };
  });
}

/**
 * Asks the declared questions via clack — `string` → text, `secret` → masked
 * password, `boolean` → confirm, `json` → text validated as JSON and stored
 * parsed (so structured config like role → permission maps stays structured
 * in the spec) — and returns answers keyed by dot-path. Empty optional
 * answers are omitted so the spec stays free of `""` noise and plugin
 * defaults keep applying.
 */
export async function promptSetup(
  questions: SetupQuestion[],
  onCancel: () => never,
): Promise<Record<string, unknown>> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    let value: unknown;
    if (q.type === 'boolean') {
      value = await confirm({ message: q.prompt, initialValue: q.default === true });
    } else if (q.type === 'json') {
      value = await text({
        message: q.prompt,
        validate: (v) => {
          const s = v?.trim();
          if (!s) return q.required ? 'Required.' : undefined;
          try {
            JSON.parse(s);
            return undefined;
          } catch {
            return 'Enter valid JSON.';
          }
        },
        ...(typeof q.default === 'string'
          ? { placeholder: q.default, defaultValue: q.default, initialValue: q.default }
          : q.required
            ? {}
            : { placeholder: 'Enter to keep the plugin defaults' }),
      });
    } else {
      const validate = (v: string | undefined): string | undefined =>
        q.required && !v?.trim() ? 'Required.' : undefined;
      value =
        q.type === 'secret'
          ? await password({ message: q.prompt, validate })
          : await text({
              message: q.prompt,
              validate,
              ...(typeof q.default === 'string'
                ? { placeholder: q.default, defaultValue: q.default, initialValue: q.default }
                : {}),
            });
    }
    if (isCancel(value)) onCancel();
    if (q.type === 'boolean') {
      answers[q.key] = value === true;
    } else if (q.type === 'json') {
      const s = typeof value === 'string' ? value.trim() : '';
      if (s) answers[q.key] = JSON.parse(s);
    } else if (typeof value === 'string' && value.trim()) {
      answers[q.key] = value.trim();
    }
  }
  return answers;
}

/** Sets each dot-path answer into `config`, creating nested mappings on the way. */
export function applySetupAnswers(
  config: Record<string, unknown>,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(answers)) {
    const parts = key.split('.');
    let node = config;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null || Array.isArray(node[part])) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts.at(-1) as string] = value;
  }
  return config;
}

/**
 * Writes setup answers into `<projectDir>/mdk.yaml` under the plugin's own
 * entry in `spec.gateway.plugins[].config`, preserving the file's
 * formatting/comments (edits the parsed document, same as the scaffold's
 * stack-file update). Used for plugins whose manifest only becomes readable
 * after `npm install` — the spec file is already on disk by then.
 */
export function applySetupAnswersToStackFile(
  projectDir: string,
  pluginPkg: string,
  answers: Record<string, unknown>,
): boolean {
  const specPath = resolve(projectDir, 'mdk.yaml');
  if (!existsSync(specPath)) return false;

  try {
    const doc = parseDocument(readFileSync(specPath, 'utf8'));
    const plugins = doc.getIn(['spec', 'gateway', 'plugins']);
    if (!isSeq(plugins)) return false;
    const idx = plugins.items.findIndex((item) => isMap(item) && item.get('package') === pluginPkg);
    if (idx === -1) return false;

    for (const [key, value] of Object.entries(answers)) {
      // createNode so structured answers (json questions) serialize as real
      // YAML mappings/sequences rather than JS object noise.
      doc.setIn(
        ['spec', 'gateway', 'plugins', idx, 'config', ...key.split('.')],
        doc.createNode(value),
      );
    }
    writeFileSync(specPath, doc.toString(), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export { PluginSetupError };
