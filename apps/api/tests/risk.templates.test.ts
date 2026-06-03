import { describe, it, expect } from 'vitest';
import {
  listRiskTemplates,
  getRiskTemplate,
} from '../src/features/risk/riskTemplates';

// Audit 2026-04-16 L3 follow-up: unit tests pinning the shape
// of the three canonical risk templates. The frontend
// RiskAssessmentForm consumes these directly via the GET
// /risk-assessments/templates + :id endpoints — if the shape
// drifts (sections[] missing, maxScore broken, id collisions)
// the form silently renders empty and clinicians can't create
// structured assessments.

describe('riskTemplates — catalog', () => {
  it('exposes exactly three canonical templates', () => {
    const all = listRiskTemplates();
    expect(all).toHaveLength(3);
    const ids = new Set(all.map((t) => t.id));
    expect(ids).toEqual(
      new Set(['suicide-risk', 'self-harm', 'harm-to-others']),
    );
  });

  it('every template has at least one section and every section has items', () => {
    for (const tpl of listRiskTemplates()) {
      expect(tpl.sections.length).toBeGreaterThan(0);
      for (const section of tpl.sections) {
        expect(section.items.length).toBeGreaterThan(0);
        for (const item of section.items) {
          expect(item.minValue).toBe(0);
          expect(item.maxValue).toBeGreaterThan(0);
        }
      }
    }
  });

  it('section.maxScore equals the sum of item.maxValue', () => {
    for (const tpl of listRiskTemplates()) {
      for (const section of tpl.sections) {
        const expected = section.items.reduce(
          (acc, i) => acc + i.maxValue,
          0,
        );
        expect(section.maxScore).toBe(expected);
      }
    }
  });

  it('template.totalMax equals the sum of section.maxScore', () => {
    for (const tpl of listRiskTemplates()) {
      const expected = tpl.sections.reduce(
        (acc, s) => acc + s.maxScore,
        0,
      );
      expect(tpl.totalMax).toBe(expected);
    }
  });

  it('item ids are unique within a template', () => {
    for (const tpl of listRiskTemplates()) {
      const itemIds = new Set<string>();
      for (const section of tpl.sections) {
        for (const item of section.items) {
          expect(itemIds.has(item.id)).toBe(false);
          itemIds.add(item.id);
        }
      }
    }
  });

  it('section ids are unique within a template', () => {
    for (const tpl of listRiskTemplates()) {
      const sectionIds = new Set(tpl.sections.map((s) => s.id));
      expect(sectionIds.size).toBe(tpl.sections.length);
    }
  });
});

describe('riskTemplates — getRiskTemplate', () => {
  it('returns the template by id', () => {
    const tpl = getRiskTemplate('suicide-risk');
    expect(tpl).not.toBeNull();
    expect(tpl!.name).toContain('Suicide');
    expect(tpl!.sections.some((s) => s.id === 'sra.ideation')).toBe(true);
  });

  it('returns null for an unknown id', () => {
    expect(getRiskTemplate('made-up-template')).toBeNull();
    expect(getRiskTemplate('')).toBeNull();
  });

  it('returns a deep-cloned object — mutations do not leak into the catalog', () => {
    const a = getRiskTemplate('suicide-risk');
    expect(a).not.toBeNull();
    // Mutate the return value — next call must still return the
    // original shape.
    (a as unknown as { name: string }).name = 'MUTATED';
    const b = getRiskTemplate('suicide-risk');
    expect(b).not.toBeNull();
    expect(b!.name).not.toBe('MUTATED');
    expect(b!.name).toContain('Suicide');
  });

  it('listRiskTemplates also returns deep clones', () => {
    const first = listRiskTemplates();
    (first[0] as unknown as { name: string }).name = 'MUTATED';
    const second = listRiskTemplates();
    expect(second[0].name).not.toBe('MUTATED');
  });
});
