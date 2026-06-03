import type {
  AuthContext,
  CreateWearableDeviceSourceDTO,
  DigitalPhenotypeSnapshot,
  WearableSurveillanceSnapshot,
  RequestWearableSourceSyncDTO,
  UpdateWearableDeviceSourceDTO,
  WearableDeviceSource,
  WearableProvider,
  WearableProviderCatalogItem,
  WearableSourceSyncOutcome,
  WearableIngestBatchDTO,
} from '@signacare/shared';
import { db, dbAdmin } from '../../db/db';
import { AppError } from '../../shared/errors';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import { withTenantContext } from '../../shared/tenantContext';
import { PATIENT_DEVICE_SOURCES_COLUMNS } from '../../db/types/patient_device_sources';
import { PATIENT_DIGITAL_PHENOTYPES_COLUMNS } from '../../db/types/patient_digital_phenotypes';
import {
  buildWearableSurveillanceSnapshot,
  runSpecialtySurveillanceActions,
  TRACKING_TYPE_FOR_ARRHYTHMIA,
  TRACKING_TYPE_FOR_GLUCOSE,
} from './digitalSurveillanceService';
import logger from '../../utils/logger';

type DeviceSourceRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  provider: string;
  device_label: string;
  external_device_id: string | null;
  is_active: boolean;
  metadata: unknown;
  last_ingested_at: Date | string | null;
  lock_version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PhenotypeRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  computation_day: Date | string;
  lookback_days: number;
  sleep_hours_avg_7d: string | number | null;
  steps_avg_7d: string | number | null;
  resting_hr_avg_7d: string | number | null;
  hrv_avg_7d: string | number | null;
  mood_avg_7d: string | number | null;
  anxiety_avg_7d: string | number | null;
  adherence_score: string | number;
  risk_index: string | number;
  risk_band: 'low' | 'moderate' | 'high' | 'critical';
  contributing_signals: unknown;
  lock_version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type MetricAccumulator = {
  sleepHours: number[];
  steps: number[];
  restingHr: number[];
  hrv: number[];
  mood: number[];
  anxiety: number[];
  observedDays: Set<string>;
};

type ProviderCapabilities = Omit<WearableProviderCatalogItem, 'isConfigured'>;

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const PROVIDER_CAPABILITIES: Record<WearableProvider, ProviderCapabilities> = {
  apple_health: {
    provider: 'apple_health',
    displayName: 'Apple Health',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: false,
    configuredEnvKeys: ['WEARABLE_APPLE_HEALTH_CLIENT_ID', 'WEARABLE_APPLE_HEALTH_CLIENT_SECRET'],
  },
  google_fit: {
    provider: 'google_fit',
    displayName: 'Google Fit',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: false,
    configuredEnvKeys: ['WEARABLE_GOOGLE_FIT_CLIENT_ID', 'WEARABLE_GOOGLE_FIT_CLIENT_SECRET'],
  },
  fitbit: {
    provider: 'fitbit',
    displayName: 'Fitbit',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: true,
    configuredEnvKeys: ['WEARABLE_FITBIT_CLIENT_ID', 'WEARABLE_FITBIT_CLIENT_SECRET'],
  },
  garmin: {
    provider: 'garmin',
    displayName: 'Garmin',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: true,
    configuredEnvKeys: ['WEARABLE_GARMIN_CLIENT_ID', 'WEARABLE_GARMIN_CLIENT_SECRET'],
  },
  oura: {
    provider: 'oura',
    displayName: 'Oura',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: true,
    configuredEnvKeys: ['WEARABLE_OURA_CLIENT_ID', 'WEARABLE_OURA_CLIENT_SECRET'],
  },
  whoop: {
    provider: 'whoop',
    displayName: 'WHOOP',
    integrationMode: 'oauth',
    supportsBackfill: true,
    supportsRealtimeWebhook: true,
    configuredEnvKeys: ['WEARABLE_WHOOP_CLIENT_ID', 'WEARABLE_WHOOP_CLIENT_SECRET'],
  },
  manual_import: {
    provider: 'manual_import',
    displayName: 'Manual Import',
    integrationMode: 'manual',
    supportsBackfill: false,
    supportsRealtimeWebhook: false,
    configuredEnvKeys: [],
  },
};

function isProviderConfigured(provider: WearableProvider): boolean {
  const config = PROVIDER_CAPABILITIES[provider];
  if (!config || config.integrationMode === 'manual') return true;
  return config.configuredEnvKeys.every((key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function assertProviderConfigured(provider: WearableProvider): void {
  if (provider === 'manual_import') return;
  if (!isProviderConfigured(provider)) {
    throw new AppError(
      `Wearable provider '${provider}' is not configured for this environment`,
      412,
      'WEARABLE_PROVIDER_NOT_CONFIGURED',
      { provider },
    );
  }
}

function deviceSourceToResponse(row: DeviceSourceRow): WearableDeviceSource {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    provider: row.provider as WearableDeviceSource['provider'],
    deviceLabel: row.device_label,
    externalDeviceId: row.external_device_id,
    isActive: row.is_active,
    metadata: parseJsonObject(row.metadata),
    lastIngestedAt: toIso(row.last_ingested_at),
    lockVersion: row.lock_version,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function phenotypeToResponse(row: PhenotypeRow): DigitalPhenotypeSnapshot {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    computationDay: row.computation_day instanceof Date
      ? row.computation_day.toISOString().split('T')[0]
      : String(row.computation_day),
    lookbackDays: row.lookback_days,
    sleepHoursAvg7d: asNullableNumber(row.sleep_hours_avg_7d),
    stepsAvg7d: asNullableNumber(row.steps_avg_7d),
    restingHrAvg7d: asNullableNumber(row.resting_hr_avg_7d),
    hrvAvg7d: asNullableNumber(row.hrv_avg_7d),
    moodAvg7d: asNullableNumber(row.mood_avg_7d),
    anxietyAvg7d: asNullableNumber(row.anxiety_avg_7d),
    adherenceScore: asNullableNumber(row.adherence_score) ?? 0,
    riskIndex: asNullableNumber(row.risk_index) ?? 0,
    riskBand: row.risk_band,
    contributingSignals: Object.fromEntries(
      Object.entries(parseJsonObject(row.contributing_signals)).map(([key, value]) => [
        key,
        asNullableNumber(value) ?? 0,
      ]),
    ),
    lockVersion: row.lock_version,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

async function assertPathwaysModuleEnabled(clinicId: string): Promise<void> {
  const moduleRow = await dbAdmin('clinic_modules')
    .where({ clinic_id: clinicId, module_key: MODULE_KEYS.PATHWAYS })
    .first('is_enabled');
  if (moduleRow && moduleRow['is_enabled'] === false) {
    throw new AppError(
      `Module '${MODULE_KEYS.PATHWAYS}' is disabled for this clinic`,
      403,
      'MODULE_DISABLED',
    );
  }
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreInverse(value: number | null, best: number, worst: number): number {
  if (value == null) return 0;
  if (value >= best) return 0;
  if (value <= worst) return 100;
  return ((best - value) / (best - worst)) * 100;
}

function scoreDirect(value: number | null, best: number, worst: number): number {
  if (value == null) return 0;
  if (value <= best) return 0;
  if (value >= worst) return 100;
  return ((value - best) / (worst - best)) * 100;
}

function bandFromRiskIndex(riskIndex: number): DigitalPhenotypeSnapshot['riskBand'] {
  if (riskIndex >= 75) return 'critical';
  if (riskIndex >= 55) return 'high';
  if (riskIndex >= 30) return 'moderate';
  return 'low';
}

function computeRisk(acc: MetricAccumulator): {
  sleepHoursAvg7d: number | null;
  stepsAvg7d: number | null;
  restingHrAvg7d: number | null;
  hrvAvg7d: number | null;
  moodAvg7d: number | null;
  anxietyAvg7d: number | null;
  adherenceScore: number;
  riskIndex: number;
  riskBand: DigitalPhenotypeSnapshot['riskBand'];
  contributingSignals: Record<string, number>;
} {
  const sleepHoursAvg7d = avg(acc.sleepHours);
  const stepsAvg7d = avg(acc.steps);
  const restingHrAvg7d = avg(acc.restingHr);
  const hrvAvg7d = avg(acc.hrv);
  const moodAvg7d = avg(acc.mood);
  const anxietyAvg7d = avg(acc.anxiety);

  const signalScores = {
    sleep: scoreInverse(sleepHoursAvg7d, 7, 4),
    steps: scoreInverse(stepsAvg7d, 8000, 1500),
    restingHr: scoreDirect(restingHrAvg7d, 65, 95),
    hrv: scoreInverse(hrvAvg7d, 45, 15),
    mood: scoreInverse(moodAvg7d, 7, 3),
    anxiety: scoreDirect(anxietyAvg7d, 3, 8),
  };

  const weighted = (
    signalScores.sleep * 0.22
    + signalScores.steps * 0.14
    + signalScores.restingHr * 0.14
    + signalScores.hrv * 0.14
    + signalScores.mood * 0.18
    + signalScores.anxiety * 0.18
  );
  const riskIndex = Number(Math.max(0, Math.min(100, weighted)).toFixed(2));

  const expectedSignals = 6;
  const presentSignals = [
    sleepHoursAvg7d,
    stepsAvg7d,
    restingHrAvg7d,
    hrvAvg7d,
    moodAvg7d,
    anxietyAvg7d,
  ].filter((item) => item != null).length;
  const adherenceScore = Number(((presentSignals / expectedSignals) * 100).toFixed(2));

  return {
    sleepHoursAvg7d,
    stepsAvg7d,
    restingHrAvg7d,
    hrvAvg7d,
    moodAvg7d,
    anxietyAvg7d,
    adherenceScore,
    riskIndex,
    riskBand: bandFromRiskIndex(riskIndex),
    contributingSignals: {
      sleep: Number(signalScores.sleep.toFixed(2)),
      steps: Number(signalScores.steps.toFixed(2)),
      restingHr: Number(signalScores.restingHr.toFixed(2)),
      hrv: Number(signalScores.hrv.toFixed(2)),
      mood: Number(signalScores.mood.toFixed(2)),
      anxiety: Number(signalScores.anxiety.toFixed(2)),
      observationDays: acc.observedDays.size,
    },
  };
}

function createAccumulator(): MetricAccumulator {
  return {
    sleepHours: [],
    steps: [],
    restingHr: [],
    hrv: [],
    mood: [],
    anxiety: [],
    observedDays: new Set<string>(),
  };
}

function addMetric(acc: MetricAccumulator, metricType: string, value: number, dayKey: string): void {
  if (metricType === 'sleep_hours') acc.sleepHours.push(value);
  if (metricType === 'steps') acc.steps.push(value);
  if (metricType === 'resting_hr') acc.restingHr.push(value);
  if (metricType === 'hrv') acc.hrv.push(value);
  if (metricType === 'mood') acc.mood.push(value);
  if (metricType === 'anxiety') acc.anxiety.push(value);
  acc.observedDays.add(dayKey);
}

export const digitalPhenotypingService = {
  listProviderCatalog(): WearableProviderCatalogItem[] {
    return Object.values(PROVIDER_CAPABILITIES).map((item) => ({
      ...item,
      isConfigured: isProviderConfigured(item.provider),
    }));
  },

  async listDeviceSources(
    auth: AuthContext,
    patientId: string,
    options?: { includeInactive?: boolean },
  ): Promise<WearableDeviceSource[]> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const query = dbAdmin('patient_device_sources')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .orderBy('created_at', 'desc')
      .select(PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[]);
    if (!options?.includeInactive) {
      query.andWhere({ is_active: true });
    }
    const rows = (await query) as unknown as DeviceSourceRow[];
    return rows.map(deviceSourceToResponse);
  },

  async createDeviceSource(
    auth: AuthContext,
    patientId: string,
    dto: CreateWearableDeviceSourceDTO,
  ): Promise<WearableDeviceSource> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    assertProviderConfigured(dto.provider);
    const rows = (await dbAdmin('patient_device_sources')
      .insert({
        clinic_id: auth.clinicId,
        patient_id: patientId,
        provider: dto.provider,
        device_label: dto.deviceLabel.trim(),
        external_device_id: dto.externalDeviceId?.trim() || null,
        is_active: true,
        metadata: JSON.stringify(dto.metadata ?? {}),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[])) as unknown as DeviceSourceRow[];
    return deviceSourceToResponse(rows[0] as DeviceSourceRow);
  },

  async updateDeviceSource(
    auth: AuthContext,
    patientId: string,
    sourceId: string,
    dto: UpdateWearableDeviceSourceDTO,
  ): Promise<WearableDeviceSource> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const source = (await dbAdmin('patient_device_sources')
      .where({ id: sourceId, clinic_id: auth.clinicId, patient_id: patientId })
      .first(PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[])) as DeviceSourceRow | undefined;
    if (!source) {
      throw new AppError('Wearable source not found', 404, 'WEARABLE_SOURCE_NOT_FOUND');
    }

    if (dto.isActive === true) {
      assertProviderConfigured(source.provider as WearableProvider);
    }

    const currentMetadata = parseJsonObject(source.metadata);
    const nextMetadata = dto.metadataPatch
      ? {
          ...currentMetadata,
          ...dto.metadataPatch,
          updatedByStaffId: auth.staffId,
          updatedAt: new Date().toISOString(),
        }
      : currentMetadata;
    const updated = await updateWithOptimisticLock<DeviceSourceRow>({
      table: 'patient_device_sources',
      where: {
        id: sourceId,
        clinic_id: auth.clinicId,
        patient_id: patientId,
      },
      expectedLockVersion: dto.expectedLockVersion,
      patch: {
        device_label: dto.deviceLabel?.trim() || source.device_label,
        external_device_id: dto.externalDeviceId !== undefined
          ? (dto.externalDeviceId?.trim() || null)
          : source.external_device_id,
        is_active: dto.isActive ?? source.is_active,
        metadata: JSON.stringify(nextMetadata),
      },
      returning: PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[],
    });
    return deviceSourceToResponse(updated);
  },

  async ingestWearableBatch(
    auth: AuthContext,
    patientId: string,
    dto: WearableIngestBatchDTO,
  ): Promise<{ ingestedCount: number }> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const source = (await dbAdmin('patient_device_sources')
      .where({
        id: dto.sourceId,
        clinic_id: auth.clinicId,
        patient_id: patientId,
        is_active: true,
      })
      .first(PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[])) as DeviceSourceRow | undefined;
    if (!source) {
      throw new AppError('Wearable source not found', 404, 'WEARABLE_SOURCE_NOT_FOUND');
    }

    const now = new Date();
    const rows = dto.entries.map((entry) => ({
      clinic_id: auth.clinicId,
      patient_id: patientId,
      tracking_type: entry.metricType,
      value: entry.value,
      note: entry.note ?? null,
      recorded_at: entry.timestamp ? new Date(entry.timestamp) : now,
      source: 'wearable_device',
    }));

    const glucoseRows = dto.entries
      .filter((entry) => TRACKING_TYPE_FOR_GLUCOSE.has(entry.metricType))
      .map((entry) => {
        const timestamp = entry.timestamp ? new Date(entry.timestamp) : now;
        const unit = entry.metricType === 'glucose_mgdl' ? 'mg/dL' : 'mmol/L';
        return {
          clinic_id: auth.clinicId,
          patient_id: patientId,
          episode_id: null,
          value: String(entry.value),
          unit,
          source: 'cgm',
          meal_context: null,
          measured_at: timestamp,
          recorded_by: null,
          note: entry.note ?? 'Imported from wearable ingestion stream',
          created_at: now,
          updated_at: now,
        };
      });

    await dbAdmin('patient_tracking').insert(rows);
    if (glucoseRows.length > 0) {
      await dbAdmin('glucose_readings').insert(glucoseRows);
    }
    await updateWithOptimisticLock<DeviceSourceRow>({
      table: 'patient_device_sources',
      where: { clinic_id: auth.clinicId, id: source.id },
      expectedLockVersion: source.lock_version,
      patch: {
        last_ingested_at: now,
      },
      returning: PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[],
    });

    const hasSpecialtySignalEntries = dto.entries.some((entry) =>
      TRACKING_TYPE_FOR_GLUCOSE.has(entry.metricType)
      || TRACKING_TYPE_FOR_ARRHYTHMIA.has(entry.metricType),
    );
    if (hasSpecialtySignalEntries) {
      try {
        await runSpecialtySurveillanceActions(auth, patientId);
      } catch (err) {
        logger.warn(
          { err, clinicId: auth.clinicId, patientId },
          'specialty surveillance actions failed after wearable ingest; continuing',
        );
      }
    }
    return { ingestedCount: rows.length };
  },

  async requestSourceSync(
    auth: AuthContext,
    patientId: string,
    sourceId: string,
    dto: RequestWearableSourceSyncDTO,
  ): Promise<WearableSourceSyncOutcome> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const source = (await dbAdmin('patient_device_sources')
      .where({
        id: sourceId,
        clinic_id: auth.clinicId,
        patient_id: patientId,
      })
      .first(PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[])) as DeviceSourceRow | undefined;
    if (!source) {
      throw new AppError('Wearable source not found', 404, 'WEARABLE_SOURCE_NOT_FOUND');
    }

    const provider = source.provider as WearableProvider;
    assertProviderConfigured(provider);
    if (!source.is_active) {
      throw new AppError(
        'Wearable source is inactive. Reactivate source before syncing',
        409,
        'WEARABLE_SOURCE_INACTIVE',
      );
    }

    const providerMode = PROVIDER_CAPABILITIES[provider].integrationMode;
    const requestedAt = new Date();
    const metadata = parseJsonObject(source.metadata);
    const nextMetadata = {
      ...metadata,
      sync: {
        requestedAt: requestedAt.toISOString(),
        requestedByStaffId: auth.staffId,
        forceBackfill: dto.forceBackfill ?? false,
        lookbackDays: dto.lookbackDays ?? 14,
        status: providerMode === 'manual' ? 'manual_acknowledged' : 'queued',
      },
    };
    await updateWithOptimisticLock<DeviceSourceRow>({
      table: 'patient_device_sources',
      where: {
        id: sourceId,
        clinic_id: auth.clinicId,
        patient_id: patientId,
      },
      expectedLockVersion: dto.expectedLockVersion,
      patch: {
        metadata: JSON.stringify(nextMetadata),
      },
      returning: PATIENT_DEVICE_SOURCES_COLUMNS as unknown as string[],
    });

    return {
      accepted: true,
      sourceId: source.id,
      provider,
      integrationMode: providerMode,
      syncRequestedAt: requestedAt.toISOString(),
      reason: providerMode === 'manual'
        ? 'Manual sources do not auto-sync; ingest API remains the import path.'
        : null,
    };
  },

  async listRecentPhenotypes(
    auth: AuthContext,
    patientId: string,
    limit = 30,
  ): Promise<DigitalPhenotypeSnapshot[]> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const rows = (await dbAdmin('patient_digital_phenotypes')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .orderBy('computation_day', 'desc')
      .limit(Math.max(1, Math.min(limit, 180)))
      .select(PATIENT_DIGITAL_PHENOTYPES_COLUMNS as unknown as string[])) as unknown as PhenotypeRow[];
    return rows.map(phenotypeToResponse);
  },

  async getWearableSurveillanceSnapshot(
    auth: AuthContext,
    patientId: string,
  ): Promise<WearableSurveillanceSnapshot> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const phenotypes = await this.listRecentPhenotypes(auth, patientId, 1);
    const latestPhenotype = phenotypes[0] ?? null;
    return buildWearableSurveillanceSnapshot(auth, {
      patientId,
      latestPhenotype,
    });
  },

  async recomputeDailyPhenotypes(
    auth: AuthContext,
    now: Date,
  ): Promise<{ patientsComputed: number; rowsUpserted: number }> {
    void auth;
    const lookbackDays = 14;
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    const sourcePatients = await dbAdmin('patient_device_sources')
      .where({ is_active: true })
      .select('clinic_id', 'patient_id')
      .groupBy('clinic_id', 'patient_id');

    let rowsUpserted = 0;
    for (const row of sourcePatients) {
      const clinicId = String(row['clinic_id']);
      const patientId = String(row['patient_id']);
      try {
        await withTenantContext(clinicId, async () => {
          const moduleRow = await db('clinic_modules')
            .where({ clinic_id: clinicId, module_key: MODULE_KEYS.PATHWAYS })
            .first('is_enabled');
          if (moduleRow && moduleRow['is_enabled'] === false) return;

          const trackingRows = await db('patient_tracking')
            .where({ clinic_id: clinicId, patient_id: patientId })
            .whereIn('tracking_type', ['sleep_hours', 'steps', 'resting_hr', 'hrv', 'mood', 'anxiety'])
            .where('recorded_at', '>=', since)
            .orderBy('recorded_at', 'desc')
            .select('tracking_type', 'value', 'recorded_at');

          const acc = createAccumulator();
          for (const tracking of trackingRows) {
            const value = asNullableNumber(tracking['value']);
            if (value == null) continue;
            const day = tracking['recorded_at'] instanceof Date
              ? tracking['recorded_at'].toISOString().split('T')[0]
              : new Date(String(tracking['recorded_at'])).toISOString().split('T')[0];
            addMetric(acc, String(tracking['tracking_type']), value, day);
          }

          const computed = computeRisk(acc);
          await db('patient_digital_phenotypes')
            .insert({
              clinic_id: clinicId,
              patient_id: patientId,
              computation_day: today,
              lookback_days: lookbackDays,
              sleep_hours_avg_7d: computed.sleepHoursAvg7d,
              steps_avg_7d: computed.stepsAvg7d,
              resting_hr_avg_7d: computed.restingHrAvg7d,
              hrv_avg_7d: computed.hrvAvg7d,
              mood_avg_7d: computed.moodAvg7d,
              anxiety_avg_7d: computed.anxietyAvg7d,
              adherence_score: computed.adherenceScore,
              risk_index: computed.riskIndex,
              risk_band: computed.riskBand,
              contributing_signals: JSON.stringify(computed.contributingSignals),
              created_at: now,
              updated_at: now,
            })
            .onConflict(['clinic_id', 'patient_id', 'computation_day'])
            .merge({
              lookback_days: lookbackDays,
              sleep_hours_avg_7d: computed.sleepHoursAvg7d,
              steps_avg_7d: computed.stepsAvg7d,
              resting_hr_avg_7d: computed.restingHrAvg7d,
              hrv_avg_7d: computed.hrvAvg7d,
              mood_avg_7d: computed.moodAvg7d,
              anxiety_avg_7d: computed.anxietyAvg7d,
              adherence_score: computed.adherenceScore,
              risk_index: computed.riskIndex,
              risk_band: computed.riskBand,
              contributing_signals: JSON.stringify(computed.contributingSignals),
              updated_at: now,
              lock_version: db.raw('patient_digital_phenotypes.lock_version + 1'),
            });
          rowsUpserted += 1;
        });
      } catch (err) {
        logger.warn(
          { err, clinicId, patientId },
          'digital phenotyping recompute failed for patient; continuing',
        );
      }
    }

    return {
      patientsComputed: sourcePatients.length,
      rowsUpserted,
    };
  },
};
