import antfu from '@antfu/eslint-config'

// Formatting is owned by Prettier (.prettierrc + lint-staged). Antfu's
// stylistic ruleset is disabled here so the two don't fight at commit time
// vs. CI time. Keep this off; do not re-introduce `style/*` overrides.
export default antfu(
  {
    type: 'lib',
    typescript: true,
    stylistic: false,
    formatters: false,
    ignores: [
      'postcss.config.js',
      'vite.config.base.js',
      '*/*.md',
      'packages/**/*.md',
      'apps/**/*.md',
      'packages/cli/templates/**',
      // Docs rendering-component templates: written against the mdk-docs
      // dependency tree (fumadocs, @/ alias), not resolvable here. They ship
      // verbatim and are installed into the docs repo by `mdk-ui docs:build`.
      'packages/cli/templates-docs/**',
    ],
  },
  // ── Cross-boundary import guard ──────────────────────────────────────────
  // Ban relative paths that navigate into src/core from src/foundation, or
  // climb 2+ levels in ui-foundation / react-adapter (which have no sub-directories
  // deep enough to need that). All packages expose '@/*' → 'src/*' and
  // react-devkit additionally exposes '@primitives' → 'src/core'.
  {
    // foundation → core: any relative path that resolves to src/core must use @primitives.
    files: ['packages/react-devkit/src/domain/**'],
    rules: {
      'ts/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(\\.\\./)+core($|\\/)',
              message: "Use '@primitives' instead of a relative path to src/core.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui-foundation/src/**', 'packages/react-adapter/src/**'],
    rules: {
      'ts/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./){2,}',
              message: "Use '@/<path>' path aliases instead of deep relative imports.",
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Nested *shipped* source has to use relative imports.
     *
     * The `@/` alias only exists in each package's `tsconfig` paths and vitest
     * resolver — `tsc` does not rewrite it, so an alias in a file that ends up in
     * `dist/` is emitted verbatim and every consumer fails to resolve it. The
     * rule above is safe for tests and for the flat directories it was written
     * against; it is wrong for source nested two or more levels deep.
     */
    files: ['packages/ui-foundation/src/presets/**'],
    ignores: ['packages/ui-foundation/src/presets/**/specs/**'],
    rules: {
      'ts/no-restricted-imports': 'off',
    },
  },
  {
    rules: {
      'ts/no-redeclare': 'off',
      'ts/explicit-function-return-type': 'off',
      'ts/consistent-type-definitions': ['error', 'type'],
      'no-console': ['warn'],
      'antfu/no-top-level-await': 'off',
      'antfu/top-level-function': 'off',
      'import/consistent-type-specifier-style': 'off',
      'node/prefer-global/process': 'off',
      'perfectionist/sort-imports': 'off',
      'test/prefer-lowercase-title': 'off',
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
          ignore: ['README.md', 'App.tsx'],
        },
      ],
    },
  },
)
