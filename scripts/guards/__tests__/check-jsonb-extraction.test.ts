/*
 * scripts/guards/__tests__/check-jsonb-extraction.test.ts
 *
 * Phase R1 PR-R1-4 cycle-2 absorb (L3 finding #2 P0) — symmetric
 * positive + NEGATIVE test fixtures for the JSONB-extraction guard.
 *
 * Cycle-1 verification was one-sided (synthetic POSITIVE + 1 NEGATIVE
 * literal). The synthetic POSITIVE used `db('treatment_pathways')` —
 * which masked the typed-Knex blind spot in the production guard
 * (`db<TreatmentPathwayRow>('treatment_pathways')`). `pathwayRepository.ts`
 * (the CLAUDE.md §1.7 canonical example) was silently uncovered.
 * Cycle-2 fixes the regex AND adds this symmetric spec to lock in
 * coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  findJsonbTablesInFile,
  hasJsonbExtractionMapper,
} from '../check-jsonb-extraction';

const JSONB = new Map<string, Set<string>>([
  ['treatment_pathways', new Set(['milestones'])],
  ['audit_log', new Set(['old_data', 'new_data', 'details'])],
  ['llm_interactions', new Set(['pipeline'])],
  ['safety_plans', new Set(['content'])],
  ['advance_directives', new Set(['content'])],
]);

describe('findJsonbTablesInFile — typed + non-typed Knex shapes', () => {
  it('detects bare db("table") form', () => {
    const src = `const r = await db('treatment_pathways').first();`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('treatment_pathways')).toBe(true);
  });

  it('detects typed db<RowT>("table") form (cycle-2 fix)', () => {
    // L3 cycle-1 finding #1 P0 — pathwayRepository.ts is THIS shape
    const src = `const r = await db<TreatmentPathwayRow>('treatment_pathways').first();`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('treatment_pathways')).toBe(true);
  });

  it('detects dbRead<T>("table") form', () => {
    const src = `const rows = await dbRead<AuditLogRow>('audit_log').select('*');`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('audit_log')).toBe(true);
  });

  it('detects trx<T>("table") form', () => {
    const src = `await trx<LlmInteractionRow>('llm_interactions').insert(payload);`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('llm_interactions')).toBe(true);
  });

  it('detects .from("table") form', () => {
    const src = `db.select('id').from('audit_log').where(...);`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('audit_log')).toBe(true);
  });

  it('does NOT detect non-JSONB-bearing tables', () => {
    const src = `db('staff').first();`;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.size).toBe(0);
  });

  it('detects multiple JSONB-bearing tables in same file', () => {
    const src = `
      const a = await db('treatment_pathways').first();
      const b = await dbRead<X>('audit_log').select('*');
    `;
    const out = findJsonbTablesInFile(src, JSONB);
    expect(out.has('treatment_pathways')).toBe(true);
    expect(out.has('audit_log')).toBe(true);
  });
});

describe('hasJsonbExtractionMapper — POSITIVE accept (mapper extracts JSONB)', () => {
  it('accepts mapper with property-access r.milestones', () => {
    const src = `
      function pathwayToResponse(r: PathwayRow): PathwayResponse {
        const m = parseMilestones(r.milestones);
        return { id: r.id, pathwayType: m.pathwayType };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(true);
  });

  it('accepts mapper with bracket access ["milestones"]', () => {
    const src = `
      function pathwayToResponse(r: PathwayRow) {
        return { milestones: r['milestones'] };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(true);
  });

  it('accepts mapper with parseColX(...) helper call', () => {
    const src = `
      function pathwayToResponse(r: PathwayRow) {
        return { ...parseMilestones(r.milestones_json) };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(true);
  });

  it('accepts arrow-form const xToResponse = (r) => { ... r.milestones ... }', () => {
    const src = `
      const pathwayToResponse = (r: Row) => {
        return { x: r.milestones };
      };
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(true);
  });
});

describe('hasJsonbExtractionMapper — NEGATIVE reject (mapper does NOT extract)', () => {
  it('rejects mapper that does not reference any JSONB column', () => {
    const src = `
      function userToResponse(r: UserRow) {
        return { id: r.id, name: r.name };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(false);
  });

  it('rejects mapper that mentions column ONLY in a comment (cycle-2 fix)', () => {
    // Cycle-1 used bare \\b<col>\\b which auto-passed comments
    const src = `
      function pathwayToResponse(r: PathwayRow) {
        // TODO: extract milestones from JSONB column
        return { id: r.id };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(false);
  });

  it('rejects mapper that mentions column in a string literal only', () => {
    const src = `
      function pathwayToResponse(r: PathwayRow) {
        const errMsg = 'milestones field is required';
        return { id: r.id, error: errMsg };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(false);
  });

  it('rejects mapper whose body ENDS before the JSONB reference (brace-balance fix)', () => {
    // Cycle-1 used a 4000-char window. A mapper at the top of a file
    // that does NOT reference the JSONB column, followed by unrelated
    // code 100 lines later that DOES, would falsely pass cycle-1 but
    // is correctly rejected cycle-2.
    const src = `
      function pathwayToResponse(r: PathwayRow) {
        return { id: r.id };
      }

      // unrelated code below the mapper
      function anotherFn() {
        const x = some.milestones;
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(false);
  });

  it('rejects file with no mapper at all', () => {
    const src = `
      const r = await db('treatment_pathways').first();
      res.json(r);
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['milestones']))).toBe(false);
  });
});

describe('hasJsonbExtractionMapper — generic JSONB column names', () => {
  // L3 cycle-1 finding #3: generic column names (`content`, `metadata`,
  // `details`) auto-pass via `\\b<col>\\b`. Cycle-2 requires
  // property-access context.

  it('rejects mapper that mentions `content` in unrelated identifier', () => {
    const src = `
      function safetyPlanToResponse(r: SafetyPlanRow) {
        const contentLength = 0; // bare identifier, not r.content
        return { id: r.id, len: contentLength };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['content']))).toBe(false);
  });

  it('accepts mapper that DOES property-access r.content', () => {
    const src = `
      function safetyPlanToResponse(r: SafetyPlanRow) {
        return { id: r.id, plan: r.content };
      }
    `;
    expect(hasJsonbExtractionMapper(src, new Set(['content']))).toBe(true);
  });
});
