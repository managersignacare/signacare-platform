/**
 * eRx REST API XML Payload Builders
 *
 * Builds ePrescription XML payloads per the eRx schema v30.0.
 * Used for ERX001 (Prescriber Create) and ERX023 (Prescriber Cancel)
 * operations against the eRx REST API.
 *
 * AIP (Active Ingredient Prescribing) compliant per eRx AIP v2.1:
 * - ItemTradeName and ItemGenericName use AMT-MPP descriptions
 * - PrescribedItem_Reserved_03 populated with full AIP drug description
 */

import { HI_PREFIX, validateHiNumber } from '../../shared/hiNumbers';

const ERX_NS = 'http://erx.com.au/integration/v1';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ErxPatient {
  familyName: string;
  givenName: string;
  dob: string;                // YYYY-MM-DD
  gender: 'M' | 'F' | 'U';
  address1?: string;
  suburb?: string;
  postcode?: string;
  state?: string;             // VIC, NSW, QLD, etc.
  phone?: string;
  mobile?: string;
  email?: string;
  medicareNumber?: string;
  medicareSubNumerate?: string;
  dvaNumber?: string;
  dvaCardColour?: string;     // G, W, O
  ihi?: string;               // 16-digit Individual Healthcare Identifier
  ctgFlag?: boolean;
}

export interface ErxClinician {
  prescriberNumber: string;   // PBS Prescriber Number (DoctorPrescriberNumber)
  providerNumber: string;     // Medicare Provider Number (DoctorProviderNumber)
  givenName: string;
  familyName: string;
  mobile?: string;
  email?: string;
  practiceName: string;
  practiceAddress1?: string;
  practiceAddress2?: string;
  practiceSuburb?: string;
  practicePostcode?: string;
  practiceState?: string;
  practiceEmail?: string;
  practicePhone?: string;
  fax?: string;
  hpii?: string;              // 16-digit Healthcare Provider Identifier
  ahpraNumber?: string;
  prescriberType?: string;    // M = Medical, D = Dental, N = Nurse, etc.
  hpio?: string;              // Organisation HPIO
  qualifications?: string;    // e.g. "MBBS"
}

export interface ErxPrescribedItem {
  prescriptionDate: string;   // ISO datetime or YYYY-MM-DD
  tradeName: string;          // AIP: AMT-MPP description
  genericName: string;        // AIP: same as tradeName for active ingredient
  form?: string;              // tablet, capsule, etc. (conditional)
  strength?: string;          // 10mg, etc. (conditional)
  genericIntention: 'G' | 'B'; // G = generic/AIP, B = brand (LEMI)
  brandSubstitutionNotAllowed?: boolean;
  pbsCode?: string;
  pbsManufacturerCode?: string;
  quantity: number;
  repeats: number;
  route?: string;             // Oral, IM, IV, etc.
  directions: string;         // Patient instructions
  isSchedule8?: boolean;
  isPrivate?: boolean;
  authorityNumber?: string;
  phoneApprovalNumber?: string;
  amtMp?: string;             // AMT Medicinal Product code
  amtMpp?: string;            // AMT Medicinal Product Pack code
  amtTpp?: string;            // AMT Trade Product Pack code
  amtMpuu?: string;           // AMT Medicinal Product Unit of Use
  amtTp?: string;
  amtTpuu?: string;
  amtCtpp?: string;
  aipDescription?: string;    // PrescribedItem_Reserved_03 — full AIP description
  scriptNumber?: string;      // Prescriber's internal script number
  reasonForPrescribing?: string;
  snomedReasonCode?: string;
  controlledSubstanceRef?: string; // State S8 permit reference
  isExtemporaneous?: boolean;
  extemporaneousDescription?: string;
  /** Repeat interval in days between dispenses (0 = no minimum interval) */
  repeatIntervalDays?: number;
  /** Regulation 24 (continued dispensing) prescription */
  isRegulation24?: boolean;
  /** Urgent/emergency supply */
  isEmergencySupply?: boolean;
  /** Unusual quantity flag — set when quantity exceeds PBS maximum */
  unusualQuantity?: boolean;
  /** Unusual dose flag — set when dose is outside normal range */
  unusualDose?: boolean;
  /** Annotations per supply number (prescriber notes for each repeat) */
  annotations?: { supplyNumber: number; value: string }[];
  /** Item unique ID from the prescribing system (maps to ItemUniqueID) */
  itemUniqueId?: string;
}

/** Prescription category: outpatient (default), inpatient, or discharge */
export type PrescriptionCategory = 'outpatient' | 'inpatient' | 'discharge';

export interface ErxPrescriptionPayload {
  scid: string;
  guid: string;
  conformanceId: string;
  patient: ErxPatient;
  clinician: ErxClinician;
  item: ErxPrescribedItem;
  tokenDelivery?: { sms?: string; email?: string };
  /** GUID of the original prescription when represcribing/repeating */
  originalGuid?: string;
  /** SCID of the original prescription (for represcribe/repeat tracking) */
  originalScid?: string;
  /** Original sequence number (for reactivate/repeat — maps to OriginalSequence) */
  originalSequence?: number;
  /** Patient consent for token notification (SMS/email) */
  notificationConsent?: boolean;
  /** Prescription category — controls PatientHospitalCategory flag */
  prescriptionCategory?: PrescriptionCategory;
}

// ── XML Escaping ─────────────────────────────────────────────────────────────

function esc(val: string | undefined | null): string {
  if (!val) return '';
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el(tag: string, value: string | number | boolean | undefined | null, nilIfEmpty = false): string {
  if (value === undefined || value === null || value === '') {
    return nilIfEmpty ? `<${tag} i:nil="true"/>` : `<${tag}/>`;
  }
  return `<${tag}>${esc(String(value))}</${tag}>`;
}

/**
 * Coerce a caller-supplied date string to an xs:dateTime literal. The
 * eRx schema v30.0 requires the PrescriptionDate field to be
 * xs:dateTime, not xs:date — shipping `2026-04-15` directly fails XSD
 * validation at the ETP2 gateway with "is not a valid value of the
 * atomic type 'xs:dateTime'".
 *
 *   '2026-04-15'                  → '2026-04-15T00:00:00'
 *   '2026-04-15T09:30:00'         → '2026-04-15T09:30:00'  (unchanged)
 *   '2026-04-15T09:30:00.123Z'    → '2026-04-15T09:30:00.123Z'  (unchanged)
 *
 * Anything else is passed through untouched so a caller that supplies
 * an already-correct xs:dateTime string isn't mangled.
 */
function toXsdDateTime(value: string): string {
  if (!value) return value;
  // Already has a time component — caller knows what they're doing.
  if (value.includes('T')) return value;
  // Plain date (YYYY-MM-DD) — append midnight local time per xs:dateTime.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00`;
  return value;
}

// ── Shared: Full ePrescription XML body ─────────────────────────────────────
// Used by ERX001 (Create), ERX023 (Cancel), ERX027 (Amend), ERX019 (Reactivate)

type ItemState = 'Active' | 'Cancelled' | 'Ceased' | 'Dispensed';

export interface ErxTokenEopPayload {
  scid: string;
  dspId?: string | null;
  token: string;
}

/**
 * Full clinical XML payload for eRx submission pathways.
 *
 * BUG-P1 note:
 * This payload intentionally carries full clinical context and MUST NOT
 * be reused as a patient-facing EoP artifact.
 */
export function buildClinicalXml(payload: ErxPrescriptionPayload, itemState: ItemState): string {
  const { scid, guid, conformanceId, patient: p, clinician: c, item: i, tokenDelivery } = payload;
  const isHospital = payload.prescriptionCategory === 'inpatient' || payload.prescriptionCategory === 'discharge';
  const isReprescribe = !!payload.originalGuid;

  // BUG-295 — HARD-FAIL on missing or malformed HPI-O. Pre-fix this
  // emitted `<PrescriberHPIO></PrescriberHPIO>` for every submission —
  // instant eRx accreditation failure. Any caller that reaches here
  // without a valid HPI-O indicates (a) clinic.hpio is NULL and the
  // clinic has not been ops-backfilled yet, or (b) the payload-
  // builder above this call didn't read clinic.hpio into the clinician
  // object. Either way, NOT a payload to send to eRx.
  //
  // Error shape mirrors HttpError's duck-typed fields so global
  // errorHandler renders it as 503 ERX_NOT_CONFIGURED. Structured so
  // the error message names the clinic (if known) without leaking
  // internal state — operator sees "this clinic isn't eRx-ready",
  // other tenants continue to prescribe normally.
  if (!c.hpio || !validateHiNumber(c.hpio, HI_PREFIX.HPI_O)) {
    const err = new Error(
      'Clinic HPI-O is missing or malformed. HPI-O must be 16 digits starting with 800362. Contact system admin to set clinics.hpio for this tenant before prescribing via eRx.',
    ) as Error & { status: number; code: string; details: Record<string, unknown> };
    err.status = 503;
    err.code = 'ERX_NOT_CONFIGURED';
    err.details = { field: 'clinic.hpio', reason: c.hpio ? 'malformed' : 'missing' };
    throw err;
  }

  const tokenBlock = tokenDelivery ? `
        <TokenMetadata>
          <ElectronicAddresses>
            ${tokenDelivery.sms ? `<ElectronicAddress><Type>sms</Type><Value>${esc(tokenDelivery.sms)}</Value></ElectronicAddress>` : ''}
            ${tokenDelivery.email ? `<ElectronicAddress><Type>email</Type><Value>${esc(tokenDelivery.email)}</Value></ElectronicAddress>` : ''}
          </ElectronicAddresses>
        </TokenMetadata>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<ePrescription xmlns="${ERX_NS}" xmlns:i="${XSI_NS}">
  ${el('SCID', scid)}
  ${el('GUID', guid)}
  ${el('CreatedDate', new Date().toISOString().replace('Z', ''))}
  ${isReprescribe && payload.originalScid ? el('OriginalSCID', payload.originalScid) : ''}
  ${isReprescribe ? el('OriginalGUID', payload.originalGuid!) : '<OriginalGUID/>'}
  ${el('NotificationConsentFlag', payload.notificationConsent ? 'true' : 'false')}
  <ETPIdentifiers>
    ${el('CreatorConformanceId', conformanceId)}
    ${isReprescribe ? el('RepeatCreatorConformanceId', conformanceId) : '<RepeatCreatorConformanceId/>'}
    <DispenserConformanceId/>
    ${el('EPresUniqueNumber', scid)}
    ${isReprescribe && payload.originalScid ? el('OriginalRepositorySoftUniqueId', payload.originalScid) : '<OriginalRepositorySoftUniqueId/>'}
    <RepositorySoftUniqueId/>
    ${el('Uri', `https://ausscripts.erx.com.au/scripts/${scid}`)}
  </ETPIdentifiers>
  <Items>
    <Item>
      ${el('Sequence', 1)}
      ${payload.originalSequence !== undefined ? el('OriginalSequence', payload.originalSequence) : ''}
      ${el('State', itemState)}
      <Content>
        <Patient>
          <PatientUniqueID/>
          <PatientNumber/>
          ${el('PatientFamilyName', p.familyName)}
          ${el('PatientFirstName', p.givenName)}
          ${el('PatientMedicareFamilyName', p.familyName)}
          ${el('PatientMedicareFirstName', p.givenName)}
          <PatientTitle/>
          ${el('PatientAddress1', p.address1 || '')}
          <PatientAddress2/>
          ${el('PatientSuburb', p.suburb || '')}
          ${el('PatientPostcode', p.postcode || '')}
          ${el('PatientState', p.state || '')}
          ${el('PatientSex', p.gender)}
          ${el('PatientPhoneNumber', p.phone || '0')}
          ${el('PatientMobileNumber', p.mobile || '0')}
          ${el('PatientEmail', p.email || '')}
          ${el('PatientMedicareNumber', p.medicareNumber || '0')}
          ${el('PatientMedicareSubNumerate', p.medicareSubNumerate || '0')}
          <PatientMedicareValidTo i:nil="true"/>
          <Concession_PensionNumber/>
          <EntitlementNumber/>
          ${el('DVANumber', p.dvaNumber || '')}
          ${el('DVACardColour', p.dvaCardColour || '')}
          ${el('PatientBirthdate', p.dob)}
          ${el('PatientCTGFlag', p.ctgFlag ? 'true' : 'false')}
          ${el('PatientIHI', p.ihi || '')}
          ${el('PatientHospitalCategory', isHospital ? 'true' : 'false')}
          <Patient_Reserved_01/><Patient_Reserved_02/><Patient_Reserved_03/><Patient_Reserved_04/><Patient_Reserved_05/>
        </Patient>
        <Clinician>
          ${el('DoctorPrescriberNumber', c.prescriberNumber)}
          ${el('DoctorFirstName', c.givenName)}
          ${el('DoctorFamilyName', c.familyName)}
          ${el('DoctorProviderNumber', c.providerNumber)}
          ${el('DoctorMobileNumber', c.mobile || '')}
          ${el('DoctorEmail', c.email || '')}
          ${el('PracticeName', c.practiceName)}
          ${el('PracticeAddress1', c.practiceAddress1 || '')}
          ${el('PracticeAddress2', c.practiceAddress2 || '')}
          ${el('PracticeSuburb', c.practiceSuburb || '')}
          ${el('PracticePostcode', c.practicePostcode || '')}
          ${el('PracticeState', c.practiceState || '')}
          ${el('PracticeEmail', c.practiceEmail || '')}
          ${el('DoctorPhoneNumber', c.practicePhone || '')}
          ${el('DoctorFaxNumber', c.fax || '0')}
          ${el('PrescribingSystemUsed', 'Signacare EMR')}
          ${el('PrescriberType', c.prescriberType || 'M')}
          ${el('PrescriberHPIO', c.hpio || '')}
          ${el('PrescriberHPII', c.hpii || '')}
          ${el('PrescriberAHPRANumber', c.ahpraNumber || '')}
          ${el('Clinician_Reserved_01', c.qualifications || '')}
          <Clinician_Reserved_02/><Clinician_Reserved_03/><Clinician_Reserved_04/><Clinician_Reserved_05/>
        </Clinician>
        <PrescribedItem>
          ${el('PrescriptionDate', toXsdDateTime(i.prescriptionDate))}
          ${el('ItemUniqueID', i.itemUniqueId || '')}
          ${el('ItemTradeName', i.tradeName)}
          ${el('ItemGenericName', i.genericName)}
          ${el('ItemForm', i.form || '')}
          ${el('ItemStrength', i.strength || '')}
          ${el('ItemGenericIntention', i.genericIntention)}
          ${el('BrandSubstitutionNotAllowed', i.brandSubstitutionNotAllowed ? 'true' : 'false')}
          ${el('PBSCode', i.pbsCode || '')}
          ${el('PBSManufacturerCode', i.pbsManufacturerCode || '')}
          ${el('Quantity', i.quantity)}
          ${el('UnusualQtyFlag', i.unusualQuantity ? 'true' : 'false')}
          ${el('ItemBarcode', '0')}
          ${el('RouteAdministration', i.route || 'Oral')}
          ${el('NumberOfRepeatsAuthorised', i.repeats)}
          ${el('PBS-DVAAuthorityNumber', i.authorityNumber || '0')}
          ${el('PhoneApprovalAuthorityNumber', i.phoneApprovalNumber || '')}
          ${el('ScheduleNumber', i.isSchedule8 ? '8' : '0')}
          ${el('PatientInstructions', i.directions)}
          ${el('RepeatIntervals', i.repeatIntervalDays ?? 0)}
          ${el('DoctorNotes', '')}
          ${el('ReasonForPrescribing', i.reasonForPrescribing || '')}
          ${el('Regulation24', i.isRegulation24 ? 'true' : 'false')}
          ${el('IsExtemp', i.isExtemporaneous ? 'true' : 'false')}
          ${el('ExtemporaneousDescription', i.extemporaneousDescription || '')}
          ${el('UnlistedItemRepatAuthority', 'false')}
          ${el('PrivatePrescription', i.isPrivate ? 'true' : 'false')}
          <ScriptCTGAnnotation/>
          ${el('AMT_MP', i.amtMp || '')}
          ${el('AMT_MPP', i.amtMpp || '')}
          ${el('AMT_TPP', i.amtTpp || '')}
          ${el('AMT_MPUU', i.amtMpuu || '')}
          ${el('AMT_TP', i.amtTp || '')}
          ${el('AMT_TPUU', i.amtTpuu || '')}
          ${el('AMT_CTPP', i.amtCtpp || '')}
          <PrescribedItem_Reserved_01/>
          <PrescribedItem_Reserved_02/>
          ${el('PrescribedItem_Reserved_03', i.aipDescription || '')}
          <PrescribedItem_Reserved_04/>
          <PrescribedItem_Reserved_05/>
          <TherapeuticGoodIdentificationCode/>
          <TherapeuticGoodIdentificationCodeSystem/>
          <TherapeuticGoodIdentificationCodeSystemName/>
          <TherapeuticGoodIdentificationCodeSystemVersion/>
          <TherapeuticGoodIdentificationDisplayName/>
          ${el('AMT_CODE_SYSTEM', 'Australian Medicines Terminology (AMT)')}
          <QuantityExtended/>
          ${el('AMT_VERSION', 'http://snomed.info/sct/32506021000036107/version/20240331')}
          <PRIMARY_MEDICATION_CODE/>
          <RTACid/>
          ${el('PrescriberScriptNumber', i.scriptNumber || '')}
          ${el('PrivacyStatement', 'true')}
          ${el('EmergencySupply', i.isEmergencySupply ? 'true' : 'false')}
          ${i.annotations?.length ? `<Annotations>${i.annotations.map(a => `
            <Annotation>
              ${el('SupplyNumber', a.supplyNumber)}
              ${el('Value', a.value)}
            </Annotation>`).join('')}
          </Annotations>` : ''}
          ${/* ControlledSubstanceReference is REQUIRED per erx-schema30.0_ETP2.xsd
               (no minOccurs=0). minLength=0 means empty content is valid, so the
               builder always emits the element even when no reference is supplied.
               Omitting the element entirely fails XSD validation with
               "element UnusualDoseFlag: this element is not expected". */ ''}
          ${el('ControlledSubstanceReference', i.controlledSubstanceRef ?? '')}
          ${/* SNOMED-CTReasonforPrescribe is REQUIRED per the XSD and typed as
               xs:integer. The element must ALWAYS appear and must contain a
               valid integer; we default to 0 when no SNOMED code is supplied. */ ''}
          ${el('SNOMED-CTReasonforPrescribe', i.snomedReasonCode ?? 0)}
          ${el('UnusualDoseFlag', i.unusualDose ? 'true' : 'false')}
        </PrescribedItem>${tokenBlock}
      </Content>
    </Item>
  </Items>
</ePrescription>`;
}

/**
 * Token-only Electronic Evidence of Prescription (EoP) XML.
 *
 * BUG-P1: patient-facing EoP content must carry only token identifiers.
 */
export function buildTokenEoPXml(payload: ErxTokenEopPayload): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ePrescription xmlns="${ERX_NS}" xmlns:i="${XSI_NS}">
  ${el('SCID', payload.scid)}
  <TokenEoP>
    ${el('DSPID', payload.dspId ?? '')}
    ${el('Token', payload.token)}
  </TokenEoP>
</ePrescription>`;
}

// ── ERX001: Prescriber Create ───────────────────────────────────────────────

/** Build ERX001 XML — new prescription. POST /eprescriptions/{SCID}/$erx001 */
export function buildErx001Xml(payload: ErxPrescriptionPayload): string {
  return buildClinicalXml(payload, 'Active');
}

// ── ERX023: Prescriber Cancel ───────────────────────────────────────────────

/** Build ERX023 XML — cancel prescription (full payload with State=Cancelled). POST /eprescriptions/{SCID}/$erx023 */
export function buildErx023Xml(payload: ErxPrescriptionPayload): string {
  return buildClinicalXml(payload, 'Cancelled');
}

// ── ERX027: Prescriber Amend ────────────────────────────────────────────────

/** Build ERX027 XML — amend prescription (full payload with amended fields, State=Active). POST /eprescriptions/{SCID}/$erx027 */
export function buildErx027Xml(payload: ErxPrescriptionPayload): string {
  return buildClinicalXml(payload, 'Active');
}

// ── ERX019: Reactivate ──────────────────────────────────────────────────────

/** Build ERX019 XML — reactivate a cancelled prescription (full payload, State=Active, OriginalSequence set). POST /eprescriptions/{SCID}/$erx019 */
export function buildErx019Xml(payload: ErxPrescriptionPayload): string {
  return buildClinicalXml(payload, 'Active');
}

// ── ERX025: Checkout For Amend (Prescriber) ─────────────────────────────────

export interface ErxCheckoutPayload {
  scid: string;
  conformanceId: string;
}

/** Build ERX025 XML — lock prescription for prescriber amendment. POST /eprescriptions/{SCID}/$erx025 */
export function buildErx025Xml(payload: ErxCheckoutPayload): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ePrescription xmlns="${ERX_NS}" xmlns:i="${XSI_NS}">
  ${el('SCID', payload.scid)}
  <ETPIdentifiers>
    ${el('CreatorConformanceId', payload.conformanceId)}
  </ETPIdentifiers>
  <Items>
    <Item>
      ${el('Sequence', 1)}
    </Item>
  </Items>
</ePrescription>`;
}

// ── ERX061: Cease Latest ────────────────────────────────────────────────────

export interface ErxCeasePayload {
  scid: string;
  conformanceId: string;
}

/** Build ERX061 XML — cease the latest supply of a prescription. POST /eprescriptions/{SCID}/$erx061 */
export function buildErx061Xml(payload: ErxCeasePayload): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ePrescription xmlns="${ERX_NS}" xmlns:i="${XSI_NS}">
  ${el('SCID', payload.scid)}
  <ETPIdentifiers>
    ${el('CreatorConformanceId', payload.conformanceId)}
    <RepeatCreatorConformanceID/>
    <DispenserConformanceId/>
    ${el('EPresUniqueNumber', payload.scid)}
    ${el('Uri', `https://ausscripts.erx.com.au/scripts/${payload.scid}`)}
  </ETPIdentifiers>
  <Items>
    <Item>
      ${el('Sequence', 1)}
      ${el('State', 'Ceased')}
      <Content/>
    </Item>
  </Items>
</ePrescription>`;
}

// ── ERX065: Reissue Token (Prescriber) ──────────────────────────────────────

export interface ErxReissueTokenPayload {
  scid: string;
  conformanceId: string;
  tokenDelivery?: { sms?: string; email?: string };
}

/** Build ERX065 XML — reissue token (send new SMS/email). POST /eprescriptions/{SCID}/$erx065 */
export function buildErx065Xml(payload: ErxReissueTokenPayload): string {
  const td = payload.tokenDelivery;
  return `<?xml version="1.0" encoding="utf-8"?>
<ePrescription xmlns="${ERX_NS}" xmlns:i="${XSI_NS}">
  ${el('SCID', payload.scid)}
  <ETPIdentifiers>
    ${el('CreatorConformanceId', payload.conformanceId)}
    <RepeatCreatorConformanceID/>
    <DispenserConformanceId/>
    ${el('EPresUniqueNumber', payload.scid)}
    ${el('Uri', `https://ausscripts.erx.com.au/scripts/${payload.scid}`)}
  </ETPIdentifiers>
  <Items>
    <Item>
      ${el('Sequence', 1)}
      <Content>
        <TokenMetadata>
          <ElectronicAddresses>
            ${td?.sms ? `<ElectronicAddress><Type>sms</Type><Value>${esc(td.sms)}</Value></ElectronicAddress>` : ''}
            ${td?.email ? `<ElectronicAddress><Type>email</Type><Value>${esc(td.email)}</Value></ElectronicAddress>` : ''}
          </ElectronicAddresses>
        </TokenMetadata>
      </Content>
    </Item>
  </Items>
</ePrescription>`;
}

// ── Service Provider Registration Payload ────────────────────────────────────

export interface ServiceProviderPayload {
  name: string;           // Clinic/practice name
  providerNo: string;     // Prescriber number (maps to Identifier type="ProviderNo")
  ahpra?: string;         // AHPRA number (optional Identifier type="AHPRA")
  contactName: string;    // Prescriber's full name
  email: string;
  phone: string;
  fax?: string;
  addressLine1: string;
  city: string;
  state: string;
  country?: string;
  postCode: string;
}

export function buildServiceProviderXml(sp: ServiceProviderPayload): string {
  return `<ServiceProvider>
  ${el('Name', sp.name)}
  <Identifiers>
    <Identifier type="ProviderNo" value="${esc(sp.providerNo)}" />
    ${sp.ahpra ? `<Identifier type="AHPRA" value="${esc(sp.ahpra)}" />` : ''}
  </Identifiers>
  <Contact>
    ${el('Name', sp.contactName)}
    ${el('Email', sp.email)}
    ${el('Phone', sp.phone)}
    ${el('Fax', sp.fax || '')}
    ${el('AddressLine1', sp.addressLine1)}
    ${el('City', sp.city)}
    ${el('State', sp.state)}
    ${el('Country', sp.country || 'Australia')}
    ${el('PostCode', sp.postCode)}
  </Contact>
</ServiceProvider>`;
}
