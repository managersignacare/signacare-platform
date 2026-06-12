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
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireSpecialty } from '../../shared/authGuards';
import {
  AI_SCRIBE_PARITY_CAPABILITIES,
  AiScribeCapabilitiesResponseSchema,
} from '@signacare/shared';
import scribeConsentRoutes from './scribeConsentRoutes';
import scribeSessionRoutes from './scribeSessionRoutes';
import scribeCatalogRoutes from './scribeCatalogRoutes';
import scribeParityRoutes from './scribeParityRoutes';
import scribeDraftSurface from './scribeDraftSurface';
import { getClinicAiRuntimeSettings } from './modelRouter/clinicAiRuntimeSettings';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// The scribe pipeline accepts structuredNote / assessmentFacts as either
// strings or model-emitted JSON objects/arrays; downstream prompt builders
// want a string. Zod `.transform` coerces to a canonical string at the
// boundary so the downstream signatures stay typed.
const stringFactArray = z
  .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
  .transform((arr) => arr.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))));

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
  autoCodeICD10,
  suggestMBSItems,
  extractOutcomeMeasures,
} from '../../mcp/scribeEnhancements';
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

// GET /api/v1/scribe/capabilities
//
// Deployment smoke uses this authenticated but non-PHI endpoint to prove that
// the active environment exposes the parity-critical scribe surfaces before
// traffic promotion. Patient/session artefact creation is tested separately by
// clinical workflow suites; this endpoint is deliberately read-only.
router.get('/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const runtime = await getClinicAiRuntimeSettings(req.clinicId!);
    res.json(AiScribeCapabilitiesResponseSchema.parse({
      schemaVersion: '1.0',
      activePath: runtime.scribeRuntimeMode === 'agentic' ? 'agentic-ai-scribe' : 'async-ai-scribe-v2',
      capabilities: AI_SCRIBE_PARITY_CAPABILITIES,
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    }));
  } catch (err) { next(err); }
});

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
router.use(scribeParityRoutes);
router.use(scribeCatalogRoutes);
router.use(scribeDraftSurface);

export default router;
