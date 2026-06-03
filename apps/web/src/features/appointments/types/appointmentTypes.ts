// apps/web/src/features/appointments/types/appointmentTypes.ts
//
// Phase 0.7 PR3 Class D (TYPEDUP:AppointmentStatus) — frontend no
// longer redeclares AppointmentStatus. It now comes directly from
// @signacare/shared, which is the single source of truth. The local
// `Appointment` alias is a friendly rename of `AppointmentResponse` for
// UI code that works with a single row.
import { AppointmentResponse, CreateAppointmentDTO } from '@signacare/shared';

export type Appointment = AppointmentResponse;
export type CreateAppointment = CreateAppointmentDTO;
export type { AppointmentStatus } from '@signacare/shared';
// Re-import locally for use in the getAppointmentStatusMeta() switch below.
import type { AppointmentStatus } from '@signacare/shared';

export type AppointmentFilters = {
  clinicianStaffId?: string;
  patientId?: string;
  status?: string;
  from?: string;
  to?: string;
};

export const getAppointmentStatusMeta = (
  status: AppointmentStatus,
): { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' } => {
  switch (status) {
    case 'scheduled':   return { label: 'Scheduled',   color: 'default' };
    case 'confirmed':   return { label: 'Confirmed',   color: 'primary' };
    case 'arrived':     return { label: 'Arrived',     color: 'success' };
    case 'in_session':  return { label: 'In progress', color: 'warning' };
    case 'completed':   return { label: 'Completed',   color: 'success' };
    case 'no_show':     return { label: 'No show',     color: 'error'   };
    case 'cancelled':   return { label: 'Cancelled',   color: 'default' };
    case 'rescheduled': return { label: 'Rescheduled', color: 'warning' };
    default:            return { label: status,        color: 'default' };
  }
};