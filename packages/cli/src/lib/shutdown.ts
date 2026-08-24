import { theme } from './theme.js';

/** A booted component the CLI must take down before it exits. */
export interface Stoppable {
  /** Shown while it is being stopped, e.g. `worker demo-miner`. */
  label: string;
  stop: () => unknown | Promise<unknown>;
}

/** Exit status for a signal-initiated stop — 128 + SIGINT, the shell convention. */
const SIGNAL_EXIT = 130;

/** How long a graceful stop gets before the process is taken down anyway. */
const GRACE_MS = 5000;

/**
 * Takes ownership of Ctrl+C for a foreground `mdk run`.
 *
 * Components are stopped in the order given (reverse boot order), but the
 * process exits no matter what they do: a stop that throws is skipped, a stop
 * that hangs is abandoned after `GRACE_MS`, and a second signal exits on the
 * spot. That guarantee is the point — every port this process holds is released
 * when the user asks it to stop, instead of a wedged shutdown leaving a listener
 * bound to a port nobody can find.
 */
export function installShutdown(components: Stoppable[]): void {
  let stopping = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      // Second Ctrl+C: the user is done waiting.
      process.exit(SIGNAL_EXIT);
    }
    stopping = true;
    process.stderr.write(`\n${theme.muted(`Stopping (${signal})…`)}\n`);

    const gracefully = (async () => {
      for (const component of components) {
        try {
          await component.stop();
        } catch (error) {
          process.stderr.write(
            theme.muted(
              `  ${component.label} did not stop cleanly: ` +
                `${error instanceof Error ? error.message : String(error)}\n`,
            ),
          );
        }
      }
    })();

    // `unref` so a finished shutdown is never held open by this timer.
    const forced = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), GRACE_MS).unref();
    });

    void Promise.race([gracefully, forced]).then((outcome) => {
      if (outcome === 'timeout') {
        process.stderr.write(theme.warn(`Shutdown timed out after ${GRACE_MS}ms — forcing exit.\n`));
      } else {
        process.stderr.write(`${theme.muted('Stopped.')}\n`);
      }
      process.exit(SIGNAL_EXIT);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
