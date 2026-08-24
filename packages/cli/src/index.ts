#!/usr/bin/env node
import { buildProgram } from './program.js';

const program = buildProgram();

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
