import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('HandoverListPage write-panel key contract', () => {
  const source = readFileSync(resolve(__dirname, './HandoverListPage.tsx'), 'utf8');

  it('uses a collision-resistant patient card key for Write Handover rows', () => {
    expect(source).toContain('function buildPatientCardKey(patient: CaseloadPatientRow, index: number): string');
    expect(source).toContain('return `${primaryId}:${emr}:${index}`;');
    expect(source).toContain('<Grid key={buildPatientCardKey(p, index)}');
  });
});
