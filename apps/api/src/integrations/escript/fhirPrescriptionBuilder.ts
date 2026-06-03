/**
 * FHIR R4 MedicationRequest Builder for NPDS
 *
 * Builds an Australian-profile FHIR MedicationRequest resource
 * conformant with ADHA Electronic Prescribing v3.0 specification.
 *
 * References:
 * - https://build.fhir.org/ig/hl7au/au-fhir-erequesting/
 * - https://developer.digitalhealth.gov.au/products/escript
 */

import type { ErxSubmitPayload } from './escriptService';
import { lookupAmtCode } from './amtCodeMap';

interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  meta: { profile: string[] };
  identifier: { system: string; value: string }[];
  status: 'active' | 'cancelled' | 'completed';
  intent: 'order';
  medicationCodeableConcept: { coding: FhirCoding[]; text: string };
  subject: { identifier: { system: string; value: string }; type: 'Patient' };
  requester: { identifier: { system: string; value: string }; type: 'Practitioner' };
  authoredOn: string;
  dosageInstruction: {
    text: string;
    route?: { coding: FhirCoding[] };
    doseAndRate?: { doseQuantity: { value: number; unit: string } }[];
    timing?: { code?: { text: string } };
  }[];
  dispenseRequest: {
    numberOfRepeatsAllowed: number;
    quantity: { value: number; unit: string };
    validityPeriod?: { start: string; end?: string };
  };
  extension?: { url: string; valueString?: string; valueBoolean?: boolean; valueCoding?: FhirCoding }[];
}

const AMT_SYSTEM = 'http://snomed.info/sct'; // Australian Medicines Terminology via SNOMED CT-AU
const PBS_SYSTEM = 'http://pbs.gov.au/code/item';
const IHI_SYSTEM = 'http://ns.electronichealth.net.au/id/hi/ihi/1.0';
const HPII_SYSTEM = 'http://ns.electronichealth.net.au/id/hi/hpii/1.0';
// HPIO_SYSTEM used when org-level FHIR context is added
// const HPIO_SYSTEM = 'http://ns.electronichealth.net.au/id/hi/hpio/1.0';
const SCRIPT_AUTHORITY_URL = 'http://ns.electronichealth.net.au/id/nata/scr/1.0';
const AU_EREQUESTING_PROFILE = 'http://hl7.org.au/fhir/StructureDefinition/au-medicationrequest';

const ROUTE_MAP: Record<string, FhirCoding> = {
  oral: { system: 'http://snomed.info/sct', code: '26643006', display: 'Oral route' },
  im: { system: 'http://snomed.info/sct', code: '78421000', display: 'Intramuscular route' },
  iv: { system: 'http://snomed.info/sct', code: '47625008', display: 'Intravenous route' },
  sc: { system: 'http://snomed.info/sct', code: '34206005', display: 'Subcutaneous route' },
  sublingual: { system: 'http://snomed.info/sct', code: '37839007', display: 'Sublingual route' },
  topical: { system: 'http://snomed.info/sct', code: '6064005', display: 'Topical route' },
  pr: { system: 'http://snomed.info/sct', code: '37161004', display: 'Rectal route' },
  inhaled: { system: 'http://snomed.info/sct', code: '447694001', display: 'Respiratory tract route' },
};

export function buildFhirMedicationRequest(payload: ErxSubmitPayload): FhirMedicationRequest {
  const doseMatch = payload.dose.match(/^([\d.]+)\s*(.*)$/);
  const doseValue = doseMatch ? parseFloat(doseMatch[1]) : 0;
  const doseUnit = doseMatch ? (doseMatch[2] || 'mg') : 'mg';

  const amt = lookupAmtCode(payload.medicationName);
  const medicationCodings: FhirCoding[] = [
    { system: AMT_SYSTEM, code: amt?.sctId ?? 'UNMAPPED', display: amt?.display ?? payload.medicationName },
  ];
  if (payload.pbsItemCode) {
    medicationCodings.push({ system: PBS_SYSTEM, code: payload.pbsItemCode, display: `PBS ${payload.pbsItemCode}` });
  }

  const extensions: FhirMedicationRequest['extension'] = [];
  if (payload.isS8) {
    extensions.push({
      url: 'http://ns.electronichealth.net.au/fhir/StructureDefinition/schedule8indicator',
      valueBoolean: true,
    });
  }
  if (payload.pbsItemCode) {
    extensions.push({
      url: 'http://ns.electronichealth.net.au/fhir/StructureDefinition/pbs-authority-prescription-number',
      valueString: payload.authorityApprovalNumber ?? payload.pbsItemCode,
    });
  }
  if (payload.authorityMode) {
    extensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/authority-mode',
      valueString: payload.authorityMode,
    });
  }
  if (payload.authorityMode === 'private' || payload.isPrivateScript) {
    extensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/private-script',
      valueBoolean: true,
    });
    if (payload.privateScriptNumber) {
      extensions.push({
        url: 'http://signacare.local/fhir/StructureDefinition/private-script-number',
        valueString: payload.privateScriptNumber,
      });
    }
  }
  if (payload.repeatIntervalDays !== undefined) {
    extensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/repeat-interval-days',
      valueString: String(payload.repeatIntervalDays),
    });
  }
  if (payload.deferredUntilDate) {
    extensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/deferred-dispense-until',
      valueString: payload.deferredUntilDate,
    });
  }

  const resource: FhirMedicationRequest = {
    resourceType: 'MedicationRequest',
    meta: { profile: [AU_EREQUESTING_PROFILE] },
    identifier: [{ system: SCRIPT_AUTHORITY_URL, value: payload.prescriptionId }],
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: medicationCodings,
      text: `${payload.medicationName} ${payload.dose}`,
    },
    subject: { identifier: { system: IHI_SYSTEM, value: payload.patientIhi }, type: 'Patient' },
    requester: { identifier: { system: HPII_SYSTEM, value: payload.prescriberHpii }, type: 'Practitioner' },
    authoredOn: payload.prescribedDate || new Date().toISOString(),
    dosageInstruction: [{
      text: `${payload.dose} ${payload.frequency} ${payload.route}${payload.directions ? ' — ' + payload.directions : ''}`,
      route: ROUTE_MAP[payload.route.toLowerCase()] ? { coding: [ROUTE_MAP[payload.route.toLowerCase()]] } : undefined,
      doseAndRate: [{ doseQuantity: { value: doseValue, unit: doseUnit } }],
      timing: { code: { text: payload.frequency } },
    }],
    dispenseRequest: {
      numberOfRepeatsAllowed: payload.repeats,
      quantity: { value: payload.quantity, unit: 'unit' },
      validityPeriod: { start: payload.prescribedDate || new Date().toISOString().split('T')[0] },
    },
  };

  if (extensions.length) resource.extension = extensions;
  return resource;
}

/**
 * Validate a FHIR MedicationRequest has all mandatory fields for NPDS submission.
 */
export function validateFhirPrescription(resource: FhirMedicationRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!resource.subject.identifier.value || resource.subject.identifier.value === '') errors.push('Patient IHI is required');
  if (!resource.requester.identifier.value || resource.requester.identifier.value === '') errors.push('Prescriber HPII is required');
  if (!resource.medicationCodeableConcept.text) errors.push('Medication name is required');
  if (!resource.dosageInstruction.length) errors.push('Dosage instruction is required');
  if (resource.dispenseRequest.numberOfRepeatsAllowed < 0) errors.push('Repeats must be >= 0');
  return { valid: errors.length === 0, errors };
}
