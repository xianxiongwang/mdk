#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Public API-surface gate for the packages a consumer wires their backend into.
 *
 * `check:agent-ready` guards the devkit's *documentation* contract (tiers,
 * JSDoc, USAGE.md, examples). Nothing guarded the *shape* contract — the set of
 * names a consumer can import — so an export could be renamed or dropped and
 * only a downstream app would notice.
 *
 * This script reads the built `.d.ts` for every subpath in each package's
 * `exports` map, records the exported names, and diffs them against a committed
 * baseline. Removals are breaking; additions are additive but still surfaced so
 * a growing surface is a deliberate choice.
 *
 * Usage:
 *   npm run check:api-surface              # verify (exits 1 on drift)
 *   npm run check:api-surface -- --update  # accept the current surface
 *
 * Run after `npm run build` — it reads `dist/`, not `src/`, so it validates
 * what consumers actually resolve through the `exports` map.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type ExportedDeclarations, Node, Project } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(__dirname, "..");
const BASELINE_DIR = path.join(UI_ROOT, "api-surface");

/**
 * Packages whose import surface consumers depend on directly. The devkit is
 * covered by `check:agent-ready` and deliberately excluded here.
 */
const PACKAGES = [
  { dir: "packages/ui-foundation", baseline: "ui-foundation.json" },
  { dir: "packages/react-adapter", baseline: "react-adapter.json" },
] as const;

type SurfaceEntry = { name: string; kind: string };
type Surface = {
  package: string;
  generator: string;
  entrypoints: Record<string, SurfaceEntry[]>;
};

const UPDATE = process.argv.includes("--update") || process.argv.includes("--update-baseline");

/** Coarse kind, chosen so a value→type change (a real break) shows in the diff. */
const classify = (name: string, decls: ExportedDeclarations[]): string => {
  const decl = decls[0];
  if (!decl) return "unknown";
  if (Node.isInterfaceDeclaration(decl)) return "type";
  if (Node.isTypeAliasDeclaration(decl)) return "type";
  if (Node.isEnumDeclaration(decl)) return "enum";
  if (Node.isClassDeclaration(decl)) return "class";
  if (Node.isFunctionDeclaration(decl)) return /^use[A-Z]/.test(name) ? "hook" : "function";
  if (Node.isVariableDeclaration(decl)) {
    const type = decl.getType();
    if (type.getCallSignatures().length > 0) {
      return /^use[A-Z]/.test(name) ? "hook" : "function";
    }
    return "const";
  }
  return "value";
};

/**
 * Resolve the `.d.ts` each `exports` subpath points at. JSON subpaths (the
 * generated manifests) carry no type surface and are skipped.
 */
const typeEntryPoints = (pkgDir: string): Record<string, string> => {
  const pkgJsonPath = path.join(UI_ROOT, pkgDir, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: Record<string, string | { types?: string }>;
  };
  const out: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkgJson.exports ?? {})) {
    const types = typeof target === "string" ? null : target.types;
    if (!types) continue;
    out[subpath] = path.join(UI_ROOT, pkgDir, types);
  }
  return out;
};

const readSurface = (pkgDir: string): Surface => {
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(UI_ROOT, pkgDir, "package.json"), "utf8"),
  ) as { name: string };

  const entryPoints = typeEntryPoints(pkgDir);
  const missing = Object.entries(entryPoints).filter(([, file]) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `${pkgJson.name}: missing built declarations — run \`npm run build\` first:\n${ 
        missing.map(([sub, file]) => `  ${sub} → ${path.relative(UI_ROOT, file)}`).join("\n")}`,
    );
  }

  // One project per package so cross-package resolution stays honest.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { declaration: true, skipLibCheck: true },
  });
  project.addSourceFilesAtPaths(path.join(UI_ROOT, pkgDir, "dist/**/*.d.ts"));

  const entrypoints: Record<string, SurfaceEntry[]> = {};
  for (const [subpath, file] of Object.entries(entryPoints)) {
    const sourceFile = project.getSourceFileOrThrow(file);
    const rows: SurfaceEntry[] = [];
    for (const [name, decls] of sourceFile.getExportedDeclarations()) {
      rows.push({ name, kind: classify(name, decls) });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    entrypoints[subpath] = rows;
  }

  return {
    package: pkgJson.name,
    generator: "scripts/check-api-surface.mts",
    entrypoints,
  };
};

type Drift = { entrypoint: string; removed: SurfaceEntry[]; added: SurfaceEntry[]; changed: string[] };

const diff = (baseline: Surface, current: Surface): Drift[] => {
  const drifts: Drift[] = [];
  const subpaths = new Set([
    ...Object.keys(baseline.entrypoints),
    ...Object.keys(current.entrypoints),
  ]);

  for (const subpath of [...subpaths].sort()) {
    const before = new Map((baseline.entrypoints[subpath] ?? []).map((e) => [e.name, e.kind]));
    const after = new Map((current.entrypoints[subpath] ?? []).map((e) => [e.name, e.kind]));

    const removed = [...before.keys()]
      .filter((name) => !after.has(name))
      .map((name) => ({ name, kind: before.get(name) as string }));
    const added = [...after.keys()]
      .filter((name) => !before.has(name))
      .map((name) => ({ name, kind: after.get(name) as string }));
    const changed = [...after.keys()]
      .filter((name) => before.has(name) && before.get(name) !== after.get(name))
      .map((name) => `${name}: ${before.get(name)} → ${after.get(name)}`);

    if (removed.length || added.length || changed.length) {
      drifts.push({ entrypoint: subpath, removed, added, changed });
    }
  }
  return drifts;
};

const baselinePathFor = (file: string): string => path.join(BASELINE_DIR, file);

let breaking = 0;
let additive = 0;

for (const pkg of PACKAGES) {
  const current = readSurface(pkg.dir);
  const baselineFile = baselinePathFor(pkg.baseline);
  const total = Object.values(current.entrypoints).reduce((n, rows) => n + rows.length, 0);

  if (UPDATE || !fs.existsSync(baselineFile)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
    const verb = UPDATE ? "updated" : "created";
    console.log(`✓ ${current.package}: baseline ${verb} — ${total} exports`);
    continue;
  }

  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as Surface;
  const drifts = diff(baseline, current);

  if (drifts.length === 0) {
    console.log(`✓ ${current.package}: ${total} exports, no drift`);
    continue;
  }

  console.log(`\n✗ ${current.package}: public surface drifted`);
  for (const drift of drifts) {
    console.log(`  ${drift.entrypoint}`);
    for (const e of drift.removed) {
      console.log(`    - REMOVED  ${e.name} (${e.kind})`);
      breaking += 1;
    }
    for (const c of drift.changed) {
      console.log(`    ~ CHANGED  ${c}`);
      breaking += 1;
    }
    for (const e of drift.added) {
      console.log(`    + added    ${e.name} (${e.kind})`);
      additive += 1;
    }
  }
}

if (breaking > 0 || additive > 0) {
  console.log(
    `\nSummary — ${breaking} breaking (removed/changed), ${additive} additive (new exports).`,
  );
  console.log(
    "If this is intended, re-run with `-- --update` and review the baseline diff in the PR.",
  );
  process.exit(1);
}
