import {
  canApproveEctTmsForms,
  canCompleteEctTmsForms,
} from '@signacare/shared';
import { z } from 'zod';

const EctTmsApprovalErrorSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
});

const TimestampLikeSchema = z.union([z.string(), z.date()]);

const NursingAssessmentResponseSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  episode_id: z.string().uuid().nullable(),
  staff_id: z.string().uuid().nullable(),
  assessment_type: z.string().min(1),
  scores: z.unknown().nullable(),
  assessment_data: z.unknown().nullable(),
  total_score: z.union([z.number(), z.string()]).nullable(),
  risk_level: z.string().nullable(),
  notes: z.string().nullable(),
  plan: z.string().nullable(),
  assessed_at: TimestampLikeSchema,
  created_at: TimestampLikeSchema,
  updated_at: TimestampLikeSchema,
});

export function isEctOrTmsAssessmentType(value: string): boolean {
  return value.startsWith('ect_') || value.startsWith('tms_');
}

export function validateEctTmsAssessmentWriter(role: string | undefined): {
  ok: boolean;
  error?: z.infer<typeof EctTmsApprovalErrorSchema>;
} {
  if (!canCompleteEctTmsForms(role)) {
    return {
      ok: false,
      error: EctTmsApprovalErrorSchema.parse({
        error: 'ECT and TMS forms require a psychiatry prescriber role',
        code: 'ECT_TMS_PRESCRIBER_ROLE_REQUIRED',
      }),
    };
  }

  return { ok: true };
}

export function withConsultantApprovalMetadata(
  scores: unknown,
  role: string | undefined,
  staffId: string | undefined,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const base = scores && typeof scores === 'object' && !Array.isArray(scores)
    ? { ...(scores as Record<string, unknown>) }
    : {};

  if (canApproveEctTmsForms(role)) {
    return {
      ...base,
      approvalStatus: 'approved',
      approvalRequired: false,
      approvedByStaffId: staffId ?? null,
      approvedAt: now,
      approvedRole: role ?? null,
    };
  }

  return {
    ...base,
    approvalStatus: 'pending_consultant_approval',
    approvalRequired: true,
    approvalRequestedByStaffId: staffId ?? null,
    approvalRequestedAt: now,
    requiredApproverRole: 'prescriber_consultant',
  };
}

export function buildConsultantApprovalError(
  role: string | undefined,
): z.infer<typeof EctTmsApprovalErrorSchema> | null {
  if (canApproveEctTmsForms(role)) return null;
  return EctTmsApprovalErrorSchema.parse({
    error: 'ECT and TMS approval requires a prescriber consultant role',
    code: 'ECT_TMS_CONSULTANT_APPROVAL_REQUIRED',
  });
}

export function deriveEctTmsRiskLevel(role: string | undefined): string {
  return canApproveEctTmsForms(role) ? 'approved' : 'pending_consultant_approval';
}

export function mapEctTmsApprovalErrorToResponse(
  value: unknown,
): z.infer<typeof EctTmsApprovalErrorSchema> {
  return EctTmsApprovalErrorSchema.parse(value);
}

export function mapNursingAssessmentRowToResponse(row: unknown): z.infer<typeof NursingAssessmentResponseSchema> {
  return NursingAssessmentResponseSchema.parse(row);
}
