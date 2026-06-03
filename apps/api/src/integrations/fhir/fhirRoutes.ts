/**
 * FHIR R4 Compatible API Endpoints
 *
 * Provides HL7 FHIR R4 formatted responses for interoperability
 * with other healthcare systems, HIEs, and My Health Record.
 *
 * Endpoints:
 *   GET /api/v1/fhir/Patient/:id
 *   GET /api/v1/fhir/Patient?family=:name
 *   GET /api/v1/fhir/Condition?patient=:id
 *   GET /api/v1/fhir/MedicationStatement?patient=:id
 *   GET /api/v1/fhir/AllergyIntolerance?patient=:id
 *   GET /api/v1/fhir/metadata (CapabilityStatement)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { AppError } from '../../shared/errors';
import { config } from '../../config/config';
import { authMiddleware } from '../../middleware/authMiddleware';

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// patients has 40+ columns so we return only the fields the FHIR
// Patient response needs to round-trip.
const PATIENT_FHIR_RETURN_COLUMNS = [
  'id', 'clinic_id', 'given_name', 'family_name', 'date_of_birth',
  'gender', 'email_primary', 'phone_mobile', 'ihi_number',
  'created_at', 'updated_at',
] as const;
const NURSING_ASSESSMENT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'staff_id',
  'assessment_type', 'scores', 'assessment_data', 'total_score',
  'risk_level', 'notes', 'plan', 'assessed_at',
  'created_at', 'updated_at',
] as const;
const FHIR_BULK_EXPORT_JOB_COLUMNS = [
  'id', 'clinic_id', 'requested_by_staff_id', 'types', 'since',
  'request_url', 'group_id', 'status', 'error_text', 'output_files',
  'total_resources', 'exported_resources',
  'started_at', 'finished_at', 'created_at',
] as const;
type PatientFhirSource = {
  id: string;
  status?: string | null;
  emr_number?: string | null;
  medicare_number?: string | null;
  ihi_number?: string | null;
  dva_number?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  preferred_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | Date | null;
  phone_mobile?: string | null;
  phone_home?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  interpreter_required?: boolean | null;
  interpreter_language?: string | null;
  indigenous_status?: string | null;
  atsi_status?: string | null;
};
const router = Router();

// FHIR CapabilityStatement — moved to server.ts for public access
/* router.get('/metadata', (_req: Request, res: Response) => {
  res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'Signacare PTY Ltd',
    software: { name: 'Signacare EMR', version: '1.0.0' },
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [{
      mode: 'server',
      resource: [
        { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }] },
        { type: 'Condition', interaction: [{ code: 'search-type' }] },
        { type: 'MedicationStatement', interaction: [{ code: 'search-type' }] },
        { type: 'AllergyIntolerance', interaction: [{ code: 'search-type' }] },
      ],
    }],
  });
});

*/ // All endpoints below require authentication — use per-route middleware
// (router.use would apply to /metadata retroactively)

// FHIR Patient resource
router.get('/Patient/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patient = await db('patients').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!patient) { res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] }); return; }
    res.json(patientToFhir(patient));
  } catch (err) { next(err); }
});

// FHIR Patient search
router.get('/Patient', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = db('patients').where({ clinic_id: req.clinicId }).whereNull('deleted_at').limit(50);
    if (req.query.family) q.whereILike('family_name', `%${req.query.family}%`);
    if (req.query.given) q.whereILike('given_name', `%${req.query.given}%`);
    if (req.query.identifier) q.where('emr_number', req.query.identifier);
    const patients = await q;
    res.json({
      resourceType: 'Bundle', type: 'searchset', total: patients.length,
      entry: patients.map((p) => ({ resource: patientToFhir(p) })),
    });
  } catch (err) { next(err); }
});

// FHIR Condition (diagnoses)
router.get('/Condition', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.query.patient as string;
    if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
    const diagnoses = await db('diagnoses')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .limit(500); // BUG-437 — fhir-ceiling per-patient list
    res.json({
      resourceType: 'Bundle', type: 'searchset', total: diagnoses.length,
      entry: diagnoses.map((d) => ({
        resource: {
          resourceType: 'Condition',
          id: d.id,
          clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: d.status || 'active' }] },
          code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-am', code: d.icd_code, display: d.description }] },
          subject: { reference: `Patient/${d.patient_id}` },
          onsetDateTime: d.diagnosed_date,
          recordedDate: d.created_at,
        },
      })),
    });
  } catch (err) { next(err); }
});

// FHIR MedicationStatement
router.get('/MedicationStatement', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.query.patient as string;
    if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
    const meds = await db('patient_medications')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .limit(500); // BUG-437 — fhir-ceiling per-patient list
    res.json({
      resourceType: 'Bundle', type: 'searchset', total: meds.length,
      entry: meds.map((m) => ({
        resource: {
          resourceType: 'MedicationStatement',
          id: m.id,
          status: m.status === 'active' ? 'active' : 'stopped',
          medicationCodeableConcept: { text: m.medication_name || m.generic_name },
          subject: { reference: `Patient/${m.patient_id}` },
          dosage: [{ text: `${m.dose || ''} ${m.frequency || ''}`.trim(), route: { text: m.route } }],
          effectivePeriod: { start: m.start_date, end: m.end_date },
        },
      })),
    });
  } catch (err) { next(err); }
});

// FHIR AllergyIntolerance
router.get('/AllergyIntolerance', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.query.patient as string;
    if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
    const allergies = await db('patient_allergies')
      .where({ patient_id: patientId })
      .whereNull('deleted_at')
      .limit(500); // BUG-437 — fhir-ceiling per-patient list
    res.json({
      resourceType: 'Bundle', type: 'searchset', total: allergies.length,
      entry: allergies.map((a) => ({
        resource: {
          resourceType: 'AllergyIntolerance',
          id: a.id,
          clinicalStatus: { coding: [{ code: a.status || 'active' }] },
          type: a.type === 'drug' ? 'allergy' : 'intolerance',
          category: [a.type === 'drug' ? 'medication' : a.type === 'food' ? 'food' : 'environment'],
          criticality: a.severity === 'life-threatening' ? 'high' : a.severity === 'severe' ? 'high' : 'low',
          code: { text: a.allergen },
          patient: { reference: `Patient/${a.patient_id}` },
          reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }] }] : [],
        },
      })),
    });
  } catch (err) { next(err); }
});

function patientToFhir(p: PatientFhirSource) {
  return {
    resourceType: 'Patient',
    id: p.id,
    identifier: [
      ...(p.emr_number ? [{ system: 'http://signacare.net/fhir/emr-number', value: p.emr_number }] : []),
      ...(p.medicare_number ? [{ system: 'http://ns.electronichealth.net.au/id/medicare-number', value: p.medicare_number }] : []),
      ...(p.ihi_number ? [{ system: 'http://ns.electronichealth.net.au/id/hi/ihi/1.0', value: p.ihi_number }] : []),
      ...(p.dva_number ? [{ system: 'http://ns.electronichealth.net.au/id/dva', value: p.dva_number }] : []),
    ],
    active: p.status === 'active',
    name: [{
      use: 'official',
      family: p.family_name,
      given: [p.given_name],
      ...(p.preferred_name ? { text: p.preferred_name } : {}),
    }],
    gender: p.gender === 'male' ? 'male' : p.gender === 'female' ? 'female' : 'other',
    birthDate: typeof p.date_of_birth === 'string' ? p.date_of_birth : p.date_of_birth?.toISOString?.()?.split('T')[0],
    telecom: [
      ...(p.phone_mobile ? [{ system: 'phone', value: p.phone_mobile, use: 'mobile' }] : []),
      ...(p.phone_home ? [{ system: 'phone', value: p.phone_home, use: 'home' }] : []),
      ...(p.email ? [{ system: 'email', value: p.email }] : []),
    ],
    address: p.address_line1 ? [{
      line: [p.address_line1, p.address_line2].filter(Boolean),
      city: p.suburb,
      state: p.state,
      postalCode: p.postcode,
      country: p.country || 'AU',
    }] : [],
    communication: p.interpreter_required ? [{
      language: { text: p.interpreter_language },
      preferred: true,
    }] : [],
    extension: [
      ...(p.indigenous_status || p.atsi_status ? [{
        url: 'http://hl7.org.au/fhir/StructureDefinition/indigenous-status',
        valueCoding: { display: p.indigenous_status || p.atsi_status },
      }] : []),
    ],
  };
}

// ── FHIR Encounter (from episodes) ──
router.get('/Encounter', authMiddleware, async (req: Request, res: Response, _next: NextFunction) => {
  const patientId = req.query.patient as string;
  if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
  const episodes = await db('episodes')
    .where({ patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('start_date', 'desc')
    .limit(500); // BUG-437 — fhir-ceiling per-patient list
  res.json({
    resourceType: 'Bundle', type: 'searchset', total: episodes.length,
    entry: episodes.map((e) => ({
      resource: {
        resourceType: 'Encounter', id: e.id, status: e.status === 'open' ? 'in-progress' : 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: e.episode_type === 'inpatient' ? 'IMP' : 'AMB' },
        subject: { reference: `Patient/${e.patient_id}` },
        period: { start: e.start_date, end: e.end_date || undefined },
        type: [{ text: e.episode_type }],
      },
    })),
  });
});

// ── FHIR Observation (from nursing_assessments + structured_observations) ──
router.get('/Observation', authMiddleware, async (req: Request, res: Response, _next: NextFunction) => {
  const patientId = req.query.patient as string;
  if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
  const obs = await db('nursing_assessments').where({ patient_id: patientId }).orderBy('assessed_at', 'desc').limit(50);
  const structured = await db('structured_observations').where({ patient_id: patientId }).orderBy('observed_at', 'desc').limit(50);
  const entries = [
    ...obs.map((o) => ({
      resource: {
        resourceType: 'Observation', id: o.id, status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey' }] }],
        code: { text: o.assessment_type },
        subject: { reference: `Patient/${o.patient_id}` },
        effectiveDateTime: o.assessed_at,
        valueQuantity: o.total_score != null ? { value: o.total_score, unit: 'score' } : undefined,
        interpretation: o.risk_level ? [{ text: o.risk_level }] : undefined,
      },
    })),
    ...structured.map((s) => ({
      resource: {
        resourceType: 'Observation', id: s.id, status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'exam' }] }],
        code: { text: `Structured Observation (${s.observation_level})` },
        subject: { reference: `Patient/${s.patient_id}` },
        effectiveDateTime: s.observation_time,
        component: [
          { code: { text: 'mood' }, valueString: s.mood },
          { code: { text: 'behaviour' }, valueString: s.behaviour },
          { code: { text: 'location' }, valueString: s.location },
        ].filter(c => c.valueString),
      },
    })),
  ];
  res.json({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries });
});

// ── FHIR DiagnosticReport (from pathology_results) ──
router.get('/DiagnosticReport', authMiddleware, async (req: Request, res: Response, _next: NextFunction) => {
  const patientId = req.query.patient as string;
  if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
  const results = await db('pathology_results').where({ patient_id: patientId }).orderBy('created_at', 'desc').limit(50);
  res.json({
    resourceType: 'Bundle', type: 'searchset', total: results.length,
    entry: results.map((r) => ({
      resource: {
        resourceType: 'DiagnosticReport', id: r.id, status: 'final',
        code: { text: r.test_name ?? 'Pathology' },
        subject: { reference: `Patient/${r.patient_id}` },
        effectiveDateTime: r.result_date ?? r.created_at,
        conclusion: r.interpretation,
      },
    })),
  });
});

// ── FHIR Practitioner (from staff) ──
router.get('/Practitioner', authMiddleware, async (_req: Request, res: Response, _next: NextFunction) => {
  const staff = await db('staff')
    .whereNull('deleted_at')
    .where('is_active', true)
    .orderBy('family_name')
    .limit(1000); // BUG-437 — fhir-ceiling clinic-wide practitioner list
  res.json({
    resourceType: 'Bundle', type: 'searchset', total: staff.length,
    entry: staff.map((s) => ({
      resource: {
        resourceType: 'Practitioner', id: s.id, active: true,
        name: [{ family: s.family_name, given: [s.given_name], prefix: s.title ? [s.title] : [] }],
        telecom: [
          s.email ? { system: 'email', value: s.email } : null,
          s.phone ? { system: 'phone', value: s.phone } : null,
        ].filter(Boolean),
        identifier: [
          s.prescriber_number ? { system: 'http://ns.electronichealth.net.au/id/prescriber-number', value: s.prescriber_number } : null,
          s.ahpra_number ? { system: 'http://ns.electronichealth.net.au/id/ahpra-registration', value: s.ahpra_number } : null,
        ].filter(Boolean),
        qualification: s.discipline ? [{ code: { text: s.discipline } }] : [],
      },
    })),
  });
});

// ── FHIR Practitioner by ID ──
router.get('/Practitioner/:id', authMiddleware, async (req: Request, res: Response, _next: NextFunction) => {
  const s = await db('staff').where({ id: req.params.id }).first();
  if (!s) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({
    resourceType: 'Practitioner', id: s.id, active: s.is_active,
    name: [{ family: s.family_name, given: [s.given_name] }],
    telecom: [s.email ? { system: 'email', value: s.email } : null].filter(Boolean),
    identifier: [s.prescriber_number ? { system: 'http://ns.electronichealth.net.au/id/prescriber-number', value: s.prescriber_number } : null].filter(Boolean),
  });
});

// ── FHIR Organization (from clinics) ──
router.get('/Organization', authMiddleware, async (_req: Request, res: Response, _next: NextFunction) => {
  const clinics = await db('clinics');
  res.json({
    resourceType: 'Bundle', type: 'searchset', total: clinics.length,
    entry: clinics.map((c) => ({
      resource: {
        resourceType: 'Organization', id: c.id, active: true,
        name: c.name,
        identifier: c.abn ? [{ system: 'http://ns.electronichealth.net.au/id/abn', value: c.abn }] : [],
        address: c.address ? [{ text: c.address }] : [],
        telecom: [c.phone ? { system: 'phone', value: c.phone } : null, c.email ? { system: 'email', value: c.email } : null].filter(Boolean),
      },
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════
// FHIR WRITE ENDPOINTS (Competitive Gap — Interoperability)
// ═══════════════════════════════════════════════════════════════════

// ── POST /fhir/Patient — Create patient from FHIR resource ──
router.post('/Patient', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resource = req.body;
    if (resource.resourceType !== 'Patient') {
      res.status(400).json({ error: 'Expected resourceType: Patient' });
      return;
    }
    const name = resource.name?.[0] ?? {};
    const telecom: Array<{ system?: string; value?: string }> = Array.isArray(resource.telecom)
      ? resource.telecom
      : [];
    const phone = telecom.find((t) => t.system === 'phone')?.value;
    const email = telecom.find((t) => t.system === 'email')?.value;
    const identifier: Array<{ system?: string; value?: string }> = Array.isArray(resource.identifier)
      ? resource.identifier
      : [];
    const medicare = identifier.find((i) => i.system?.includes('medicare'))?.value;
    const rawIhi = identifier.find((i) => i.system?.includes('ihi'))?.value;

    // BUG-A5.0 — IHI Luhn validation. Reject the entire FHIR Patient
    // resource when an `ihi` identifier is present but malformed. AHPRA
    // ADHA-A5.0 requires Luhn enforcement at every write boundary —
    // including this FHIR ingest path which historically bypassed
    // patientService.create. Empty / missing IHI is allowed (optional).
    const { isValidIhi } = await import('@signacare/shared');
    if (rawIhi != null && rawIhi !== '' && !isValidIhi(rawIhi)) {
      res.status(400).json({
        error: 'Patient.identifier (IHI) must be 16 digits starting with 800360 with a valid Luhn check digit (AHPRA ADHA-A5.0)',
        code: 'INVALID_IHI',
      });
      return;
    }
    const ihi = rawIhi ?? null;

    // BUG-A5.0 — FHIR ingest bypasses patientService.create by design
    // (different audit/EMR-number semantics). IHI is Luhn-gated inline
    // above (line ~373); this is the canonical FHIR write path.
    // Architectural refactor to consolidate with patientService.create
    // tracked as BUG-A5.0-FOLLOWUP-FHIR-CANONICAL.
    // @ihi-write-exempt: FHIR ingest path; IHI Luhn-gated inline above (BUG-A5.0-FOLLOWUP-FHIR-CANONICAL tracks consolidation with patientService.create)
    const [row] = await db('patients').insert({
      id: db.raw('gen_random_uuid()'),
      clinic_id: req.clinicId,
      emr_number: `EMR-FHIR-${Date.now()}`,
      given_name: Array.isArray(name.given) ? name.given.join(' ') : name.given ?? 'Unknown',
      family_name: name.family ?? 'Unknown',
      date_of_birth: resource.birthDate ?? '1900-01-01',
      gender: resource.gender ?? 'unknown',
      phone_mobile: phone ?? null,
      email_primary: email ?? null,
      medicare_number: medicare ?? null,
      ihi_number: ihi,
      created_at: new Date(), updated_at: new Date(),
    }).returning(PATIENT_FHIR_RETURN_COLUMNS);

    res.status(201).json({
      resourceType: 'Patient', id: row.id,
      meta: { versionId: '1', lastUpdated: new Date().toISOString() },
      name: [{ family: row.family_name, given: [row.given_name] }],
      birthDate: row.date_of_birth,
      gender: row.gender,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /fhir/Observation — Create observation (vitals/assessments) ──
router.post('/Observation', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resource = req.body;
    if (resource.resourceType !== 'Observation') {
      res.status(400).json({ error: 'Expected resourceType: Observation' });
      return;
    }
    const patientId = resource.subject?.reference?.replace('Patient/', '');
    if (!patientId) { res.status(400).json({ error: 'subject.reference required' }); return; }

    // Phase R3: real columns are staff_id + assessment_data (not the
    // ghost assessed_by_staff_id + values pre-R2 pattern). assessed_at
    // defaults to now() — matches baseline.
    const [row] = await db('nursing_assessments').insert({
      id: db.raw('gen_random_uuid()'),
      clinic_id: req.clinicId,
      patient_id: patientId,
      staff_id: req.user?.id ?? null,
      assessment_type: 'physical_tracking',
      scores: JSON.stringify(resource.component ?? []),
      assessment_data: JSON.stringify(resource.valueQuantity ?? resource.valueCodeableConcept ?? {}),
      notes: resource.note?.[0]?.text ?? null,
      total_score: resource.valueQuantity?.value ?? null,
      assessed_at: new Date(),
    }).returning(NURSING_ASSESSMENT_COLUMNS);

    res.status(201).json({
      resourceType: 'Observation', id: row.id,
      meta: { lastUpdated: new Date().toISOString() },
      status: 'final',
      subject: { reference: `Patient/${patientId}` },
    });
  } catch (err) {
    next(err);
  }
});

// ── FHIR Bulk Data Access $export ──────────────────────────────────────────
//
// S3.2: replaces the prior synchronous in-memory stub with a proper
// async kickoff → poll → download flow per
// https://hl7.org/fhir/uv/bulkdata/export.html
//
//   POST/GET /fhir/$export                  — system-level (all patients in clinic)
//   POST/GET /fhir/Patient/$export          — same as above (spec alias)
//   POST/GET /fhir/Group/[id]/$export       — restricted to one team's patients
//   GET      /fhir/$export-status/[jobId]   — poll job status
//   DELETE   /fhir/$export-status/[jobId]   — cancel a running job
//
// Spec details honoured:
//   - Async kickoff: 202 Accepted + Content-Location header pointing at the
//     status endpoint, regardless of whether Prefer: respond-async was set.
//   - Polling: 202 + X-Progress while running, 200 + manifest JSON when
//     done. Manifest shape per the spec: { transactionTime, request,
//     requiresAccessToken, output: [{type, url, count}], error }
//   - _type filter (comma-separated, defaults to all supported)
//   - _since filter (ISO 8601 timestamp; resources updated since)
//   - _typeFilter is NOT supported (spec optional, complex; follow-up)
import {
  SUPPORTED_BULK_TYPES,
  isSupportedBulkType,
} from './serializers';
import { processBulkExportJob } from './bulkExportWorker';

interface BulkExportJobRow {
  id: string;
  clinic_id: string;
  requested_by_staff_id: string;
  types: string[];
  since: Date | string | null;
  request_url: string;
  group_id: string | null;
  status: string;
  output_files: Array<{ type: string; url: string; count: number; sizeBytes: number }>;
  total_resources: number | null;
  exported_resources: number;
  error_text: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

async function kickoffExport(
  req: Request,
  res: Response,
  next: NextFunction,
  groupId: string | null,
): Promise<void> {
  try {
    if (!req.clinicId) {
      res.status(401).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'security' }] });
      return;
    }

    // _type filter — defaults to all supported types
    const requestedTypes = (req.query._type as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
      ...SUPPORTED_BULK_TYPES,
    ];
    const types = requestedTypes.filter(isSupportedBulkType);
    if (types.length === 0) {
      res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', details: { text: '_type contains no supported resource types' } }],
      });
      return;
    }

    // _since filter — ISO 8601 timestamp
    let since: Date | null = null;
    if (req.query._since) {
      const parsed = new Date(req.query._since as string);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'invalid', details: { text: '_since must be ISO 8601' } }],
        });
        return;
      }
      since = parsed;
    }

    const baseUrl = config.apiBaseUrl;
    const requestUrl = `${baseUrl}${req.originalUrl}`;
    const requesterId = (req as Request & { user?: { id: string } }).user?.id;
    if (!requesterId) {
      res.status(401).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'security' }] });
      return;
    }

    const [job] = await db<BulkExportJobRow>('fhir_bulk_export_jobs')
      .insert({
        clinic_id: req.clinicId,
        requested_by_staff_id: requesterId,
        types,
        since,
        request_url: requestUrl,
        group_id: groupId,
        status: 'accepted',
      })
      .returning(FHIR_BULK_EXPORT_JOB_COLUMNS) as BulkExportJobRow[];

    // Defer actual processing so the kickoff request returns immediately.
    // setImmediate keeps the worker in-process; a follow-up can wire this
    // through JobBus when we have a dedicated worker process.
    //
    // CLAUDE.md §2.2: every async call must have an error path. `void
    // processBulkExportJob(job.id)` on its own would silently swallow
    // any throw before `processBulkExportJob`'s own try/catch engages
    // (e.g. a synchronous setup failure or a broken import) and would
    // surface as an unhandled rejection — Node may terminate the
    // process. Chain `.catch` so a failure logs at ERROR level and
    // updates the job row to `failed` for the client to discover via
    // the status endpoint.
    setImmediate(() => {
      processBulkExportJob(job.id).catch(async (err: unknown) => {
        logger.error(
          { err, jobId: job.id },
          'fhir bulk export worker crashed before its own handler — job marked failed',
        );
        try {
          // Phase R3: real column is error_text (not error_message).
          // fhir_bulk_export_jobs is APPEND-ONLY so no updated_at column.
          await db('fhir_bulk_export_jobs')
            .where({ id: job.id })
            .update({
              status: 'failed',
              error_text:
                err instanceof Error ? err.message : String(err),
              finished_at: new Date(),
            });
        } catch (updateErr) {
          logger.error(
            { err: updateErr, jobId: job.id },
            'fhir bulk export worker: failed to mark job as failed after crash',
          );
        }
      });
    });

    const statusUrl = `${baseUrl}/api/v1/fhir/$export-status/${job.id}`;
    res.status(202).setHeader('Content-Location', statusUrl).end();
  } catch (err) { next(err); }
}

router.get('/Patient/\\$export', authMiddleware, (req: Request, res: Response, next: NextFunction) =>
  kickoffExport(req, res, next, null),
);
router.get('/\\$export', authMiddleware, (req: Request, res: Response, next: NextFunction) =>
  kickoffExport(req, res, next, null),
);
router.get('/Group/:groupId/\\$export', authMiddleware, (req: Request, res: Response, next: NextFunction) =>
  kickoffExport(req, res, next, req.params.groupId),
);

// Status polling
router.get(
  '/\\$export-status/:jobId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await db<BulkExportJobRow>('fhir_bulk_export_jobs')
        .where({ id: req.params.jobId, clinic_id: req.clinicId })
        .first();
      if (!job) {
        res.status(404).json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'not-found' }],
        });
        return;
      }
      if (job.status === 'completed') {
        // Spec: Expires header recommended; we use 24h ahead.
        res.setHeader('Expires', new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString());
        res.json({
          transactionTime: job.finished_at ?? job.created_at,
          request: job.request_url,
          requiresAccessToken: true,
          output: job.output_files,
          error: [],
          // Non-spec extensions, useful for the client UI
          jobId: job.id,
          totalResources: job.total_resources,
        });
        return;
      }
      if (job.status === 'failed') {
        return next(new AppError(job.error_text ?? 'Bulk export failed', 500, 'EXPORT_FAILED'));
      }
      if (job.status === 'cancelled') {
        res.status(404).json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'not-found', details: { text: 'export was cancelled' } }],
        });
        return;
      }
      // accepted | in_progress
      const progress = job.total_resources
        ? `${Math.round((job.exported_resources / job.total_resources) * 100)}%`
        : `${job.exported_resources} resources exported`;
      res.status(202)
        .setHeader('X-Progress', progress)
        .setHeader('Retry-After', '5')
        .end();
    } catch (err) { next(err); }
  },
);

// Cancel
router.delete(
  '/\\$export-status/:jobId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await db<BulkExportJobRow>('fhir_bulk_export_jobs')
        .where({ id: req.params.jobId, clinic_id: req.clinicId })
        .whereIn('status', ['accepted', 'in_progress'])
        .update({ status: 'cancelled', finished_at: new Date() });
      if (updated === 0) {
        res.status(404).json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'not-found' }],
        });
        return;
      }
      res.status(202).end();
    } catch (err) { next(err); }
  },
);

export default router;
