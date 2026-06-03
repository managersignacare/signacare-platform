import { notificationService, type EmitInput, type EmitResult } from '../notifications/notificationService';

export type ClinicalSignalSource =
  | 'messaging'
  | 'appointments'
  | 'referrals'
  | 'integration_drift'
  | 'scheduler'
  | 'workflow'
  | 'system';

export interface ClinicalSignalInput extends EmitInput {
  source: ClinicalSignalSource;
  signalKey: string;
}

/**
 * Centralized entry point for clinical UI signals.
 *
 * Why: M1 structural remediation. Feature modules emit through this
 * facade so we can keep one canonical envelope for cross-module
 * notifications (source + signal metadata + delivery channels).
 */
export async function emitClinicalSignal(input: ClinicalSignalInput): Promise<EmitResult> {
  const payload = {
    ...(input.payload ?? {}),
    signal_source: input.source,
    signal_key: input.signalKey,
  };

  return notificationService.emit({
    ...input,
    payload,
  });
}
