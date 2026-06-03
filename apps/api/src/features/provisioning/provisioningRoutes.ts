// apps/api/src/features/provisioning/provisioningRoutes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';
import { ProvisionClinicSchema } from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { provisionClinic } from './provisioningService';

export const provisioningRoutes = Router();

provisioningRoutes.use(authMiddleware);

// POST /provisioning/provision — Full clinic onboarding (superadmin only)
provisioningRoutes.post(
  '/provision',
  requireRole('superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ProvisionClinicSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const result = await provisionClinic(auth, dto);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /provisioning/defaults — Returns default reference data lists for the wizard preview
provisioningRoutes.get(
  '/defaults',
  requireRole('superadmin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        defaultModules: [
          'patients', 'episodes', 'clinical_notes', 'medications',
          'appointments', 'tasks', 'reports', 'referrals',
          'billing', 'correspondence',
        ],
        allModules: [
          { key: 'patients', label: 'Patient Management' },
          { key: 'episodes', label: 'Episode Management' },
          { key: 'clinical_notes', label: 'Clinical Notes' },
          { key: 'medications', label: 'Medications & Prescriptions' },
          { key: 'appointments', label: 'Appointments & Scheduling' },
          { key: 'referrals', label: 'Referral Management' },
          { key: 'referral-solo', label: 'Solo Referral Management' },
          { key: 'referral-team', label: 'Team Referral Management' },
          { key: 'tasks', label: 'Task Management' },
          { key: 'billing', label: 'Billing' },
          { key: 'reports', label: 'Reports & Analytics' },
          { key: 'correspondence', label: 'Correspondence & Letters' },
          { key: 'pathology', label: 'Pathology & Investigations' },
          { key: 'bed_board', label: 'Bed Board / Inpatient' },
          { key: 'mha', label: 'Mental Health Act / Legal' },
          { key: 'lai', label: 'LAI Management' },
          { key: 'clozapine', label: 'Clozapine Monitoring' },
          { key: 'medical-scribe', label: 'AI Scribe' },
          { key: 'ai-agent', label: 'AI Agent' },
          { key: 'agentic-ai-scribe', label: 'Agentic AI Scribe (Next-Gen)' },
          { key: 'group_therapy', label: 'Group Therapy' },
          { key: 'escalations', label: 'Escalations' },
          { key: 'shift_handover', label: 'Shift Handover' },
          { key: 'outcome_measures', label: 'Outcome Measures' },
          { key: 'risk_assessment', label: 'Risk Assessment' },
        ],
        clinicTypes: [
          { value: 'solo_practice', label: 'Solo Practice (Individual Practitioner)' },
          { value: 'group_practice', label: 'Group Practice (Multiple Clinicians)' },
          { value: 'hospital', label: 'Small Private Hospital' },
        ],
      });
    } catch (err) {
      next(err);
    }
  },
);
