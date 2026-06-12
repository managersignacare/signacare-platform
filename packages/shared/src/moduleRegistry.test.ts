import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from './moduleRegistry';

/**
 * Regression tests for the shared patient-tab module registry.
 *
 * These assertions pin the staging-walkthrough findings so a future
 * label or order edit cannot silently re-introduce them:
 *
 *   - All `*-exchange` patient tabs must carry a distinguishing label
 *     (no two tabs may share the bare "Information Exchange" label).
 *   - The `pathways` tab must NOT carry the misleading label
 *     "Psychology"; the route hosts the Psychology Pathways feature.
 *   - Every `order` declared on a `patientTabs` entry must be unique
 *     across the registry. Previously `ect` and `surgery` both
 *     carried `order: 310`, leaving their relative render order
 *     undefined.
 */
describe('MODULE_REGISTRY patientTabs invariants', () => {
  const allTabs = MODULE_REGISTRY.flatMap((m) => m.patientTabs ?? []);

  it('all *-exchange tabs carry distinguishing labels', () => {
    const exchangeTabs = allTabs.filter((t) => t.id.endsWith('-exchange'));
    expect(exchangeTabs.length).toBeGreaterThanOrEqual(7);
    const labels = exchangeTabs.map((t) => t.label);

    // No bare "Information Exchange" labels allowed.
    for (const t of exchangeTabs) {
      expect(t.label).not.toBe('Information Exchange');
      expect(t.label).toMatch(/Information Exchange$/);
    }
    // Labels must be unique across the seven exchanges.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('pathways tab is labelled to identify the Pathways feature', () => {
    const pathways = allTabs.find((t) => t.id === 'pathways');
    expect(pathways).toBeDefined();
    expect(pathways?.label).toContain('Pathways');
  });

  it('every patientTabs.order is unique across the registry', () => {
    const orderByTabId = new Map<string, number>();
    for (const t of allTabs) {
      orderByTabId.set(t.id, t.order);
    }
    const orders = [...orderByTabId.values()];
    const collisions = orders.filter((o, i) => orders.indexOf(o) !== i);
    expect(collisions).toEqual([]);
  });

  it('ect and surgery no longer share the same order', () => {
    const ect = allTabs.find((t) => t.id === 'ect');
    const surgery = allTabs.find((t) => t.id === 'surgery');
    expect(ect).toBeDefined();
    expect(surgery).toBeDefined();
    expect(ect!.order).not.toBe(surgery!.order);
  });
});
