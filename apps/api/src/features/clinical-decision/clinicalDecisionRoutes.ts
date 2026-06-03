/**
 * @admin-only — CDS rule catalogue + alert preview, no UI caller yet
 *
 * Clinical Decision Support Routes
 * Metabolic monitoring, drug interaction alerts, clozapine monitoring rules
 *
 * Endpoints:
 *   GET /api/v1/clinical-decision/alerts/patient/:patientId
 *   GET /api/v1/clinical-decision/rules
 *
 * Rationale (DEAD-MOUNT exemption per Phase 0.7 PR2): the metabolic + clozapine
 * monitoring rules are currently surfaced to clinicians via the Pathology and
 * Medications tabs which run their checks server-side as part of the existing
 * clinical-notes / pathology / medications endpoints. The standalone
 * /clinical-decision routes are a future consolidation surface (one bell that
 * lists every patient-level alert across categories) — the aggregator UI has
 * not shipped. Until then operators preview the rule catalogue via curl. See
 * docs/admin-routes.md.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authMiddleware);
const ROLES = ['clinician', 'admin', 'superadmin'];

// ── Metabolic Monitoring Rules ──
const METABOLIC_RULES = [
  { drug_class: 'antipsychotic', check: 'weight', frequency_weeks: 4, message: 'Weight check due — all antipsychotics require monthly weight monitoring' },
  { drug_class: 'antipsychotic', check: 'fasting_glucose', frequency_weeks: 12, message: 'Fasting glucose due — metabolic syndrome screening' },
  { drug_class: 'antipsychotic', check: 'lipid_profile', frequency_weeks: 12, message: 'Lipid profile due — metabolic monitoring' },
  { drug_class: 'antipsychotic', check: 'waist_circumference', frequency_weeks: 12, message: 'Waist circumference measurement due' },
  { drug_class: 'antipsychotic', check: 'blood_pressure', frequency_weeks: 12, message: 'Blood pressure check due' },
  { drug_class: 'antipsychotic', check: 'ecg', frequency_weeks: 52, message: 'Annual ECG due — QTc monitoring for antipsychotic therapy' },
  { drug_class: 'clozapine', check: 'full_blood_count', frequency_weeks: 1, message: 'URGENT: Weekly FBC required for clozapine (first 18 weeks)' },
  { drug_class: 'clozapine', check: 'full_blood_count_monthly', frequency_weeks: 4, message: 'Monthly FBC required for clozapine (after 18 weeks)' },
  { drug_class: 'clozapine', check: 'clozapine_level', frequency_weeks: 12, message: 'Clozapine trough level due' },
  { drug_class: 'clozapine', check: 'troponin_crp', frequency_weeks: 4, message: 'Troponin/CRP monitoring for clozapine myocarditis screening (first 4 weeks)' },
  { drug_class: 'lithium', check: 'lithium_level', frequency_weeks: 12, message: 'Lithium level due — target 0.6-0.8 mmol/L (0.8-1.0 acute)' },
  { drug_class: 'lithium', check: 'renal_function', frequency_weeks: 12, message: 'Renal function check due — lithium nephrotoxicity monitoring' },
  { drug_class: 'lithium', check: 'thyroid_function', frequency_weeks: 26, message: 'Thyroid function due — lithium-induced hypothyroidism screening' },
  { drug_class: 'lithium', check: 'calcium', frequency_weeks: 26, message: 'Calcium level due — lithium-associated hyperparathyroidism' },
  { drug_class: 'valproate', check: 'valproate_level', frequency_weeks: 12, message: 'Valproate level due — target 50-100 mg/L' },
  { drug_class: 'valproate', check: 'liver_function', frequency_weeks: 12, message: 'LFTs due — valproate hepatotoxicity monitoring' },
  { drug_class: 'valproate', check: 'full_blood_count', frequency_weeks: 12, message: 'FBC due — valproate thrombocytopenia monitoring' },
  { drug_class: 'carbamazepine', check: 'carbamazepine_level', frequency_weeks: 12, message: 'Carbamazepine level due — target 4-12 mg/L' },
  { drug_class: 'carbamazepine', check: 'sodium', frequency_weeks: 12, message: 'Sodium level due — carbamazepine SIADH risk' },
];

// GET /alerts/patient/:patientId — get CDS alerts for a patient
router.get('/alerts/patient/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get patient's active medications
    // BUG-430: explicit clinic_id Layer-1 filter (CLAUDE.md §1.3).
    const meds = await db('patient_medications')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId, status: 'active' });

    const alerts: { type: string; severity: 'info' | 'warning' | 'critical'; message: string; medication: string; check: string }[] = [];

    for (const med of meds) {
      const medName = (med.medication_name ?? '').toLowerCase();

      // Classify drug
      let drugClass = 'other';
      if (/clozapine/i.test(medName)) drugClass = 'clozapine';
      else if (/lithium/i.test(medName)) drugClass = 'lithium';
      else if (/valproate|sodium valproate|depakote/i.test(medName)) drugClass = 'valproate';
      else if (/carbamazepine|tegretol/i.test(medName)) drugClass = 'carbamazepine';
      else if (/olanzapine|quetiapine|risperidone|aripiprazole|paliperidone|ziprasidone|amisulpride|haloperidol|chlorpromazine|flupentixol|zuclopenthixol/i.test(medName)) drugClass = 'antipsychotic';

      // Find applicable rules
      const rules = METABOLIC_RULES.filter(r => r.drug_class === drugClass);

      // Check last pathology result date for each rule
      for (const rule of rules) {
        // BUG-430: clinic_id Layer-1 on pathology lookup.
        const lastResult = await db('pathology_results')
          .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
          .whereRaw("test_name ILIKE ?", [`%${rule.check.replace(/_/g, ' ')}%`])
          .orderBy('result_date', 'desc')
          .first()
          .catch((err) => { logger.warn({ err }, 'clinicalDecisionRoutes: op failed — returning null'); return null; });

        const weeksSinceResult = lastResult
          ? Math.floor((Date.now() - new Date(lastResult.result_date).getTime()) / (7 * 86400000))
          : 999;

        if (weeksSinceResult >= rule.frequency_weeks) {
          alerts.push({
            type: 'metabolic_monitoring',
            severity: drugClass === 'clozapine' ? 'critical' : 'warning',
            message: rule.message,
            medication: med.medication_name,
            check: rule.check,
          });
        }
      }

      // S8 medication alert
      if (med.is_s8) {
        alerts.push({
          type: 'safescript_check',
          severity: 'warning',
          message: `Schedule 8 medication (${med.medication_name}) — SafeScript check recommended before prescribing`,
          medication: med.medication_name,
          check: 'safescript',
        });
      }
    }

    res.json({ alerts, count: alerts.length });
  } catch (err) { next(err); }
});

// GET /rules — list all CDS rules
router.get('/rules', requireRoles(ROLES), (_req: Request, res: Response) => {
  res.json(METABOLIC_RULES);
});

export default router;
