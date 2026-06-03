/**
 * MySL (My Script List / Active Script Registry) Client
 *
 * Implements the MySL consent and registration flows per the
 * Medication Knowledge FHIR API specification:
 *
 * - GET  [base]/Patient?identifier={IHI}  — check if patient is registered
 * - POST [base]/Consent                    — create consent for site
 * - GET  [base]/MedicationRequest?patient={id} — retrieve active scripts
 *
 * Authentication: Bearer token from MK Identity Server (OAuth2).
 * See: MySL Security Model — Site Authentication Sequence Diagram.
 */

import { logger } from '../../utils/logger';

// FHIR R4 resource shapes used by the MySL API.
// Only fields we actually read are typed; everything else is omitted.
interface MySLFhirResource {
  resourceType?: string;
  id?: string;
  status?: string;
}
interface MySLMedicationRequest extends MySLFhirResource {
  medicationCodeableConcept?: {
    text?: string;
    coding?: Array<{ display?: string }>;
  };
  dosageInstruction?: Array<{ text?: string }>;
  requester?: { display?: string; reference?: string };
  authoredOn?: string;
}
interface MySLBundleEntry {
  resource?: MySLFhirResource | MySLMedicationRequest;
}
interface MySLBundle {
  entry?: MySLBundleEntry[];
  total?: number;
}
interface MySLConsentResponse extends MySLFhirResource {}

const MYSL_API_URL = process.env.MYSL_API_URL ?? '';
const MYSL_CLIENT_ID = process.env.MYSL_CLIENT_ID ?? '';
const MYSL_CLIENT_SECRET = process.env.MYSL_CLIENT_SECRET ?? '';
const MYSL_TOKEN_URL = process.env.MYSL_TOKEN_URL ?? '';

export function isMyslConfigured(): boolean {
  return !!MYSL_API_URL && !!MYSL_CLIENT_ID && !!MYSL_CLIENT_SECRET && !!MYSL_TOKEN_URL;
}

// ── OAuth2 Token Cache ────────────────────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function isMySLConfigured(): boolean {
  return !!(MYSL_API_URL && MYSL_CLIENT_ID && MYSL_TOKEN_URL);
}

async function getBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.accessToken;

  const res = await fetch(MYSL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: MYSL_CLIENT_ID,
      client_secret: MYSL_CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`MySL token request failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

// ── MySL Status Types ─────────────────────────────────────────────────────────

/** MySL button colour per the consent flow diagrams */
export type MySLStatus = 'red' | 'amber' | 'green';

export interface MySLPatientStatus {
  status: MySLStatus;
  registered: boolean;
  consentGranted: boolean;
  patientFhirId?: string;
  error?: string;
}

export interface MySLScript {
  resourceType: string;
  id: string;
  status: string;
  medicationName: string;
  dose?: string;
  prescriber?: string;
  authoredOn?: string;
}

export interface MySLMedicationSyncInput {
  patientIhi: string;
  prescriptionId: string;
  medicationRequestResource: unknown;
  status?: 'active' | 'cancelled';
  npdsReference?: string | null;
  erxToken?: string | null;
}

export interface MySLMedicationSyncResult {
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  medicationRequestId?: string;
  patientFhirId?: string;
  reason?: string;
  error?: string;
}

const SIGNACARE_PRESCRIPTION_IDENTIFIER_SYSTEM = 'http://signacare.local/fhir/identifier/prescription-id';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function appendUniqueIdentifier(
  identifiers: unknown,
  entry: { system: string; value: string },
): Array<Record<string, string>> {
  const base = Array.isArray(identifiers)
    ? identifiers.filter((item): item is Record<string, string> =>
      !!item
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof (item as { system?: unknown }).system === 'string'
      && typeof (item as { value?: unknown }).value === 'string',
    )
    : [];
  const hasEntry = base.some((item) => item.system === entry.system && item.value === entry.value);
  if (!hasEntry) base.push(entry);
  return base;
}

async function findExistingMedicationRequestId(
  patientFhirId: string,
  prescriptionId: string,
  token: string,
): Promise<string | null> {
  const searchIdentifier = `${SIGNACARE_PRESCRIPTION_IDENTIFIER_SYSTEM}|${prescriptionId}`;
  const lookupUrl = `${MYSL_API_URL}/MedicationRequest?patient=${encodeURIComponent(patientFhirId)}&identifier=${encodeURIComponent(searchIdentifier)}`;
  const lookupRes = await fetch(lookupUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' },
  });
  if (!lookupRes.ok) return null;
  const bundle = await lookupRes.json() as MySLBundle;
  const existing = (bundle.entry ?? [])
    .map((entry) => asRecord(entry.resource))
    .find((resource) => resource?.resourceType === 'MedicationRequest' && typeof resource?.id === 'string');
  return typeof existing?.id === 'string' ? existing.id : null;
}

function normalizeMedicationRequestResource(
  resource: unknown,
  patientFhirId: string,
  prescriptionId: string,
  status: 'active' | 'cancelled',
  npdsReference?: string | null,
  erxToken?: string | null,
): Record<string, unknown> {
  const parsed = asRecord(resource);
  const normalized: Record<string, unknown> = parsed ? { ...parsed } : {};
  normalized.resourceType = 'MedicationRequest';
  normalized.status = status;
  normalized.intent = typeof normalized.intent === 'string' ? normalized.intent : 'order';
  normalized.subject = { reference: `Patient/${patientFhirId}` };
  normalized.identifier = appendUniqueIdentifier(
    normalized.identifier,
    { system: SIGNACARE_PRESCRIPTION_IDENTIFIER_SYSTEM, value: prescriptionId },
  );
  const existingExtensions = Array.isArray(normalized.extension)
    ? normalized.extension.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
  if (npdsReference) {
    existingExtensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/npds-reference',
      valueString: npdsReference,
    });
  }
  if (erxToken) {
    existingExtensions.push({
      url: 'http://signacare.local/fhir/StructureDefinition/erx-token',
      valueString: erxToken,
    });
  }
  normalized.extension = existingExtensions;
  return normalized;
}

// ── API Operations ────────────────────────────────────────────────────────────

/**
 * Check patient registration and consent status on MySL.
 *
 * Flow (from Consent Flow diagrams):
 * 1. GET /Patient?identifier={IHI}&_revinclude=Consent:patient
 * 2. If no Patient resource → RED (not registered)
 * 3. If Patient exists but no Consent for our org → AMBER (registered, no consent)
 * 4. If Patient exists and Consent exists for org → GREEN (ready to view)
 */
export async function checkPatientMySLStatus(patientIhi: string): Promise<MySLPatientStatus> {
  if (!isMySLConfigured()) {
    return { status: 'red', registered: false, consentGranted: false, error: 'MySL not configured.' };
  }

  try {
    const token = await getBearerToken();
    const ihiUri = `http://ns.electronichealth.net.au/id/hi/ihi/1.0|${patientIhi}`;
    const url = `${MYSL_API_URL}/Patient?identifier=${encodeURIComponent(ihiUri)}&_revinclude=Consent:patient`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' },
    });

    if (!res.ok) {
      return { status: 'red', registered: false, consentGranted: false, error: `MySL ${res.status}` };
    }

    const bundle = await res.json() as MySLBundle;
    const entries = bundle.entry ?? [];

    // Find Patient resource
    const patientEntry = entries.find((e) => e.resource?.resourceType === 'Patient');
    if (!patientEntry) {
      // RED — patient not registered on MySL
      return { status: 'red', registered: false, consentGranted: false };
    }

    const patientFhirId = patientEntry.resource?.id;

    // Find Consent resource for our organisation
    const consentEntry = entries.find((e) => e.resource?.resourceType === 'Consent');
    if (!consentEntry) {
      // AMBER — patient registered but no consent for this site
      return { status: 'amber', registered: true, consentGranted: false, patientFhirId };
    }

    // GREEN — patient registered and consent granted
    return { status: 'green', registered: true, consentGranted: true, patientFhirId };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message }, '[MySL] Status check failed');
    return { status: 'red', registered: false, consentGranted: false, error: message };
  }
}

/**
 * Request consent from patient for this site to view their MySL.
 * Creates a Consent resource with status "proposed".
 * MySL will then send SMS/email to the patient for approval.
 */
export async function requestConsent(patientFhirId: string): Promise<{ success: boolean; consentId?: string; error?: string }> {
  if (!isMySLConfigured()) {
    return { success: false, error: 'MySL not configured.' };
  }

  try {
    const token = await getBearerToken();
    const consentResource = {
      resourceType: 'Consent',
      status: 'proposed',
      scope: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }],
      },
      category: [{
        coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Consent Document' }],
      }],
      patient: { reference: `Patient/${patientFhirId}` },
    };

    const res = await fetch(`${MYSL_API_URL}/Consent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
      },
      body: JSON.stringify(consentResource),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `MySL Consent ${res.status}: ${errText.substring(0, 200)}` };
    }

    const result = await res.json() as MySLConsentResponse;
    logger.info({ consentId: result.id, patientFhirId }, '[MySL] Consent request created');
    return { success: true, consentId: result.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Retrieve the patient's active scripts from MySL.
 * Requires GREEN status (consent granted).
 */
export async function getActiveScripts(patientFhirId: string): Promise<{ success: boolean; scripts?: MySLScript[]; error?: string }> {
  if (!isMySLConfigured()) {
    return { success: false, error: 'MySL not configured.' };
  }

  try {
    const token = await getBearerToken();
    const res = await fetch(`${MYSL_API_URL}/MedicationRequest?patient=${patientFhirId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' },
    });

    if (!res.ok) {
      return { success: false, error: `MySL ${res.status}` };
    }

    const bundle = await res.json() as MySLBundle;
    const scripts: MySLScript[] = (bundle.entry ?? [])
      .map((e) => e.resource as MySLMedicationRequest | undefined)
      .filter((r): r is MySLMedicationRequest => !!r && r.resourceType === 'MedicationRequest')
      .map((r) => ({
        resourceType: r.resourceType ?? 'MedicationRequest',
        id: r.id ?? '',
        status: r.status ?? '',
        medicationName: r.medicationCodeableConcept?.text ?? r.medicationCodeableConcept?.coding?.[0]?.display ?? 'Unknown',
        dose: r.dosageInstruction?.[0]?.text,
        prescriber: r.requester?.display,
        authoredOn: r.authoredOn,
      }));

    return { success: true, scripts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Sync a submitted/cancelled prescription into MySL so ASLR is not read-only.
 * This is best-effort and never throws into the prescribing path.
 */
export async function syncMedicationRequestFromPrescription(
  input: MySLMedicationSyncInput,
): Promise<MySLMedicationSyncResult> {
  if (!isMySLConfigured()) {
    return { success: false, action: 'skipped', reason: 'mysl_not_configured' };
  }

  try {
    const patientStatus = await checkPatientMySLStatus(input.patientIhi);
    if (!patientStatus.registered) {
      return { success: false, action: 'skipped', reason: 'patient_not_registered' };
    }
    if (!patientStatus.consentGranted) {
      return { success: false, action: 'skipped', reason: 'consent_not_granted' };
    }
    if (!patientStatus.patientFhirId) {
      return { success: false, action: 'skipped', reason: 'missing_patient_fhir_id' };
    }

    const token = await getBearerToken();
    const existingId = await findExistingMedicationRequestId(patientStatus.patientFhirId, input.prescriptionId, token);
    const normalizedResource = normalizeMedicationRequestResource(
      input.medicationRequestResource,
      patientStatus.patientFhirId,
      input.prescriptionId,
      input.status ?? 'active',
      input.npdsReference ?? null,
      input.erxToken ?? null,
    );

    const method = existingId ? 'PUT' : 'POST';
    const endpoint = existingId
      ? `${MYSL_API_URL}/MedicationRequest/${existingId}`
      : `${MYSL_API_URL}/MedicationRequest`;

    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
      },
      body: JSON.stringify(normalizedResource),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        success: false,
        action: 'skipped',
        reason: 'write_failed',
        error: `MySL MedicationRequest ${res.status}: ${body.substring(0, 240)}`,
        patientFhirId: patientStatus.patientFhirId,
      };
    }

    const out = await res.json() as MySLFhirResource;
    const medicationRequestId = out.id ?? existingId ?? undefined;
    return {
      success: true,
      action: existingId ? 'updated' : 'created',
      medicationRequestId,
      patientFhirId: patientStatus.patientFhirId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message, prescriptionId: input.prescriptionId }, '[MySL] MedicationRequest sync failed');
    return {
      success: false,
      action: 'skipped',
      reason: 'exception',
      error: message,
    };
  }
}
