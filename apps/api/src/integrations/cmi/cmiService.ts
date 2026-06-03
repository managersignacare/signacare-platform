/**
 * CMI Submission Service
 *
 * Handles data validation, packaging, and submission to
 * Department of Health Victoria's CMI system.
 *
 * Submission modes:
 * - API (when CMI_API_URL is configured)
 * - File export (CSV/XML for manual upload)
 * - Test mode (validates without submitting)
 */

import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { extractEpisodes, extractServiceContacts, extractOutcomeMeasures } from './cmiDataExtractor';
import type { CmiSubmissionPayload, CmiSubmissionResult, CmiEpisodeRecord, CmiServiceContact, CmiOutcomeMeasure } from './cmiTypes';

const CMI_API_URL = process.env.CMI_API_URL;
const CMI_ORG_CODE = process.env.CMI_ORG_CODE ?? 'SIGNACARE001';
const CMI_API_KEY = process.env.CMI_API_KEY;
const CMI_MODE = process.env.CMI_SUBMISSION_MODE ?? 'test';

export function isCmiConfigured(): boolean {
  return !!(CMI_API_URL && CMI_API_KEY);
}

// ── Validation ──

interface ValidationError { recordType: string; field: string; message: string }

function validateEpisode(ep: CmiEpisodeRecord, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!ep.clientId) errors.push({ recordType: 'episode', field: `[${idx}].clientId`, message: 'Client ID (UR) required' });
  if (!ep.startDate) errors.push({ recordType: 'episode', field: `[${idx}].startDate`, message: 'Start date required' });
  if (!ep.principalDiagnosis || ep.principalDiagnosis === 'F99') errors.push({ recordType: 'episode', field: `[${idx}].principalDiagnosis`, message: 'ICD-10 diagnosis required (F99 = unspecified)' });
  if (!ep.teamCode || ep.teamCode === 'UNKNOWN') errors.push({ recordType: 'episode', field: `[${idx}].teamCode`, message: 'Team code required' });
  return errors;
}

function validateContact(c: CmiServiceContact, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!c.clientId) errors.push({ recordType: 'contact', field: `[${idx}].clientId`, message: 'Client ID required' });
  if (!c.contactDate) errors.push({ recordType: 'contact', field: `[${idx}].contactDate`, message: 'Contact date required' });
  if (c.duration <= 0) errors.push({ recordType: 'contact', field: `[${idx}].duration`, message: 'Duration must be > 0' });
  return errors;
}

function validateMeasure(m: CmiOutcomeMeasure, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!m.clientId) errors.push({ recordType: 'outcome', field: `[${idx}].clientId`, message: 'Client ID required' });
  if (!m.collectionDate) errors.push({ recordType: 'outcome', field: `[${idx}].collectionDate`, message: 'Collection date required' });
  if (!m.measureType) errors.push({ recordType: 'outcome', field: `[${idx}].measureType`, message: 'Measure type required' });
  // HoNOS validation: all 12 items should be 0-4
  if (m.measureType === 'honos') {
    const vals = Object.values(m.scores);
    if (vals.length < 12) errors.push({ recordType: 'outcome', field: `[${idx}].scores`, message: 'HoNOS requires 12 items' });
    if (vals.some(v => v < 0 || v > 4)) errors.push({ recordType: 'outcome', field: `[${idx}].scores`, message: 'HoNOS scores must be 0-4' });
  }
  return errors;
}

// ── Submission ──

export async function prepareCmiSubmission(
  clinicId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ payload: CmiSubmissionPayload; validation: { errors: ValidationError[]; warnings: string[] } }> {
  const episodes = await extractEpisodes(clinicId, dateFrom, dateTo);
  const contacts = await extractServiceContacts(clinicId, dateFrom, dateTo);
  const outcomes = await extractOutcomeMeasures(clinicId, dateFrom, dateTo);

  const payload: CmiSubmissionPayload = {
    orgCode: CMI_ORG_CODE,
    submissionPeriod: `${dateFrom} to ${dateTo}`,
    submissionType: 'full',
    episodes,
    contacts,
    outcomes,
    seclusionRestraint: [], // Would be extracted from a dedicated table
  };

  const errors: ValidationError[] = [];
  episodes.forEach((ep, i) => errors.push(...validateEpisode(ep, i)));
  contacts.forEach((c, i) => errors.push(...validateContact(c, i)));
  outcomes.forEach((m, i) => errors.push(...validateMeasure(m, i)));

  const warnings: string[] = [];
  if (!outcomes.length) warnings.push('No outcome measures found for this period. NOCC requires HoNOS at admission, 91-day review, and discharge.');
  const episodesWithoutDx = episodes.filter(e => e.principalDiagnosis === 'F99');
  if (episodesWithoutDx.length) warnings.push(`${episodesWithoutDx.length} episodes have unspecified diagnosis (F99).`);

  return { payload, validation: { errors, warnings } };
}

export async function submitToCmi(
  clinicId: string,
  actorId: string,
  payload: CmiSubmissionPayload,
): Promise<CmiSubmissionResult> {
  await writeAuditLog({
    actorId, clinicId, action: 'CREATE', tableName: 'cmi_submissions',
    recordId: clinicId,
    newData: {
      period: payload.submissionPeriod,
      episodes: payload.episodes.length,
      contacts: payload.contacts.length,
      outcomes: payload.outcomes.length,
      mode: CMI_MODE,
    },
  });

  if (!isCmiConfigured()) {
    logger.info('[CMI] Not configured — returning validation-only result');
    return {
      success: false,
      recordsAccepted: 0,
      recordsRejected: 0,
      validationErrors: [{ recordType: 'system', field: 'config', message: 'CMI not configured. Set CMI_API_URL and CMI_API_KEY.' }],
      timestamp: new Date().toISOString(),
    };
  }

  if (CMI_MODE === 'test') {
    logger.info({ records: payload.episodes.length + payload.contacts.length }, '[CMI] Test mode — data validated but not submitted');
    return {
      success: true,
      submissionId: `TEST-${Date.now()}`,
      recordsAccepted: payload.episodes.length + payload.contacts.length + payload.outcomes.length,
      recordsRejected: 0,
      validationErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Production submission
  try {
    const resp = await fetch(`${CMI_API_URL}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CMI_API_KEY}`,
        'X-Org-Code': CMI_ORG_CODE,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        success: false,
        recordsAccepted: 0,
        recordsRejected: payload.episodes.length + payload.contacts.length,
        validationErrors: [{ recordType: 'system', field: 'api', message: `CMI API ${resp.status}: ${errText.substring(0, 200)}` }],
        timestamp: new Date().toISOString(),
      };
    }

    // CMI submission response shape — fields are optional because the
    // upstream API returns different field names across deployments.
    interface CmiSubmissionResponse {
      submissionId?: string;
      id?: string;
      accepted?: number;
      rejected?: number;
      errors?: Array<{ recordType: string; field: string; message: string }>;
    }
    const result = await resp.json() as CmiSubmissionResponse;
    return {
      success: true,
      submissionId: result.submissionId ?? result.id,
      recordsAccepted: result.accepted ?? (payload.episodes.length + payload.contacts.length),
      recordsRejected: result.rejected ?? 0,
      validationErrors: result.errors ?? [],
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      recordsAccepted: 0,
      recordsRejected: 0,
      validationErrors: [{ recordType: 'system', field: 'network', message: err instanceof Error ? err.message : String(err) }],
      timestamp: new Date().toISOString(),
    };
  }
}

// ── CSV Export (for manual upload to CMI portal) ──

export function exportEpisodesToCsv(episodes: CmiEpisodeRecord[]): string {
  const header = 'OrgCode,ClientID,EpisodeID,EpisodeType,SettingType,StartDate,EndDate,PrincipalDiagnosis,LegalStatus,TeamCode';
  const rows = episodes.map(e =>
    `${e.orgCode},${e.clientId},${e.episodeId},${e.episodeType},${e.settingType},${e.startDate},${e.endDate ?? ''},${e.principalDiagnosis},${e.mentalHealthLegalStatus},${e.teamCode}`
  );
  return [header, ...rows].join('\n');
}

export function exportContactsToCsv(contacts: CmiServiceContact[]): string {
  const header = 'OrgCode,ClientID,ContactDate,ContactType,Duration,ParticipationType,ClinicianCategory,Modality,DNA,TeamCode';
  const rows = contacts.map(c =>
    `${c.orgCode},${c.clientId},${c.contactDate},${c.contactType},${c.duration},${c.participationType},${c.clinicianCategory},${c.serviceContactModality},${c.didNotAttend ? 'Y' : 'N'},${c.teamCode}`
  );
  return [header, ...rows].join('\n');
}

export function exportOutcomesToCsv(outcomes: CmiOutcomeMeasure[]): string {
  const header = 'OrgCode,ClientID,EpisodeID,CollectionOccasion,CollectionDate,MeasureType,TotalScore,RaterType';
  const rows = outcomes.map(m =>
    `${m.orgCode},${m.clientId},${m.episodeId},${m.collectionOccasion},${m.collectionDate},${m.measureType},${m.totalScore ?? ''},${m.raterType}`
  );
  return [header, ...rows].join('\n');
}
