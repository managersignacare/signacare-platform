import { dbAdmin } from '../db/db';
import { logger } from '../utils/logger';
import { isFeatureEnabled } from './featureFlags';
import { writeAuditLog } from '../utils/audit';
import { sendAdminAlert } from '../features/patient-outreach/adminAlert';
import { emitClinicalSignal } from '../features/events/clinicalSignalEmitter';

export interface IntegrationConfigDriftIssue {
  key: string;
  message: string;
  envVars: string[];
}

export interface IntegrationConfigDriftEvaluationInput {
  featureFlags: {
    integrationMhrDocref: boolean;
    integrationRadiologyHl7: boolean;
    integrationHealthlink: boolean;
  };
  runtimeConfigured: {
    mhr: boolean;
    radiology: boolean;
    healthlink: boolean;
    npds: boolean;
    erxAdapter: boolean;
    erxRest: boolean;
  };
  clinicConfig: {
    hpio: string | null;
    npdsConformanceId: string | null;
  };
}

interface PerClinicDriftDeps {
  getFeatureFlag: (flag: string, clinicId: string) => Promise<boolean>;
  getRuntimeConfigured: () => Promise<IntegrationConfigDriftEvaluationInput['runtimeConfigured']>;
  getClinicConfig: (clinicId: string) => Promise<IntegrationConfigDriftEvaluationInput['clinicConfig']>;
  writeDriftAudit: (clinicId: string, actorId: string, issues: IntegrationConfigDriftIssue[]) => Promise<void>;
  sendWarning: (clinicId: string, actorId: string, issues: IntegrationConfigDriftIssue[]) => Promise<void>;
}

const checkedClinics = new Set<string>();
const inFlightClinics = new Set<string>();

const defaultDeps: PerClinicDriftDeps = {
  async getFeatureFlag(flag, clinicId) {
    return isFeatureEnabled(flag, clinicId);
  },
  async getRuntimeConfigured() {
    const { isMhrDocumentApiConfigured } = await import('../integrations/mhr/mhrDocumentClient');
    const { isRadiologyConfigured } = await import('../integrations/radiology/radiologyClient');
    const { isHealthLinkConfigured } = await import('../integrations/healthlink/healthLinkClient');
    const { isNpdsConfigured } = await import('../integrations/escript/npdsClient');
    const { isErxAdapterConfigured } = await import('../integrations/escript/erxAdapterClient');
    const { isConfigured: isErxRestConfigured } = await import('../integrations/escript/erxRestClient');

    return {
      mhr: isMhrDocumentApiConfigured(),
      radiology: isRadiologyConfigured(),
      healthlink: isHealthLinkConfigured(),
      npds: isNpdsConfigured(),
      erxAdapter: isErxAdapterConfigured(),
      erxRest: isErxRestConfigured(),
    };
  },
  async getClinicConfig(clinicId) {
    const row = await dbAdmin('clinics')
      .where({ id: clinicId })
      .select('hpio', 'npds_conformance_id')
      .first();

    return {
      hpio: row?.hpio ?? null,
      npdsConformanceId: row?.npds_conformance_id ?? null,
    };
  },
  async writeDriftAudit(clinicId, actorId, issues) {
    await writeAuditLog({
      clinicId,
      actorId,
      action: 'CLINIC_INTEGRATION_CONFIG_DRIFT',
      tableName: 'clinic_settings',
      recordId: clinicId,
      newData: {
        bug: 'BUG-310',
        issues,
      },
    });
  },
  async sendWarning(clinicId, actorId, issues) {
    const title = 'Integration configuration drift detected';
    const body = 'One or more enabled clinic integrations are not fully configured. Review clinic integration settings.';

    await emitClinicalSignal({
      source: 'integration_drift',
      signalKey: 'integration-config-drift',
      clinicId,
      userId: actorId,
      severity: 'warning',
      category: 'system',
      title,
      body,
      payload: {
        bug: 'BUG-310',
        issues,
      },
      dedupeKey: `bug-310:integration-config-drift:${clinicId}`,
      channels: ['sse', 'bell'],
    });

    await sendAdminAlert({
      clinicId,
      kind: 'integration_config_drift',
      payload: {
        bug: 'BUG-310',
        title,
        issues,
      },
    });
  },
};

function hasValue(v: string | null): boolean {
  return !!v && v.trim().length > 0;
}

export function evaluatePerClinicIntegrationConfigDrift(
  input: IntegrationConfigDriftEvaluationInput,
): IntegrationConfigDriftIssue[] {
  const issues: IntegrationConfigDriftIssue[] = [];

  if (input.featureFlags.integrationMhrDocref && !input.runtimeConfigured.mhr) {
    issues.push({
      key: 'integration-mhr-docref',
      message: "Feature flag 'integration-mhr-docref' is ON but MHR integration is not configured.",
      envVars: ['MHR_API_URL', 'MHR_NASH_CERT_PATH', 'MHR_CONFORMANCE_ID'],
    });
  }

  if (input.featureFlags.integrationRadiologyHl7 && !input.runtimeConfigured.radiology) {
    issues.push({
      key: 'integration-radiology-hl7',
      message: "Feature flag 'integration-radiology-hl7' is ON but RIS/HL7 integration is not configured.",
      envVars: ['RIS_MLLP_HOST', 'RIS_MLLP_PORT'],
    });
  }

  if (input.featureFlags.integrationHealthlink && !input.runtimeConfigured.healthlink) {
    issues.push({
      key: 'integration-healthlink',
      message: "Feature flag 'integration-healthlink' is ON but HealthLink integration is not configured.",
      envVars: ['HEALTHLINK_SMD_ID', 'HEALTHLINK_SMD_URL'],
    });
  }

  const erxAny =
    input.runtimeConfigured.npds ||
    input.runtimeConfigured.erxAdapter ||
    input.runtimeConfigured.erxRest;

  if (erxAny && !hasValue(input.clinicConfig.hpio)) {
    issues.push({
      key: 'clinic-hpio-missing',
      message: 'Clinic has eRx runtime configured but clinics.hpio is missing.',
      envVars: ['STRICT_ERX_HPIO=true (after backfill)'],
    });
  }

  if (input.runtimeConfigured.npds && !hasValue(input.clinicConfig.npdsConformanceId)) {
    issues.push({
      key: 'clinic-npds-conformance-id-missing',
      message: 'Clinic has NPDS runtime configured but clinics.npds_conformance_id is missing.',
      envVars: ['STRICT_NPDS_CONFORMANCE=true (after backfill)'],
    });
  }

  return issues;
}

export async function runPerClinicIntegrationConfigDriftCheck(
  input: { clinicId: string; actorId: string; role: string },
  deps: PerClinicDriftDeps = defaultDeps,
): Promise<{ checked: boolean; issues: IntegrationConfigDriftIssue[] }> {
  if (input.role !== 'admin' && input.role !== 'superadmin') {
    return { checked: false, issues: [] };
  }

  if (checkedClinics.has(input.clinicId) || inFlightClinics.has(input.clinicId)) {
    return { checked: false, issues: [] };
  }

  inFlightClinics.add(input.clinicId);

  try {
    const featureFlags = {
      integrationMhrDocref: await deps.getFeatureFlag('integration-mhr-docref', input.clinicId),
      integrationRadiologyHl7: await deps.getFeatureFlag('integration-radiology-hl7', input.clinicId),
      integrationHealthlink: await deps.getFeatureFlag('integration-healthlink', input.clinicId),
    };

    const runtimeConfigured = await deps.getRuntimeConfigured();
    const clinicConfig = await deps.getClinicConfig(input.clinicId);

    const issues = evaluatePerClinicIntegrationConfigDrift({
      featureFlags,
      runtimeConfigured,
      clinicConfig,
    });

    if (issues.length > 0) {
      await deps.writeDriftAudit(input.clinicId, input.actorId, issues);
      await deps.sendWarning(input.clinicId, input.actorId, issues);
      logger.warn(
        {
          clinicId: input.clinicId,
          actorId: input.actorId,
          issues,
          kind: 'integration_config_drift',
        },
        '[BUG-310] per-clinic integration configuration drift detected',
      );
    }

    checkedClinics.add(input.clinicId);
    return { checked: true, issues };
  } finally {
    inFlightClinics.delete(input.clinicId);
  }
}

export function schedulePerClinicIntegrationConfigDriftCheck(input: {
  clinicId: string;
  actorId: string;
  role: string;
}): void {
  runPerClinicIntegrationConfigDriftCheck(input).catch((err) => {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        clinicId: input.clinicId,
        actorId: input.actorId,
      },
      '[BUG-310] per-clinic integration drift check failed open',
    );
  });
}

export function __resetPerClinicIntegrationConfigDriftCacheForTests(): void {
  checkedClinics.clear();
  inFlightClinics.clear();
}
