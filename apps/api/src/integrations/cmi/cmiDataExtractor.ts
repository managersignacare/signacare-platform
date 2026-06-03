/**
 * CMI Data Extractor
 *
 * Extracts and maps Signacare EMR data into CMI-compatible format
 * for submission to Department of Health Victoria.
 */

import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import type {
  CmiEpisodeRecord, CmiServiceContact, CmiOutcomeMeasure,
  CmiEpisodeType, CmiSettingType, CmiLegalStatus, CmiContactType,
  CmiClinicianCategory,
} from './cmiTypes';

const ORG_CODE = process.env.CMI_ORG_CODE ?? 'SIGNACARE001';

interface LegalOrderLike {
  status?: string;
  order_type?: string;
}

// ── Episode Type Mapping ──
function mapEpisodeType(emrType: string): CmiEpisodeType {
  const map: Record<string, CmiEpisodeType> = {
    inpatient: 'inpatient', community: 'ambulatory', residential: 'residential',
    day_program: 'day_program', outpatient: 'ambulatory',
  };
  return map[emrType.toLowerCase()] ?? 'ambulatory';
}

function mapSettingType(team: string, episodeType: string): CmiSettingType {
  if (episodeType === 'inpatient') return 'acute_inpatient';
  const teamLower = team?.toLowerCase() ?? '';
  if (teamLower.includes('acis') || teamLower.includes('catt')) return 'mobile_support';
  if (teamLower.includes('parc')) return 'residential';
  if (teamLower.includes('ccu')) return 'sub_acute';
  return 'community_care';
}

function mapLegalStatus(orders: LegalOrderLike[]): CmiLegalStatus {
  const active = orders.find((order) => order.status === 'active');
  if (!active) return 'voluntary';
  const type = active.order_type?.toLowerCase() ?? '';
  if (type.includes('assessment')) return 'involuntary_assessment';
  if (type.includes('temporary')) return 'temporary_treatment';
  if (type.includes('treatment')) return 'involuntary_treatment';
  if (type.includes('court')) return 'court_order';
  return 'voluntary';
}

function mapClinicianCategory(role: string, discipline: string): CmiClinicianCategory {
  const r = (role ?? '').toLowerCase();
  const d = (discipline ?? '').toLowerCase();
  if (d.includes('psychiatrist') || r === 'psychiatrist') return 'psychiatrist';
  if (d.includes('registrar')) return 'registrar';
  if (d.includes('psycholog')) return 'psychologist';
  if (d.includes('social work')) return 'social_worker';
  if (d.includes('occupational')) return 'occupational_therapist';
  if (d.includes('nurse') || d.includes('rn') || d.includes('en')) return 'nurse';
  if (d.includes('peer')) return 'peer_worker';
  if (d.includes('gp')) return 'gp';
  return 'other';
}

// ── Extract Episodes ──

export async function extractEpisodes(clinicId: string, dateFrom: string, dateTo: string): Promise<CmiEpisodeRecord[]> {
  const episodes = await db('episodes')
    .where({ clinic_id: clinicId })
    .where(function () {
      this.whereBetween('start_date', [dateFrom, dateTo])
        .orWhereBetween('end_date', [dateFrom, dateTo])
        .orWhere(function () { this.where('start_date', '<=', dateTo).where(function () { this.whereNull('end_date').orWhere('end_date', '>=', dateFrom); }); });
    })
    .join('patients', 'episodes.patient_id', 'patients.id')
    .select('episodes.*', 'patients.emr_number');

  const records: CmiEpisodeRecord[] = [];
  for (const ep of episodes) {
    // Get legal orders for this patient during the episode
    const legalOrders = await db('patient_legal_orders')
      .where({ patient_id: ep.patient_id })
      .whereIn('status', ['active', 'expired'])
      .leftJoin('legal_order_type_configs', 'patient_legal_orders.order_type_id', 'legal_order_type_configs.id')
      .select('patient_legal_orders.*', 'legal_order_type_configs.name as order_type');

    records.push({
      orgCode: ORG_CODE,
      clientId: ep.emr_number,
      episodeId: ep.id,
      episodeType: mapEpisodeType(ep.episode_type),
      settingType: mapSettingType(ep.team, ep.episode_type),
      startDate: ep.start_date,
      endDate: ep.end_date ?? undefined,
      principalDiagnosis: ep.icd10_code ?? 'F99',
      mentalHealthLegalStatus: mapLegalStatus(legalOrders),
      referralSource: ep.stream ?? 'community',
      teamCode: ep.team ?? 'UNKNOWN',
    });
  }
  return records;
}

// ── Extract Service Contacts ──

export async function extractServiceContacts(clinicId: string, dateFrom: string, dateTo: string): Promise<CmiServiceContact[]> {
  const notes = await db('clinical_notes')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .whereBetween('note_date', [dateFrom, dateTo])
    .leftJoin('staff', 'clinical_notes.author_id', 'staff.id')
    .select('clinical_notes.*', 'staff.role as staff_role', 'staff.discipline_id');

  // Also get appointments as contacts
  const appointments = await db('appointments')
    .where({ clinic_id: clinicId })
    .whereBetween('appointment_start', [dateFrom + 'T00:00:00', dateTo + 'T23:59:59'])
    .whereIn('status', ['completed', 'checked_in'])
    .leftJoin('staff', 'appointments.clinician_id', 'staff.id')
    .select('appointments.*', 'staff.role as staff_role', 'staff.discipline_id');

  const contacts: CmiServiceContact[] = [];

  for (const note of notes) {
    const cat = (note.note_category ?? '').toLowerCase();
    let contactType: CmiContactType = 'review';
    if (cat.includes('assessment') || cat.includes('intake')) contactType = 'assessment';
    else if (cat.includes('therapy') || cat.includes('psychology')) contactType = 'therapy_individual';
    else if (cat.includes('medication') || cat.includes('lai') || cat.includes('clozapine')) contactType = 'medication_management';
    else if (cat.includes('crisis') || cat.includes('acis')) contactType = 'crisis_intervention';
    else if (cat.includes('family') || cat.includes('carer')) contactType = 'family_carer';

    contacts.push({
      orgCode: ORG_CODE,
      clientId: note.patient_id,
      contactDate: note.note_date,
      contactType,
      duration: 30, // Default — in production, derive from appointment duration
      participationType: 'individual',
      clinicianCategory: mapClinicianCategory(note.staff_role, note.discipline_id),
      serviceContactModality: 'face_to_face',
      didNotAttend: false,
      teamCode: 'DEFAULT',
    });
  }

  for (const appt of appointments) {
    contacts.push({
      orgCode: ORG_CODE,
      clientId: appt.patient_id,
      contactDate: new Date(appt.appointment_start).toISOString().split('T')[0],
      contactType: appt.appointment_type?.toLowerCase().includes('telehealth') ? 'telehealth' : 'review',
      duration: appt.duration_mins ?? 30,
      participationType: 'individual',
      clinicianCategory: mapClinicianCategory(appt.staff_role, appt.discipline_id),
      serviceContactModality: appt.telehealth ? 'video_telehealth' : 'face_to_face',
      didNotAttend: appt.status === 'no_show',
      teamCode: 'DEFAULT',
    });
  }

  return contacts;
}

// ── Extract Outcome Measures ──

export async function extractOutcomeMeasures(clinicId: string, dateFrom: string, dateTo: string): Promise<CmiOutcomeMeasure[]> {
  // Look for HoNOS / K10+ data in assessment_responses or structured_fields in notes
  const assessments = await db('assessment_responses')
    .where({ clinic_id: clinicId })
    .whereBetween('created_at', [dateFrom, dateTo + 'T23:59:59'])
    .leftJoin('assessment_templates', 'assessment_responses.template_id', 'assessment_templates.id')
    .select('assessment_responses.*', 'assessment_templates.name as template_name')
    .catch((err) => { logger.warn({ err, clinicId, dateFrom, dateTo }, 'CMI extractor: assessment_responses query failed — degraded to []'); return []; });

  const measures: CmiOutcomeMeasure[] = [];
  type MeasureType = 'honos' | 'honos_65plus' | 'honosca' | 'k10plus' | 'lsp16' | 'basis32';
  for (const a of assessments) {
    const name = (a.template_name ?? '').toLowerCase();
    let measureType: MeasureType | null = null;
    if (name.includes('honos')) measureType = name.includes('65') ? 'honos_65plus' : name.includes('ca') ? 'honosca' : 'honos';
    else if (name.includes('k10') || name.includes('kessler')) measureType = 'k10plus';
    else if (name.includes('lsp')) measureType = 'lsp16';
    else if (name.includes('basis')) measureType = 'basis32';

    if (measureType) {
      measures.push({
        orgCode: ORG_CODE,
        clientId: a.patient_id,
        episodeId: a.episode_id ?? '',
        collectionOccasion: 'review',
        collectionDate: new Date(a.created_at).toISOString().split('T')[0],
        measureType,
        scores: typeof a.responses === 'string' ? JSON.parse(a.responses) : a.responses ?? {},
        raterType: 'clinician',
      });
    }
  }
  return measures;
}
