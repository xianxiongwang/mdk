import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDirs, makeTmpDir } from '../helpers.js';

const CANCEL = Symbol('cancel');
const clack = vi.hoisted(() => ({
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@clack/prompts', () => ({
  ...clack,
  isCancel: (v: unknown) => v === CANCEL,
}));

const {
  PluginSetupError,
  applySetupAnswers,
  applySetupAnswersToStackFile,
  promptSetup,
  readSetupQuestions,
} = await import('../../src/lib/plugin-setup.js');

afterEach(() => {
  cleanupTmpDirs();
  vi.clearAllMocks();
});

function writeManifest(dir: string, manifest: unknown): void {
  writeFileSync(
    join(dir, 'mdk-plugin.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  );
}

describe('readSetupQuestions', () => {
  it('returns [] when there is no manifest or no setup block', () => {
    const dir = makeTmpDir();
    expect(readSetupQuestions(dir)).toEqual([]);
    writeManifest(dir, { name: 'p', routes: [] });
    expect(readSetupQuestions(dir)).toEqual([]);
  });

  it('normalizes questions: type defaults to string, required to false', () => {
    const dir = makeTmpDir();
    writeManifest(dir, {
      setup: [
        { key: 'google.clientId', prompt: 'Client ID', required: true },
        { key: 'google.clientSecret', prompt: 'Secret', type: 'secret' },
        { key: 'debug', prompt: 'Debug?', type: 'boolean', default: true },
        { key: 'url', prompt: 'URL', default: 'http://localhost', required: 'yes' },
        { key: 'auth.roles', prompt: 'Roles map', type: 'json' },
      ],
    });
    expect(readSetupQuestions(dir)).toEqual([
      { key: 'google.clientId', prompt: 'Client ID', type: 'string', required: true, default: undefined },
      { key: 'google.clientSecret', prompt: 'Secret', type: 'secret', required: false, default: undefined },
      { key: 'debug', prompt: 'Debug?', type: 'boolean', required: false, default: true },
      { key: 'url', prompt: 'URL', type: 'string', required: false, default: 'http://localhost' },
      { key: 'auth.roles', prompt: 'Roles map', type: 'json', required: false, default: undefined },
    ]);
  });

  it('throws a PluginSetupError naming the offender for malformed blocks', () => {
    const dir = makeTmpDir();
    writeManifest(dir, 'not json');
    expect(() => readSetupQuestions(dir)).toThrow(PluginSetupError);

    writeManifest(dir, { setup: 'nope' });
    expect(() => readSetupQuestions(dir)).toThrow(/`setup` must be an array/);

    writeManifest(dir, { setup: [{ prompt: 'x' }] });
    expect(() => readSetupQuestions(dir)).toThrow(/setup\[0\]\.key/);

    writeManifest(dir, { setup: [{ key: 'a' }] });
    expect(() => readSetupQuestions(dir)).toThrow(/setup\[0\]\.prompt/);

    writeManifest(dir, { setup: [{ key: 'a', prompt: 'x', type: 'password' }] });
    expect(() => readSetupQuestions(dir)).toThrow(/setup\[0\]\.type/);
  });
});

describe('promptSetup', () => {
  const bail = vi.fn(() => {
    throw new Error('BAILED');
  }) as unknown as () => never;

  it('maps string → text, secret → password, boolean → confirm', async () => {
    clack.text.mockResolvedValueOnce('client-id');
    clack.password.mockResolvedValueOnce('s3cret');
    clack.confirm.mockResolvedValueOnce(false);

    const answers = await promptSetup(
      [
        { key: 'google.clientId', prompt: 'Client ID', type: 'string', required: true, default: 'x' },
        { key: 'google.clientSecret', prompt: 'Secret', type: 'secret', required: true },
        { key: 'debug', prompt: 'Debug?', type: 'boolean', default: true },
      ],
      bail,
    );

    expect(answers).toEqual({
      'google.clientId': 'client-id',
      'google.clientSecret': 's3cret',
      debug: false,
    });
    expect(clack.text).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Client ID', defaultValue: 'x', validate: expect.any(Function) }),
    );
    expect(clack.confirm).toHaveBeenCalledWith({ message: 'Debug?', initialValue: true });

    const { validate } = clack.text.mock.calls[0][0] as { validate: (v?: string) => string | undefined };
    expect(validate('')).toBe('Required.');
    expect(validate('  ')).toBe('Required.');
    expect(validate('ok')).toBeUndefined();
  });

  it('json questions validate, parse, and skip when left empty', async () => {
    clack.text
      .mockResolvedValueOnce(' {"operator": ["agent:chat"]} ')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('{"admin": ["users:rw"]}');

    const answers = await promptSetup(
      [
        { key: 'auth.roles', prompt: 'Roles map', type: 'json' },
        { key: 'auth.roleManagement', prompt: 'Management map', type: 'json' },
        { key: 'auth.required', prompt: 'Required map', type: 'json', required: true, default: '{}' },
      ],
      bail,
    );

    expect(answers).toEqual({
      'auth.roles': { operator: ['agent:chat'] },
      'auth.required': { admin: ['users:rw'] },
    });
    expect(clack.text).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Roles map', placeholder: 'Enter to keep the plugin defaults' }),
    );

    const { validate } = clack.text.mock.calls[0][0] as { validate: (v?: string) => string | undefined };
    expect(validate('not json')).toBe('Enter valid JSON.');
    expect(validate('{"ok": 1}')).toBeUndefined();
    expect(validate('')).toBeUndefined();

    const { validate: requiredValidate } = clack.text.mock.calls[2][0] as {
      validate: (v?: string) => string | undefined;
    };
    expect(requiredValidate('')).toBe('Required.');
  });

  it('a json prompt resolving to a non-string is treated as empty', async () => {
    clack.text.mockResolvedValueOnce(42);
    const answers = await promptSetup([{ key: 'j', prompt: 'J', type: 'json' }], bail);
    expect(answers).toEqual({});
  });

  it('a required json question without a default gets no placeholder hint', async () => {
    clack.text.mockResolvedValueOnce('{}');
    await promptSetup([{ key: 'j', prompt: 'J', type: 'json', required: true }], bail);
    const call = clack.text.mock.calls[0][0] as { placeholder?: string };
    expect(call.placeholder).toBeUndefined();
  });

  it('bails when a json prompt is cancelled', async () => {
    clack.text.mockResolvedValueOnce(CANCEL);
    await expect(
      promptSetup([{ key: 'j', prompt: 'J', type: 'json' }], bail),
    ).rejects.toThrow('BAILED');
  });

  it('omits empty optional answers and trims the rest', async () => {
    clack.text.mockResolvedValueOnce('  spaced  ').mockResolvedValueOnce('');
    const answers = await promptSetup(
      [
        { key: 'a', prompt: 'A', type: 'string' },
        { key: 'b', prompt: 'B', type: 'string' },
      ],
      bail,
    );
    expect(answers).toEqual({ a: 'spaced' });
  });

  it('does not flag empty optional answers as invalid', async () => {
    clack.text.mockResolvedValueOnce('');
    await promptSetup([{ key: 'a', prompt: 'A', type: 'string' }], bail);
    const { validate } = clack.text.mock.calls[0][0] as { validate: (v?: string) => string | undefined };
    expect(validate('')).toBeUndefined();
  });

  it('invokes onCancel when a prompt is cancelled', async () => {
    clack.password.mockResolvedValueOnce(CANCEL);
    await expect(
      promptSetup([{ key: 's', prompt: 'S', type: 'secret' }], bail),
    ).rejects.toThrow('BAILED');
  });
});

describe('applySetupAnswers', () => {
  it('sets dot-path answers, creating nested mappings', () => {
    const config: Record<string, unknown> = {};
    applySetupAnswers(config, {
      'google.clientId': 'id',
      'google.clientSecret': 'secret',
      'auth.superAdmin': 'root@example.com',
      flat: true,
    });
    expect(config).toEqual({
      google: { clientId: 'id', clientSecret: 'secret' },
      auth: { superAdmin: 'root@example.com' },
      flat: true,
    });
  });

  it('replaces non-mapping intermediate nodes instead of crashing', () => {
    const config: Record<string, unknown> = { google: 'oops', auth: [1] };
    applySetupAnswers(config, { 'google.clientId': 'id', 'auth.superAdmin': 'a@b.co' });
    expect(config).toEqual({ google: { clientId: 'id' }, auth: { superAdmin: 'a@b.co' } });
  });
});

describe('applySetupAnswersToStackFile', () => {
  function writeStackFile(dir: string, lines: string[]): void {
    writeFileSync(join(dir, 'mdk.yaml'), lines.join('\n'), 'utf8');
  }

  const PLUGINS_SPEC = [
    'kind: Stack',
    'spec:',
    '  gateway:',
    '    port: 3847',
    '    plugins:',
    '      - package: "@x/auth"',
    '        config: {}',
    '      - package: "@x/alerts"',
    '        config: {}',
  ];

  it('returns false when mdk.yaml is absent', () => {
    expect(applySetupAnswersToStackFile(makeTmpDir(), '@x/auth', { a: 1 })).toBe(false);
  });

  it('returns false when the spec has no plugins list (scalar document)', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'mdk.yaml'), 'just a string\n', 'utf8');
    expect(applySetupAnswersToStackFile(dir, '@x/auth', { 'a.b': 1 })).toBe(false);
  });

  it('returns false when the plugin has no entry in spec.gateway.plugins', () => {
    const dir = makeTmpDir();
    writeStackFile(dir, PLUGINS_SPEC);
    expect(applySetupAnswersToStackFile(dir, '@x/unknown', { 'a.b': 1 })).toBe(false);
  });

  it('returns false when the plugin entry cannot be patched (scalar config)', () => {
    const dir = makeTmpDir();
    writeStackFile(dir, [
      'kind: Stack',
      'spec:',
      '  gateway:',
      '    plugins:',
      '      - package: "@x/auth"',
      '        config: notamap',
    ]);
    expect(applySetupAnswersToStackFile(dir, '@x/auth', { 'a.b': 1 })).toBe(false);
  });

  it('serializes structured (json question) answers into the plugin entry', () => {
    const dir = makeTmpDir();
    writeStackFile(dir, PLUGINS_SPEC);
    expect(
      applySetupAnswersToStackFile(dir, '@x/auth', {
        'auth.roles': { operator: ['agent:chat', 'actions:w'] },
      }),
    ).toBe(true);
    const spec = parse(readFileSync(join(dir, 'mdk.yaml'), 'utf8')) as {
      spec: { gateway: { plugins: Array<{ config: Record<string, unknown> }> } };
    };
    expect(spec.spec.gateway.plugins[0].config).toEqual({
      auth: { roles: { operator: ['agent:chat', 'actions:w'] } },
    });
    expect(spec.spec.gateway.plugins[1].config).toEqual({});
    expect(readFileSync(join(dir, 'mdk.yaml'), 'utf8')).not.toContain('[object');
  });

  it('patches the matching plugin entry in place, preserving comments', () => {
    const dir = makeTmpDir();
    writeStackFile(dir, ['# stack spec', ...PLUGINS_SPEC]);
    expect(
      applySetupAnswersToStackFile(dir, '@x/alerts', {
        'alerts.webhook': 'https://hook',
        'alerts.enabled': true,
      }),
    ).toBe(true);
    const yaml = readFileSync(join(dir, 'mdk.yaml'), 'utf8');
    expect(yaml).toContain('# stack spec');
    const spec = parse(yaml) as {
      spec: { gateway: { plugins: Array<{ config: Record<string, unknown> }> } };
    };
    expect(spec.spec.gateway.plugins[1].config).toEqual({
      alerts: { webhook: 'https://hook', enabled: true },
    });
    expect(spec.spec.gateway.plugins[0].config).toEqual({});
  });
});
