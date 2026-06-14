import type { AuthContext, CreateLegalOrderDTO, UpdateLegalOrderDTO } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import {
  requireClinicalAccessRole,
  requirePatientReadAccess,
  requirePatientRelationship,
  requirePermission,
} from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';
import {
  legalOrderCrudRepository,
  type ActiveClinicLegalOrderListRow,
  type PatientLegalOrderListRow,
  type PatientLegalOrderAuditRow,
} from './legalOrderCrudRepository';

type PatientLegalOrderResponse = {
  id: string;
  patientId: string;
  clinicId: string;
  lockVersion: number;
  orderTypeId: string;
  enteredById: string | null;
  orderNumber: string | null;
  startDate: string;
  endDate: string | null;
  reviewDate: string | null;
  nextApplicationDate: string | null;
  status: string;
  notes: string | null;
  aiSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

type PatientLegalOrderListResponse = PatientLegalOrderResponse & {
  orderTypeName: string;
  orderCategory: string;
  enteredByName: string;
};

type ActiveClinicLegalOrderListResponse = PatientLegalOrderListResponse & {
  patientGivenName: string;
  patientFamilyName: string;
  patientDob: string | null;
};

function toIsoOrPassthrough(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function mapOrderRowToResponse(
  row: {
    id: string;
    patient_id: string;
    clinic_id: string;
    lock_version?: number;
    order_type_id: string;
    entered_by_id?: string | null;
    order_number?: string | null;
    start_date: string | Date;
    end_date?: string | Date | null;
    review_date?: string | Date | null;
    next_application_date?: string | Date | null;
    status: string;
    notes?: string | null;
    ai_summary?: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  },
): PatientLegalOrderResponse {
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    lockVersion: typeof row.lock_version === 'number' ? row.lock_version : 1,
    orderTypeId: row.order_type_id,
    enteredById: row.entered_by_id ?? null,
    orderNumber: row.order_number ?? null,
    startDate: toIsoOrPassthrough(row.start_date) ?? '',
    endDate: toIsoOrPassthrough(row.end_date ?? null),
    reviewDate: toIsoOrPassthrough(row.review_date ?? null),
    nextApplicationDate: toIsoOrPassthrough(row.next_application_date ?? null),
    status: row.status,
    notes: row.notes ?? null,
    aiSummary: row.ai_summary ?? null,
    createdAt: toIsoOrPassthrough(row.created_at) ?? '',
    updatedAt: toIsoOrPassthrough(row.updated_at) ?? '',
  };
}

function isPastDate(value: string | Date | null | undefined, now: Date): boolean {
  if (!value) return false;
  const asDate = value instanceof Date ? value : new Date(value);
  return asDate.getTime() < now.getTime();
}

function buildUpdatePatch(dto: Omit<UpdateLegalOrderDTO, 'expectedLockVersion'>): {
  order_number?: string;
  start_date?: string;
  end_date?: string;
  review_date?: string;
  next_application_date?: string;
  status?: 'active' | 'expired' | 'revoked' | 'pending' | 'draft';
  notes?: string;
  ai_summary?: string;
} {
  const patch: {
    order_number?: string;
    start_date?: string;
    end_date?: string;
    review_date?: string;
    next_application_date?: string;
    status?: 'active' | 'expired' | 'revoked' | 'pending' | 'draft';
    notes?: string;
    ai_summary?: string;
  } = {};

  if (dto.orderNumber !== undefined) patch.order_number = dto.orderNumber;
  if (dto.startDate !== undefined) patch.start_date = dto.startDate;
  if (dto.endDate !== undefined) patch.end_date = dto.endDate;
  if (dto.reviewDate !== undefined) patch.review_date = dto.reviewDate;
  if (dto.nextApplicationDate !== undefined) {
    patch.next_application_date = dto.nextApplicationDate;
  }
  if (dto.status !== undefined) patch.status = dto.status;
  if (dto.notes !== undefined) patch.notes = dto.notes;
  if (dto.aiSummary !== undefined) patch.ai_summary = dto.aiSummary;

  return patch;
}

function toAuditShape(row: PatientLegalOrderAuditRow): Record<string, unknown> {
  return {
    id: row.id,
    patient_id: row.patient_id,
    order_type_id: row.order_type_id,
    order_number: row.order_number,
    start_date: row.start_date,
    end_date: row.end_date,
    review_date: row.review_date,
    next_application_date: row.next_application_date,
    status: row.status,
    lock_version: row.lock_version,
    updated_at: toIsoOrPassthrough(row.updated_at),
  };
}

export const legalOrderCrudService = {
  async listActiveForClinic(
    auth: AuthContext,
  ): Promise<{ orders: ActiveClinicLegalOrderListResponse[] }> {
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'patient:read');

    const rows = await legalOrderCrudRepository.listActiveByClinic(auth.clinicId);

    return {
      orders: rows.map((row: ActiveClinicLegalOrderListRow) => ({
        ...mapOrderRowToResponse(row),
        orderTypeName: row.ordertypename,
        orderCategory: row.ordercategory,
        enteredByName: row.enteredbyname,
        patientGivenName: row.patientgivenname,
        patientFamilyName: row.patientfamilyname,
        patientDob: toIsoOrPassthrough(row.patientdob),
      })),
    };
  },

  async listForPatient(
    auth: AuthContext,
    patientId: string,
  ): Promise<{ orders: PatientLegalOrderListResponse[] }> {
    // R-FIX-BUG-576-AUTHCONTEXT-LIST
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'patient:read');
    await requirePatientReadAccess(auth, patientId);

    const rows = await legalOrderCrudRepository.listByPatient(patientId, auth.clinicId);
    const now = new Date();

    for (const row of rows) {
      if (!isPastDate(row.end_date, now) || row.status !== 'active') continue;

      const affected = await legalOrderCrudRepository.expireIfActive(row.id, auth.clinicId);
      if (affected > 0) {
        await writeAuditLog({
          clinicId: auth.clinicId,
          userId: auth.staffId,
          action: 'LEGAL_ORDER_AUTO_EXPIRED',
          tableName: 'patient_legal_orders',
          recordId: row.id,
          oldData: {
            status: 'active',
            end_date: row.end_date,
          },
          newData: {
            status: 'expired',
            end_date: row.end_date,
            auto_expired_by: 'list_handler',
            trigger: 'view-side-effect',
            patient_id: row.patient_id,
            order_type_id: row.order_type_id,
          },
        });
      }

      row.status = 'expired';
      row.lock_version = (row.lock_version ?? 1) + 1;
    }

    return {
      orders: rows.map((row: PatientLegalOrderListRow) => ({
        ...mapOrderRowToResponse(row),
        orderTypeName: row.ordertypename,
        orderCategory: row.ordercategory,
        enteredByName: row.enteredbyname,
      })),
    };
  },

  async create(
    auth: AuthContext,
    patientId: string,
    dto: CreateLegalOrderDTO,
  ): Promise<{ order: PatientLegalOrderResponse }> {
    // R-FIX-BUG-576-AUTHCONTEXT-CREATE
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'patient:update');
    await requirePatientRelationship(auth, patientId);

    if (dto.endDate && dto.startDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new AppError('End date cannot be before start date', 400, 'VALIDATION_ERROR');
    }

    const row = await legalOrderCrudRepository.create({
      patientId,
      clinicId: auth.clinicId,
      orderTypeId: dto.orderTypeId,
      enteredById: auth.staffId,
      orderNumber: dto.orderNumber ?? null,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      reviewDate: dto.reviewDate ?? null,
      nextApplicationDate: dto.nextApplicationDate ?? null,
      status: dto.status ?? 'active',
      notes: dto.notes ?? null,
    });

    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'LEGAL_ORDER_CREATE',
      tableName: 'patient_legal_orders',
      recordId: row.id,
      newData: {
        patient_id: patientId,
        order_type_id: dto.orderTypeId,
        order_number: dto.orderNumber ?? null,
        start_date: dto.startDate,
        end_date: dto.endDate ?? null,
        review_date: dto.reviewDate ?? null,
        next_application_date: dto.nextApplicationDate ?? null,
        status: dto.status ?? 'active',
      },
    });

    return { order: mapOrderRowToResponse(row) };
  },

  async update(
    auth: AuthContext,
    orderId: string,
    dto: UpdateLegalOrderDTO,
  ): Promise<{ order: PatientLegalOrderResponse | null }> {
    // R-FIX-BUG-576-AUTHCONTEXT-UPDATE
    requireClinicalAccessRole(auth);
    requirePermission(auth, 'patient:update');

    const before = await legalOrderCrudRepository.getAuditRow(orderId, auth.clinicId);
    if (!before) {
      return { order: null };
    }
    await requirePatientRelationship(auth, before.patient_id);

    const { expectedLockVersion, ...mutable } = dto;
    const after = await legalOrderCrudRepository.update(
      orderId,
      auth.clinicId,
      expectedLockVersion,
      buildUpdatePatch(mutable),
    );
    const fullRow = await legalOrderCrudRepository.getById(orderId, auth.clinicId);

    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'LEGAL_ORDER_UPDATE',
      tableName: 'patient_legal_orders',
      recordId: orderId,
      oldData: toAuditShape(before),
      newData: toAuditShape(after),
    });

    return { order: fullRow ? mapOrderRowToResponse(fullRow) : null };
  },
};
