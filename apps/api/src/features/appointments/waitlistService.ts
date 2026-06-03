// apps/api/src/features/appointments/waitlistService.ts
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { waitlistRepository, type WaitlistStatus } from './waitlistRepository';
import { AppError } from '../../shared/errors';
import {
  WaitlistCreateDTO,
  WaitlistUpdateDTO,
  WaitlistEntryResponse,
} from '@signacare/shared';
import { z } from 'zod';

type WaitlistCreateDTOType = z.infer<typeof WaitlistCreateDTO>;
type WaitlistUpdateDTOType = z.infer<typeof WaitlistUpdateDTO>;
type WaitlistEntryResponseType = z.infer<typeof WaitlistEntryResponse>;

function mapDbToResponse(row: Record<string, unknown>): WaitlistEntryResponseType {
  // Phase 0.7.5 c24 C4 (SD12) — maps canonical DB columns to the camelCase
  // response contract. Frontend field names (preferredClinicianId,
  // addedDate, targetAppointmentBy) are unchanged; only the backend
  // reads from real columns (preferred_clinician_id, added_date,
  // target_appointment_by) instead of ghost ones.
  return {
    id: row.id as string,
    clinicId: row.clinic_id as string,
    patientId: row.patient_id as string,
    referralId: (row.referral_id as string | null) ?? null,
    preferredClinicianId: (row.preferred_clinician_id as string | null) ?? null,
    priority: row.priority as WaitlistEntryResponseType['priority'],
    preferredTimeOfDay: (row.preferred_time_of_day as WaitlistEntryResponseType['preferredTimeOfDay']) ?? null,
    preferredStartTime: (row.preferred_start_time as string | null) ?? null,
    preferredEndTime: (row.preferred_end_time as string | null) ?? null,
    addedDate: row.added_date as string,
    targetAppointmentBy: (row.target_appointment_by as string | null) ?? null,
    status: row.status as WaitlistEntryResponseType['status'],
    convertedAppointmentId: (row.converted_appointment_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const waitlistService = {
  async create(
    clinicId: string,
    _staffId: string,
    dto: WaitlistCreateDTOType,
  ): Promise<WaitlistEntryResponseType> {
    const rowToInsert = {
      id: uuidv4(),
      clinic_id: clinicId,
      patient_id: dto.patientId,
      referral_id: dto.referralId ?? null,
      preferred_clinician_id: dto.preferredClinicianId ?? null,
      priority: dto.priority,
      preferred_time_of_day: dto.preferredTimeOfDay ?? null,
      preferred_start_time: dto.preferredStartTime ?? null,
      preferred_end_time: dto.preferredEndTime ?? null,
      added_date: new Date().toISOString().split('T')[0],
      target_appointment_by: dto.targetAppointmentBy ?? null,
      status: 'waiting' as WaitlistStatus,
      converted_appointment_id: null,
      notes: dto.notes ?? null,
    };
    const created = await waitlistRepository.create(db, rowToInsert);
    return mapDbToResponse(created as unknown as Record<string, unknown>);
  },

  async update(
    clinicId: string,
    id: string,
    dto: WaitlistUpdateDTOType,
  ): Promise<WaitlistEntryResponseType> {
    const existing = await waitlistRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Waitlist entry not found', 404, 'NOT_FOUND');

    const patch = {
      preferred_clinician_id:
        dto.preferredClinicianId !== undefined
          ? dto.preferredClinicianId
          : existing.preferred_clinician_id,
      priority: dto.priority ?? existing.priority,
      target_appointment_by: dto.targetAppointmentBy ?? existing.target_appointment_by,
      status: (dto.status ?? existing.status) as WaitlistStatus,
      notes: dto.notes ?? existing.notes,
    };

    const updated = await waitlistRepository.update(db, clinicId, id, patch);
    if (!updated) throw new AppError('Waitlist entry not found after update', 404, 'NOT_FOUND');
    return mapDbToResponse(updated as unknown as Record<string, unknown>);
  },

  async list(
    clinicId: string,
    params: {
      patientId?: string;
      status?: string;
      priority?: string;
      limit: number;
      offset: number;
    },
  ): Promise<WaitlistEntryResponseType[]> {
    const rows = await waitlistRepository.list({
      clinicId,
      patientId: params.patientId,
      status: params.status as WaitlistStatus | undefined,
      priority: params.priority as WaitlistEntryResponseType['priority'] | undefined,
      limit: params.limit,
      offset: params.offset,
    });
    return rows.map((r) => mapDbToResponse(r as unknown as Record<string, unknown>));
  },

  async promoteToAppointment(
    clinicId: string,
    _staffId: string,
    waitlistEntryId: string,
    appointmentDetails: {
      clinicianId: string;
      episodeId?: string;
      startTime: string;
      endTime: string;
      type: 'initial' | 'follow_up' | 'assessment' | 'telehealth' | 'group' | 'clinical_review';
      notes?: string;
    },
  ): Promise<{ appointment: Record<string, unknown>; waitlistEntry: WaitlistEntryResponseType }> {
    const existing = await waitlistRepository.findById(clinicId, waitlistEntryId);
    if (!existing) throw new AppError('Waitlist entry not found', 404, 'NOT_FOUND');
    if (existing.status !== 'waiting' && existing.status !== 'offered') {
      throw new AppError('Only waiting or offered entries can be converted', 422, 'INVALID_STATE');
    }

    const start = new Date(appointmentDetails.startTime);
    const end = new Date(appointmentDetails.endTime);
    if (end <= start) {
      throw new AppError('End time must be after start time', 422, 'INVALID_TIME_RANGE');
    }

    const result = await db.transaction(async (trx) => {
      const conflicts = await trx('appointments')
        .where({ clinic_id: clinicId, clinician_id: appointmentDetails.clinicianId })
        .whereNull('deleted_at')
        .whereNot('status', 'cancelled')
        .andWhere((builder) =>
          builder
            .whereBetween('appointment_start', [start, end])
            .orWhereBetween('appointment_end', [start, end])
            .orWhere((b) => b.where('appointment_start', '<', start).andWhere('appointment_end', '>', end)),
        );

      if (conflicts.length > 0) {
        throw new AppError(
          'Clinician is already booked during this time slot',
          409,
          'APPOINTMENT_CONFLICT',
        );
      }

      // Phase 0.7.5 c24 D1 — explicit column list matching AppointmentDb.
      // The .returning shape is the contract with the caller (which
      // only reads .id + serialises the row in the response), so the
      // same 18-column list the appointmentRepository uses applies here.
      const [createdAppointment] = await trx('appointments')
        .insert({
          id: uuidv4(),
          clinic_id: clinicId,
          patient_id: existing.patient_id,
          clinician_id: appointmentDetails.clinicianId,
          episode_id: appointmentDetails.episodeId ?? null,
          appointment_start: start,
          appointment_end: end,
          status: 'scheduled',
          appointment_type: appointmentDetails.type,
          notes: appointmentDetails.notes ?? existing.notes,
          telehealth: appointmentDetails.type === 'telehealth',
          telehealth_url: null,
          cancellation_reason: null,
          cancelled_by_id: null,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        })
        .returning([
          'id',
          'clinic_id',
          'patient_id',
          'clinician_id',
          'episode_id',
          'specialty_code',
          'appointment_start',
          'appointment_end',
          'appointment_type',
          'status',
          'notes',
          'telehealth',
          'telehealth_url',
          'cancellation_reason',
          'cancelled_by_id',
          'created_at',
          'updated_at',
          'deleted_at',
        ]);

      const updatedWaitlist = await waitlistRepository.update(trx, clinicId, waitlistEntryId, {
        status: 'converted',
        converted_appointment_id: createdAppointment.id,
      });

      if (!updatedWaitlist) {
        throw new AppError('Waitlist entry not found during conversion', 404, 'NOT_FOUND');
      }

      return { createdAppointment, updatedWaitlist };
    });

    return {
      appointment: result.createdAppointment as unknown as Record<string, unknown>,
      waitlistEntry: mapDbToResponse(result.updatedWaitlist as unknown as Record<string, unknown>),
    };
  },
};