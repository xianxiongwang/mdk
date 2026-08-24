import { describe, expect, it } from 'vitest';
import {
  GATEWAY_CATALOG,
  WORKER_CATALOG,
  findCatalogGatewayPlugin,
  findCatalogWorker,
  resolveCatalogPackage,
  type CatalogWorker,
} from '../../src/lib/catalog.js';

describe('findCatalogWorker', () => {
  it('finds a known worker by its package value', () => {
    const entry = findCatalogWorker('@tetherto/mdk-worker-antminer');
    expect(entry?.label).toBe('mdk-worker-antminer');
  });

  it('returns undefined for an unknown package', () => {
    expect(findCatalogWorker('@nope/not-a-worker')).toBeUndefined();
  });
});

describe('resolveCatalogPackage', () => {
  it('resolves a plain (non-bundled) entry with no repoPath as not bundled', () => {
    const entry = WORKER_CATALOG.find((w) => !w.repoPath);
    expect(entry).toBeDefined();
    const resolved = resolveCatalogPackage(entry as CatalogWorker);
    expect(resolved.bundled).toBe(false);
    expect(resolved.unavailable).toBeUndefined();
    expect(resolved.packageName).toBe(entry?.value);
  });

  it('resolves the bundled antminer entry from this monorepo checkout', () => {
    const entry = findCatalogWorker('@tetherto/mdk-worker-antminer');
    const resolved = resolveCatalogPackage(entry as CatalogWorker);
    expect(resolved.bundled).toBe(true);
    expect(resolved.checkoutDir).toMatch(/backend[/\\]workers[/\\]miners[/\\]antminer$/);
  });

  it('resolves the bundled agent gateway plugin from this checkout', () => {
    const entry = findCatalogGatewayPlugin('@tetherto/mdk-plugin-agent');
    expect(entry).toBeDefined();
    const resolved = resolveCatalogPackage(entry!);
    expect(resolved.bundled).toBe(true);
    expect(resolved.checkoutDir).toMatch(/backend[/\\]plugins[/\\]agent$/);
  });

  it('findCatalogGatewayPlugin returns undefined for an unknown package', () => {
    expect(findCatalogGatewayPlugin('@nope/not-a-plugin')).toBeUndefined();
  });

  it('marks an entry unavailable when its repoPath does not exist in the checkout', () => {
    const entry: CatalogWorker = {
      value: '@tetherto/mdk-worker-nonexistent',
      label: 'mdk-worker-nonexistent',
      hint: 'test fixture',
      repoPath: 'does/not/exist/anywhere',
    };
    const resolved = resolveCatalogPackage(entry);
    expect(resolved.bundled).toBe(false);
    expect(resolved.unavailable).toBe(true);
    expect(resolved.packageName).toBe(entry.value);
  });
});

describe('catalog contents', () => {
  it('exposes non-empty worker and gateway catalogs with the expected shape', () => {
    expect(WORKER_CATALOG.length).toBeGreaterThan(0);
    expect(GATEWAY_CATALOG.length).toBeGreaterThan(0);
    for (const entry of [...WORKER_CATALOG, ...GATEWAY_CATALOG]) {
      expect(entry.value).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.hint).toBeTruthy();
    }
  });
});
