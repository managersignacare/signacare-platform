import type { AuthContext } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { requirePatientReadAccess, requirePatientRelationship, requirePermission } from '../../shared/authGuards';
import { advanceDirectiveRepository, type AdvanceDirectiveRow } from './advanceDirectiveRepository';

interface CreateAdvanceDirectiveInput {
  patientId: string;
  type: string;
  content: unknown;
  status: string;
  validFrom: string | null;
  validUntil: string | null;
}

export const advanceDirectiveService = {
  async listByPatient(auth: AuthContext, patientId: string): Promise<AdvanceDirectiveRow[]> {
    requirePermission(auth, 'note:read');
    await requirePatientReadAccess(auth, patientId);
    return advanceDirectiveRepository.listByPatient(auth.clinicId, patientId);
  },

  async create(auth: AuthContext, input: CreateAdvanceDirectiveInput): Promise<AdvanceDirectiveRow> {
    requirePermission(auth, 'note:create');
    await requirePatientRelationship(auth, input.patientId);
    return advanceDirectiveRepository.create({
      clinic_id: auth.clinicId,
      patient_id: input.patientId,
      type: input.type,
      content: input.content,
      status: input.status,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
    });
  },

  async update(
    auth: AuthContext,
    id: string,
    expectedLockVersion: number,
    patch: Record<string, unknown>,
  ): Promise<AdvanceDirectiveRow> {
    requirePermission(auth, 'note:update');
    const existing = await advanceDirectiveRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Advance directive not found', 404, 'NOT_FOUND');
    }
    await requirePatientRelationship(auth, existing.patient_id);
    return advanceDirectiveRepository.update(auth.clinicId, id, expectedLockVersion, patch);
  },
};
