import {
  ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE,
  buildAsyncClinicalAiJobMessage,
  requiresAsyncClinicalAiJob,
} from '@signacare/shared';
import { AppError } from '../../shared/errors';

export function assertSyncClinicalAiRouteAllowed(action: string, patientId?: string): void {
  if (!requiresAsyncClinicalAiJob({ action, patientId })) return;
  throw new AppError(
    buildAsyncClinicalAiJobMessage(action),
    409,
    ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE,
    {
      action,
      recommendedEndpoint: '/api/v1/ai/jobs',
    },
  );
}
