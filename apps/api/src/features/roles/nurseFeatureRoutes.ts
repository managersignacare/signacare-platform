import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { CLINICAL_ROLES, NURSE_ROLES } from '../../shared/roleGroups';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
// BUG-622 — canonical Zod request schema + response mapper for the
// MAR write-rail, closing the field-name drift between MarChartPanel
// payload (camelCase) and the snake_case DB columns. Pre-fix the
// handler destructured 3 different field names (`prescriptionId`,
// `givenAt`, `dose`) and silently dropped 2 fields (`administrationContext`,
// `prnReason`) → success-path rows missing patient_medication_id →
// DOUBLE-DOSING harm class. The schema enforces canonical names; the
// mapper enforces canonical response casing per CLAUDE.md §5.2.
import { MedicationAdministrationCreateSchema } from '@signacare/shared';
import {
  mapMedicationAdministrationRowToResponse,
  type MedicationAdministrationRow,
} from './medicationAdministrationMapper';

// Local Zod schema for observation updates (Phase R3b / CLAUDE.md §12).
// `values` is the JSONB payload clinicians record during a structured
// observation; notes is free text.
const ObservationUpdateSchema = z.object({
  values: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(10000).optional(),
});

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MedicationAdministrationsQuerySchema = z.object({
  patientId: z.string().uuid(),
  date: z.string().regex(DATE_ONLY_RE, 'date must be YYYY-MM-DD').optional(),
  from: z.string().regex(DATE_ONLY_RE, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_ONLY_RE, 'to must be YYYY-MM-DD').optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
}).superRefine((v, ctx) => {
  if (v.from && v.to && v.from > v.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: 'from must be on or before to',
    });
  }
});

// Audit Tier 1.4 (CRIT-H2 / GAP-B2) — nurse-only clinical triage patch.
// The receptionist POST/PUT on /phone-triage writes receptionist_summary
// (admin text) only. The nurse writes clinical_risk_flags (structured
// risk JSON the receptionist must NOT see or overwrite) via this route,
// and may optionally refine receptionist_summary while reviewing the
// call. `clinicalRiskFlags` is a free-shape record because the app
// evolves the keys (suicidality, intoxication, psychomotor_agitation,
// etc.) without a migration per new flag.
const NurseTriagePatchSchema = z.object({
  expectedLockVersion: z.number().int().positive(), // BUG-PR-R1-12-FIX-S1-phone_triage
  clinicalRiskFlags: z.record(z.string(), z.unknown()).nullable().optional(),
  receptionistSummary: z.string().max(10000).nullable().optional(),
  urgency: z.enum(['urgent', 'semi-urgent', 'routine']).optional(),
  status: z.string().max(30).optional(),
});

const PHONE_TRIAGE_FULL_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'caller_name', 'caller_relationship',
  'caller_phone', 'reason_for_call', 'urgency', 'triage_notes',
  'receptionist_summary', 'clinical_risk_flags',
  'action_taken', 'assigned_to_id', 'received_by_id', 'triaged_by_staff_id',
  'status', 'created_at', 'updated_at',
] as const;

const router = Router();

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// All 4 tables are materialized in R2b baseline — pre-R2 they were ghost
// tables silently targeted by this router (shift_handovers even had a
// DDL-in-handler block in violation of CLAUDE.md §7.3; that block has
// been removed along with the Phase F markers).
const STRUCTURED_OBSERVATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'staff_id', 'observation_type',
  'location', 'mood', 'behaviour', 'risk_concerns', 'sleep_quality',
  'values', 'notes', 'observed_at', 'created_at',
] as const;

const NURSING_ASSESSMENT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'staff_id',
  'assessment_type', 'scores', 'assessment_data', 'total_score',
  'risk_level', 'notes', 'plan', 'assessed_at', 'created_at', 'updated_at',
] as const;

const MEDICATION_ADMINISTRATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'patient_medication_id',
  'scheduled_time', 'status', 'administered_time',
  'administered_by_staff_id', 'dose_given', 'route', 'site', 'notes',
  'reason_not_given', 'witnessed_by_staff_id', 'batch_number',
  'administration_context', 'prn_reason', 'created_at',
  'lock_version', // BUG-PR-R1-12-FIX-S0-medication_administrations
] as const;

const SHIFT_HANDOVER_COLUMNS = [
  'id', 'clinic_id', 'ward', 'shift_type', 'summary_manual',
  'key_issues', 'patient_updates', 'outgoing_staff_id', 'incoming_staff_id',
  'pending_actions', 'shift_date', 'status', 'created_by_id',
  'acknowledged_at', 'created_at', 'updated_at',
  'lock_version', // BUG-PR-R1-12-FIX-S1-shift_handovers
] as const;

// BUG-PR-R1-12-FIX-S1-shift_handovers — REQUIRED expectedLockVersion.
const ShiftHandoverPatchSchema = z.object({
  expectedLockVersion: z.number().int().positive(), summary: z.string().max(20000).nullable().optional(),
  keyEvents: z.unknown().optional(), patientConcerns: z.unknown().optional(), pendingTasks: z.unknown().optional(),
  incomingStaffIds: z.array(z.string().uuid()).nullable().optional(), acknowledged: z.boolean().optional(),
});

//  NURSE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── MAR Chart ───────────────────────────────────────────────────────────────
// GET /medications/mar/:patientId
//
// BUG-623 — pre-fix queried `prescriptions` then filtered administrations
// on `a.patient_medication_id === med.id`. FK targets `patient_medications`
// not `prescriptions`, so the join NEVER matched → MAR showed zero doses →
// DOUBLE-DOSING harm class (sibling to BUG-622 on the WRITE rail). CLAUDE.md
// §1.1 + §1.2 violation. Compound bug: pre-fix wrapped each row in a
// `{ medication: {...}, administrations: [...] }` envelope the consumer
// never unwrapped, so `med.id` / `med.name` were undefined — even if the
// join had worked, the MAR would have rendered without labels.
//
// Post-fix queries `patient_medications` (FK target), applies soft-delete
// filter (CLAUDE.md §1.4), returns FLAT shape consumed directly by the
// NursingPage MAR grid. BUG-627 folded in atomically: administrations
// sub-shape goes through `mapMedicationAdministrationRowToResponse` so
// the response is canonical-camel + Zod-validated per CLAUDE.md §5.2.
//
// Gated by NURSE_ROLES + requirePatientRelationship (audit CRIT-H1).
// 403 NO_PATIENT_RELATIONSHIP if nurse not on care team; break-glass bypasses.
router.get(
  '/medications/mar/:patientId',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.params;
      const auth = buildAuthContext(req, patientId);
      await requirePatientRelationship(auth, patientId);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      // Active patient_medications — the canonical source-of-truth for
      // "what this patient is on right now". `medication_administrations.patient_medication_id`
      // FK targets THIS table (verified via `\d medication_administrations` —
      // FOREIGN KEY (patient_medication_id) REFERENCES patient_medications(id)),
      // so the administrations join below resolves correctly.
      // Soft-delete filter per CLAUDE.md §1.4 (patient_medications carries
      // a `deleted_at` column).
      const medications = await dbRead('patient_medications')
        .where({ patient_id: patientId, clinic_id: req.clinicId })
        .whereIn('status', ['active', 'on_hold'])
        .whereNull('deleted_at')
        .orderBy('drug_label', 'asc');

      // Administration records for the date.
      const administrations = await dbRead('medication_administrations')
        .where({ patient_id: patientId, clinic_id: req.clinicId })
        .whereRaw('scheduled_time::date = ?', [date])
        .orderBy('scheduled_time', 'asc')
        .select(MEDICATION_ADMINISTRATION_COLUMNS as unknown as string[]);

      // Build MAR grid as a FLAT shape so the NursingPage consumer reads
      // `med.id` / `med.name` / `med.administrations` directly without
      // unwrapping a `{ medication: {...} }` envelope. Each administrations
      // sub-row is canonicalised through `mapMedicationAdministrationRowToResponse`
      // (BUG-627) so the response carries canonical camelCase + Zod-validated
      // shape (per CLAUDE.md §5.2) sibling-uniform with the BUG-622 POST
      // response.
      const medicationRows = medications as Array<{ id: string; drug_label: string | null; generic_name: string | null; brand_name: string | null; dose: string | null; route: string | null; frequency: string | null; status: string | null }>;
      const administrationRows = administrations as MedicationAdministrationRow[];
      const marGrid = medicationRows.map((med) => {
        const medAdmins = administrationRows
          .filter((a) => a.patient_medication_id === med.id)
          .map((a) => mapMedicationAdministrationRowToResponse(a));
        return {
          id: med.id,
          name: med.drug_label,
          genericName: med.generic_name,
          brandName: med.brand_name,
          dose: med.dose,
          route: med.route,
          frequency: med.frequency,
          status: med.status,
          administrations: medAdmins,
        };
      });

      res.json({ data: marGrid, date, patientId });
    } catch (err) { next(err); }
  },
);

// ── Medication Administrations (timeline feed used by MAR panel) ───────────
// GET /medication-administrations
//
// BUG-MAR-READ-ROUTE — the web MAR chart (`MarChartPanel.tsx`) reads
// administrations from this endpoint with date/range filters. The route
// was missing, so the panel fail-loud banner fired continuously with 404
// and dose-history cells rendered incomplete. This route is read-only,
// relationship-gated, canonical-camel mapped, and accessible to all
// clinical roles that can view medication history.
router.get(
  '/medication-administrations',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, date, from, to, limit } = MedicationAdministrationsQuerySchema.parse(req.query);
      const auth = buildAuthContext(req, patientId);
      await requirePatientRelationship(auth, patientId);

      let query = dbRead('medication_administrations')
        .where({ clinic_id: req.clinicId, patient_id: patientId })
        .orderBy('scheduled_time', 'desc')
        .limit(limit)
        .select(MEDICATION_ADMINISTRATION_COLUMNS as unknown as string[]);

      if (date) {
        query = query.whereRaw('scheduled_time::date = ?', [date]);
      } else {
        if (from) query = query.whereRaw('scheduled_time::date >= ?', [from]);
        if (to) query = query.whereRaw('scheduled_time::date <= ?', [to]);
      }

      const rows = await query as MedicationAdministrationRow[];
      res.json({ data: rows.map((r) => mapMedicationAdministrationRowToResponse(r)) });
    } catch (err) { next(err); }
  },
);

// ── Record Medication Administration ────────────────────────────────────────
// POST /medication-administrations
// Gated end-to-end (CRIT-H1 / G17 sweep): NURSE_ROLES + requirePatientRelationship.
router.post(
  '/medication-administrations',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // BUG-622 — Zod-validate canonical camelCase DTO at request boundary.
      const dto = MedicationAdministrationCreateSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      await requirePatientRelationship(auth, dto.patientId);

      const [row] = await db('medication_administrations')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: dto.patientId,
          patient_medication_id: dto.patientMedicationId,
          scheduled_time: dto.scheduledTime,
          status: dto.status,
          administered_time: dto.administeredTime ?? db.fn.now(),
          administered_by_staff_id: req.user!.id,
          dose_given: dto.doseGiven ?? null,
          route: dto.route ?? null,
          site: dto.site ?? null,
          notes: dto.notes ?? null,
          reason_not_given: dto.reasonNotGiven ?? null,
          witnessed_by_staff_id: dto.witnessId ?? null,
          batch_number: dto.batchNumber ?? null,
          administration_context: dto.administrationContext ?? null,
          prn_reason: dto.prnReason ?? null,
          created_at: db.fn.now(),
        })
        .returning(MEDICATION_ADMINISTRATION_COLUMNS);

      // BUG-622 — apply mapper at boundary so the response is
      // canonical camelCase per CLAUDE.md §5.2.
      res.status(201).json(mapMedicationAdministrationRowToResponse(row as MedicationAdministrationRow));
    } catch (err) { next(err); }
  },
);

// ── Medications Due Now ─────────────────────────────────────────────────────
// GET /medications/due-now
// BUG-632 — pre-fix joined `prescriptions` on `ma.patient_medication_id`
// (FK is `patient_medications`; sibling of BUG-623); also §1.8
// interpolation, §5.2 raw snake_case, §1.4 no soft-delete. Post-fix:
// Knex builder + parameterized make_interval + soft-delete + camel
// mapper + L4 FINDING-2 absorb (S0 excludes ceased pm.status).
router.get(
  '/medications/due-now',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowMinutes = Math.max(parseInt((req.query.window as string) || '60', 10), 0);
      const wardFilter = req.query.ward as string | undefined;
      const query = dbRead('medication_administrations as ma')
        .innerJoin('patient_medications as pm', 'pm.id', 'ma.patient_medication_id')
        .innerJoin('patients as p', 'p.id', 'ma.patient_id')
        .leftJoin('bed_movements as bm', (j) => {
          j.on('bm.patient_id', '=', 'p.id')
            .andOn('bm.clinic_id', '=', dbRead.raw('?', [req.clinicId]))
            .andOn('bm.movement_type', '=', dbRead.raw('?', ['admission']));
        })
        .leftJoin('beds as b', 'b.id', 'bm.bed_id')
        .where('ma.clinic_id', req.clinicId)
        .where('pm.clinic_id', req.clinicId) // BUG-634-cascade §1.3 belt
        .where('p.clinic_id', req.clinicId) // BUG-634-cascade §1.3 belt
        .where('ma.status', 'scheduled')
        .whereRaw(
          `ma.scheduled_time BETWEEN NOW() - make_interval(mins => ?) AND NOW() + make_interval(mins => ?)`,
          [windowMinutes, windowMinutes],
        )
        .whereNot('pm.status', 'ceased')
        .whereNull('pm.deleted_at')
        .whereNull('p.deleted_at')
        .orderBy('ma.scheduled_time', 'asc')
        .select(
          'p.id as patient_id',
          dbRead.raw(`p.given_name || ' ' || p.family_name as patient_name`),
          'p.emr_number', 'pm.generic_name', 'pm.dose', 'pm.route',
          'ma.id as admin_id', 'ma.scheduled_time', 'b.ward', 'b.bed_label',
        );
      if (wardFilter) query.where('b.ward', wardFilter);
      // Snake → camel per CLAUDE.md §5.2.
      const data = ((await query) as Array<{ patient_id: string; patient_name: string; emr_number: string | null; generic_name: string | null; dose: string | null; route: string | null; admin_id: string; scheduled_time: string | Date; ward: string | null; bed_label: string | null }>).map((r) => ({
        patientId: r.patient_id, patientName: r.patient_name,
        emrNumber: r.emr_number, genericName: r.generic_name,
        dose: r.dose, route: r.route, adminId: r.admin_id,
        scheduledTime: r.scheduled_time instanceof Date ? r.scheduled_time.toISOString() : r.scheduled_time,
        ward: r.ward, bedLabel: r.bed_label,
      }));
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// ── Structured Observations CRUD ────────────────────────────────────────────
// GET /structured-observations
router.get(
  '/structured-observations',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, type, limit = '50' } = req.query;
      // If the caller scopes the query to a specific patient, verify the
      // relationship. Unscoped calls return a clinic-wide recent-observations
      // stream (appropriate for nurse dashboard / shift overview).
      if (patientId) {
        const auth = buildAuthContext(req, patientId as string);
        await requirePatientRelationship(auth, patientId as string);
      }
      let query = dbRead('structured_observations')
        .where({ clinic_id: req.clinicId })
        .orderBy('observed_at', 'desc')
        .limit(parseInt(limit as string, 10));

      if (patientId) query = query.where({ patient_id: patientId });
      if (type) query = query.where({ observation_type: type });

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /structured-observations — gated end-to-end (CRIT-H1 / G17 sweep).
router.post(
  '/structured-observations',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId, observationType, values, observedAt,
        mood, behaviour, riskConcerns, sleep,
      } = req.body;
      if (!patientId) { res.status(400).json({ error: 'patientId is required' }); return; }
      const auth = buildAuthContext(req, patientId);
      await requirePatientRelationship(auth, patientId);

      const [row] = await db('structured_observations')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: patientId,
          observation_type: observationType,
          location: values?.location ?? null,
          mood: mood ?? null,
          behaviour: behaviour ?? null,
          risk_concerns: riskConcerns ?? null,
          // Phase 0.7.5 c24 D11 (SD53/54/55) — column renames to match DB:
          //   observation_level → observation_type
          //   sleep_status      → sleep_quality
          //   observation_time  → observed_at
          // The prior code wrote the left-hand-side names on every
          // INSERT. Postgres silently dropped the ghost keys (same
          // pattern as SD40/41/43). Structured observations saved
          // without observation_type, sleep_quality, or observed_at.
          sleep_quality: (['awake', 'asleep', 'restless', 'unsettled'].includes(values?.sleep ?? sleep ?? '') ? (values?.sleep ?? sleep) : null),
          values: JSON.stringify(values ?? {}),
          observed_at: observedAt || db.fn.now(),
          staff_id: req.user!.id,
          created_at: db.fn.now(),
        })
        .returning(STRUCTURED_OBSERVATION_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /structured-observations/:id — gated end-to-end (CRIT-H1 / G17 sweep).
router.put(
  '/structured-observations/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Look up the record FIRST to get its patient_id, then enforce the
      // relationship. A 404 is returned both for non-existent rows AND for
      // rows in another clinic (tenant isolation via clinic_id filter).
      const existing = await db('structured_observations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const auth = buildAuthContext(req, existing.patient_id);
      await requirePatientRelationship(auth, existing.patient_id);

      // Phase 0.7.5 c24 D11 (SD56) — structured_observations has no
      // `updated_at`, `escalation_required`, or `escalation_notes`
      // columns. The prior code wrote all three on every PUT; Postgres
      // silently dropped the unknown keys. Clinical-escalation context
      // on observations is a real feature gap — flagged for Phase F to
      // decide whether to add those columns.
      //
      // For now the update only touches columns that actually exist:
      // values (JSONB), risk_concerns, notes. The escalation intent
      // can be encoded inside the values JSONB payload as an interim.
      const { values, notes } = ObservationUpdateSchema.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (values !== undefined) updates.values = JSON.stringify(values);
      if (notes !== undefined) updates.risk_concerns = notes;
      // @catalogued: BUG-242 (Wave B-10) — re-enable escalation_* writes once Phase F SD56 columns exist.

      const [row] = await db('structured_observations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(STRUCTURED_OBSERVATION_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /structured-observations/:id — gated end-to-end (CRIT-H1 / G17 sweep).
router.delete(
  '/structured-observations/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await db('structured_observations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const auth = buildAuthContext(req, existing.patient_id);
      await requirePatientRelationship(auth, existing.patient_id);

      const deleted = await db('structured_observations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Shift Handover Auto-Summary ─────────────────────────────────────────────
// GET /shift-handovers/auto-summary
router.get(
  '/shift-handovers/auto-summary',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ward = req.query.ward as string;
      const shiftHours = parseInt((req.query.hours as string) || '8', 10);
      const since = new Date(Date.now() - shiftHours * 3600000);

      // Gather all key events from the shift period.
      // BUG-722: keep query fan-out sequential inside request-scoped RLS.
      const observations = await dbRead('structured_observations')
        .where({ clinic_id: req.clinicId })
        .where('observed_at', '>=', since)
        .where('escalation_required', true)
        .select('*');
      const admins = await dbRead('medication_administrations')
        .where({ clinic_id: req.clinicId })
        .where('created_at', '>=', since)
        .whereIn('status', ['refused', 'withheld', 'omitted'])
        .select('*');
      const incidents = await dbRead('escalations')
        .where({ clinic_id: req.clinicId })
        .where('created_at', '>=', since)
        .whereNull('deleted_at')
        .select('*');
      const newAdmissions = await dbRead('bed_movements')
        .where({ clinic_id: req.clinicId, movement_type: 'admission' })
        .where('created_at', '>=', since)
        .select('*');

      // Build summary (AI enhancement could be layered on here)
      const summary = {
        shiftPeriod: { from: since.toISOString(), to: new Date().toISOString(), hours: shiftHours },
        ward: ward || 'all',
        escalatedObservations: observations.length,
        missedMedications: admins.length,
        incidents: incidents.length,
        newAdmissions: newAdmissions.length,
        highlights: [] as string[],
      };

      if (observations.length > 0) {
        summary.highlights.push(`${observations.length} escalated observation(s) requiring review`);
      }
      if (admins.length > 0) {
        summary.highlights.push(`${admins.length} medication(s) refused/withheld/omitted`);
      }
      if (incidents.length > 0) {
        summary.highlights.push(`${incidents.length} incident(s) logged during shift`);
      }
      if (newAdmissions.length > 0) {
        summary.highlights.push(`${newAdmissions.length} new admission(s)`);
      }

      res.json({
        data: summary,
        details: {
          escalatedObservations: observations,
          missedMedications: admins,
          incidents,
          newAdmissions,
        },
      });
    } catch (err) { next(err); }
  },
);

// ── Shift Handovers CRUD ────────────────────────────────────────────────────
// GET /shift-handovers
router.get(
  '/shift-handovers',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ward, date, shiftDate, shiftType, outgoingStaffId, limit = '20' } = req.query;
      let query = dbRead('shift_handovers')
        .where({ clinic_id: req.clinicId })
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit as string, 10));

      if (ward) query = query.where({ ward });
      if (shiftType) query = query.where({ shift_type: shiftType });
      if (outgoingStaffId) query = query.where({ outgoing_staff_id: outgoingStaffId });
      // Support both 'date' and 'shiftDate' query params
      const filterDate = (shiftDate ?? date) as string | undefined;
      if (filterDate) query = query.whereRaw('shift_date = ? OR created_at::date = ?', [filterDate, filterDate]);

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /shift-handovers
router.post(
  '/shift-handovers',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        ward, shiftType, shiftDate,
        // Accept both frontend naming and original naming
        summary, summaryManual,
        keyEvents, keyIssues,
        patientConcerns, patientUpdates,
        incomingStaffIds,
        pendingTasks, pendingActions,
        status,
      } = req.body;

      // shift_handovers is a first-class baseline table (R2b Section P).
      // CLAUDE.md §7.3 forbids DDL in route handlers — the pre-R2
      // `db.schema.createTable` + `hasTable` check has been removed.

      const [row] = await db('shift_handovers')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          ward: ward || null,
          shift_type: shiftType || 'morning',
          summary_manual: summaryManual ?? summary ?? null,
          key_issues: keyIssues ?? JSON.stringify(keyEvents || []),
          patient_updates: patientUpdates ?? JSON.stringify(patientConcerns || []),
          outgoing_staff_id: req.user!.id,
          incoming_staff_id: incomingStaffIds?.[0] || null,
          pending_actions: pendingActions ?? JSON.stringify(pendingTasks || []),
          shift_date: shiftDate || new Date().toISOString().slice(0, 10),
          status: status || 'pending',
          created_by_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(SHIFT_HANDOVER_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /shift-handovers/:id
router.put(
  '/shift-handovers/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ShiftHandoverPatchSchema.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (dto.summary !== undefined) updates.summary_manual = dto.summary;
      if (dto.keyEvents !== undefined) updates.key_issues = JSON.stringify(dto.keyEvents);
      if (dto.patientConcerns !== undefined) updates.patient_updates = JSON.stringify(dto.patientConcerns);
      if (dto.pendingTasks !== undefined) updates.pending_actions = JSON.stringify(dto.pendingTasks);
      if (dto.incomingStaffIds !== undefined) updates.incoming_staff_id = dto.incomingStaffIds?.[0] || null;
      if (dto.acknowledged !== undefined) { updates.status = dto.acknowledged ? 'acknowledged' : 'pending'; updates.acknowledged_at = new Date(); }
      // BUG-PR-R1-12-FIX-S1-shift_handovers — opt-locked UPDATE.
      const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
      const row = await updateWithOptimisticLock<Record<string, unknown>>({
        table: 'shift_handovers', where: { id: req.params.id, clinic_id: req.clinicId },
        expectedLockVersion: dto.expectedLockVersion, patch: updates, returning: SHIFT_HANDOVER_COLUMNS,
      });
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /shift-handovers/:id
router.delete(
  '/shift-handovers/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('shift_handovers')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Nursing Assessments CRUD (NEWS2, fluid balance, falls risk, wound care) ─
// GET /nursing-assessments
router.get(
  '/nursing-assessments',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, assessmentType, episodeId, limit = '50' } = req.query;
      let query = dbRead('nursing_assessments')
        .where({ clinic_id: req.clinicId })
        .orderBy('assessed_at', 'desc')
        .limit(parseInt(limit as string, 10));

      if (patientId) query = query.where({ patient_id: patientId });
      if (assessmentType) query = query.where({ assessment_type: assessmentType });
      if (episodeId) query = query.where({ episode_id: episodeId });

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /nursing-assessments
router.post(
  '/nursing-assessments',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId, assessmentType, scores, totalScore, riskLevel,
        values, notes, assessedAt,
      } = req.body;

      if (!patientId || !assessmentType) {
        res.status(400).json({ error: 'patientId and assessmentType are required' });
        return;
      }

      // Auto-assign active episode if not provided
      let resolvedEpisodeId = req.body.episodeId || null;
      if (!resolvedEpisodeId) {
        const activeEp = await db('episodes').where({ patient_id: patientId, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').orderBy('created_at', 'desc').first();
        resolvedEpisodeId = activeEp?.id ?? null;
      }

      const [row] = await db('nursing_assessments')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: patientId,
          episode_id: resolvedEpisodeId,
          assessment_type: assessmentType,
          scores: JSON.stringify(scores || {}),
          total_score: totalScore || null,
          risk_level: riskLevel || null,
          assessment_data: JSON.stringify(values || {}),
          notes: notes || null,
          staff_id: req.user?.id ?? null,
          assessed_at: assessedAt || db.fn.now(),
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(NURSING_ASSESSMENT_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /nursing-assessments/:id
router.put(
  '/nursing-assessments/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        scores, totalScore, riskLevel, values, notes, nextDueAt,
      } = req.body;

      // Phase 0.7.5 c24 D11 (SD57/58) — column renames to match DB:
      //   values         → assessment_data (the correct JSONB payload column)
      //   review_datetime → flagged for Phase F (no next-review column on
      //                      nursing_assessments today; adding one is a
      //                      migration + feature decision).
      // Pre-fix every PUT silently dropped both keys.
      const updates: Record<string, unknown> = { updated_at: db.fn.now() };
      if (scores !== undefined) updates.scores = JSON.stringify(scores);
      if (totalScore !== undefined) updates.total_score = totalScore;
      if (riskLevel !== undefined) updates.risk_level = riskLevel;
      if (values !== undefined) updates.assessment_data = JSON.stringify(values);
      if (notes !== undefined) updates.notes = notes;
      // @catalogued: BUG-242 (Wave B-10) — re-enable review scheduling once Phase F SD58 column exists.
      void nextDueAt;

      const [row] = await db('nursing_assessments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(NURSING_ASSESSMENT_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /nursing-assessments/:id
router.delete(
  '/nursing-assessments/:id',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('nursing_assessments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Phone Triage — Nurse Clinical Review ───────────────────────────────────
// Tier 1.4 (CRIT-H2 / GAP-B2). Nurse-only PATCH that sets the structured
// clinical_risk_flags jsonb column on an existing phone_triage row. The
// receptionist POST/PUT at /phone-triage writes only receptionist_summary;
// risk findings NEVER traverse the receptionist write-path, preventing
// cross-role overwrite + leakage of clinical risk text to non-clinical
// staff. Patient-relationship check is gated ONLY when the row has a
// linked patient_id (call-line triage may predate patient registration).
//
// PATCH /phone-triage/:id/clinical-triage
router.patch(
  '/phone-triage/:id/clinical-triage',
  requireRoles([...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = NurseTriagePatchSchema.parse(req.body);

      const existing = await dbRead('phone_triage')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

      if (existing.patient_id) {
        const auth = buildAuthContext(req, existing.patient_id);
        await requirePatientRelationship(auth, existing.patient_id);
      }

      const patch: Record<string, unknown> = { triaged_by_staff_id: req.user!.id };
      if (dto.clinicalRiskFlags !== undefined) {
        patch.clinical_risk_flags = dto.clinicalRiskFlags === null ? null : JSON.stringify(dto.clinicalRiskFlags);
      }
      if (dto.receptionistSummary !== undefined) patch.receptionist_summary = dto.receptionistSummary;
      if (dto.urgency !== undefined) patch.urgency = dto.urgency;
      if (dto.status !== undefined) patch.status = dto.status;
      // BUG-PR-R1-12-FIX-S1-phone_triage — opt-locked UPDATE.
      const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
      const row = await updateWithOptimisticLock<Record<string, unknown>>({
        table: 'phone_triage',
        where: { id: req.params.id, clinic_id: req.clinicId },
        expectedLockVersion: dto.expectedLockVersion,
        patch,
        returning: PHONE_TRIAGE_FULL_COLUMNS,
      });
      res.json(row);
    } catch (err) { next(err); }
  },
);

export default router;
