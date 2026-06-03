import { describe, expect, it } from 'vitest';
import { ErxSubmitContractSchema } from '../../src/features/prescriptions/erxRegulatoryContract';
import { buildFhirMedicationRequest } from '../../src/integrations/escript/fhirPrescriptionBuilder';

function basePayload() {
  return {
    prescriptionId: '11111111-1111-1111-1111-111111111111',
    patientIhi: '8003608833357361',
    prescriberHpii: '8003618833357361',
    prescriberHpio: '8003628833357361',
    medicationName: 'Olanzapine',
    dose: '10mg',
    route: 'oral',
    frequency: 'daily',
    quantity: 30,
    repeats: 1,
    pbsItemCode: '1234X',
    isS8: false,
    prescribedDate: '2026-05-15',
  };
}

describe('BUG-303/304/305 eRx regulatory contract', () => {
  it('T1: accepts standard PBS general workflow', () => {
    const parsed = ErxSubmitContractSchema.parse(basePayload());
    expect(parsed.pbsItemCode).toBe('1234X');
    expect(parsed.authorityMode).toBeUndefined();
  });

  it('T2: rejects non-private scripts without PBS code', () => {
    const payload = { ...basePayload(), authorityMode: 'general' as const, pbsItemCode: undefined };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T3: rejects phone authority without approval number', () => {
    const payload = { ...basePayload(), authorityMode: 'phone' as const };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T4: accepts phone authority with approval number', () => {
    const payload = {
      ...basePayload(),
      authorityMode: 'phone' as const,
      authorityApprovalNumber: 'PA-90812',
    };
    const parsed = ErxSubmitContractSchema.parse(payload);
    expect(parsed.authorityApprovalNumber).toBe('PA-90812');
  });

  it('T5: rejects private script carrying PBS code', () => {
    const payload = {
      ...basePayload(),
      authorityMode: 'private' as const,
      isPrivateScript: true,
      privateScriptNumber: 'PRV-2026-0001',
      privatePriceCents: 1899,
    };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T6: requires private number and price for private scripts', () => {
    const payload = {
      ...basePayload(),
      authorityMode: 'private' as const,
      pbsItemCode: undefined,
      isPrivateScript: true,
    };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T7: rejects deferred dispense before prescribed date', () => {
    const payload = {
      ...basePayload(),
      deferredUntilDate: '2026-05-01',
    };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T8: rejects deferred dispense beyond 90 days', () => {
    const payload = {
      ...basePayload(),
      deferredUntilDate: '2026-09-01',
    };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T9: rejects repeat interval when repeats are zero', () => {
    const payload = {
      ...basePayload(),
      repeats: 0,
      repeatIntervalDays: 30,
    };
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('T10: FHIR builder carries authority/private/deferred extensions', () => {
    const payload = ErxSubmitContractSchema.parse({
      ...basePayload(),
      pbsItemCode: undefined,
      authorityMode: 'private',
      isPrivateScript: true,
      privateScriptNumber: 'PRV-2026-0002',
      privatePriceCents: 2500,
      repeats: 3,
      repeatIntervalDays: 30,
      deferredUntilDate: '2026-06-15',
    });
    const fhir = buildFhirMedicationRequest(payload);
    const urls = new Set((fhir.extension ?? []).map((e) => e.url));
    expect(urls.has('http://signacare.local/fhir/StructureDefinition/authority-mode')).toBe(true);
    expect(urls.has('http://signacare.local/fhir/StructureDefinition/private-script')).toBe(true);
    expect(urls.has('http://signacare.local/fhir/StructureDefinition/private-script-number')).toBe(true);
    expect(urls.has('http://signacare.local/fhir/StructureDefinition/repeat-interval-days')).toBe(true);
    expect(urls.has('http://signacare.local/fhir/StructureDefinition/deferred-dispense-until')).toBe(true);
  });
});
