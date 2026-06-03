import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const legalOrderRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'legal', 'legalOrderRoutes.ts'),
  'utf8',
);

const legalOrderServiceSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'legal', 'legalOrderCrudService.ts'),
  'utf8',
);

describe('BUG-LG family source guards — legal-order command ownership + response boundaries', () => {
  test('routes delegate writes to legalOrderCrudService (no route-level db/repo writes)', () => {
    expect(legalOrderRoutesSource).toContain('legalOrderCrudService.create(');
    expect(legalOrderRoutesSource).toContain('legalOrderCrudService.update(');
    expect(legalOrderRoutesSource).toContain('legalOrderCrudService.listForPatient(');
    expect(legalOrderRoutesSource).not.toContain("db('");
    expect(legalOrderRoutesSource).not.toContain('legalOrderCrudRepository');
  });

  test('route responses are schema-validated before res.json', () => {
    expect(legalOrderRoutesSource).toContain('LegalOrderListResponseSchema.parse(response)');
    expect(legalOrderRoutesSource).toContain('LegalOrderCreateResponseSchema.parse(response)');
    expect(legalOrderRoutesSource).toContain('LegalOrderUpdateResponseSchema.parse(response)');
  });

  test('service emits canonical legal-order audit actions on create/update', () => {
    expect(legalOrderServiceSource).toContain("action: 'LEGAL_ORDER_CREATE'");
    expect(legalOrderServiceSource).toContain("action: 'LEGAL_ORDER_UPDATE'");
    expect(legalOrderServiceSource).toContain('await writeAuditLog({');
  });
});
