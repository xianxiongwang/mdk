import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShutdown, type Stoppable } from '../../src/lib/shutdown.js';

describe('installShutdown', () => {
  let handlers: Record<string, (signal: NodeJS.Signals) => void>;
  let stderrLines: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handlers = {};
    vi.spyOn(process, 'on').mockImplementation(((event: string, cb: (signal: NodeJS.Signals) => void) => {
      handlers[event] = cb;
      return process;
    }) as typeof process.on);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    stderrLines = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers SIGINT and SIGTERM handlers', () => {
    installShutdown([]);
    expect(handlers.SIGINT).toBeInstanceOf(Function);
    expect(handlers.SIGTERM).toBeInstanceOf(Function);
  });

  it('stops components in the given order and exits 130 on success', async () => {
    const order: string[] = [];
    const components: Stoppable[] = [
      {
        label: 'gateway',
        stop: () => {
          order.push('gateway');
        },
      },
      {
        label: 'kernel',
        stop: async () => {
          order.push('kernel');
        },
      },
    ];
    installShutdown(components);
    handlers.SIGINT('SIGINT');
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(['gateway', 'kernel']);
    expect(exitSpy).toHaveBeenCalledWith(130);
    expect(stderrLines.join('')).toContain('Stopping (SIGINT)');
    expect(stderrLines.join('')).toContain('Stopped.');
  });

  it('logs and continues past a component whose stop() throws', async () => {
    const goodStop = vi.fn();
    const components: Stoppable[] = [
      {
        label: 'bad',
        stop: () => {
          throw new Error('boom');
        },
      },
      { label: 'good', stop: goodStop },
    ];
    installShutdown(components);
    handlers.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(stderrLines.join('')).toContain('bad did not stop cleanly: boom');
    expect(goodStop).toHaveBeenCalled();
  });

  it('stringifies a non-Error value thrown by stop()', async () => {
    const components: Stoppable[] = [
      {
        label: 'weird',
        stop: () => {
          throw 'not an Error instance';
        },
      },
    ];
    installShutdown(components);
    handlers.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(stderrLines.join('')).toContain('weird did not stop cleanly: not an Error instance');
  });

  it('forces an exit after the grace period when a component hangs', async () => {
    const components: Stoppable[] = [{ label: 'stuck', stop: () => new Promise(() => {}) }];
    installShutdown(components);
    handlers.SIGINT('SIGINT');
    await vi.advanceTimersByTimeAsync(5000);

    expect(stderrLines.join('')).toContain('Shutdown timed out after 5000ms');
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('exits immediately on a second signal while still stopping', async () => {
    const components: Stoppable[] = [{ label: 'stuck', stop: () => new Promise(() => {}) }];
    installShutdown(components);
    handlers.SIGINT('SIGINT');
    handlers.SIGINT('SIGINT');

    expect(exitSpy).toHaveBeenCalledWith(130);
  });
});
