/**
 * Canonical identifiers for domain-state transitions owned by the
 * Class E command migration program in the v4 architecture plan.
 *
 * These values are opaque identifiers, not human-readable labels.
 * They exist so routes, services, guards, telemetry, and future
 * command registries can agree on one stable command name per
 * high-risk transition.
 */
export const DOMAIN_COMMANDS = {
  EPISODE_CREATE: 'episode.create',
  EPISODE_DEACTIVATE: 'episode.deactivate',
  EPISODE_ASSIGN_MDT: 'episode.assign-mdt',
  REFERRAL_CREATE: 'referral.create',
  REFERRAL_INTAKE_CLOSE: 'referral.intake-close',
  PRESCRIPTION_CREATE: 'prescription.create',
  PATIENT_MEDICATION_UPDATE: 'patientMedication.update',
  CLOZAPINE_TITRATE: 'clozapine.titrate',
  ECT_SCHEDULE_SESSION: 'ect.scheduleSession',
  TMS_SCHEDULE_SESSION: 'tms.scheduleSession',
  ONCOLOGY_START_CYCLE: 'oncology.startCycle',
  ONCOLOGY_RECORD_RESPONSE: 'oncology.recordResponse',
  MHA_S30_TRANSITION: 'mha.s30Transition',
  MHA_S32_TRANSITION: 'mha.s32Transition',
  LEGAL_ORDER_PLACE: 'legalOrder.place',
  RETENTION_PURGE_EXECUTE: 'retentionPurge.execute',
  ALLOCATION_ASSIGN: 'allocation.assign',
  INTAKE_CLOSE: 'intake.close',
  STAFF_SETTINGS_UPDATE: 'staffSettings.update',
} as const;

export type DomainCommand = (typeof DOMAIN_COMMANDS)[keyof typeof DOMAIN_COMMANDS];

export const ALL_DOMAIN_COMMANDS: readonly DomainCommand[] = Object.values(DOMAIN_COMMANDS);

export const DOMAIN_COMMAND_WAVES = {
  E1: [
    DOMAIN_COMMANDS.EPISODE_CREATE,
    DOMAIN_COMMANDS.EPISODE_DEACTIVATE,
    DOMAIN_COMMANDS.EPISODE_ASSIGN_MDT,
    DOMAIN_COMMANDS.REFERRAL_CREATE,
    DOMAIN_COMMANDS.REFERRAL_INTAKE_CLOSE,
  ],
  E2: [
    DOMAIN_COMMANDS.PRESCRIPTION_CREATE,
    DOMAIN_COMMANDS.PATIENT_MEDICATION_UPDATE,
    DOMAIN_COMMANDS.CLOZAPINE_TITRATE,
  ],
  E3: [
    DOMAIN_COMMANDS.ECT_SCHEDULE_SESSION,
    DOMAIN_COMMANDS.TMS_SCHEDULE_SESSION,
    DOMAIN_COMMANDS.ONCOLOGY_START_CYCLE,
    DOMAIN_COMMANDS.ONCOLOGY_RECORD_RESPONSE,
  ],
  E4: [
    DOMAIN_COMMANDS.MHA_S30_TRANSITION,
    DOMAIN_COMMANDS.MHA_S32_TRANSITION,
    DOMAIN_COMMANDS.LEGAL_ORDER_PLACE,
    DOMAIN_COMMANDS.RETENTION_PURGE_EXECUTE,
  ],
  E5: [
    DOMAIN_COMMANDS.ALLOCATION_ASSIGN,
    DOMAIN_COMMANDS.INTAKE_CLOSE,
    DOMAIN_COMMANDS.STAFF_SETTINGS_UPDATE,
  ],
} as const satisfies Record<string, readonly DomainCommand[]>;
