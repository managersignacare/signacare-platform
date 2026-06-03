/**
 * Scribe Enhancement Routes
 *
 * API endpoints for medical-grade scribe features:
 * - Clinician preferences
 * - Smart macros
 * - Patient summary generation
 * - Auto referral/GP letter
 * - ICD-10-AM suggestions
 * - MBS item suggestions
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { requireFeatureEnabled } from '../../middleware/featureFlagMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { db } from '../../db/db';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship, requireSpecialty } from '../../shared/authGuards';
// BUG-284 — disclaimer envelope parity with the rest of the clinical-AI
// surface (BUG-038 shipped CLINICAL_AI_DISCLAIMER as the canonical
// string embedded in every AI-response body).
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { writeLlmAccessBypassAudit } from '../../shared/writeLlmAccessBypassAudit';
import scribeConsentRoutes from './scribeConsentRoutes';
import scribeSessionRoutes from './scribeSessionRoutes';
import scribeCatalogRoutes from './scribeCatalogRoutes';
import { recordScribeReadabilitySignal } from '../../shared/postDeployTelemetry';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// The scribe pipeline accepts structuredNote / assessmentFacts as either
// strings or model-emitted JSON objects/arrays; downstream prompt builders
// want a string. Zod `.transform` coerces to a canonical string at the
// boundary so the downstream signatures stay typed.
const structuredNoteInput = z
  .union([z.string().min(1), z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length > 0, 'structuredNote required')])
  .transform((v) => (typeof v === 'string' ? v : JSON.stringify(v)));

const stringFactArray = z
  .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
  .transform((arr) => arr.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))));

const PatientSummarySchema = z.object({
  structuredNote: structuredNoteInput,
  patientId: z.string().uuid().optional(),
});

const ReferralLetterSchema = z.object({
  structuredNote: structuredNoteInput,
  recipientType: z.enum(['gp', 'specialist', 'service']).optional(),
  recipientName: z.string().max(200).optional(),
  patientId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

const Icd10SuggestSchema = z.object({
  assessmentFacts: stringFactArray.optional(),
  formattedNote: z.string().optional(),
});

const MbsSuggestSchema = z.object({
  contactType: z.string().max(100).optional(),
  durationMinutes: z.number().int().positive().max(600).optional(),
  practitionerType: z.string().max(60).optional(),
  isNewPatient: z.boolean().optional(),
  isTelehealth: z.boolean().optional(),
});

const OutcomeMeasureSchema = z.object({
  transcript: z.string().optional(),
  extractedFacts: stringFactArray.optional(),
});
import {
  getScribePreferences,
  saveScribePreferences,
  PATIENT_SUMMARY_PROMPT,
  buildPatientSummaryPrompt,
  REFERRAL_LETTER_PROMPT,
  buildReferralLetterPrompt,
  autoCodeICD10,
  suggestMBSItems,
  extractOutcomeMeasures,
  wrapAsAiDraft,
  roleLabel,
} from '../../mcp/scribeEnhancements';
import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const router = Router();
router.use(authMiddleware);
// Every scribe endpoint is gated behind the 'medical-scribe' module
// grant. requireModuleRead allows access_level='read' OR 'write' —
// the scribe surface is not split into read/write today, so read
// is the effective "can use" check. Admins and superadmins bypass
// via the BYPASS_ROLES shortcut in moduleAccessMiddleware.
router.use(requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE));
// Subscription module toggle for ambient scribe is independent from
// agentic scribe. Missing-row policy remains fail-open for backward
// compatibility (existing clinics without explicit rows stay enabled
// until a superadmin toggles off the module).
router.use(requireClinicModuleEnabled(MODULE_KEYS.MEDICAL_SCRIBE));
// Audit Tier 5.1 — AI kill switch. When the 2-person disable flow
// completes on `ai-scribe`, every endpoint here returns 403
// FEATURE_DISABLED within the 60s cache TTL. Admin role does NOT
// bypass — a kill switch is for everyone.
router.use(requireFeatureEnabled('ai-scribe'));

// ── Clinician Scribe Preferences ───────────────────────────────────────────

// GET /api/v1/scribe/preferences
router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = await getScribePreferences(req.user!.id);
    res.json(prefs);
  } catch (err) { next(err); }
});

// PUT /api/v1/scribe/preferences
router.put('/preferences',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await saveScribePreferences(req.user!.id, req.body);
      const prefs = await getScribePreferences(req.user!.id);
      res.json(prefs);
    } catch (err) { next(err); }
  },
);

// ── Smart Macros ───────────────────────────────────────────────────────────

// GET /api/v1/scribe/macros
router.get('/macros', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = await getScribePreferences(req.user!.id);
    // Merge user macros with system defaults
    const systemMacros: Record<string, string> = {
      'NAD': 'No abnormality detected',
      'WNL': 'Within normal limits',
      'NBM': 'Nil by mouth',
      'NFA': 'No further action',
      'RV': 'Review',
      'F/U': 'Follow-up',
      'Pt': 'Patient',
      'Hx': 'History',
      'Dx': 'Diagnosis',
      'Tx': 'Treatment',
      'Rx': 'Prescription',
      'Ix': 'Investigations',
      'Sx': 'Symptoms',
      'Cx': 'Complications',
      'O/E': 'On examination',
      'c/o': 'Complaining of',
      'SOB': 'Shortness of breath',
      'BIBA': 'Brought in by ambulance',
      'BIB': 'Brought in by',
      'NKDA': 'No known drug allergies',
      'MSE WNL': 'Mental state examination within normal limits. Appearance: appropriately dressed, good hygiene, good eye contact. Behaviour: cooperative, no psychomotor abnormality. Speech: normal rate, volume, and rhythm. Mood: euthymic. Affect: reactive, congruent with mood. Thought form: logical, goal-directed. Thought content: no suicidal or homicidal ideation, no delusions. Perception: no hallucinations reported. Cognition: grossly intact, oriented to time, place, and person. Insight: good. Judgement: intact.',
      'LOW RISK': 'Risk to self: Low — no current suicidal ideation, no self-harm. Risk to others: Low — no homicidal ideation, no aggressive behaviour. Vulnerability: Low — adequate support, engaged in treatment. Protective factors: engaged in treatment, supportive family, employed.',
      'STANDARD F/U': 'Follow-up appointment in 4 weeks. Continue current medications. Review at next appointment. Contact crisis team if deterioration.',
    };
    res.json({ systemMacros, userMacros: prefs.macros ?? {} });
  } catch (err) { next(err); }
});

// PUT /api/v1/scribe/macros
router.put('/macros',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = await getScribePreferences(req.user!.id);
      prefs.macros = req.body.macros ?? {};
      await saveScribePreferences(req.user!.id, prefs);
      res.json({ macros: prefs.macros });
    } catch (err) { next(err); }
  },
);

// ── After-Visit Patient Summary ────────────────────────────────────────────

// POST /api/v1/scribe/patient-summary
router.post('/patient-summary',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { structuredNote, patientId } = PatientSummarySchema.parse(req.body);

      // BUG-036 — patient-relationship gate. patientId is optional per
      // PatientSummarySchema, so the gate is conditional. When absent,
      // only the already-sanitized structuredNote flows (from a prior
      // scribe session that had its own /ambient-note gate — BUG-035).
      if (patientId) {
        const auth = buildAuthContext(req, patientId);
        await requirePatientRelationship(auth, patientId);
      }

      // Get patient name
      let patientName = 'there';
      if (patientId) {
        const patient = await db('patients').where({ id: patientId }).first();
        if (patient) patientName = patient.given_name ?? patient.preferred_name ?? 'there';
      }

      const prompt = buildPatientSummaryPrompt(structuredNote, patientName);
      const model = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

      const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
        model,
        system: PATIENT_SUMMARY_PROMPT,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }, { timeout: 60000 });

      // Tier 12.1 — wrap in AI-DRAFT header so the clinician cannot
      // miss that this is un-reviewed model output.
      const summary = wrapAsAiDraft(resp.data?.response ?? '');
      // BUG-284 — disclaimer envelope parity with /suggest, /clinical-ai,
      // /agent. Frontend must surface the AI-source signal via this
      // canonical field; auditors parse it across the full LLM surface.
      // BUG-279 — explicit bypass-role audit for /scribe/patient-summary.
      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
        endpoint: '/scribe/patient-summary',
        feature: 'scribe-patient-summary',
      });
      recordScribeReadabilitySignal({
        feature: 'scribe-patient-summary',
        text: summary,
      });
      res.json({ summary, patientName, isAiDraft: true, disclaimer: CLINICAL_AI_DISCLAIMER });
    } catch (err) { next(err); }
  },
);

// ── Auto Referral / GP Letter ──────────────────────────────────────────────

// POST /api/v1/scribe/referral-letter
router.post('/referral-letter',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { structuredNote, recipientType, recipientName, patientId, reason } = ReferralLetterSchema.parse(req.body);

      // BUG-036 — patient-relationship gate. patientId is optional per
      // ReferralLetterSchema; when present, loads DOB/MRN into the Ollama
      // prompt — must verify clinician-patient relationship first.
      if (patientId) {
        const auth = buildAuthContext(req, patientId);
        await requirePatientRelationship(auth, patientId);
      }

      // Get patient and clinician details
      let patientName = '', patientDob = '', patientMrn = '';
      if (patientId) {
        const patient = await db('patients').where({ id: patientId }).first();
        if (patient) {
          patientName = `${patient.given_name} ${patient.family_name}`;
          patientDob = patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString('en-AU') : '';
          patientMrn = patient.emr_number ?? '';
        }
      }

      const staff = await db('staff').where({ id: req.user!.id }).first();
      const clinicianName = staff ? `${staff.given_name} ${staff.family_name}` : '';
      // Tier 12.4 — role labels must match the clinician's role so the
      // letter's sign-off reads correctly ("Consultant Psychiatrist"
      // vs "Clinical Psychologist" etc.). Fall back to "Treating
      // Clinician" when the row has no role.
      const clinicianRole = staff?.role ?? req.user!.role ?? '';

      const prompt = buildReferralLetterPrompt(
        structuredNote,
        recipientType ?? 'gp',
        recipientName ?? 'GP',
        patientName,
        patientDob,
        patientMrn,
        clinicianName,
        clinicianRole,
        reason,
      );

      const model = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
      const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
        model,
        system: REFERRAL_LETTER_PROMPT,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }, { timeout: 60000 });

      // Tier 12.1 — AI-DRAFT header on referral letters too.
      const letter = wrapAsAiDraft(resp.data?.response ?? '');
      // BUG-284 — disclaimer envelope parity (see /patient-summary).
      // BUG-279 — explicit bypass-role audit for /scribe/referral-letter.
      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
        endpoint: '/scribe/referral-letter',
        feature: 'scribe-referral-letter',
      });
      res.json({
        letter,
        patientName,
        clinicianName,
        clinicianRoleLabel: roleLabel(clinicianRole),
        isAiDraft: true,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      });
    } catch (err) { next(err); }
  },
);

// ── ICD-10-AM Suggestions ──────────────────────────────────────────────────

// POST /api/v1/scribe/icd10-suggest
router.post('/icd10-suggest',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { assessmentFacts, formattedNote } = Icd10SuggestSchema.parse(req.body);
      const suggestions = autoCodeICD10(assessmentFacts ?? [], formattedNote ?? '');
      res.json({ suggestions });
    } catch (err) { next(err); }
  },
);

// ── MBS Item Suggestions ───────────────────────────────────────────────────

// POST /api/v1/scribe/mbs-suggest
router.post('/mbs-suggest',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contactType, durationMinutes, practitionerType, isNewPatient, isTelehealth } = MbsSuggestSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const suggestions = suggestMBSItems(
        contactType ?? '',
        durationMinutes ?? 30,
        practitionerType ?? 'psychiatrist',
        isNewPatient ?? false,
        isTelehealth ?? false,
      );
      const includesMedicoLegalPsychiatryItem = suggestions.some((s) => s.itemNumber === '291');
      if (includesMedicoLegalPsychiatryItem) {
        await requireSpecialty(auth, ['psychiatry']);
      }
      res.json({ suggestions });
    } catch (err) { next(err); }
  },
);

// ── Outcome Measure Extraction ─────────────────────────────────────────────

// POST /api/v1/scribe/outcome-measures
router.post('/outcome-measures',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transcript, extractedFacts } = OutcomeMeasureSchema.parse(req.body);
      const measures = extractOutcomeMeasures(transcript ?? '', extractedFacts ?? []);
      res.json({ measures });
    } catch (err) { next(err); }
  },
);

// BUG-330 — split monolithic scribeRoutes.ts into bounded route modules
// while preserving one shared middleware envelope at this parent router.
router.use(scribeConsentRoutes);
router.use(scribeSessionRoutes);
router.use(scribeCatalogRoutes);

export default router;
