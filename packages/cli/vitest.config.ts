import { defineConfig } from 'vitest/config';

// Scratch projects created by manually trying the CLI (`mdk-try/`, `mdk-try-2/`,
// see .gitignore) come with their own installed dependencies and, for a linked
// worker, their own test suite — neither belongs to *this* package's coverage.
// Tests are scoped to `tests/**` so nothing outside it is ever collected.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        // vitest 4's v8 provider uses AST-aware branch remapping (more granular
        // than v3's), so this package's real branch coverage moved from ~96%
        // to ~92% with no test changes. Lower bar for branches only, matching
        // the other packages in the monorepo (ui/packages/*) that already run
        // on vitest 4 and keep `branches` below the other three metrics.
        branches: 90,
      },
    },
  },
});
