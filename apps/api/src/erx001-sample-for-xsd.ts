/**
 * One-off script used by the Phase 0.6 ERX001 XSD validation check.
 *
 * Builds a minimal-valid ERX001 payload via the production builder
 * (erxRestPayloads.ts → buildErx001Xml) and writes it to stdout so
 * xmllint can validate it against the eRx schema v30.0 ETP2 XSD
 * shipped in the vendor reference pack at
 * /Users/drprakashkamath/Downloads/ePrescribing-master/erx-schema30.0_ETP2.xsd.
 *
 * Usage:
 *   cd apps/api && npx ts-node --transpile-only \
 *     -r tsconfig-paths/register --project tsconfig.node.json \
 *     scripts/erx001-sample-for-xsd.ts > /tmp/erx001-sample.xml
 *   xmllint --noout --schema \
 *     /Users/drprakashkamath/Downloads/ePrescribing-master/erx-schema30.0_ETP2.xsd \
 *     /tmp/erx001-sample.xml
 *
 * Values taken from the reference pack's ERX001_Prescriber_Create.xml
 * example — deliberately minimal rather than exercising every optional
 * field. The assertion is that the builder emits schema-valid XML for a
 * typical outpatient prescription, not that every permutation
 * round-trips.
 */
import { buildErx001Xml, type ErxPrescriptionPayload } from './integrations/escript/erxRestPayloads';

const payload: ErxPrescriptionPayload = {
  scid: '2XXXXX9V7D6HPF2FM6',
  guid: '23c5e95a-909c-45ab-bfa8-68b7451d6056',
  conformanceId: 'Signacare|1.0.0',
  patient: {
    familyName: 'TEST',
    givenName: 'ERXTESTFIVE',
    dob: '1950-01-01',
    gender: 'U',
    address1: 'TEST',
    suburb: 'MEL',
    postcode: '3052',
    state: 'VIC',
    phone: '0',
    mobile: '0',
    // 16-digit IHI placeholder matching the canonical reference
    // payload's test sentinel. The XSD restricts PatientIHI to
    // xs:long with minInclusive=1111111111111111 — the builder
    // emits whatever the caller supplies, so production callers
    // must provide a real IHI from the patient record. The test
    // uses the vendor-approved sentinel so the payload validates.
    ihi: '1111111111111111',
  },
  clinician: {
    prescriberNumber: '1234567',
    providerNumber: '1234567A',
    givenName: 'TEST',
    familyName: 'DOCTOR',
    // 11-digit sentinel matching the reference pack's canonical
    // ERX001_Prescriber_Create.xml DoctorMobileNumber field.
    mobile: '12341564321',
    practiceName: 'Signacare Demo Practice',
    practiceAddress1: '1 Test St',
    practiceSuburb: 'Melbourne',
    practicePostcode: '3000',
    practiceState: 'VIC',
    practicePhone: '0390000000',
    prescriberType: 'M',
    // 16-digit HPII / HPIO placeholders — same reasoning as the
    // PatientIHI sentinel above. Production callers supply the
    // real HPII from the staff.hpii column.
    hpii: '1111111111111111',
    hpio: '1111111111111111',
  },
  item: {
    prescriptionDate: '2026-04-15',
    tradeName: 'Paracetamol 500 mg tablet',
    genericName: 'Paracetamol 500 mg tablet',
    form: 'tablet',
    strength: '500 mg',
    genericIntention: 'G',
    quantity: 20,
    repeats: 0,
    route: 'Oral',
    directions: 'Take one or two tablets every 4 hours as required for pain. Max 8 per day.',
    isSchedule8: false,
    isPrivate: true,
  },
};

// eslint-disable-next-line no-console
console.log(buildErx001Xml(payload));
