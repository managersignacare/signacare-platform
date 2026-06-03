// apps/api/src/features/flags/flagRepository.ts
import { db } from '../../db/db';

export interface PatientFlagRow {
  id:                  string;
  clinic_id:           string;
  patient_id:          string;
  episode_id:          string | null;
  category:            string;
  severity:            string;
  title:               string;
  description:         string | null;
  status:              string;
  raised_by_staff_id:  string | null;
  resolved_by_staff_id: string | null;
  raised_at:           string;
  resolved_at:         string | null;
  related_record_type: string | null;
  related_record_id:   string | null;
  is_header_flag:      boolean;
  created_at:          string;
  updated_at:          string;
  deleted_at:          string | null;
}

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: patient_flags has these 19 columns matching PatientFlagRow.
const PATIENT_FLAG_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'episode_id',
  'category',
  'severity',
  'title',
  'description',
  'status',
  'raised_by_staff_id',
  'resolved_by_staff_id',
  'raised_at',
  'resolved_at',
  'related_record_type',
  'related_record_id',
  'is_header_flag',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export const flagRepository = {
  async insert(
    row: Omit<PatientFlagRow, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>,
  ): Promise<PatientFlagRow> {
    const [inserted] = await db('patient_flags')
      .insert({
        ...row,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      })
      .returning(PATIENT_FLAG_COLUMNS);
    return inserted as PatientFlagRow;
  },

  async findActiveDuplicate(
    clinicId: string,
    patientId: string,
    category: string,
    severity: string,
    title: string,
    relatedRecordType?: string,
    relatedRecordId?: string,
  ): Promise<PatientFlagRow | undefined> {
    const row = await db('patient_flags')
      .where({
        clinic_id:  clinicId,
        patient_id: patientId,
        category,
        severity,
        title,
        status: 'active',
      })
      .modify((q) => {
        if (relatedRecordType) q.andWhere('related_record_type', relatedRecordType);
        if (relatedRecordId)   q.andWhere('related_record_id', relatedRecordId);
      })
      .whereNull('deleted_at')
      .first();
    return row as PatientFlagRow | undefined;
  },

  async resolveByRecord(
    clinicId: string,
    category: string,
    relatedRecordId: string,
    resolvedByStaffId?: string,
  ): Promise<void> {
    await db('patient_flags')
      .where('clinic_id', clinicId)
      .andWhere('category', category)
      .andWhere('related_record_id', relatedRecordId)
      .andWhere('status', 'active')
      .whereNull('deleted_at')
      .update({
        status:                'resolved',
        resolved_by_staff_id:  resolvedByStaffId ?? null,
        resolved_at:           new Date(),
        updated_at:            new Date(),
      });
  },

  async listHighSeverityForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<PatientFlagRow[]> {
    const rows = await db('patient_flags')
      .where('clinic_id', clinicId)
      .andWhere('patient_id', patientId)
      .whereIn('severity', ['high', 'critical'])
      .andWhere('status', 'active')
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
    return rows as PatientFlagRow[];
  },

  async listForPatient(clinicId: string, patientId: string): Promise<PatientFlagRow[]> {
    const rows = await db('patient_flags')
      .where('clinic_id', clinicId)
      .andWhere('patient_id', patientId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
    return rows as PatientFlagRow[];
  },
};

// S4.3: alias export under the new canonical name. See the matching
// comment in flagService.ts for the rationale.
export { flagRepository as clinicalFlagRepository };
