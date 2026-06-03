/*
 * scripts/guards/__tests__/check-scaffold-extension.test.ts
 *
 * Phase 0b.1b-ii-B — symmetric tests for the scaffold-extension guard.
 * Cycle-1: tests for the detect/ignore axis (table-name derivation,
 * scaffold matching, extension detection, divergence annotation).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCandidateTableNames,
  deriveScaffoldKind,
  findZodObjectSchemas,
  fileExtendsOrDiverges,
} from '../check-scaffold-extension';

describe('deriveCandidateTableNames', () => {
  it('strips Schema/Response/Dto suffixes and produces snake_case', () => {
    const cands = deriveCandidateTableNames('MedicationResponseSchema');
    expect(cands).toContain('medication');
    expect(cands).toContain('medications'); // pluralized candidate
  });

  it('handles multi-word PascalCase', () => {
    const cands = deriveCandidateTableNames('PatientMedicationResponseSchema');
    expect(cands).toContain('patient_medication');
    expect(cands).toContain('patient_medications');
  });

  it('handles already-plural names (de-pluralization candidate)', () => {
    const cands = deriveCandidateTableNames('TasksResponseSchema');
    expect(cands).toContain('tasks');
    expect(cands).toContain('task');
  });

  it('emits empty list when name is bare "Schema" (no body)', () => {
    expect(deriveCandidateTableNames('Schema')).toEqual([]);
  });

  it('handles -y → -ies pluralization', () => {
    const cands = deriveCandidateTableNames('TherapyResponseSchema');
    expect(cands).toContain('therapy');
    expect(cands).toContain('therapies');
  });
});

describe('deriveScaffoldKind', () => {
  it('returns "response" for *ResponseSchema', () => {
    expect(deriveScaffoldKind('MedicationResponseSchema')).toBe('response');
  });

  it('returns "dto" for *DtoSchema / *RequestSchema / *CreateSchema / *UpdateSchema', () => {
    expect(deriveScaffoldKind('MedicationDtoSchema')).toBe('dto');
    expect(deriveScaffoldKind('MedicationRequestSchema')).toBe('dto');
    expect(deriveScaffoldKind('MedicationCreateSchema')).toBe('dto');
    expect(deriveScaffoldKind('MedicationUpdateSchema')).toBe('dto');
  });

  it('returns null for ambiguous names', () => {
    expect(deriveScaffoldKind('SomeFooSchema')).toBe(null);
  });
});

describe('findZodObjectSchemas', () => {
  it('finds export const X = z.object(...) at line N', () => {
    const src = `
import { z } from 'zod';

export const FooSchema = z.object({
  id: z.string().uuid(),
});

export const BarResponseSchema = z.object({
  name: z.string(),
});
`;
    const decls = findZodObjectSchemas(src, '/abs/foo.ts', 'foo.ts');
    expect(decls).toHaveLength(2);
    expect(decls[0].schemaName).toBe('FooSchema');
    expect(decls[0].declarationStart).toBe(4);
    expect(decls[1].schemaName).toBe('BarResponseSchema');
  });

  it('does NOT match z.object inside a non-Schema export', () => {
    const src = `
export const NOT_A_SCHEMA = { id: z.object({}) };
export const ALSO_NOT = "z.object";
`;
    const decls = findZodObjectSchemas(src, '/abs/x.ts', 'x.ts');
    expect(decls).toHaveLength(0);
  });

  it('does NOT match derived schemas (.partial(), .extend(), etc.)', () => {
    // This is fine — the file CAN have .extend() chains, but only fresh
    // z.object calls trigger the guard. Derived schemas inherit their
    // shape from the parent.
    const src = `
import { z } from 'zod';
export const FooSchema = z.object({ id: z.string() });
export const FooUpdateSchema = FooSchema.partial();
`;
    const decls = findZodObjectSchemas(src, '/abs/x.ts', 'x.ts');
    expect(decls).toHaveLength(1);
    expect(decls[0].schemaName).toBe('FooSchema');
  });
});

describe('fileExtendsOrDiverges', () => {
  const decl = {
    file: '/abs/medication.schemas.ts',
    fileRelative: 'packages/shared/src/medication.schemas.ts',
    schemaName: 'MedicationResponseSchema',
    declarationStart: 30,
  };
  const match = {
    scaffoldFile: 'packages/shared/src/_scaffolds/medications.response.scaffold.ts',
    scaffoldExportName: 'MedicationsResponseScaffoldSchema',
    tableName: 'medications',
    kind: 'response' as const,
  };

  it('detects scaffold import at file top', () => {
    const src = `
import { MedicationsResponseScaffoldSchema } from './_scaffolds/medications.response.scaffold';
import { z } from 'zod';

${'\n'.repeat(25)}
export const MedicationResponseSchema = MedicationsResponseScaffoldSchema.extend({});
`;
    const result = fileExtendsOrDiverges(src, decl, match);
    expect(result.extended).toBe(true);
    expect(result.diverges).toBe(false);
  });

  it('detects @scaffold-divergence annotation near the declaration', () => {
    const src = `${'\n'.repeat(25)}
// @scaffold-divergence: response is filtered for clinician role
export const MedicationResponseSchema = z.object({});
`;
    const result = fileExtendsOrDiverges(src, decl, match);
    expect(result.diverges).toBe(true);
    expect(result.reason).toContain('filtered for clinician role');
  });

  it('detects @scaffold-divergence annotation in file header (first 30 lines)', () => {
    const src = `// @scaffold-divergence: this whole file is a derived view
import { z } from 'zod';
${'\n'.repeat(50)}
export const MedicationResponseSchema = z.object({});
`;
    const result = fileExtendsOrDiverges(src, decl, match);
    expect(result.diverges).toBe(true);
  });

  it('returns extended=false, diverges=false when neither import nor annotation', () => {
    const src = `import { z } from 'zod';

export const MedicationResponseSchema = z.object({
  id: z.string(),
});
`;
    const result = fileExtendsOrDiverges(src, decl, match);
    expect(result.extended).toBe(false);
    expect(result.diverges).toBe(false);
  });

  it('does NOT confuse import from unrelated scaffold path', () => {
    const src = `import { OtherScaffold } from './_scaffolds/something_else.dto.scaffold';

export const MedicationResponseSchema = z.object({});
`;
    const result = fileExtendsOrDiverges(src, decl, match);
    expect(result.extended).toBe(false);
  });
});
