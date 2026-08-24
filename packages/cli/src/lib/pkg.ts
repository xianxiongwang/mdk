import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface PackageJson {
  name: string;
  version: string;
  description?: string;
}

// dist/lib/pkg.js -> ../../package.json resolves to the package root.
export const pkg = require('../../package.json') as PackageJson;
