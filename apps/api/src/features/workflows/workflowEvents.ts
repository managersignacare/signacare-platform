/**
 * Workflow Event Emitter — singleton event bus for business process triggers.
 *
 * Controllers emit events here; the workflow engine subscribes to execute
 * configured workflow steps.
 */
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

export interface WorkflowTriggerData {
  clinicId: string;
  patientId?: string;
  episodeId?: string;
  referralId?: string;
  noteId?: string;
  taskId?: string;
  appointmentId?: string;
  staffId?: string;
  [key: string]: unknown;
}

export const TRIGGER_EVENTS = [
  'referral_accepted',
  'referral_rejected',
  'episode_opened',
  'episode_closed',
  'note_signed',
  'task_completed',
  'appointment_completed',
  'patient_admitted',
  'patient_discharged',
  'pathology_uploaded',
  'lai_overdue',
  'clozapine_blood_due',
  'review_overdue',
  'medication_prescribed',
  'escalation_created',
] as const;

export type TriggerEvent = typeof TRIGGER_EVENTS[number];

class WorkflowEventBus extends EventEmitter {
  hasListenersFor(event: TriggerEvent): boolean {
    return this.listenerCount(event) > 0;
  }

  emitWorkflow(event: TriggerEvent, data: WorkflowTriggerData): void {
    logger.debug({ event, clinicId: data.clinicId, patientId: data.patientId }, `[Workflow] Event: ${event}`);
    this.emit(event, data);
  }
}

export const workflowEvents = new WorkflowEventBus();
workflowEvents.setMaxListeners(50);
