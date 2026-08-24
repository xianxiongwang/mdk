import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HOST, findFreePort, isPortFree } from '../../src/lib/ports.js';

describe('ports', () => {
  let held: Server | undefined;

  afterEach(async () => {
    if (held) {
      await new Promise<void>((resolveClose) => held?.close(() => resolveClose()));
      held = undefined;
    }
  });

  it('exports the loopback default host', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
  });

  it('reports a bindable port as free', async () => {
    // Port 0 asks the OS for an ephemeral port; bind it once to learn a number,
    // then release it immediately so the next probe sees it free again.
    const probe = createServer();
    const port = await new Promise<number>((resolveListen) => {
      probe.listen(0, DEFAULT_HOST, () => {
        resolveListen((probe.address() as { port: number }).port);
      });
    });
    await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));

    await expect(isPortFree(port)).resolves.toBe(true);
  });

  it('reports a bound port as not free', async () => {
    held = createServer();
    const port = await new Promise<number>((resolveListen) => {
      held?.listen(0, DEFAULT_HOST, () => {
        resolveListen((held?.address() as { port: number }).port);
      });
    });

    await expect(isPortFree(port)).resolves.toBe(false);
  });

  it('findFreePort returns the start port when it is free', async () => {
    const port = await findFreePort({ start: 19999 });
    expect(port).toBeGreaterThanOrEqual(19999);
  });

  it('findFreePort skips a busy port and any explicitly taken ones', async () => {
    held = createServer();
    const busyPort = await new Promise<number>((resolveListen) => {
      held?.listen(0, DEFAULT_HOST, () => {
        resolveListen((held?.address() as { port: number }).port);
      });
    });

    const found = await findFreePort({ start: busyPort, taken: new Set([busyPort + 1]) });
    expect(found).not.toBe(busyPort);
    expect(found).not.toBe(busyPort + 1);
  });

  it('throws when no free port exists in the scanned window', async () => {
    const taken = new Set<number>();
    for (let p = 20500; p < 20505; p++) taken.add(p);
    await expect(findFreePort({ start: 20500, limit: 5, taken })).rejects.toThrow(
      /No free port found/,
    );
  });
});
