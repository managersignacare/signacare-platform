import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/db';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requirePatientRelationship } from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError, ErrorCode } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
import { detectAndRecordSensitiveFlags } from './scribeSafetyService';
import { buildScribeActionLineageKey } from './scribeActionLineage';

const router = Router();

// ── Tier 12.8–12.10 — Scribe Sessions (pause / resume / whisper mode) ──────
//
// A scribe session wraps a scribe recording so clinicians can pause mid-
// consult (for handovers, interruptions, calls) and resume without
// splitting the transcript. Whisper-mode (12.10) is a UI/audio hint that
// the session is an outpatient dictation — the server stores the flag so
// downstream pipelines can adjust speech-model parameters.

const SessionStartSchema = z.object({
  patientId: z.string().uuid(),
  consentId: z.string().uuid().optional(),
  whisperMode: z.boolean().optional(),
});

const SessionPatchSchema = z.object({
  action: z.enum(['pause', 'resume', 'end', 'abandon']),
});
const DateLikeResponseSchema = z.union([z.string(), z.date()]);
const ScribeSessionStatusResponseSchema = z.enum(['active', 'paused', 'completed', 'abandoned']);

const ScribeSessionRowResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  patientId: z.string().uuid(),
  consentId: z.string().uuid().nullable(),
  status: ScribeSessionStatusResponseSchema,
  whisperMode: z.boolean(),
  startedAt: DateLikeResponseSchema,
  pausedAt: DateLikeResponseSchema.nullable(),
  resumedAt: DateLikeResponseSchema.nullable(),
  endedAt: DateLikeResponseSchema.nullable(),
});

const SensitiveCategoryResponseSchema = z.enum([
  'self_harm',
  'suicide_intent',
  'violence_to_others',
  'abuse_disclosure',
  'child_protection',
  'domestic_violence',
  'substance_misuse',
  'sexual_assault',
  'eating_disorder_critical',
  'psychosis_acute',
]);

const SensitiveSeverityResponseSchema = z.enum(['low', 'moderate', 'high', 'critical']);

const SensitiveScanFlagResponseSchema = z.object({
  id: z.string().uuid(),
  category: SensitiveCategoryResponseSchema,
  severity: SensitiveSeverityResponseSchema,
});

const SensitiveScanResponseSchema = z.object({
  flags: z.array(SensitiveScanFlagResponseSchema),
  count: z.number().int().nonnegative(),
});

const SensitiveFlagQueueRowResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  category: SensitiveCategoryResponseSchema,
  severity: SensitiveSeverityResponseSchema,
  snippet: z.string(),
  transcriptOffset: z.number().int().nonnegative(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: DateLikeResponseSchema.nullable(),
  reviewDisposition: z.string().nullable(),
  createdAt: DateLikeResponseSchema,
});

const SensitiveFlagListResponseSchema = z.object({
  flags: z.array(SensitiveFlagQueueRowResponseSchema),
});

const SensitiveFlagReviewResponseSchema = z.object({
  id: z.string().uuid(),
  reviewed_by: z.string().uuid(),
  reviewed_at: DateLikeResponseSchema,
  review_disposition: z.enum(['false_positive', 'acknowledged', 'escalated', 'action_taken']),
});

const ActionItemStatusResponseSchema = z.enum(['pending_review', 'accepted', 'rejected', 'applied']);

const ActionItemRowResponseSchema = z.object({
  id: z.string().uuid(),
  itemType: z.enum([
    'task',
    'medication_change',
    'medication_new',
    'referral',
    'investigation',
    'followup',
    'letter',
    'escalation',
  ]),
  description: z.string(),
  assigneeRole: z.string().nullable(),
  dueDate: z.union([z.string(), z.date(), z.null()]),
  lineageKey: z.string().min(1),
  status: ActionItemStatusResponseSchema,
  createdAt: DateLikeResponseSchema,
  downstreamTable: z.string().nullable().optional(),
  downstreamId: z.string().uuid().nullable().optional(),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: DateLikeResponseSchema.nullable().optional(),
});

const ActionItemListResponseSchema = z.object({
  items: z.array(ActionItemRowResponseSchema),
});

const ActionItemReviewResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['accepted', 'rejected']),
  reviewed_by: z.string().uuid(),
  reviewed_at: DateLikeResponseSchema,
});

const ActionItemLinkResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('applied'),
  downstreamTable: z.string().min(1),
  downstreamId: z.string().uuid(),
});

const TalkTimeRatioResponseSchema = z.object({
  clinicianRatio: z.number().nonnegative(),
  patientRatio: z.number().nonnegative(),
  silenceRatio: z.number().nonnegative(),
});

const TalkTimeUpsertResponseSchema = z.object({
  sessionId: z.string().uuid(),
  clinicianSeconds: z.number().int().nonnegative(),
  patientSeconds: z.number().int().nonnegative(),
  silenceSeconds: z.number().int().nonnegative(),
  totalSeconds: z.number().int().nonnegative(),
  ratio: TalkTimeRatioResponseSchema.nullable(),
});

const TalkTimeReadResponseSchema = z.object({
  clinicianSeconds: z.number().int().nonnegative(),
  patientSeconds: z.number().int().nonnegative(),
  silenceSeconds: z.number().int().nonnegative(),
  totalSeconds: z.number().int().nonnegative(),
  ratio: TalkTimeRatioResponseSchema.nullable(),
});

function mapScribeSessionRowToResponse(row: unknown) {
  return ScribeSessionRowResponseSchema.parse(row);
}

function mapSensitiveScanToResponse(flags: unknown) {
  const parsedFlags = z.array(z.unknown()).parse(flags).map((flag) => SensitiveScanFlagResponseSchema.parse(flag));
  return SensitiveScanResponseSchema.parse({
    flags: parsedFlags,
    count: parsedFlags.length,
  });
}

function mapSensitiveFlagListToResponse(rows: unknown) {
  const parsedRows = z.array(z.unknown()).parse(rows).map((row) => SensitiveFlagQueueRowResponseSchema.parse(row));
  return SensitiveFlagListResponseSchema.parse({ flags: parsedRows });
}

function mapSensitiveFlagReviewToResponse(row: unknown) {
  return SensitiveFlagReviewResponseSchema.parse(row);
}

function mapActionItemListToResponse(rows: unknown) {
  const parsedRows = z.array(z.unknown()).parse(rows).map((row) => ActionItemRowResponseSchema.parse(row));
  return ActionItemListResponseSchema.parse({ items: parsedRows });
}

function mapActionItemReviewToResponse(row: unknown) {
  return ActionItemReviewResponseSchema.parse(row);
}

function mapActionItemLinkToResponse(row: unknown) {
  return ActionItemLinkResponseSchema.parse(row);
}

function mapTalkTimeUpsertToResponse(payload: unknown) {
  return TalkTimeUpsertResponseSchema.parse(payload);
}

function mapTalkTimeReadToResponse(payload: unknown) {
  return TalkTimeReadResponseSchema.parse(payload);
}

// POST /api/v1/scribe/session — start a session. Caller must have a
// clinician-patient relationship; consent can be attached now or added
// later via PATCH.
router.post(
  '/session',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SessionStartSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      await requirePatientRelationship(auth, dto.patientId);

      const [row] = await db('scribe_sessions')
        .insert({
          clinic_id: req.clinicId,
          clinician_id: req.user!.id,
          patient_id: dto.patientId,
          consent_id: dto.consentId ?? null,
          status: 'active',
          whisper_mode: dto.whisperMode ?? false,
        })
        .returning([
          'id',
          'clinic_id as clinicId',
          'clinician_id as clinicianId',
          'patient_id as patientId',
          'consent_id as consentId',
          'status',
          'whisper_mode as whisperMode',
          'started_at as startedAt',
          'paused_at as pausedAt',
          'resumed_at as resumedAt',
          'ended_at as endedAt',
        ]);

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'CREATE',
        tableName: 'scribe_sessions',
        recordId: row.id,
        newData: { patientId: dto.patientId, whisperMode: dto.whisperMode },
      });

      res.status(201).json(mapScribeSessionRowToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/scribe/session/:id — state transitions.
//
// Allowed: active→paused, paused→active (via resume), any→completed
// (via end), any→abandoned (via abandon). Invalid transitions respond
// 409 rather than silently succeeding — a broken client shouldn't be
// able to "pause" an already-paused session and lose the paused_at
// anchor.
router.patch(
  '/session/:id',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action } = SessionPatchSchema.parse(req.body);
      const existing = await db('scribe_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));

      // BUG-276 — patient-relationship gate. The existing ownership
      // check below (originating clinician OR admin/superadmin) protects
      // the session metadata, but state transitions expose session
      // patient_id to downstream pipeline (ambient processor, action
      // items, etc.). A clinician who IS the originating clinician must
      // ALSO have an active care relationship — otherwise a clinician
      // who started a session against a patient they no longer treat
      // can continue mutating it indefinitely.
      const auth = buildAuthContext(req, existing.patient_id);
      await requirePatientRelationship(auth, existing.patient_id);

      // Only the originating clinician, an admin, or a superadmin may
      // mutate the session. Anyone else is a 403 — a second clinician
      // shouldn't be able to end another's session from a shared client.
      if (
        existing.clinician_id !== req.user!.id &&
        req.user!.role !== 'admin' &&
        req.user!.role !== 'superadmin'
      ) {
        return next(
          new AppError('Forbidden — not the session clinician', 403, ErrorCode.FORBIDDEN),
        );
      }

      const now = new Date();
      const patch: Record<string, unknown> = { updated_at: now };

      if (action === 'pause') {
        if (existing.status !== 'active') {
          return next(
            new AppError(`Cannot pause — session is ${existing.status}`, 409, ErrorCode.CONFLICT),
          );
        }
        patch.status = 'paused';
        patch.paused_at = now;
      } else if (action === 'resume') {
        if (existing.status !== 'paused') {
          return next(
            new AppError(`Cannot resume — session is ${existing.status}`, 409, ErrorCode.CONFLICT),
          );
        }
        patch.status = 'active';
        patch.resumed_at = now;
      } else if (action === 'end') {
        if (existing.status === 'completed' || existing.status === 'abandoned') {
          return next(
            new AppError(`Session already ${existing.status}`, 409, ErrorCode.CONFLICT),
          );
        }
        patch.status = 'completed';
        patch.ended_at = now;
      } else {
        // abandon
        if (existing.status === 'completed' || existing.status === 'abandoned') {
          return next(
            new AppError(`Session already ${existing.status}`, 409, ErrorCode.CONFLICT),
          );
        }
        patch.status = 'abandoned';
        patch.ended_at = now;
      }

      const [row] = await db('scribe_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(patch)
        .returning([
          'id',
          'clinic_id as clinicId',
          'clinician_id as clinicianId',
          'patient_id as patientId',
          'consent_id as consentId',
          'status',
          'whisper_mode as whisperMode',
          'started_at as startedAt',
          'paused_at as pausedAt',
          'resumed_at as resumedAt',
          'ended_at as endedAt',
        ]);

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'UPDATE',
        tableName: 'scribe_sessions',
        recordId: row.id,
        newData: { action, status: row.status },
      });

      res.json(mapScribeSessionRowToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/scribe/session/:id — fetch a single session
router.get('/session/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('scribe_sessions')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .select(
        'id',
        'clinic_id as clinicId',
        'clinician_id as clinicianId',
        'patient_id as patientId',
        'consent_id as consentId',
        'status',
        'whisper_mode as whisperMode',
        'started_at as startedAt',
        'paused_at as pausedAt',
        'resumed_at as resumedAt',
        'ended_at as endedAt',
      )
      .first();
    if (!row) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));
    res.json(mapScribeSessionRowToResponse(row));
  } catch (err) {
    next(err);
  }
});

// ── Tier 13.1 — Sensitive-topic flags ──────────────────────────────────────
//
// POST /scribe/session/:id/scan — run the sensitive-topic detector on
// the supplied transcript and persist any matches. Called by the scribe
// pipeline AFTER transcript finalisation (Pass 3 complete), not on raw
// mid-consult audio. The scan is idempotent at the text level — running
// it twice on the same transcript produces duplicate rows, so the
// client is expected to call it once per session-final transcript.

const SensitiveScanSchema = z.object({
  transcript: z.string().min(1).max(200_000),
});

router.post(
  '/session/:id/scan',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transcript } = SensitiveScanSchema.parse(req.body);
      const session = await db('scribe_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!session) return next(new AppError('Session not found', 404, ErrorCode.NOT_FOUND));

      const flags = await detectAndRecordSensitiveFlags({
        clinicId: req.clinicId!,
        sessionId: session.id,
        patientId: session.patient_id,
        transcript,
      });

      res.json(mapSensitiveScanToResponse(flags));
    } catch (err) {
      next(err);
    }
  },
);

// GET /scribe/sensitive-flags?status=unreviewed — triage queue for the
// medical director / safety lead. Scoped to the current clinic via RLS
// + application filter.
router.get(
  '/sensitive-flags',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onlyUnreviewed = req.query.status === 'unreviewed';
      let q = db('scribe_sensitive_flags')
        .where({ clinic_id: req.clinicId })
        .select(
          'id',
          'session_id as sessionId',
          'patient_id as patientId',
          'category',
          'severity',
          'snippet',
          'transcript_offset as transcriptOffset',
          'reviewed_by as reviewedBy',
          'reviewed_at as reviewedAt',
          'review_disposition as reviewDisposition',
          'created_at as createdAt',
        )
        .orderBy([
          { column: 'severity', order: 'asc' },
          { column: 'created_at', order: 'desc' },
        ])
        .limit(200);
      if (onlyUnreviewed) q = q.whereNull('reviewed_at');
      const rows = await q;
      res.json(mapSensitiveFlagListToResponse(rows));
    } catch (err) {
      next(err);
    }
  },
);

const SensitiveFlagReviewSchema = z.object({
  disposition: z.enum(['false_positive', 'acknowledged', 'escalated', 'action_taken']),
});

// PATCH /scribe/sensitive-flags/:id/review — disposition after triage.
router.patch(
  '/sensitive-flags/:id/review',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { disposition } = SensitiveFlagReviewSchema.parse(req.body);
      const [row] = await db('scribe_sensitive_flags')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update({
          reviewed_by: req.user!.id,
          reviewed_at: new Date(),
          review_disposition: disposition,
        })
        .returning(['id', 'reviewed_by', 'reviewed_at', 'review_disposition']);
      if (!row) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));
      res.json(mapSensitiveFlagReviewToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// ── Tier 13.2 — Action items ───────────────────────────────────────────────
//
// Extracted from a note by the LLM (POST /scribe/session/:id/action-items
// takes the structured note + transcript and asks the model to list
// actionable items with type + description + assignee_role + optional
// due_date). Every item starts with status='pending_review' — nothing
// is auto-applied to the EHR. Clinicians accept/reject/apply via
// separate endpoints.

const ActionItemCreateSchema = z.object({
  itemType: z.enum([
    'task',
    'medication_change',
    'medication_new',
    'referral',
    'investigation',
    'followup',
    'letter',
    'escalation',
  ]),
  description: z.string().min(1).max(1000),
  assigneeRole: z.string().max(40).optional(),
  dueDate: z.string().date().optional(),
});

const ActionItemReviewSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

// POST /scribe/session/:id/action-items — bulk create
router.post(
  '/session/:id/action-items',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = z.array(ActionItemCreateSchema).min(1).max(50).parse(req.body.items);
      const session = await db('scribe_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!session) return next(new AppError('Session not found', 404, ErrorCode.NOT_FOUND));

      const rows = await db('scribe_action_items')
        .insert(
          items.map((i) => ({
            clinic_id: req.clinicId,
            session_id: session.id,
            patient_id: session.patient_id,
            item_type: i.itemType,
            description: i.description,
            assignee_role: i.assigneeRole ?? null,
            due_date: i.dueDate ?? null,
            lineage_key: buildScribeActionLineageKey({
              itemType: i.itemType,
              description: i.description,
              assigneeRole: i.assigneeRole ?? null,
              dueDate: i.dueDate ?? null,
            }),
            status: 'pending_review',
          })),
        )
        .onConflict(['clinic_id', 'session_id', 'lineage_key'])
        .ignore()
        .returning([
          'id',
          'item_type as itemType',
          'description',
          'assignee_role as assigneeRole',
          'due_date as dueDate',
          'lineage_key as lineageKey',
          'status',
          'created_at as createdAt',
        ]);
      const lineageKeys = items.map((i) => buildScribeActionLineageKey({
        itemType: i.itemType,
        description: i.description,
        assigneeRole: i.assigneeRole ?? null,
        dueDate: i.dueDate ?? null,
      }));
      const allRows = await db('scribe_action_items')
        .where({ clinic_id: req.clinicId, session_id: session.id })
        .whereIn('lineage_key', lineageKeys)
        .select(
          'id',
          'item_type as itemType',
          'description',
          'assignee_role as assigneeRole',
          'due_date as dueDate',
          'lineage_key as lineageKey',
          'status',
          'created_at as createdAt',
          'downstream_table as downstreamTable',
          'downstream_id as downstreamId',
          'reviewed_by as reviewedBy',
          'reviewed_at as reviewedAt',
        )
        .orderBy('created_at', 'asc');

      const created = rows.length > 0;
      res.status(created ? 201 : 200).json(mapActionItemListToResponse(allRows));
    } catch (err) {
      next(err);
    }
  },
);

// GET /scribe/session/:id/action-items — list for a session
router.get('/session/:id/action-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('scribe_action_items')
      .where({ session_id: req.params.id, clinic_id: req.clinicId })
      .select(
        'id',
        'item_type as itemType',
        'description',
        'assignee_role as assigneeRole',
        'due_date as dueDate',
        'lineage_key as lineageKey',
        'status',
        'downstream_table as downstreamTable',
        'downstream_id as downstreamId',
        'reviewed_by as reviewedBy',
        'reviewed_at as reviewedAt',
        'created_at as createdAt',
      )
      .orderBy('created_at', 'asc');
    res.json(mapActionItemListToResponse(rows));
  } catch (err) {
    next(err);
  }
});

// PATCH /scribe/action-items/:id/review — accept or reject. Accepting
// does NOT auto-apply to the EHR; the clinician still clicks through
// to the task / medication / referral surface and confirms the
// downstream record, which then calls PATCH /scribe/action-items/:id
// with the downstream_table + downstream_id to close the loop.
router.patch(
  '/action-items/:id/review',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = ActionItemReviewSchema.parse(req.body);
      const [row] = await db('scribe_action_items')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update({
          status,
          reviewed_by: req.user!.id,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['id', 'status', 'reviewed_by', 'reviewed_at']);
      if (!row) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));
      res.json(mapActionItemReviewToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

const ActionItemLinkSchema = z.object({
  downstreamTable: z.string().min(1).max(60),
  downstreamId: z.string().uuid(),
});

// PATCH /scribe/action-items/:id/link — record the downstream EHR row
// (task, medication, referral) created from an accepted item.
router.patch(
  '/action-items/:id/link',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { downstreamTable, downstreamId } = ActionItemLinkSchema.parse(req.body);
      const [row] = await db('scribe_action_items')
        .where({ id: req.params.id, clinic_id: req.clinicId, status: 'accepted' })
        .update({
          status: 'applied',
          downstream_table: downstreamTable,
          downstream_id: downstreamId,
          updated_at: new Date(),
        })
        .returning([
          'id',
          'status',
          'downstream_table as downstreamTable',
          'downstream_id as downstreamId',
        ]);
      if (!row) {
        return next(
          new AppError(
            'Not found, or not in status=accepted',
            404,
            ErrorCode.NOT_FOUND,
          ),
        );
      }
      res.json(mapActionItemLinkToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// ── Tier 13.4 — Talk-time metrics ──────────────────────────────────────────
//
// Diarisation output from Whisper gives us per-segment speaker labels
// (clinician / patient / unknown). The scribe pipeline aggregates that
// into clinician_seconds + patient_seconds + silence_seconds and POSTs
// the totals here. One row per session; repeat POSTs overwrite.

const TalkTimeSchema = z.object({
  clinicianSeconds: z.number().int().nonnegative(),
  patientSeconds: z.number().int().nonnegative(),
  silenceSeconds: z.number().int().nonnegative(),
  totalSeconds: z.number().int().nonnegative(),
});

router.put(
  '/session/:id/talk-time',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = TalkTimeSchema.parse(req.body);
      const session = await db('scribe_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!session) return next(new AppError('Session not found', 404, ErrorCode.NOT_FOUND));

      const existing = await db('scribe_talk_time_metrics')
        .where({ session_id: session.id, clinic_id: req.clinicId })
        .first();

      if (existing) {
        await db('scribe_talk_time_metrics')
          .where({ id: existing.id, clinic_id: req.clinicId })
          .update({
            clinician_seconds: dto.clinicianSeconds,
            patient_seconds: dto.patientSeconds,
            silence_seconds: dto.silenceSeconds,
            total_seconds: dto.totalSeconds,
          });
      } else {
        await db('scribe_talk_time_metrics').insert({
          clinic_id: req.clinicId,
          session_id: session.id,
          clinician_seconds: dto.clinicianSeconds,
          patient_seconds: dto.patientSeconds,
          silence_seconds: dto.silenceSeconds,
          total_seconds: dto.totalSeconds,
        });
      }

      const ratio =
        dto.totalSeconds > 0
          ? {
              clinicianRatio: dto.clinicianSeconds / dto.totalSeconds,
              patientRatio: dto.patientSeconds / dto.totalSeconds,
              silenceRatio: dto.silenceSeconds / dto.totalSeconds,
            }
          : null;

      res.json(mapTalkTimeUpsertToResponse({ sessionId: session.id, ...dto, ratio }));
    } catch (err) {
      next(err);
    }
  },
);

router.get('/session/:id/talk-time', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('scribe_talk_time_metrics')
      .where({ session_id: req.params.id, clinic_id: req.clinicId })
      .select(
        'clinician_seconds as clinicianSeconds',
        'patient_seconds as patientSeconds',
        'silence_seconds as silenceSeconds',
        'total_seconds as totalSeconds',
      )
      .first();
    if (!row) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));
    const ratio =
      row.totalSeconds > 0
        ? {
            clinicianRatio: row.clinicianSeconds / row.totalSeconds,
            patientRatio: row.patientSeconds / row.totalSeconds,
            silenceRatio: row.silenceSeconds / row.totalSeconds,
          }
        : null;
    res.json(mapTalkTimeReadToResponse({ ...row, ratio }));
  } catch (err) {
    next(err);
  }
});

export default router;
