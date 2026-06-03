import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const oncologyRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'oncology', 'oncologyRoutes.ts'),
  'utf8',
);

describe('BUG-ONC family source guards', () => {
  test('oncology route list responses are schema-validated envelopes', () => {
    expect(oncologyRoutesSource).toContain('ConditionsListResponseSchema.parse({ items: rows.map(mapConditionToResponse) })');
    expect(oncologyRoutesSource).toContain('TnmListResponseSchema.parse({ items: rows.map(mapTnmToResponse) })');
    expect(oncologyRoutesSource).toContain('EcogListResponseSchema.parse({ items: rows.map(mapEcogToResponse) })');
    expect(oncologyRoutesSource).toContain('TreatmentPlansListResponseSchema.parse({ items: rows.map(mapPlanToResponse) })');
    expect(oncologyRoutesSource).toContain('ChemoCyclesListResponseSchema.parse({ items: rows.map(mapChemoCycleToResponse) })');
    expect(oncologyRoutesSource).toContain('TumourBoardListResponseSchema.parse({ items: rows.map(mapDecisionToResponse) })');
  });

  test('oncology route write responses are schema-validated envelopes', () => {
    expect(oncologyRoutesSource).toContain('ConditionWriteResponseSchema.parse({ item: mapConditionToResponse(row) })');
    expect(oncologyRoutesSource).toContain('TnmWriteResponseSchema.parse({ item: mapTnmToResponse(row) })');
    expect(oncologyRoutesSource).toContain('EcogWriteResponseSchema.parse({ item: mapEcogToResponse(row) })');
    expect(oncologyRoutesSource).toContain('TreatmentPlanWriteResponseSchema.parse({ item: mapPlanToResponse(row) })');
    expect(oncologyRoutesSource).toContain('ChemoCycleWriteResponseSchema.parse({ item: mapChemoCycleToResponse(row) })');
    expect(oncologyRoutesSource).toContain('TumourBoardWriteResponseSchema.parse({ item: mapDecisionToResponse(row) })');
  });
});
