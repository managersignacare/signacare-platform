/**
 * Group Therapy Session Routes
 * CBT, DBT, ACT, Psychoeducation groups with attendance tracking
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { CreateGroupSessionSchema, UpdateGroupSessionSchema, AddGroupAttendeeSchema, UpdateGroupAttendeeSchema } from '@signacare/shared';

// Local Zod schema for the individual-note endpoint (Phase R3b / CLAUDE.md §12).
// The frontend posts snake_case keys here (unlike the typical camelCase
// convention) because the original route was hand-rolled. Preserved here
// to avoid breaking the existing client. Side effect: optional creation of
// a signed clinical note in the patient's record.
const IndividualNoteSchema = z.object({
  individual_notes: z.string().min(1).max(10000),
  patient_id: z.string().uuid().optional(),
  create_clinical_note: z.boolean().optional(),
  note_category: z.string().max(60).optional(),
  author_id: z.string().uuid().optional(),
});

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.GROUP_THERAPY));
const ROLES = ['clinician', 'admin', 'superadmin'];

// Real schema (Phase R3 / verified against schema-snapshot.json):
// group_sessions: 15 columns; group_session_attendees: 7 columns.
// The DTO previously mapped to 5 ghost columns on attendees
// (attendance, participation_rating, individual_notes, diary_card_completed,
// homework_completed). Phase R3 reconciliation:
//   - attendance              → attendance_status (rename)
//   - individual_notes        → notes (rename)
//   - participation_rating    → DROPPED (no column; clinician should use
//                                       the per-attendee `notes` field)
//   - diary_card_completed    → DROPPED (no column)
//   - homework_completed      → DROPPED (no column)
// The dropped fields were never schema-modeled and never persisted —
// removing them from the write path makes the route work end-to-end
// for the first time.
const GROUP_SESSION_COLUMNS = [
  'id',
  'clinic_id',
  'facilitator_id',
  'name',
  'group_type',
  'program',
  'session_date',
  'start_time',
  'end_time',
  'duration_min',
  'location',
  'notes',
  'status',
  'created_at',
  'updated_at',
] as const;
const GROUP_SESSION_ATTENDEE_COLUMNS = [
  'id',
  'group_session_id',
  'patient_id',
  'attendance_status',
  'notes',
  'created_at',
  'updated_at',
] as const;

// List sessions (with optional filters)
router.get('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { groupType, from, to } = req.query;
    const q = db('group_sessions')
      .where({ 'group_sessions.clinic_id': req.clinicId })
      .leftJoin('staff as f', 'group_sessions.facilitator_id', 'f.id')
      .leftJoin(
        db('group_session_attendees').select('group_session_id').count('* as cnt').groupBy('group_session_id').as('ac'),
        'group_sessions.id', 'ac.group_session_id'
      )
      .select('group_sessions.*', db.raw("f.given_name || ' ' || f.family_name as facilitator_name"), db.raw("COALESCE(ac.cnt, 0)::int as attendee_count"))
      .orderBy('group_sessions.session_date', 'desc');
    if (groupType) q.where('group_sessions.group_type', groupType);
    if (from) q.where('group_sessions.session_date', '>=', from);
    if (to) q.where('group_sessions.session_date', '<=', to);
    const rows = await q;
    res.json(rows);
  } catch (err) { next(err); }
});

// Get session with attendees
router.get('/:id', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await db('group_sessions').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    const attendees = await db('group_session_attendees as a')
      .join('patients as p', 'a.patient_id', 'p.id')
      .where('a.group_session_id', req.params.id)
      .select('a.*', 'p.given_name', 'p.family_name', 'p.emr_number');
    res.json({ ...session, attendees });
  } catch (err) { next(err); }
});

// Create session
router.post('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    CreateGroupSessionSchema.parse(req.body);
    const { name, groupName, groupType, program, sessionDate, startTime, endTime, durationMin,
      location, notes } = req.body;
    const sessionName = name || groupName;
    if (!sessionName) { res.status(400).json({ error: 'name or groupName is required' }); return; }
    const [row] = await db('group_sessions').insert({
      clinic_id: req.clinicId,
      name: sessionName,
      group_type: groupType,
      program: program || null,
      facilitator_id: req.user!.id,
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      duration_min: durationMin || null,
      location,
      notes: notes || null,
      status: 'scheduled',
    }).returning(GROUP_SESSION_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// Update session
router.patch('/:id', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    UpdateGroupSessionSchema.parse(req.body);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const [k, v] of Object.entries(req.body)) {
      updates[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = v;
    }
    delete updates.id; delete updates.clinic_id;
    const [row] = await db('group_sessions').where({ id: req.params.id, clinic_id: req.clinicId }).update(updates).returning(GROUP_SESSION_COLUMNS);
    res.json(row);
  } catch (err) { next(err); }
});

// Add/update attendance
router.post('/:id/attendance', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { attendees } = req.body; // [{patientId, attendance, participationRating, individualNotes, diaryCardCompleted, homeworkCompleted}]
    if (!Array.isArray(attendees)) { res.status(400).json({ error: 'attendees array required' }); return; }
    for (const a of attendees) {
      // Phase R3: write to real columns only. Per-attendee
      // participation_rating + diary_card + homework fields were never
      // schema-modeled — they should live on the per-attendee `notes`
      // column or a future JSONB extension.
      await db('group_session_attendees')
        .insert({
          group_session_id: req.params.id,
          patient_id: a.patientId,
          attendance_status: a.attendance || 'attended',
          notes: a.individualNotes ?? null,
        })
        .onConflict(['group_session_id', 'patient_id'])
        .merge();
    }
    // Update session status
    await db('group_sessions').where({ id: req.params.id }).update({ status: 'completed', updated_at: new Date() });
    res.json({ ok: true, count: attendees.length });
  } catch (err) { next(err); }
});

// ── Individual Attendee CRUD ──

// List attendees for a session
router.get('/:id/attendees', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('group_session_attendees as a')
      .join('patients as p', 'a.patient_id', 'p.id')
      .where('a.group_session_id', req.params.id)
      .select('a.*', db.raw("p.given_name || ' ' || p.family_name as patient_name"), 'p.emr_number as patient_ur');
    res.json(rows);
  } catch (err) { next(err); }
});

// Add single patient to session
router.post('/:id/attendees', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = AddGroupAttendeeSchema.parse(req.body);
    const { patient_id, attendance } = dto;
    const [row] = await db('group_session_attendees').insert({
      group_session_id: req.params.id,
      patient_id,
      attendance_status: attendance ?? 'attended',
    }).onConflict(['group_session_id', 'patient_id']).merge().returning(GROUP_SESSION_ATTENDEE_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// Update individual attendee (attendance, rating, diary, homework)
router.patch('/:id/attendees/:attendeeId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateGroupAttendeeSchema.parse(req.body);
    const updates: Record<string, unknown> = {};
    // Phase R3: map DTO field names to real DB columns.
    if (dto.attendance !== undefined) updates['attendance_status'] = dto.attendance;
    if (dto.individual_notes !== undefined) updates['notes'] = dto.individual_notes;
    // participation_rating, diary_card_completed, homework_completed are
    // not schema-modeled — silently drop them rather than crash. Schema
    // extension is tracked separately.
    const [row] = await db('group_session_attendees')
      .where({ id: req.params.attendeeId, group_session_id: req.params.id })
      .update(updates).returning(GROUP_SESSION_ATTENDEE_COLUMNS);
    res.json(row);
  } catch (err) { next(err); }
});

// Remove patient from session
router.delete('/:id/attendees/:attendeeId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('group_session_attendees').where({ id: req.params.attendeeId, group_session_id: req.params.id }).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Save individual note + create clinical note in patient record
router.post('/:id/attendees/:attendeeId/note', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { individual_notes, patient_id, create_clinical_note, note_category, author_id } = IndividualNoteSchema.parse(req.body);

    // Update attendee notes (real column is 'notes', not 'individual_notes')
    await db('group_session_attendees')
      .where({ id: req.params.attendeeId, group_session_id: req.params.id })
      .update({ notes: individual_notes });

    // Optionally create a clinical note in the patient's record
    if (create_clinical_note && patient_id) {
      const session = await db('group_sessions').where({ id: req.params.id }).first();
      const noteContent = `GROUP THERAPY NOTE\nGroup: ${session?.name ?? ''}\nDate: ${session?.session_date ?? ''}\n\n${individual_notes}`;

      await db('clinical_notes').insert({
        clinic_id: req.clinicId,
        patient_id,
        author_id: author_id ?? req.user!.id,
        note_category: note_category ?? 'group-therapy',
        source_type: 'manual',
        content_html: noteContent,
        is_signed: true,
        is_draft: false,
        signed_by_id: req.user!.id,
        signed_at: new Date(),
        note_date: session?.session_date ?? new Date().toISOString().split('T')[0],
      });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Get patient's group history
router.get('/patient/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('group_session_attendees as a')
      .join('group_sessions as s', 'a.group_session_id', 's.id')
      .where('a.patient_id', req.params.patientId)
      .select('a.*', 's.name', 's.group_type', 's.session_date')
      .orderBy('s.session_date', 'desc');
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
