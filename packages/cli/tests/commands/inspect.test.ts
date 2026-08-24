import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessExitSignal, mockProcessExit } from '../helpers.js';
import type { StatusReport } from '../../src/lib/status.js';

const collectStatusMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/status.js', () => ({ collectStatus: collectStatusMock }));

const { registerGet, registerDescribe, registerLogs, registerStatus } = await import(
  '../../src/commands/inspect.js'
);

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('-o, --output <fmt>', '', 'table');
  registerGet(program);
  registerDescribe(program);
  registerLogs(program);
  registerStatus(program);
  return program;
}

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
});

function healthyReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    project: '/proj',
    environment: {
      node: { version: '20.0.0', ok: true, required: '>=20' },
      packageManager: 'npm',
      git: true,
      spec: { found: true, path: '/proj/mdk.yaml', valid: true, error: null, stack: 'my-stack' },
      dependencies: { ok: true, checked: 1, missing: [] },
    },
    stack: {
      kernel: { state: 'up', keyFile: '/proj/.mdk/kernel.key', key: 'deadbeefdeadbeef', error: null },
      gateway: { state: 'up', url: 'http://127.0.0.1:3847', error: null },
      workers: {
        declared: 1,
        registered: 1,
        totalDevices: 1,
        items: [{ name: 'a', declared: true, registered: true, state: 'READY', health: 'OK', devices: 1 }],
      },
    },
    health: 'healthy',
    ok: true,
    ...overrides,
  };
}

describe('mdk get / describe / logs (stubs)', () => {
  it('write a not-implemented notice to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const program = buildProgram();
    await program.parseAsync(['node', 'mdk', 'get', 'workers']);
    await program.parseAsync(['node', 'mdk', 'describe', 'worker', 'a']);
    await program.parseAsync(['node', 'mdk', 'logs', 'gateway']);
    const out = stderr.mock.calls.join('');
    expect(out).toContain('mdk get workers: not implemented yet');
    expect(out).toContain('mdk describe worker a: not implemented yet');
    expect(out).toContain('mdk logs gateway: not implemented yet');
  });
});

describe('mdk status', () => {
  it('rejects an unknown --output format with exit code 2', async () => {
    const program = buildProgram();
    mockProcessExit();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(
      program.parseAsync(['node', 'mdk', '--output', 'xml', 'status']),
    ).rejects.toThrow(ProcessExitSignal);
    expect(stderr.mock.calls.join('')).toContain('unknown --output "xml"');
  });

  it('exits 1 and prints the error when collectStatus throws', async () => {
    const program = buildProgram();
    mockProcessExit();
    collectStatusMock.mockRejectedValue(new Error('boom'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(program.parseAsync(['node', 'mdk', 'status'])).rejects.toThrow(ProcessExitSignal);
    expect(stderr.mock.calls.join('')).toContain('boom');
  });

  it('prints a healthy table report with exit code 0', async () => {
    collectStatusMock.mockResolvedValue(healthyReport());
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    const out = stdout.mock.calls.join('');
    expect(out).toContain('MDK status');
    expect(out).toContain('my-stack');
    expect(out).toContain('Health: healthy');
    expect(process.exitCode).toBe(0);
  });

  it('prints JSON when -o json is given', async () => {
    collectStatusMock.mockResolvedValue(healthyReport());
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', '--output', 'json', 'status']);
    const out = stdout.mock.calls.join('');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('prints YAML when -o yaml is given', async () => {
    collectStatusMock.mockResolvedValue(healthyReport());
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', '--output', 'yaml', 'status']);
    expect(stdout.mock.calls.join('')).toContain('health: healthy');
  });

  it('exits 4 for a bad environment (invalid spec) even if the stack looks healthy', async () => {
    collectStatusMock.mockResolvedValue(
      healthyReport({
        environment: {
          node: { version: '20.0.0', ok: true, required: '>=20' },
          packageManager: 'npm',
          git: false,
          spec: { found: false, path: '/proj/mdk.yaml', valid: false, error: 'bad spec', stack: null },
          dependencies: { ok: true, checked: 0, missing: [] },
        },
      }),
    );
    const program = buildProgram();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    expect(process.exitCode).toBe(4);
  });

  it('exits 5 for a degraded/down stack with a valid environment', async () => {
    collectStatusMock.mockResolvedValue(
      healthyReport({
        health: 'degraded',
        ok: false,
        stack: {
          kernel: { state: 'up', keyFile: '/proj/.mdk/kernel.key', key: 'deadbeef', error: null },
          gateway: { state: 'down', url: 'http://127.0.0.1:3847', error: 'ERR_MDK_STATUS_TIMEOUT: timed out' },
          workers: {
            declared: 2,
            registered: 1,
            totalDevices: 1,
            items: [
              { name: 'a', declared: true, registered: true, state: 'READY', health: 'OK', devices: 1 },
              { name: 'b', declared: true, registered: false, state: null, health: null, devices: 0 },
            ],
          },
        },
      }),
    );
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    expect(process.exitCode).toBe(5);
    expect(stdout.mock.calls.join('')).toContain('unreachable (ERR_MDK_STATUS_TIMEOUT)');
  });

  it('defaults --output to "table" when no default is configured on the option', async () => {
    collectStatusMock.mockResolvedValue(healthyReport());
    const program = new Command();
    program.exitOverride();
    program.option('-o, --output <fmt>'); // no default — optsWithGlobals().output is undefined
    registerStatus(program);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    expect(stdout.mock.calls.join('')).toContain('MDK status');
  });

  it('reports a down component with no error as "not running", and renders the plural device count and an overall "down" health', async () => {
    collectStatusMock.mockResolvedValue(
      healthyReport({
        health: 'down',
        ok: false,
        stack: {
          kernel: { state: 'down', keyFile: '/proj/.mdk/kernel.key', key: null, error: null },
          gateway: { state: 'down', url: null, error: 'connection refused, retry later' },
          workers: {
            declared: 1,
            registered: 2,
            totalDevices: 0,
            items: [
              { name: 'a', declared: true, registered: false, state: null, health: null, devices: 0 },
              { name: 'extra', declared: false, registered: true, state: 'READY', health: 'OK', devices: 1 },
            ],
          },
        },
      }),
    );
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    const out = stdout.mock.calls.join('');
    expect(out).toContain('not running');
    expect(out).toContain('connection refused, retry later');
    expect(out).toContain('0 devices');
    expect(out).toContain('not in spec');
    expect(out).toContain('Health: down');
    expect(process.exitCode).toBe(5);
  });

  it('exits 1 with a stringified message when collectStatus rejects a non-Error value', async () => {
    const program = buildProgram();
    mockProcessExit();
    collectStatusMock.mockRejectedValue('a plain string failure');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(program.parseAsync(['node', 'mdk', 'status'])).rejects.toThrow(ProcessExitSignal);
    expect(stderr.mock.calls.join('')).toContain('a plain string failure');
  });

  it('renders a spec error and missing-dependency lines in the table', async () => {
    collectStatusMock.mockResolvedValue(
      healthyReport({
        environment: {
          node: { version: '18.0.0', ok: false, required: '>=20' },
          packageManager: 'npm',
          git: false,
          spec: { found: true, path: '/proj/mdk.yaml', valid: false, error: 'line1\nline2', stack: null },
          dependencies: { ok: false, checked: 2, missing: ['left-pad'] },
        },
      }),
    );
    const program = buildProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['node', 'mdk', 'status']);
    const out = stdout.mock.calls.join('');
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('not installed: left-pad');
    expect(process.exitCode).toBe(4);
  });
});
