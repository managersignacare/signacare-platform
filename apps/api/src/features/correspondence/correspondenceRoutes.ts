import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireFeatureEnabled } from '../../middleware/featureFlagMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';
import * as ctrl from './correspondenceController';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.CORRESPONDENCE));

// POST /correspondence — create a letter (shorthand)
router.post('/', requireRole('clinician', 'admin', 'superadmin'), async (req, res, next) => {
  try {
    // Forward to letters endpoint
    req.url = '/letters';
    ctrl.createLetter(req, res, next);
  } catch (err) { next(err); }
});

// GET /correspondence/patient/:patientId — shorthand
router.get('/patient/:patientId', async (req, res, next) => {
  try {
    req.url = '/letters/patient/' + req.params.patientId;
    req.params = { patientId: req.params.patientId };
    ctrl.listLetters(req, res, next);
  } catch (err) { next(err); }
});

router.get('/templates', ctrl.listTemplates);
// Audit Tier 5.1 — only the AI-drafting endpoint gates on `ai-letter`.
// Creating / reading / editing a manually-typed letter remains
// available even when AI is disabled.
router.post('/generate-from-note', requireRole('clinician', 'admin'), requireFeatureEnabled('ai-letter'), ctrl.generateFromNote);

router.post('/letters', requireRole('clinician', 'admin'), ctrl.createLetter);
router.get('/letters/patient/:patientId', ctrl.listLetters);
router.get('/letters/:letterId', ctrl.getLetter);
router.patch('/letters/:letterId', requireRole('clinician', 'admin'), ctrl.updateLetter);
router.delete('/letters/:letterId', requireRole('clinician', 'admin'), ctrl.deleteLetter);

// GET /correspondence/letters/:letterId/pdf — Generate PDF
router.get('/letters/:letterId/pdf', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const letter = await db('correspondence_letters')
      .where({ id: req.params.letterId, clinic_id: req.clinicId })
      .first();
    if (!letter) { res.status(404).json({ error: 'Letter not found' }); return; }

    const clinic = await db('clinics').where({ id: req.clinicId }).first();
    // BUG-430: explicit clinic_id Layer-1 — `letter` is already tenant-scoped
    // (loaded with clinic_id at line above), so this carries the same tenant;
    // making the invariant explicit at the boundary protects the
    // RLS-disabled code path (CLAUDE.md §1.3).
    const patient = await db('patients').where({ id: letter.patient_id, clinic_id: req.clinicId }).whereNull('patients.deleted_at').first();
    const author = letter.generated_by_id ? await db('staff').where({ id: letter.generated_by_id }).whereNull('staff.deleted_at').first() : null;

    // Check if signature should be included (query param ?sign=true)
    const includeSignature = req.query.sign === 'true';

    const { generateLetterPdf } = await import('../../shared/pdfGenerator');
    const pdfBuffer = await generateLetterPdf({
      clinicName: clinic?.name ?? 'Signacare EMR',
      clinicAddress: clinic?.address ?? '',
      clinicPhone: clinic?.phone ?? '',
      clinicEmail: clinic?.email ?? '',
      date: new Date(letter.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
      recipientName: letter.recipient_name ?? 'To Whom It May Concern',
      patientName: patient ? `${patient.given_name} ${patient.family_name}` : 'Unknown',
      patientDob: patient?.date_of_birth ?? '',
      patientUrNumber: patient?.emr_number ?? '',
      body: letter.body ?? letter.content ?? '',
      authorName: author ? `${author.given_name} ${author.family_name}` : '',
      authorTitle: author?.discipline ?? '',
      authorQualifications: author?.qualifications ?? '',
      signatureDataUrl: includeSignature ? (author?.digital_signature ?? null) : null,
      includeSignature,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="letter-${letter.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

export default router;
