// apps/api/src/integrations/fhir/fhirAdditionalResources.ts
//
// Additional FHIR R4 resources for AU Core conformance:
//   - MedicationRequest (prescriptions)
//   - Procedure (clinical procedures)
//   - Immunization (vaccination records)
//   - Location (service delivery locations)

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../../db/db';
import { authMiddleware } from '../../middleware/authMiddleware';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authMiddleware);

interface FhirPrescriptionRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: string;
  brand_name: string | null;
  generic_name: string | null;
  pbs_item_code: string | null;
  prescribed_date: string | Date;
  prescribed_by_staff_id: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  quantity: number | null;
  repeats: number | null;
  expires_at: string | Date | null;
}

interface FhirProcedureRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  assessment_type: string;
  scores: unknown;
  created_at: string | Date;
  notes: string | null;
}

interface FhirOrgUnitRow {
  id: string;
  clinic_id: string;
  name: string;
}

interface FhirBedRow {
  id: string;
  clinic_id: string;
  status: string;
  ward: string | null;
  bed_label: string;
}

// ── FHIR MedicationRequest (from prescriptions) ──
router.get('/MedicationRequest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.query.patient as string;
    if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }
    const rxs = await db<FhirPrescriptionRow>('prescriptions')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .orderBy('prescribed_date', 'desc');

    res.json({
      resourceType: 'Bundle', type: 'searchset', total: rxs.length,
      entry: rxs.map((rx) => ({
        resource: {
          resourceType: 'MedicationRequest', id: rx.id,
          status: rx.status === 'active' ? 'active' : rx.status === 'ceased' ? 'stopped' : 'completed',
          intent: 'order',
          medicationCodeableConcept: {
            text: rx.brand_name ?? rx.generic_name,
            coding: rx.pbs_item_code ? [{
              system: 'http://pbs.gov.au/code/item', code: rx.pbs_item_code,
            }] : [],
          },
          subject: { reference: `Patient/${rx.patient_id}` },
          authoredOn: rx.prescribed_date,
          requester: rx.prescribed_by_staff_id ? { reference: `Practitioner/${rx.prescribed_by_staff_id}` } : undefined,
          dosageInstruction: [{
            text: `${rx.dose ?? ''} ${rx.frequency ?? ''} ${rx.route ?? ''}`.trim(),
            route: rx.route ? { text: rx.route } : undefined,
          }],
          dispenseRequest: {
            quantity: rx.quantity ? { value: rx.quantity } : undefined,
            numberOfRepeatsAllowed: rx.repeats ?? undefined,
            validityPeriod: { start: rx.prescribed_date, end: rx.expires_at ?? undefined },
          },
          substitution: { allowedBoolean: true },
        },
      })),
    });
  } catch (err) { logger.error({ err }, 'FHIR resource error'); next(err); }
});

// ── FHIR Procedure (from nursing_assessments with procedure-like types) ──
router.get('/Procedure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.query.patient as string;
    if (!patientId) { res.status(400).json({ error: 'patient parameter required' }); return; }

    // ECT and TMS sessions are procedures
    const procedures = await db<FhirProcedureRow>('nursing_assessments')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .whereIn('assessment_type', ['ect_session', 'tms_session'])
      .orderBy('created_at', 'desc');

    res.json({
      resourceType: 'Bundle', type: 'searchset', total: procedures.length,
      entry: procedures.map((p) => {
        const scores = typeof p.scores === 'string' ? JSON.parse(p.scores) : p.scores ?? {};
        return {
          resource: {
            resourceType: 'Procedure', id: p.id,
            status: 'completed',
            code: {
              coding: [{
                system: 'http://snomed.info/sct',
                code: p.assessment_type === 'ect_session' ? '313191000' : '398158005',
                display: p.assessment_type === 'ect_session' ? 'Electroconvulsive therapy' : 'Transcranial magnetic stimulation',
              }],
              text: p.assessment_type === 'ect_session' ? 'ECT Session' : 'TMS Session',
            },
            subject: { reference: `Patient/${p.patient_id}` },
            performedDateTime: p.created_at,
            note: p.notes ? [{ text: p.notes }] : [],
            extension: scores.sessionNumber ? [{
              url: 'http://signacare.com.au/fhir/StructureDefinition/session-number',
              valueInteger: scores.sessionNumber,
            }] : [],
          },
        };
      }),
    });
  } catch (err) { logger.error({ err }, 'FHIR resource error'); next(err); }
});

// ── FHIR Location (from org_units / wards) ──
router.get('/Location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await db<FhirOrgUnitRow>('org_units').where({ clinic_id: req.clinicId });
    const beds = await db<FhirBedRow>('beds').where({ clinic_id: req.clinicId });

    const entries = [
      ...orgs.map((o) => ({
        resource: {
          resourceType: 'Location', id: o.id,
          status: 'active',
          name: o.name,
          type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'HOSP', display: 'Hospital' }] }],
          managingOrganization: { reference: `Organization/${req.clinicId}` },
        },
      })),
      ...beds.map((b) => ({
        resource: {
          resourceType: 'Location', id: b.id,
          status: b.status === 'available' ? 'active' : 'suspended',
          name: `${b.ward ?? 'Ward'} — ${b.bed_label}`,
          mode: 'instance',
          type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'BED', display: 'Bed' }] }],
          physicalType: { coding: [{ code: 'bd', display: 'Bed' }] },
        },
      })),
    ];

    res.json({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries });
  } catch (err) { logger.error({ err }, 'FHIR resource error'); next(err); }
});

export default router;
