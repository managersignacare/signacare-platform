import { z } from 'zod';

export const DURABLE_CLINICAL_AI_JOB_ACTIONS = [
  'ambient',
  'maudsley',
  'isbar',
  'formulation',
  '5p-formulation',
  '91day',
  'letter',
  'admin-report',
  'discharge',
  'med-summary',
  'register-summary',
  'risk-summary',
  'report-insight',
  'handover-summary',
  'medication-adherence',
  'ect-summary',
  'mhrt-report',
  'certificate',
  'classify',
  'linkages',
  'lifechart-schema',
] as const;

export const DurableClinicalAiJobActionSchema = z.enum(DURABLE_CLINICAL_AI_JOB_ACTIONS);
export type DurableClinicalAiJobAction = z.infer<typeof DurableClinicalAiJobActionSchema>;

export const PATIENT_SCOPED_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS = [
  'ambient',
  'maudsley',
  'isbar',
  'letter',
  'med-summary',
  'register-summary',
  'formulation',
  '5p-formulation',
  '91day',
  'discharge',
  'mhrt-report',
  'risk-summary',
  'report-insight',
  'handover-summary',
  'medication-adherence',
  'ect-summary',
  'certificate',
  'classify',
  'linkages',
  'lifechart-schema',
] as const satisfies readonly DurableClinicalAiJobAction[];

export const UNCONDITIONAL_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS = [
  'admin-report',
  'handover-summary',
] as const satisfies readonly DurableClinicalAiJobAction[];

const patientScopedAsyncRequiredSet = new Set<string>(PATIENT_SCOPED_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS);
const unconditionalAsyncRequiredSet = new Set<string>(UNCONDITIONAL_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS);
const durableClinicalAiJobActionSet = new Set<string>(DURABLE_CLINICAL_AI_JOB_ACTIONS);

export const ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE = 'AI_ACTION_REQUIRES_ASYNC_JOB';

export function isDurableClinicalAiJobAction(action: string): action is DurableClinicalAiJobAction {
  return durableClinicalAiJobActionSet.has(action);
}

export function requiresAsyncClinicalAiJob(params: {
  action: string;
  patientId?: string | null;
}): boolean {
  if (unconditionalAsyncRequiredSet.has(params.action)) return true;
  return Boolean(params.patientId) && patientScopedAsyncRequiredSet.has(params.action);
}

export function buildAsyncClinicalAiJobMessage(action: string): string {
  return `${action} must run through the durable async AI job workflow, not a browser-held /llm/clinical-ai request.`;
}
