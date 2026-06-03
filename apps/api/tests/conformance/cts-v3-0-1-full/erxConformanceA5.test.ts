/**
 * BUG-344 — ADHA CTS v3.0.1 expanded local conformance vectors.
 *
 * This suite extends the BUG-299 MVP harness with a broader contract
 * matrix covering:
 * - eRx submit regulatory contract vectors
 * - FHIR MedicationRequest validity vectors
 * - ERX001 XML content vectors
 * - ERX002 / ERX005 parser vectors
 *
 * Vector count: 60.
 */

import { describe, expect, it } from 'vitest';
import { ErxSubmitContractSchema } from '../../../src/features/prescriptions/erxRegulatoryContract';
import { buildFhirMedicationRequest, validateFhirPrescription } from '../../../src/integrations/escript/fhirPrescriptionBuilder';
import { buildErx001Xml } from '../../../src/integrations/escript/erxRestPayloads';
import { parseErx002, parseErx005 } from '../../../src/integrations/escript/erxSoapPayloads';

function baseSubmit() {
  return {
    prescriptionId: '11111111-1111-1111-1111-111111111111',
    patientIhi: '8003608833357361',
    prescriberHpii: '8003618833357361',
    prescriberHpio: '8003621234567892',
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

function baseRestPayload() {
  return {
    scid: '212345678901234',
    guid: '11111111-1111-1111-1111-111111111111',
    conformanceId: 'Signacare|1.0.0',
    patient: {
      familyName: 'Smith',
      givenName: 'Jane',
      dob: '1990-01-01',
      gender: 'F' as const,
      ihi: '8003608833357361',
      medicareNumber: '29500003411',
    },
    clinician: {
      prescriberNumber: '1234567',
      providerNumber: '2699958J',
      givenName: 'Dr',
      familyName: 'Tester',
      practiceName: 'Signacare',
      hpii: '8003618833357361',
      hpio: '8003621234567892',
    },
    item: {
      prescriptionDate: '2026-05-15',
      tradeName: 'Olanzapine',
      genericName: 'Olanzapine',
      genericIntention: 'G' as const,
      quantity: 30,
      repeats: 1,
      pbsCode: '1234X',
      directions: 'One nightly',
    },
  };
}

describe('BUG-344 expanded conformance vectors', () => {
  const contractVectors: Array<{ name: string; payload: Record<string, unknown>; valid: boolean }> = [
    { name: 'C01 base payload valid', payload: baseSubmit(), valid: true },
    { name: 'C02 phone authority requires approval', payload: { ...baseSubmit(), authorityMode: 'phone' }, valid: false },
    { name: 'C03 phone authority with approval valid', payload: { ...baseSubmit(), authorityMode: 'phone', authorityApprovalNumber: 'PH-1' }, valid: true },
    { name: 'C04 written authority requires approval', payload: { ...baseSubmit(), authorityMode: 'written' }, valid: false },
    { name: 'C05 written authority with approval valid', payload: { ...baseSubmit(), authorityMode: 'written', authorityApprovalNumber: 'WR-1' }, valid: true },
    { name: 'C06 private requires no PBS', payload: { ...baseSubmit(), authorityMode: 'private', isPrivateScript: true, privateScriptNumber: 'P-1', privatePriceCents: 1000 }, valid: false },
    { name: 'C07 private with no PBS valid', payload: { ...baseSubmit(), pbsItemCode: undefined, authorityMode: 'private', isPrivateScript: true, privateScriptNumber: 'P-1', privatePriceCents: 1000 }, valid: true },
    { name: 'C08 private missing number invalid', payload: { ...baseSubmit(), pbsItemCode: undefined, authorityMode: 'private', isPrivateScript: true, privatePriceCents: 1000 }, valid: false },
    { name: 'C09 private missing price invalid', payload: { ...baseSubmit(), pbsItemCode: undefined, authorityMode: 'private', isPrivateScript: true, privateScriptNumber: 'P-1' }, valid: false },
    { name: 'C10 repeatIntervalDays requires repeats', payload: { ...baseSubmit(), repeats: 0, repeatIntervalDays: 30 }, valid: false },
    { name: 'C11 repeatIntervalDays with repeats valid', payload: { ...baseSubmit(), repeats: 2, repeatIntervalDays: 30 }, valid: true },
    { name: 'C12 deferred date before prescribed invalid', payload: { ...baseSubmit(), deferredUntilDate: '2026-05-01' }, valid: false },
    { name: 'C13 deferred date >90d invalid', payload: { ...baseSubmit(), deferredUntilDate: '2026-09-01' }, valid: false },
    { name: 'C14 deferred date in window valid', payload: { ...baseSubmit(), deferredUntilDate: '2026-06-30' }, valid: true },
    { name: 'C15 explicit general with no PBS invalid', payload: { ...baseSubmit(), authorityMode: 'general', pbsItemCode: undefined }, valid: false },
    { name: 'C16 streamlined with PBS valid', payload: { ...baseSubmit(), authorityMode: 'streamlined' }, valid: true },
    { name: 'C17 private implied by flag valid', payload: { ...baseSubmit(), pbsItemCode: undefined, isPrivateScript: true, privateScriptNumber: 'P-2', privatePriceCents: 900 }, valid: true },
    { name: 'C18 invalid private price invalid', payload: { ...baseSubmit(), pbsItemCode: undefined, authorityMode: 'private', isPrivateScript: true, privateScriptNumber: 'P-3', privatePriceCents: 0 }, valid: false },
    { name: 'C19 quantity positive required', payload: { ...baseSubmit(), quantity: 0 }, valid: false },
    { name: 'C20 repeats nonnegative required', payload: { ...baseSubmit(), repeats: -1 }, valid: false },
  ];

  it.each(contractVectors)('$name', ({ payload, valid }) => {
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    expect(parsed.success).toBe(valid);
  });

  const fhirVectors: Array<{ name: string; payload: Record<string, unknown>; valid: boolean }> = [
    { name: 'F01 base valid', payload: baseSubmit(), valid: true },
    { name: 'F02 zero repeats valid', payload: { ...baseSubmit(), repeats: 0 }, valid: true },
    { name: 'F03 no pbs code valid', payload: { ...baseSubmit(), pbsItemCode: undefined }, valid: true },
    { name: 'F04 s8 true valid', payload: { ...baseSubmit(), isS8: true }, valid: true },
    { name: 'F05 explicit private valid', payload: { ...baseSubmit(), pbsItemCode: undefined, authorityMode: 'private', isPrivateScript: true, privateScriptNumber: 'P-2', privatePriceCents: 900 }, valid: true },
    { name: 'F06 deferred + repeat interval valid', payload: { ...baseSubmit(), deferredUntilDate: '2026-06-20', repeatIntervalDays: 30, repeats: 2 }, valid: true },
    { name: 'F07 missing medication invalid', payload: { ...baseSubmit(), medicationName: '' }, valid: false },
    { name: 'F08 missing patientIhi invalid', payload: { ...baseSubmit(), patientIhi: '' }, valid: false },
    { name: 'F09 missing prescriberHpii invalid', payload: { ...baseSubmit(), prescriberHpii: '' }, valid: false },
    { name: 'F10 negative repeats invalid', payload: { ...baseSubmit(), repeats: -1 }, valid: false },
    { name: 'F11 malformed date still builds but contract invalid', payload: { ...baseSubmit(), prescribedDate: '15-05-2026' }, valid: false },
    { name: 'F12 phone authority with approval valid', payload: { ...baseSubmit(), authorityMode: 'phone', authorityApprovalNumber: 'PH-2' }, valid: true },
    { name: 'F13 written authority with approval valid', payload: { ...baseSubmit(), authorityMode: 'written', authorityApprovalNumber: 'WR-2' }, valid: true },
    { name: 'F14 route alternative valid', payload: { ...baseSubmit(), route: 'IM' }, valid: true },
    { name: 'F15 frequency free text valid', payload: { ...baseSubmit(), frequency: 'nightly when required' }, valid: true },
  ];

  it.each(fhirVectors)('$name', ({ payload, valid }) => {
    const parsed = ErxSubmitContractSchema.safeParse(payload);
    if (!parsed.success) {
      expect(valid).toBe(false);
      return;
    }
    const fhir = buildFhirMedicationRequest(parsed.data);
    const v = validateFhirPrescription(fhir);
    expect(v.valid).toBe(valid);
  });

  const xmlVectors = [
    { name: 'X01 base XML includes GUID', payload: baseRestPayload(), needle: '<GUID>11111111-1111-1111-1111-111111111111</GUID>' },
    { name: 'X02 includes PatientIHI', payload: baseRestPayload(), needle: '<PatientIHI>8003608833357361</PatientIHI>' },
    { name: 'X03 includes PrescriberHPII', payload: baseRestPayload(), needle: '<PrescriberHPII>8003618833357361</PrescriberHPII>' },
    { name: 'X04 includes PrescriberHPIO', payload: baseRestPayload(), needle: '<PrescriberHPIO>8003621234567892</PrescriberHPIO>' },
    { name: 'X05 includes PBS code', payload: baseRestPayload(), needle: '<PBSCode>1234X</PBSCode>' },
    { name: 'X06 private script flag emits true', payload: { ...baseRestPayload(), item: { ...baseRestPayload().item, isPrivate: true } }, needle: '<PrivatePrescription>true</PrivatePrescription>' },
    { name: 'X07 private script flag default false', payload: baseRestPayload(), needle: '<PrivatePrescription>false</PrivatePrescription>' },
    { name: 'X08 authority number present', payload: { ...baseRestPayload(), item: { ...baseRestPayload().item, authorityNumber: 'AUTH-1' } }, needle: '<PBS-DVAAuthorityNumber>AUTH-1</PBS-DVAAuthorityNumber>' },
    { name: 'X09 phone approval present', payload: { ...baseRestPayload(), item: { ...baseRestPayload().item, phoneApprovalNumber: 'PH-1' } }, needle: '<PhoneApprovalAuthorityNumber>PH-1</PhoneApprovalAuthorityNumber>' },
    { name: 'X10 repeat interval populated', payload: { ...baseRestPayload(), item: { ...baseRestPayload().item, repeatIntervalDays: 30 } }, needle: '<RepeatIntervals>30</RepeatIntervals>' },
  ];

  it.each(xmlVectors)('$name', ({ payload, needle }) => {
    const xml = buildErx001Xml(payload);
    expect(xml).toContain(needle);
  });

  const erx002Vectors = [
    { name: 'P01 parses success message', xml: '<ERX002><MessageId>m1</MessageId><PrescriptionId>p1</PrescriptionId><ScriptNumber>s1</ScriptNumber><Token>t1</Token></ERX002>', success: true },
    { name: 'P02 parses SOAP fault', xml: '<soap:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>bad request</faultstring></soap:Fault>', success: false },
    { name: 'P03 parses explicit ErrorCode', xml: '<ERX002><ErrorCode>E123</ErrorCode><ErrorMessage>invalid</ErrorMessage></ERX002>', success: false },
    { name: 'P04 parses namespaced tags', xml: '<erx:MessageId>m2</erx:MessageId><erx:PrescriptionId>p2</erx:PrescriptionId><erx:ScriptNumber>s2</erx:ScriptNumber>', success: true },
    { name: 'P05 token expiry parse', xml: '<ERX002><TokenExpiry>2026-06-01</TokenExpiry></ERX002>', success: true },
  ];

  it.each(erx002Vectors)('$name', ({ xml, success }) => {
    const parsed = parseErx002(xml);
    expect(parsed.success).toBe(success);
  });

  const erx005Vectors = [
    { name: 'D01 parses dispense notification', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><DispensedDate>2026-05-15</DispensedDate><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D02 ignores non-ERX005 type', xml: '<MessageType>ERX001</MessageType><ScriptNumber>s1</ScriptNumber>', expectNull: true },
    { name: 'D03 returns null when missing script number', xml: '<ERX005><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: true },
    { name: 'D04 parses repeat number', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><RepeatNumber>2</RepeatNumber><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D05 parses pharmacy details', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><PharmacyName>A Chemist</PharmacyName><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D06 parses namespaced script number', xml: '<erx:ScriptNumber>s1</erx:ScriptNumber><erx:DispensedQuantity>1</erx:DispensedQuantity>', expectNull: false },
    { name: 'D07 parse fallback dispensed date', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D08 parse pharmacist name', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><PharmacistName>Pat</PharmacistName><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D09 parse pharmacy HPIO', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><PharmacyHPIO>8003621234567892</PharmacyHPIO><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
    { name: 'D10 parse patient names', xml: '<ERX005><ScriptNumber>s1</ScriptNumber><FamilyName>Smith</FamilyName><GivenName>Jane</GivenName><DispensedQuantity>1</DispensedQuantity></ERX005>', expectNull: false },
  ];

  it.each(erx005Vectors)('$name', ({ xml, expectNull }) => {
    const parsed = parseErx005(xml);
    if (expectNull) {
      expect(parsed).toBeNull();
    } else {
      expect(parsed).not.toBeNull();
    }
  });
});
