import type { ScribeOutcomeTelemetry } from '@signacare/shared';
import { recordLlmInteraction } from '../../shared/recordLlmInteraction';

export async function recordScribeOutcomeTelemetry(input: {
  clinicId: string;
  staffId: string;
  patientId: string;
  sessionId?: string | null;
  telemetry: ScribeOutcomeTelemetry;
}): Promise<void> {
  await recordLlmInteraction({
    clinicId: input.clinicId,
    userId: input.staffId,
    patientId: input.patientId,
    feature: 'scribe-outcome-telemetry',
    modelName: 'system-telemetry',
    modelProvider: 'system',
    modelVersion: 'system-telemetry@1.0',
    success: true,
    latencyMs: input.telemetry.latencyMs,
    metadata: {
      event: input.telemetry.event,
      sessionPresent: Boolean(input.sessionId),
      jobPresent: Boolean(input.telemetry.jobId),
      documentKind: input.telemetry.documentKind ?? null,
      editDistanceRatio: input.telemetry.editDistanceRatio ?? null,
      acceptedWithoutEdit: input.telemetry.acceptedWithoutEdit ?? null,
      clinicianSatisfaction: input.telemetry.clinicianSatisfaction ?? null,
      lineageKey: input.telemetry.lineageKey ?? null,
      source: 'ai-scribe-parity-v1',
    },
  });
}
