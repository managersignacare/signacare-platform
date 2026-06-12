import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  canRequestDutyClinicianRelationship,
  canRequestDutyPrescriberRelationship,
  DUTY_RELATIONSHIP_DURATION_HOURS,
  getAllowedDutyRelationshipTypes,
  isDutyRelationshipType,
  isPrescriberSystemRole,
  type DutyRelationshipType,
} from '@signacare/shared';
import { db } from '../../db/db';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireClinicalAccessRole, requirePermission } from '../../shared/authGuards';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';

const DutyRelationshipTypeSchema = z.enum(['duty_clinician', 'duty_prescriber']);
const DutyRelationshipDurationSchema = z
  .number()
  .int()
  .refine(
    (value): value is (typeof DUTY_RELATIONSHIP_DURATION_HOURS)[number] =>
      DUTY_RELATIONSHIP_DURATION_HOURS.includes(
        value as (typeof DUTY_RELATIONSHIP_DURATION_HOURS)[number],
      ),
    'Invalid duty relationship duration',
  );

const CreateDutyRelationshipSchema = z.object({
  relationshipType: DutyRelationshipTypeSchema,
  reason: z.string().trim().min(5).max(1000),
  expiresInHours: DutyRelationshipDurationSchema.default(12),
});

const ActiveDutyRelationshipResponseSchema = z.object({
  id: z.string().uuid(),
  relationshipType: DutyRelationshipTypeSchema,
  reason: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  createdById: z.string().uuid().nullable(),
  status: z.enum(['created', 'existing']),
});

const DutyRelationshipEnvelopeSchema = z.object({
  relationship: ActiveDutyRelationshipResponseSchema,
});

const DutyRelationshipListResponseSchema = z.object({
  relationships: z.array(
    z.object({
      id: z.string().uuid(),
      relationshipType: DutyRelationshipTypeSchema,
      reason: z.string(),
      createdAt: z.string(),
      expiresAt: z.string(),
      createdById: z.string().uuid().nullable(),
    }),
  ),
});

type ActiveRelationshipRow = {
  id: string;
  relationship_type: string;
  reason: string;
  created_at: string | Date;
  expires_at: string | Date;
  created_by_id: string | null;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapActiveRelationshipRow(
  row: ActiveRelationshipRow,
  status: 'created' | 'existing',
) {
  return ActiveDutyRelationshipResponseSchema.parse({
    id: row.id,
    relationshipType: row.relationship_type,
    reason: row.reason,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    createdById: row.created_by_id,
    status,
  });
}

function assertDutyRelationshipAccess(
  req: Request,
  relationshipType?: DutyRelationshipType,
): {
  staffId: string;
  clinicId: string;
  role: string;
} {
  const auth = buildAuthContext(req, req.params.id);
  requireClinicalAccessRole(auth);
  requirePermission(auth, 'patient:read');

  if (!canRequestDutyClinicianRelationship(auth.role)) {
    throw new AppError(
      'Only clinical staff can request a duty relationship.',
      403,
      'CLINICAL_ACCESS_DENIED',
    );
  }

  if (relationshipType === 'duty_prescriber' && !canRequestDutyPrescriberRelationship(auth.role)) {
    throw new AppError(
      'Duty prescriber relationships require an authorised prescriber system role.',
      403,
      'DUTY_PRESCRIBER_ROLE_REQUIRED',
    );
  }

  return {
    staffId: auth.staffId,
    clinicId: auth.clinicId,
    role: auth.role,
  };
}

export const patientDutyRelationshipRouter = Router();

patientDutyRelationshipRouter.get(
  '/:id/duty-relationships/me',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = assertDutyRelationshipAccess(req);
      const patient = await db('patients')
        .where({ id: req.params.id, clinic_id: auth.clinicId })
        .whereNull('deleted_at')
        .first('id');

      if (!patient) {
        throw new AppError('Patient not found in clinic', 404, 'NOT_FOUND');
      }

      const allowedTypes = getAllowedDutyRelationshipTypes(auth.role);
      const rows: ActiveRelationshipRow[] = await db('patient_duty_relationships')
        .where({
          clinic_id: auth.clinicId,
          patient_id: req.params.id,
          staff_id: auth.staffId,
        })
        .whereNull('revoked_at')
        .where('expires_at', '>', new Date())
        .whereIn('relationship_type', allowedTypes)
        .orderBy('expires_at', 'desc')
        .select(
          'id',
          'relationship_type',
          'reason',
          'created_at',
          'expires_at',
          'created_by_id',
        );

      res.json(
        DutyRelationshipListResponseSchema.parse({
          relationships: rows.map((row) => ({
            id: row.id,
            relationshipType: row.relationship_type,
            reason: row.reason,
            createdAt: toIso(row.created_at),
            expiresAt: toIso(row.expires_at),
            createdById: row.created_by_id,
          })),
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

patientDutyRelationshipRouter.post(
  '/:id/duty-relationships',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = CreateDutyRelationshipSchema.parse(req.body);
      const auth = assertDutyRelationshipAccess(req, payload.relationshipType);
      const patient = await db('patients')
        .where({ id: req.params.id, clinic_id: auth.clinicId })
        .whereNull('deleted_at')
        .first('id');

      if (!patient) {
        throw new AppError('Patient not found in clinic', 404, 'NOT_FOUND');
      }

      const now = new Date();
      const existing = await db('patient_duty_relationships')
        .where({
          clinic_id: auth.clinicId,
          patient_id: req.params.id,
          staff_id: auth.staffId,
          relationship_type: payload.relationshipType,
        })
        .whereNull('revoked_at')
        .where('expires_at', '>', now)
        .orderBy('expires_at', 'desc')
        .first<ActiveRelationshipRow>(
          'id',
          'relationship_type',
          'reason',
          'created_at',
          'expires_at',
          'created_by_id',
        );

      if (existing && isDutyRelationshipType(existing.relationship_type)) {
        res.status(200).json(
          DutyRelationshipEnvelopeSchema.parse({
            relationship: mapActiveRelationshipRow(existing, 'existing'),
          }),
        );
        return;
      }

      const expiresAt = new Date(now.getTime() + payload.expiresInHours * 60 * 60 * 1000);
      const [row] = await db('patient_duty_relationships')
        .insert({
          id: db.raw('gen_random_uuid()'),
          clinic_id: auth.clinicId,
          patient_id: req.params.id,
          staff_id: auth.staffId,
          created_by_id: auth.staffId,
          relationship_type: payload.relationshipType,
          reason: payload.reason,
          expires_at: expiresAt,
          created_at: now,
        })
        .returning<ActiveRelationshipRow[]>([
          'id',
          'relationship_type',
          'reason',
          'created_at',
          'expires_at',
          'created_by_id',
        ]);

      await writeAuditLog({
        clinicId: auth.clinicId,
        actorId: auth.staffId,
        action: 'DUTY_RELATIONSHIP_GRANTED',
        tableName: 'patient_duty_relationships',
        recordId: row.id,
        newData: {
          patientId: req.params.id,
          relationshipType: payload.relationshipType,
          expiresAt: expiresAt.toISOString(),
          reason: payload.reason,
          actorRole: auth.role,
          prescriberRoleGranted:
            payload.relationshipType === 'duty_prescriber'
              ? isPrescriberSystemRole(auth.role)
              : false,
        },
      });

      res.status(201).json(
        DutyRelationshipEnvelopeSchema.parse({
          relationship: mapActiveRelationshipRow(row, 'created'),
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
