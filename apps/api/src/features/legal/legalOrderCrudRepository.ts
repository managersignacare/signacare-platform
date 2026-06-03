import type { Knex } from 'knex';
import { db } from '../../db/db';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import {
  PATIENT_LEGAL_ORDERS_COLUMNS,
  type PatientLegalOrdersRow,
} from '../../db/types/patient_legal_orders';

const DEFAULT_CONN = db as unknown as Knex;

export interface PatientLegalOrderListRow extends PatientLegalOrdersRow {
  lock_version: number;
  ordertypename: string;
  ordercategory: string;
  enteredbyname: string;
}

export interface ActiveClinicLegalOrderListRow extends PatientLegalOrdersRow {
  lock_version: number;
  ordertypename: string;
  ordercategory: string;
  enteredbyname: string;
  patientgivenname: string;
  patientfamilyname: string;
  patientdob: string | null;
}

export type PatientLegalOrderAuditRow = {
  id: string;
  patient_id: string;
  order_type_id: string;
  order_number: string | null;
  start_date: string;
  end_date: string | null;
  review_date: string | null;
  next_application_date: string | null;
  status: string;
  updated_at: string | Date;
  lock_version: number;
};

// @column-list-projection-exempt: audit_log old/new projection intentionally
// excludes free-text PHI columns (notes, ai_summary).
const PATIENT_LEGAL_ORDER_AUDIT_COLUMNS = [
  'id',
  'patient_id',
  'order_type_id',
  'order_number',
  'start_date',
  'end_date',
  'review_date',
  'next_application_date',
  'status',
  'updated_at',
  'lock_version',
] as const;

type LegalOrderUpdatePatch = {
  order_number?: string;
  start_date?: string;
  end_date?: string;
  review_date?: string;
  next_application_date?: string;
  status?: 'active' | 'expired' | 'revoked' | 'pending' | 'draft';
  notes?: string;
  ai_summary?: string;
};

export const legalOrderCrudRepository = {
  async listActiveByClinic(
    clinicId: string,
    conn: Knex = DEFAULT_CONN,
  ): Promise<ActiveClinicLegalOrderListRow[]> {
    const rows = await conn('patient_legal_orders')
      .join(
        'legal_order_type_configs',
        'legal_order_type_configs.id',
        'patient_legal_orders.order_type_id',
      )
      .join('patients', 'patients.id', 'patient_legal_orders.patient_id')
      .leftJoin('staff', 'staff.id', 'patient_legal_orders.entered_by_id')
      .where('patient_legal_orders.clinic_id', clinicId)
      .andWhere('patients.clinic_id', clinicId)
      .whereNull('patients.deleted_at')
      .where('patient_legal_orders.status', 'active')
      .where(function whereCurrentOrder(this: Knex.QueryBuilder) {
        this.whereNull('patient_legal_orders.end_date')
          .orWhere('patient_legal_orders.end_date', '>=', conn.raw('CURRENT_DATE'));
      })
      .select(
        'patient_legal_orders.*',
        'legal_order_type_configs.name as ordertypename',
        'legal_order_type_configs.category as ordercategory',
        conn.raw(
          "COALESCE(staff.given_name || ' ' || staff.family_name, '') as enteredbyname",
        ),
        'patients.given_name as patientgivenname',
        'patients.family_name as patientfamilyname',
        'patients.date_of_birth as patientdob',
      )
      .orderBy('patient_legal_orders.review_date', 'asc')
      .orderBy('patient_legal_orders.start_date', 'desc');

    return rows as ActiveClinicLegalOrderListRow[];
  },

  async listByPatient(
    patientId: string,
    clinicId: string,
    conn: Knex = DEFAULT_CONN,
  ): Promise<PatientLegalOrderListRow[]> {
    const rows = await conn('patient_legal_orders')
      .join(
        'legal_order_type_configs',
        'legal_order_type_configs.id',
        'patient_legal_orders.order_type_id',
      )
      .leftJoin('staff', 'staff.id', 'patient_legal_orders.entered_by_id')
      .where('patient_legal_orders.patient_id', patientId)
      .where('patient_legal_orders.clinic_id', clinicId)
      .select(
        'patient_legal_orders.*',
        'legal_order_type_configs.name as ordertypename',
        'legal_order_type_configs.category as ordercategory',
        conn.raw(
          "COALESCE(staff.given_name || ' ' || staff.family_name, '') as enteredbyname",
        ),
      )
      .orderBy('patient_legal_orders.start_date', 'desc');

    return rows as PatientLegalOrderListRow[];
  },

  async expireIfActive(
    orderId: string,
    clinicId: string,
    conn: Knex = DEFAULT_CONN,
  ): Promise<number> {
    return conn('patient_legal_orders')
      .where({ id: orderId, clinic_id: clinicId, status: 'active' })
      .update({
        status: 'expired',
        updated_at: new Date(),
        // BUG-566 — auto-expire is a real mutation; bump lock_version so
        // subsequent edits cannot race against stale client state.
        lock_version: conn.raw('lock_version + 1'),
      });
  },

  async create(
    args: {
      patientId: string;
      clinicId: string;
      orderTypeId: string;
      enteredById: string;
      orderNumber: string | null;
      startDate: string;
      endDate: string | null;
      reviewDate: string | null;
      nextApplicationDate: string | null;
      status: 'active' | 'expired' | 'revoked' | 'pending' | 'draft';
      notes: string | null;
    },
    conn: Knex = DEFAULT_CONN,
  ): Promise<PatientLegalOrdersRow> {
    const [row] = await conn('patient_legal_orders')
      .insert({
        id: conn.raw('gen_random_uuid()'),
        patient_id: args.patientId,
        clinic_id: args.clinicId,
        order_type_id: args.orderTypeId,
        entered_by_id: args.enteredById,
        order_number: args.orderNumber,
        start_date: args.startDate,
        end_date: args.endDate,
        review_date: args.reviewDate,
        next_application_date: args.nextApplicationDate,
        status: args.status,
        notes: args.notes,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(PATIENT_LEGAL_ORDERS_COLUMNS);

    return row as PatientLegalOrdersRow;
  },

  async getAuditRow(
    orderId: string,
    clinicId: string,
    conn: Knex = DEFAULT_CONN,
  ): Promise<PatientLegalOrderAuditRow | null> {
    const row = await conn('patient_legal_orders')
      .where({ id: orderId, clinic_id: clinicId })
      .first(PATIENT_LEGAL_ORDER_AUDIT_COLUMNS);

    return (row as PatientLegalOrderAuditRow | undefined) ?? null;
  },

  async update(
    orderId: string,
    clinicId: string,
    expectedLockVersion: number,
    patch: LegalOrderUpdatePatch,
  ): Promise<PatientLegalOrderAuditRow> {
    // R-FIX-BUG-566-REPO-USES-HELPER
    return updateWithOptimisticLock<PatientLegalOrderAuditRow>({
      table: 'patient_legal_orders',
      where: { id: orderId, clinic_id: clinicId },
      expectedLockVersion,
      patch,
      returning: PATIENT_LEGAL_ORDER_AUDIT_COLUMNS as unknown as string[],
    });
  },

  async getById(
    orderId: string,
    clinicId: string,
    conn: Knex = DEFAULT_CONN,
  ): Promise<PatientLegalOrdersRow | null> {
    const row = await conn('patient_legal_orders')
      .where({ id: orderId, clinic_id: clinicId })
      .first(PATIENT_LEGAL_ORDERS_COLUMNS);

    return (row as PatientLegalOrdersRow | undefined) ?? null;
  },
};
