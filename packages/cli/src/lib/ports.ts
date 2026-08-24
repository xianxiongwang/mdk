import { createServer } from 'node:net';

/** Loopback host every local mock and component binds to unless told otherwise. */
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Whether `port` can be bound on `host` right now, tested by actually binding it
 * (the only answer the OS will give honestly — scanning `lsof` output would miss
 * sockets owned by other users and races either way).
 */
export function isPortFree(port: number, host: string = DEFAULT_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

export interface FreePortOptions {
  /** First port to try. */
  start: number;
  host?: string;
  /** Ports to treat as taken even if the OS says they are free (already handed out). */
  taken?: Set<number>;
  /** How many ports to try before giving up. */
  limit?: number;
}

/**
 * First bindable port at or after `start`, skipping any already handed out in
 * this run. Callers scan a small window — a machine with 200 consecutive busy
 * ports in this range has a bigger problem than port selection.
 */
export async function findFreePort({
  start,
  host = DEFAULT_HOST,
  taken,
  limit = 200,
}: FreePortOptions): Promise<number> {
  for (let port = start; port < start + limit && port <= 65535; port++) {
    if (taken?.has(port)) continue;
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`No free port found in ${start}–${start + limit - 1} on ${host}.`);
}
