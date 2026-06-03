// Re-export authoritative types from shared package
export type {
  EscalationPriority,
  EscalationStatus,
  EscalationEventType,
  CreateEscalationDTO,
  UpdateEscalationDTO,
  EscalationEventResponse,
  EscalationResponse,
} from '@signacare/shared';

export {
  EscalationPrioritySchema,
  EscalationStatusSchema,
  CreateEscalationSchema,
  UpdateEscalationSchema,
} from '@signacare/shared';

// Alias used in some components
export type { EscalationResponse as Escalation } from '@signacare/shared';

export const ASSIGNED_TEAMS = [
  'Inpatient',
  'ACIS',
  'CATT',
  'Emergency',
  'Community',
  'Management',
] as const;
