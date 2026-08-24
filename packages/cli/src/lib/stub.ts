/**
 * Placeholder used by every command in this scaffold.
 *
 * The CLI wires up the full command surface (names, arguments, options, help),
 * but no command carries any underlying behavior yet. Each action simply calls
 * `stub()` so that another developer can drop the real implementation in place
 * of this call without touching the command wiring.
 *
 * Machine-facing data must go to stdout; these notices are human-facing, so
 * they are written to stderr (12-factor pipeline discipline).
 */
export function stub(command: string, hint?: string): void {
  process.stderr.write(`mdk ${command}: not implemented yet (stub).\n`);
  if (hint) {
    process.stderr.write(`  -> ${hint}\n`);
  }
}
