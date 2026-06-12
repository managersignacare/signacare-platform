import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const patientRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'patients', 'patientRoutes.ts'),
  'utf8',
);

const outcomeRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'outcomes', 'outcomeRoutes.ts'),
  'utf8',
);

describe('lifecycle route guards', () => {
  test('patient routes expose the patient-scoped clinical note delete alias', () => {
    expect(patientRoutesSource).toContain("router.delete('/:id/notes/:noteId'");
    expect(patientRoutesSource).toContain('clinicalNoteService.softDelete(auth, req.params.noteId)');
  });

  test('outcome routes expose soft delete and persist deleted_at', () => {
    expect(outcomeRoutesSource).toContain("router.delete('/:id'");
    expect(outcomeRoutesSource).toContain('deleted_at: new Date()');
    expect(outcomeRoutesSource).toContain("action: 'SOFT_DELETE'");
  });
});
