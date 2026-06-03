import { dbAdmin } from '../../db/db';
import {
  emitClinicalSignal,
  type ClinicalSignalSource,
} from '../../features/events/clinicalSignalEmitter';
import type { EmitInput, EmitResult } from '../../features/notifications/notificationService';

export interface SchedulerSignalInput extends Omit<EmitInput, 'conn'> {
  signalKey: string;
  source?: ClinicalSignalSource;
}

/**
 * Canonical scheduler->notification adapter.
 *
 * Why:
 * - M1 structural remediation: schedulers route through centralized
 *   clinical-signal envelope, not direct notificationService.emit.
 * - BUG-583 sibling pattern: schedulers run outside request context,
 *   so conn must be dbAdmin for durable bell inserts.
 */
export async function emitSchedulerSignal(input: SchedulerSignalInput): Promise<EmitResult> {
  return emitClinicalSignal({
    ...input,
    source: input.source ?? 'scheduler',
    signalKey: input.signalKey,
    conn: dbAdmin,
  });
}

