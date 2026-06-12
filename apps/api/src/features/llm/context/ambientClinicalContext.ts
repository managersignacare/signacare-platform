import type {
  AuthContext,
  ClinicalContextEnvelope,
  RoutedModelExecution,
} from '@signacare/shared';
import { dbAdmin } from '../../../db/db';
import { requireClinicalAccessRole } from '../../../shared/authGuards';
import { AppError } from '../../../shared/errors';
import {
  buildClinicalContext,
  type BuiltClinicalContext,
} from './buildClinicalContext';
import { buildClinicalContextAuditMetadata } from './contextAuditWriter';

export interface AmbientGovernedContextInput {
  readonly clinicId: string;
  readonly staffId: string;
  readonly patientId?: string;
  readonly auth?: AuthContext;
}

function ensureAmbientAuthMatchesInput(
  auth: AuthContext,
  input: AmbientGovernedContextInput,
): AuthContext {
  if (auth.staffId !== input.staffId || auth.clinicId !== input.clinicId) {
    throw new AppError(
      'Ambient auth context does not match the current staff or clinic scope',
      403,
      'AMBIENT_AUTH_CONTEXT_MISMATCH',
    );
  }

  if (
    input.patientId
    && auth.patientId !== undefined
    && auth.patientId !== input.patientId
  ) {
    throw new AppError(
      'Ambient auth context does not match the requested patient scope',
      403,
      'AMBIENT_AUTH_CONTEXT_MISMATCH',
    );
  }

  return {
    ...auth,
    patientId: input.patientId,
  };
}

async function loadAmbientStaffAuth(
  input: Required<Pick<AmbientGovernedContextInput, 'clinicId' | 'staffId' | 'patientId'>>,
): Promise<AuthContext> {
  const staff = await dbAdmin('staff')
    .where({ id: input.staffId })
    .whereNull('deleted_at')
    .first<{ id: string; clinic_id: string; role: string; is_active: boolean }>(
      'id',
      'clinic_id',
      'role',
      'is_active',
    );

  if (!staff || staff.clinic_id !== input.clinicId || !staff.is_active) {
    throw new AppError(
      'Ambient staff context is not active for this clinic',
      403,
      'AMBIENT_STAFF_CONTEXT_INVALID',
    );
  }

  const auth: AuthContext = {
    staffId: staff.id,
    clinicId: staff.clinic_id,
    role: staff.role,
    permissions: [],
    patientId: input.patientId,
  };
  requireClinicalAccessRole(auth);
  return auth;
}

export async function resolveAmbientClinicalAuth(
  input: AmbientGovernedContextInput,
): Promise<AuthContext | null> {
  if (!input.patientId) return null;

  if (input.auth) {
    const auth = ensureAmbientAuthMatchesInput(input.auth, input);
    requireClinicalAccessRole(auth);
    return auth;
  }

  return loadAmbientStaffAuth({
    clinicId: input.clinicId,
    staffId: input.staffId,
    patientId: input.patientId,
  });
}

export async function buildAmbientGovernedClinicalContext(
  input: AmbientGovernedContextInput,
): Promise<BuiltClinicalContext | null> {
  const auth = await resolveAmbientClinicalAuth(input);
  if (!auth || !input.patientId) return null;

  return buildClinicalContext({
    auth,
    documentType: 'scribe-pass2',
    patientId: input.patientId,
  });
}

export function buildAmbientGovernedContextAuditMetadata(args: {
  readonly execution: RoutedModelExecution;
  readonly contextEnvelope?: ClinicalContextEnvelope | null;
}) {
  return buildClinicalContextAuditMetadata(
    args.execution,
    args.contextEnvelope ?? null,
  );
}

export function shouldFailClosedForAmbientContext(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;

  return error.status >= 400 && error.status < 500;
}
