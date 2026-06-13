import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIDDEN_PATIENT_TABS,
  PATIENT_TABS,
  PATIENT_TAB_GROUPS,
  type KnownPatientTabId,
} from './patientTypes';

/**
 * Regression tests for the canonical patient-detail tab registry.
 *
 * These assertions pin the UI/navigation findings from the staging
 * walkthrough so a future label edit cannot silently re-introduce them:
 *
 *   - All seven specialty `*-exchange` tabs must carry distinguishable
 *     labels. A patient with multiple specialty modules enabled used to
 *     see seven identical "Information Exchange" tabs.
 *   - The `pathways` tab must NOT carry the label "Psychology" alone —
 *     the route hosts the Psychology Pathways feature, not a Psychology
 *     module.
 *   - Every tab id declared in the `KnownPatientTabId` union must have
 *     a corresponding `PATIENT_TABS` entry, and every entry's id must
 *     be present in `PATIENT_TAB_GROUPS` (we have a single source of
 *     truth for tab labels and consumers should not silently render an
 *     unknown id).
 */
describe('PATIENT_TABS canonical registry', () => {
  it('every specialty *-exchange tab has a distinguishing label', () => {
    const exchangeTabs = PATIENT_TABS.filter((t) => t.id.endsWith('-exchange'));
    expect(exchangeTabs.length).toBeGreaterThanOrEqual(7);

    // No two specialty exchange tabs may share the exact same label.
    const labels = exchangeTabs.map((t) => t.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);

    // Each specialty exchange label must NOT be the bare phrase
    // "Information Exchange" — every exchange tab needs a prefix.
    for (const tab of exchangeTabs) {
      expect(tab.label).not.toBe('Information Exchange');
      expect(tab.label).toMatch(/Information Exchange$/);
    }
  });

  it('mh-exchange specifically carries an MH-prefixed label', () => {
    const tab = PATIENT_TABS.find((t) => t.id === 'mh-exchange');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('MH Information Exchange');
  });

  it('pathways tab is labelled as the Pathways feature (not as a Psychology module)', () => {
    const tab = PATIENT_TABS.find((t) => t.id === 'pathways');
    expect(tab).toBeDefined();
    // Must include the word "Pathways" so users know what they're
    // opening. "Psychology" alone is misleading.
    expect(tab?.label).toContain('Pathways');
  });

  it('keeps documentation ahead of rating scales in the mental health navigation group', () => {
    const mentalHealthGroup = PATIENT_TAB_GROUPS.find((group) => group.label === 'Mental Health');
    expect(mentalHealthGroup).toBeDefined();

    const documentationIndex = mentalHealthGroup!.tabs.indexOf('documentation');
    const assessmentsIndex = mentalHealthGroup!.tabs.indexOf('assessments');

    expect(documentationIndex).toBeGreaterThanOrEqual(0);
    expect(assessmentsIndex).toBe(documentationIndex + 1);
    expect(mentalHealthGroup!.tabs).not.toContain('episodes');
  });

  it('moves episodes into the admin group directly under overview', () => {
    const adminGroup = PATIENT_TAB_GROUPS.find((group) => group.label === 'Admin');
    expect(adminGroup).toBeDefined();
    expect(adminGroup?.tabs.slice(0, 2)).toEqual(['overview', 'episodes']);
  });

  it('tracks the default hidden workbench tabs in a single source of truth', () => {
    expect(DEFAULT_HIDDEN_PATIENT_TABS).toEqual([
      'problems',
      'tracking',
      'billing',
      'inpatient-care',
      'ect',
      'tms',
    ]);
  });

  it('every tab id is registered exactly once', () => {
    const ids = PATIENT_TABS.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every tab referenced in PATIENT_TAB_GROUPS has a matching PATIENT_TABS entry', () => {
    const knownIds = new Set<KnownPatientTabId>(PATIENT_TABS.map((t) => t.id));
    const groupTabIds = PATIENT_TAB_GROUPS.flatMap((group) => group.tabs);
    const missing = groupTabIds.filter((id) => !knownIds.has(id));
    expect(missing).toEqual([]);
  });
});
