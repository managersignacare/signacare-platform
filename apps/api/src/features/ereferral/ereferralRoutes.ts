/**
 * E-Referral Routes
 *
 * ereferrals table has a deliberately small column set with rich extra
 * data stored in the content JSONB. The previous route implementation
 * wrote to 8 columns that don't exist (referring_clinician_id,
 * referral_direction, referred_to_*, urgency, current_medications,
 * risk_summary) — masked by an @code-columns-exempt marker pre-R2.
 *
 * Phase R3 fix: write canonical columns directly + funnel the
 * direction/recipient/clinical metadata into content JSONB. Reads
 * also unpack content so the API shape doesn't change for callers.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { CreateEreferralSchema, UpdateEreferralSchema } from '@signacare/shared';

const router = Router();
router.use(authMiddleware);
const ROLES = ['clinician', 'admin', 'superadmin'];

// Real ereferrals columns per schema-snapshot.json (Phase R3).
const EREFERRAL_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'referrer_name',
  'referrer_org',
  'referrer_phone',
  'referrer_email',
  'priority',
  'status',
  'content',
  'reason',
  'clinical_summary',
  'created_at',
  'updated_at',
] as const;

interface EreferralContent {
  referralDirection?: string;
  referredToService?: string;
  referredToClinician?: string;
  referredToEmail?: string;
  referringClinicianId?: string;
  diagnosis?: string;
  currentMedications?: string;
  riskSummary?: string;
  responseNotes?: string;
  responseAt?: string;
  sentAt?: string;
}

router.get('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { direction, status } = req.query;
    const q = db('ereferrals')
      .where({ 'ereferrals.clinic_id': req.clinicId })
      .join('patients', 'ereferrals.patient_id', 'patients.id')
      .select('ereferrals.*', 'patients.given_name', 'patients.family_name', 'patients.emr_number')
      .orderBy('ereferrals.created_at', 'desc');
    if (direction) {
      // Read referralDirection out of the content JSONB instead of a ghost column.
      q.whereRaw("ereferrals.content->>'referralDirection' = ?", [String(direction)]);
    }
    if (status) q.where('ereferrals.status', status);
    res.json(await q);
  } catch (err) { next(err); }
});

router.post('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateEreferralSchema.parse(req.body);
    const { patientId, urgency, reason, clinicalSummary, diagnosis, currentMedications, riskSummary } = dto;
    const { referralDirection, referredToService, referredToClinician, referredToEmail } = req.body;
    const content: EreferralContent = {
      referralDirection: referralDirection || 'outbound',
      referredToService,
      referredToClinician,
      referredToEmail,
      referringClinicianId: req.user!.id,
      diagnosis,
      currentMedications,
      riskSummary,
    };
    const [row] = await db('ereferrals').insert({
      clinic_id: req.clinicId,
      patient_id: patientId,
      priority: urgency || 'routine',
      reason,
      clinical_summary: clinicalSummary,
      content: JSON.stringify(content),
    }).returning(EREFERRAL_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateEreferralSchema.parse(req.body);
    const { status, responseNotes } = dto;
    const updates: Record<string, unknown> = { status, updated_at: new Date() };
    // sent_at, response_at, response_notes don't exist as columns —
    // funnel them through content JSONB. Read existing content first so
    // the merge doesn't clobber prior fields.
    const existing = await db('ereferrals')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Ereferral not found' });
      return;
    }
    const existingContent: EreferralContent = (typeof existing.content === 'string'
      ? JSON.parse(existing.content)
      : existing.content) ?? {};
    if (status === 'sent') existingContent.sentAt = new Date().toISOString();
    if (status === 'accepted' || status === 'declined') {
      existingContent.responseAt = new Date().toISOString();
      existingContent.responseNotes = responseNotes;
    }
    updates['content'] = JSON.stringify(existingContent);
    const [row] = await db('ereferrals')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update(updates)
      .returning(EREFERRAL_COLUMNS);
    res.json(row);
  } catch (err) { next(err); }
});

export default router;
