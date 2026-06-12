// apps/api/src/features/reports/reports.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { reportsController } from './reportsController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { extractCount } from '../../shared/extractCount';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { handleAdminOverview } from './adminOverviewRoute';
import { AppError } from '../../shared/errors';
import { OPEN_TASK_STATUSES } from '../tasks/taskStatusCatalog';
import {
  CASE_MANAGER_ROLES,
  CLINICAL_ROLES,
  MANAGER_ROLES,
} from '../../shared/roleGroups';
import adminReportsRoutes from './adminReportsRouter';
import { resolveLockedRuntimeSelection } from '../llm/modelRouter/modelRouter';
import { scoreClinicalNoteAudit } from './llmAuditScoring';

// Governance-scope routes (admin + superadmin only). These expose
// per-clinician activity, quality-improvement audit tooling, and other
// cross-team data that a general clinician / receptionist must not see.
// Keep in sync with the 6 routes below that mount this middleware.
// Superadmin is included by the requireRoles implementation (see
// rbacMiddleware.ts line 16 — superadmin bypass is unconditional).
const governanceRoleGate = requireRoles(['admin']);
const clinicalAlertsRoleGate = requireRoles([
  ...new Set([
    ...CLINICAL_ROLES,
    ...CASE_MANAGER_ROLES,
    ...MANAGER_ROLES,
    'readonly',
    'referral_coordinator',
  ]),
]);

// Local Zod schemas (Phase R3b / CLAUDE.md §12) — clinical-note audit
// template + run inputs. `questions` is flexible: each entry may be a
// plain string label or a { text, options[] } object.
const AuditTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  questions: z.array(z.union([
    z.string().min(1),
    z.object({ text: z.string().min(1) }).passthrough(),
  ])).min(1),
});

const AuditRunCreateSchema = z.object({
  templateId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
  sampleSize: z.number().int().positive().max(500),
  useLlm: z.boolean().optional(),
});

const router = Router();

router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.REPORTS));

// List report runs
router.get('/', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const clinicId = req.clinicId;
    // Phase 0.7.5 c24 C6 (SD18) — was where({ clinicid }) ordering by
    // `generatedat` (both ghost columns). Now uses real column names.
    const rows = await db('report_runs').where({ clinic_id: clinicId }).orderBy('generated_at', 'desc').limit(50);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Static segments must come before parameterised ones to avoid route shadowing
router.get('/filters/clinicians', (req, res, next) =>
  reportsController.getCliniciansForFilter(req, res, next),
);

router.get('/encounters', (req, res, next) =>
  reportsController.getEncounterReport(req, res, next),
);

router.get('/outcomes/dashboard', (req, res, next) =>
  reportsController.getOutcomeDashboard(req, res, next),
);

router.use('/admin-report', adminReportsRoutes);

router.post('/generate', (req, res, next) =>
  reportsController.generateReport(req, res, next),
);

router.get('/:id/download', (req, res, next) =>
  reportsController.downloadReport(req, res, next),
);

router.get('/admin-overview', governanceRoleGate, handleAdminOverview);

// ══════════════════════════════════════════════════════════════════════════════
//  CLINICAL ALERTS ENDPOINT — overdue + upcoming for dashboard cards
// ══════════════════════════════════════════════════════════════════════════════
router.get('/clinical-alerts', clinicalAlertsRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { resolveStaffNames, resolveTeamNames } = await import('../../utils/nameResolver');
    const clinicId = req.clinicId;
    const staffId = req.user!.id;
    const role = req.user?.role ?? '';
    const teamId = req.query.teamId as string | undefined;
    const daysAhead = parseInt(req.query.daysAhead as string, 10) || 14;
    const daysBack = parseInt(req.query.daysBack as string, 10) || 30;
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysAhead * 86400000);
    const pastDate = new Date(now.getTime() - daysBack * 86400000);

    if (teamId) {
      const team = await db('org_units')
        .where({ id: teamId, clinic_id: clinicId })
        .first('id');
      if (!team) {
        throw new AppError('Team not found in this clinic', 404, 'NOT_FOUND');
      }

      const bypassRoles = new Set(['admin', 'manager', 'superadmin']);
      if (!bypassRoles.has(role)) {
        const directTeamMembership = await db('staff_team_assignments')
          .where({
            clinic_id: clinicId,
            org_unit_id: teamId,
            staff_id: staffId,
            is_active: true,
          })
          .first('id');

        const directRoleAssignment = await db('staff_role_assignments')
          .where({
            clinic_id: clinicId,
            org_unit_id: teamId,
            staff_id: staffId,
            is_active: true,
          })
          .first('id');

        if (!directTeamMembership && !directRoleAssignment) {
          throw new AppError(
            'Only team members or managers may scope alerts to this team',
            403,
            'TEAM_SCOPE_FORBIDDEN',
          );
        }
      }
    }

    const normalizedRole = role.trim().toLowerCase();
    const clinicWideRoles = new Set(['manager', 'admin', 'superadmin']);

    // Scope clinical alerts by selected team when provided; otherwise:
    // - manager/admin/superadmin see clinic-wide open-episode patient set
    // - other roles see own open-episode patient set
    const patientFilter = teamId
      ? db('episodes')
        .where({ clinic_id: clinicId, team_id: teamId, status: 'open' })
        .whereNull('deleted_at')
        .select('patient_id')
      : clinicWideRoles.has(normalizedRole)
        ? db('episodes')
          .where({ clinic_id: clinicId, status: 'open' })
          .whereNull('deleted_at')
          .select('patient_id')
        : db('episodes')
          .where({
            clinic_id: clinicId,
            primary_clinician_id: staffId,
            status: 'open',
          })
          .whereNull('deleted_at')
          .select('patient_id');

    type ClinicalAlertRow = {
      dueDate: string | Date;
      alertType: string;
      clinicianId?: string;
      teamId?: string;
      [key: string]: unknown;
    };

    const alertQueries = [
      // LAI overdue
      db('lai_schedules as l').join('patients as p', 'p.id', 'l.patient_id')
        .where({ 'l.clinic_id': clinicId, 'l.status': 'active' })
        .whereIn('l.patient_id', patientFilter)
        .whereRaw('l.next_due_date < CURRENT_DATE')
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          'l.drug_name as detail', 'l.next_due_date as dueDate', db.raw("'lai_overdue' as alertType")),
      // LAI upcoming
      db('lai_schedules as l').join('patients as p', 'p.id', 'l.patient_id')
        .where({ 'l.clinic_id': clinicId, 'l.status': 'active' })
        .whereIn('l.patient_id', patientFilter)
        .whereRaw('l.next_due_date >= CURRENT_DATE AND l.next_due_date <= ?', [futureDate])
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          'l.drug_name as detail', 'l.next_due_date as dueDate', db.raw("'lai_upcoming' as alertType")),
      // Legal orders expiring soon
      db('patient_legal_orders as lo').join('patients as p', 'p.id', 'lo.patient_id')
        .where({ 'lo.status': 'active', 'lo.clinic_id': clinicId, 'p.clinic_id': clinicId })
        .whereIn('lo.patient_id', patientFilter)
        .whereRaw('lo.end_date <= ? AND lo.end_date >= CURRENT_DATE', [futureDate])
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("COALESCE(lo.order_type_id::text, 'Legal Order') as detail"), 'lo.end_date as dueDate', db.raw("'legal_expiring' as alertType")),
      // Legal orders expired
      db('patient_legal_orders as lo').join('patients as p', 'p.id', 'lo.patient_id')
        .where({ 'lo.status': 'active', 'lo.clinic_id': clinicId, 'p.clinic_id': clinicId })
        .whereIn('lo.patient_id', patientFilter)
        .whereRaw('lo.end_date < CURRENT_DATE')
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("COALESCE(lo.order_type_id::text, 'Legal Order') as detail"), 'lo.end_date as dueDate', db.raw("'legal_expired' as alertType")),
      // 91-day review overdue
      db('episodes as e').join('patients as p', 'p.id', 'e.patient_id')
        .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
        .whereIn('e.patient_id', patientFilter)
        .whereRaw("e.start_date < CURRENT_DATE - INTERVAL '91 days'")
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          'e.start_date as detail', db.raw("e.start_date + INTERVAL '91 days' as dueDate"), db.raw("'review_91d_overdue' as alertType"),
          'e.primary_clinician_id as clinicianId', 'e.team_id as teamId'),
      // 91-day review upcoming (due within next 7 days, not yet overdue)
      db('episodes as e').join('patients as p', 'p.id', 'e.patient_id')
        .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
        .whereIn('e.patient_id', patientFilter)
        .whereRaw("e.start_date >= CURRENT_DATE - INTERVAL '91 days'")
        .whereRaw("e.start_date < CURRENT_DATE - INTERVAL '84 days'")
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          'e.start_date as detail', db.raw("e.start_date + INTERVAL '91 days' as dueDate"), db.raw("'review_91d_upcoming' as alertType"),
          'e.primary_clinician_id as clinicianId', 'e.team_id as teamId'),
      // Missed appointments (no-show in last N days)
      db('appointments as a').join('patients as p', 'p.id', 'a.patient_id')
        .where({ 'a.clinic_id': clinicId, 'a.status': 'no_show' }).whereNull('a.deleted_at')
        .whereIn('a.patient_id', patientFilter)
        .whereBetween('a.appointment_start', [pastDate, now])
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("a.appointment_type as detail"), 'a.appointment_start as dueDate', db.raw("'missed_appointment' as alertType")),
      // Overdue medical review (episodes open > 30 days without a note of type 'medical_review')
      db('episodes as e').join('patients as p', 'p.id', 'e.patient_id')
        .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
        .whereIn('e.patient_id', patientFilter)
        .whereNotExists(function() {
          this.select(db.raw('1')).from('clinical_notes as cn')
            .whereRaw('cn.patient_id = e.patient_id')
            .whereRaw("cn.note_type IN ('medical_review', 'psychiatrist_review')")
            .whereRaw('cn.created_at > CURRENT_DATE - INTERVAL \'30 days\'')
            .whereNull('cn.deleted_at');
        })
        .whereRaw("e.start_date < CURRENT_DATE - INTERVAL '30 days'")
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("'No medical review in 30d' as detail"), 'e.start_date as dueDate', db.raw("'overdue_medical_review' as alertType")),
      // NEW-S1-B fix (2026-04-30): pre-fix query referenced `m.recipient_id`
      // which does NOT exist in the `messages` table (verified against
      // schema-snapshot.json). The `messages` schema tracks recipients via
      // `message_thread_participants` (per-thread, not per-message), so the
      // broken query crashed with "column m.recipient_id does not exist".
      // Per-staff unread-message alert deferred to post-staging — see
      // BUG-NEW-S1-B-FOLLOWUP-UNREAD-MESSAGES-ALERT. Returning 0 preserves
      // the Promise.all array shape and the response contract.
      Promise.resolve(0),
      // Open incidents
      db('escalations').where({ clinic_id: clinicId }).whereNull('deleted_at')
        .whereIn('status', ['open', 'active', 'new'])
        .whereIn('patient_id', patientFilter)
        .count('* as cnt').then(extractCount),
      // Overdue tasks for this clinician
      // BUG-NEW-S1-CASCADE-A fix (2026-04-30): correct column is `due_date`
      // not `due_at` (verified against schema-snapshot.json). Pre-fix this
      // slot crashed at runtime with "column due_at does not exist". The
      // crash rejected the entire /clinical-alerts Promise.all, so the
      // dashboard alerts surface returned 500 to clinicians for weeks.
      db('tasks').where({ clinic_id: clinicId, assigned_to_id: staffId })
        .whereIn('status', OPEN_TASK_STATUSES).whereRaw('due_date < CURRENT_DATE')
        .count('* as cnt').then(extractCount),
      // Metabolic monitoring overdue (no outcome_measure of type metabolic_monitoring in 90 days)
      db('episodes as e').join('patients as p', 'p.id', 'e.patient_id')
        .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
        .whereIn('e.patient_id', patientFilter)
        .whereNotExists(function() {
          this.select(db.raw('1')).from('outcome_measures as om')
            .whereRaw('om.patient_id = e.patient_id')
            .whereNull('om.deleted_at')
            .whereRaw("om.measure_type IN ('metabolic_monitoring', 'physical_health')")
            .whereRaw('om.created_at > CURRENT_DATE - INTERVAL \'90 days\'');
        })
        .whereRaw("e.start_date < CURRENT_DATE - INTERVAL '90 days'")
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("'No metabolic profile in 90d' as detail"), db.raw("CURRENT_DATE as dueDate"), db.raw("'metabolic_overdue' as alertType")),
      // Upcoming post-discharge follow-up contacts (episodes closed in last 7 days, no contact record)
      db('episodes as e').join('patients as p', 'p.id', 'e.patient_id')
        .where({ 'e.clinic_id': clinicId, 'e.status': 'closed' }).whereNull('e.deleted_at')
        .whereRaw("e.end_date >= CURRENT_DATE - INTERVAL '7 days'")
        .whereNotExists(function() {
          this.select(db.raw('1')).from('contact_records as cr')
            .whereRaw('cr.patient_id = e.patient_id')
            .whereRaw('cr.created_at > e.end_date');
        })
        .select('p.id as patientId', 'p.given_name as givenName', 'p.family_name as familyName', 'p.emr_number as emrNumber',
          db.raw("'Post-discharge contact needed' as detail"), 'e.end_date as dueDate', db.raw("'post_discharge_contact' as alertType")),
    ] as const;

    const resolvedAlertQueries: unknown[] = [];
    for (const query of alertQueries) {
      // BUG-722: request-scoped RLS uses one transaction connection;
      // execute query fan-out sequentially.
      resolvedAlertQueries.push(await query);
    }

    const [
      laiOverdue, laiUpcoming,
      legalExpiring, legalExpired,
      review91Overdue,
      review91Upcoming,
      missedAppts,
      overdueMedReview,
      unreadMessages,
      openIncidents,
      overdueTasks,
      metabolicOverdue,
      postDischargeContacts,
    ] = resolvedAlertQueries as [
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      ClinicalAlertRow[],
      number,
      number,
      number,
      ClinicalAlertRow[],
      ClinicalAlertRow[],
    ];

    // Combine all list alerts
    const alerts = [
      ...laiOverdue, ...laiUpcoming,
      ...legalExpiring, ...legalExpired,
      ...review91Overdue,
      ...review91Upcoming,
      ...missedAppts,
      ...overdueMedReview,
      ...metabolicOverdue,
      ...postDischargeContacts,
    ];

    // Resolve staff/team names on 91d review items
    await resolveStaffNames(review91Overdue, 'clinicianId');
    await resolveTeamNames(review91Overdue, 'teamId');
    await resolveStaffNames(review91Upcoming, 'clinicianId');
    await resolveTeamNames(review91Upcoming, 'teamId');

    // Categorize into overdue vs upcoming
    const overdue = alerts.filter((a) => {
      const d = new Date(a.dueDate);
      return d < now || ['lai_overdue', 'legal_expired', 'review_91d_overdue', 'missed_appointment', 'overdue_medical_review', 'metabolic_overdue', 'post_discharge_contact'].includes(a.alertType);
    });
    const upcoming = alerts.filter((a) => ['lai_upcoming', 'legal_expiring', 'review_91d_upcoming'].includes(a.alertType));

    res.json({
      overdue: overdue.map((a) => ({ ...a, dueDate: a.dueDate instanceof Date ? a.dueDate.toISOString().slice(0, 10) : a.dueDate })),
      upcoming: upcoming.map((a) => ({ ...a, dueDate: a.dueDate instanceof Date ? a.dueDate.toISOString().slice(0, 10) : a.dueDate })),
      counts: {
        laiOverdue: laiOverdue.length,
        laiUpcoming: laiUpcoming.length,
        legalExpiring: legalExpiring.length,
        legalExpired: legalExpired.length,
        review91dOverdue: review91Overdue.length,
        review91dUpcoming: review91Upcoming.length,
        missedAppointments: missedAppts.length,
        overdueMedicalReview: overdueMedReview.length,
        metabolicOverdue: metabolicOverdue.length,
        postDischargeContacts: postDischargeContacts.length,
        unreadMessages: unreadMessages,
        openIncidents: openIncidents,
        overdueTasks: overdueTasks,
      },
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CASELOAD REPORT — by team/org level with aggregation
// ══════════════════════════════════════════════════════════════════════════════
router.get('/caseload-by-team', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { resolveTeamNames } = await import('../../utils/nameResolver');
    const clinicId = req.clinicId;

    // Caseload per team (org unit)
    const teamCaseload = await db('episodes as e')
      .join('org_units as ou', 'ou.id', 'e.team_id')
      .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
      .groupBy('ou.id', 'ou.name', 'ou.parent_id')
      .select('ou.id as teamId', 'ou.name as teamName', 'ou.parent_id as parentId', db.raw('count(DISTINCT e.patient_id)::int as caseload'));

    // Caseload per clinician
    const clinicianCaseload = await db('episodes as e')
      .join('staff as s', 's.id', 'e.primary_clinician_id')
      .where({ 'e.clinic_id': clinicId, 'e.status': 'open' }).whereNull('e.deleted_at')
      .groupBy('s.id', 's.given_name', 's.family_name', 's.role', 'e.team_id')
      .select('s.id as staffId', db.raw("s.given_name || ' ' || s.family_name as staffName"), 's.role',
        'e.team_id as teamId', db.raw('count(DISTINCT e.patient_id)::int as caseload'));

    await resolveTeamNames(clinicianCaseload, 'teamId');

    // Build tree with aggregated parent values
    const teamMap = new Map(teamCaseload.map((t) => [t.teamId, t]));
    for (const t of teamCaseload) {
      let parent = teamMap.get(t.parentId);
      while (parent) {
        parent.caseload = (parent.caseload ?? 0); // already counted via group by, but children contribute
        parent = teamMap.get(parent.parentId);
      }
    }

    res.json({ teams: teamCaseload, clinicians: clinicianCaseload });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  QUALITY AUDIT
// ══════════════════════════════════════════════════════════════════════════════

// GET audit templates
// Governance-gated (same class as /admin-overview — QI audit tool touches
// every clinician's signed notes). Tier 1.1 (G17 stop-on-pattern extension).
router.get('/audit-templates', governanceRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const rows = await db('audit_templates').where({ clinic_id: req.clinicId }).whereNull('deleted_at').orderBy('name');
    res.json({ templates: rows });
  } catch (err) { next(err); }
});

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches audit_templates in baseline Section P.
const AUDIT_TEMPLATE_COLUMNS = [
  'id', 'clinic_id', 'name', 'description', 'questions',
  'created_by_id', 'created_at', 'updated_at', 'deleted_at',
] as const;

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches audit_runs in baseline Section P.
const AUDIT_RUN_COLUMNS = [
  'id', 'clinic_id', 'template_id', 'team_id', 'clinician_id',
  'sample_size', 'status', 'selected_note_ids', 'results',
  'created_by_id', 'created_at', 'updated_at',
] as const;

// POST create audit template — governance-gated (same class as /admin-overview).
router.post('/audit-templates', governanceRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { name, description, questions } = AuditTemplateCreateSchema.parse(req.body);
    const [row] = await db('audit_templates').insert({
      clinic_id: req.clinicId, name, description: description ?? null,
      questions: JSON.stringify(questions),
      created_by_id: req.user!.id, created_at: new Date(), updated_at: new Date(),
    }).returning(AUDIT_TEMPLATE_COLUMNS);
    res.status(201).json({ template: row });
  } catch (err) { next(err); }
});

// POST run audit — governance-gated. Samples signed notes across clinicians
// and optionally sends them to the LLM scorer. Must not be triggerable by
// general clinicians / receptionists.
router.post('/audit-runs', governanceRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { templateId, teamId, clinicianId, sampleSize, useLlm } = AuditRunCreateSchema.parse(req.body);
    const clinicId = req.clinicId;

    // Load template
    const template = await db('audit_templates').where({ id: templateId, clinic_id: clinicId }).first();
    if (!template) { res.status(404).json({ error: 'Audit template not found' }); return; }

    // Select random clinical notes for audit
    let q = db('clinical_notes as cn')
      .join('patients as p', 'p.id', 'cn.patient_id')
      .leftJoin('staff as s', 's.id', 'cn.author_id')
      .where('cn.clinic_id', clinicId).whereNull('cn.deleted_at')
      .where('cn.status', 'signed'); // Only audit signed notes

    if (teamId) {
      q = q.whereIn('cn.patient_id',
        db('episodes').where({ team_id: teamId, status: 'open', clinic_id: clinicId }).select('patient_id')
      );
    }
    if (clinicianId) {
      q = q.where('cn.author_id', clinicianId);
    }

    const notes = await q
      .select('cn.id as noteId', 'cn.patient_id as patientId', 'cn.title', 'cn.note_type', 'cn.content', 'cn.created_at',
        db.raw("p.given_name || ' ' || p.family_name as patientName"),
        db.raw("COALESCE(s.given_name || ' ' || s.family_name, 'Unknown') as authorName"),
      )
      .orderByRaw('RANDOM()')
      .limit(sampleSize);

    // Create audit run record
    const [run] = await db('audit_runs').insert({
      clinic_id: clinicId, template_id: templateId,
      team_id: teamId ?? null, clinician_id: clinicianId ?? null,
      sample_size: notes.length, status: useLlm ? 'llm_pending' : 'manual',
      selected_note_ids: JSON.stringify(notes.map((n) => n.noteId)),
      created_by_id: req.user!.id, created_at: new Date(), updated_at: new Date(),
    }).returning(AUDIT_RUN_COLUMNS);

    // If LLM audit requested, fire off async scoring
    if (useLlm) {
      const questions = typeof template.questions === 'string' ? JSON.parse(template.questions) : template.questions;
      const toQuestionText = (question: unknown): string => {
        if (typeof question === 'string') return question;
        if (question && typeof question === 'object' && 'text' in question) {
          const text = (question as { text?: unknown }).text;
          if (typeof text === 'string') return text;
        }
        return String(question ?? '');
      };
      const questionTexts = questions.map((question: unknown) => toQuestionText(question));
      const runtimeSelection = await resolveLockedRuntimeSelection(req.clinicId);
      // Fire async — don't await
      void (async () => {
        try {
          const results: Array<Record<string, unknown>> = [];
          for (const note of notes) {
            try {
              results.push(await scoreClinicalNoteAudit({
                clinicId: req.clinicId!,
                createdById: req.user!.id,
                runId: run.id,
                templateId,
                runtimeSelection,
                noteId: note.noteId,
                patientId: note.patientId ?? null,
                noteType: note.note_type ?? null,
                authorName: note.authorName,
                content: note.content,
                questions: questionTexts,
              }));
            } catch { results.push({ noteId: note.noteId, error: 'LLM scoring failed' }); }
          }
          await db('audit_runs').where({ id: run.id }).update({
            status: 'completed', results: JSON.stringify(results), updated_at: new Date(),
          });
        } catch (_err) {
          await db('audit_runs').where({ id: run.id }).update({ status: 'llm_failed', updated_at: new Date() });
        }
      })();
    }

    res.status(201).json({
      run: { ...run, questions: typeof template.questions === 'string' ? JSON.parse(template.questions) : template.questions },
      selectedNotes: notes,
    });
  } catch (err) { next(err); }
});

// GET audit run results — governance-gated.
router.get('/audit-runs/:id', governanceRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const run = await db('audit_runs').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!run) { res.status(404).json({ error: 'Not found' }); return; }
    const template = await db('audit_templates').where({ id: run.template_id }).first();
    res.json({
      run: { ...run, results: typeof run.results === 'string' ? JSON.parse(run.results) : run.results },
      template,
    });
  } catch (err) { next(err); }
});

// GET list audit runs — governance-gated.
router.get('/audit-runs', governanceRoleGate, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const rows = await db('audit_runs').where({ clinic_id: req.clinicId }).orderBy('created_at', 'desc').limit(50);
    res.json({ runs: rows });
  } catch (err) { next(err); }
});

export default router;
