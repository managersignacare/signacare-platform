import { createHash, randomUUID } from 'node:crypto';
import type {
  ClinicalContextFact,
  ContextExclusion,
  ContextFactDomain,
  ContextTrustLevel,
} from '@signacare/shared';
import { AppError } from '../../../shared/errors';
import { patientRepository, type PatientRow } from '../../patients/patientRepository';

const SOURCE_CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000;

export type MinimalAnchorPatient = Pick<
  PatientRow,
  | 'id'
  | 'given_name'
  | 'family_name'
  | 'preferred_name'
  | 'date_of_birth'
  | 'emr_number'
  | 'updated_at'
>;

export interface SourceReaderContext {
  readonly clinicId: string;
  readonly patientId: string;
  readonly episodeId?: string;
  readonly builtAt: string;
  readonly lookbackDays: number;
  readonly patient: MinimalAnchorPatient;
}

export interface SourceReaderResult {
  readonly facts: ClinicalContextFact[];
  readonly excluded: ContextExclusion[];
}

export function buildLookbackStart(builtAt: string, lookbackDays: number): Date | null {
  if (lookbackDays <= 0) return null;
  const end = new Date(builtAt);
  return new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

export function toIsoString(value: string | Date | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  return value.toISOString();
}

export function estimateTokenCost(payload: unknown): number {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return Math.max(1, Math.ceil(serialized.length / 4));
}

export function createLineageKey(sourceTable: string, sourceId: string, sourceDate: string): string {
  return createHash('sha256')
    .update(`${sourceTable}:${sourceId}:${sourceDate}`)
    .digest('hex');
}

export function createFact(args: {
  domain: ContextFactDomain;
  tier: ClinicalContextFact['tier'];
  trustLevel: ContextTrustLevel;
  sourceTable: string;
  sourceId: string;
  sourceDate: string;
  builtAt: string;
  payload: unknown;
  citationRequired?: boolean;
}): ClinicalContextFact {
  const sourceCapturedAt = args.sourceDate;
  const builtAtMs = new Date(args.builtAt).getTime();
  const sourceCapturedAtMs = new Date(sourceCapturedAt).getTime();

  if (!Number.isFinite(builtAtMs)) {
    throw new AppError('Clinical context builtAt timestamp is invalid', 500, 'CONTEXT_INVALID_BUILT_AT', {
      builtAt: args.builtAt,
      domain: args.domain,
    });
  }

  if (!Number.isFinite(sourceCapturedAtMs)) {
    throw new AppError('Clinical context source timestamp is invalid', 500, 'CONTEXT_INVALID_SOURCE_TIMESTAMP', {
      sourceTable: args.sourceTable,
      sourceId: args.sourceId,
      sourceDate: sourceCapturedAt,
      domain: args.domain,
    });
  }

  if (sourceCapturedAtMs - builtAtMs > SOURCE_CLOCK_SKEW_ALLOWANCE_MS) {
    throw new AppError('Clinical context source timestamp is in the future', 409, 'CONTEXT_FUTURE_SOURCE', {
      sourceTable: args.sourceTable,
      sourceId: args.sourceId,
      sourceDate: sourceCapturedAt,
      builtAt: args.builtAt,
      domain: args.domain,
    });
  }

  const ageSeconds = Math.max(0, Math.floor((builtAtMs - sourceCapturedAtMs) / 1000));

  return {
    factId: randomUUID(),
    tier: args.tier,
    domain: args.domain,
    trustLevel: args.trustLevel,
    lineage: {
      sourceTable: args.sourceTable,
      sourceId: args.sourceId,
      sourceDate: sourceCapturedAt,
      lineageKey: createLineageKey(args.sourceTable, args.sourceId, sourceCapturedAt),
      citationRequired: args.citationRequired ?? false,
    },
    freshness: {
      sourceCapturedAt,
      contextBuiltAt: args.builtAt,
      ageSeconds,
    },
    payload: args.payload,
    tokenCost: estimateTokenCost(args.payload),
  };
}

export function createRequiredSentinelFact(
  domain: ContextFactDomain,
  patient: MinimalAnchorPatient,
  builtAt: string,
  payload: unknown,
): ClinicalContextFact {
  return createFact({
    domain,
    tier: 'A',
    trustLevel: 'derived',
    sourceTable: 'patients',
    sourceId: patient.id,
    sourceDate: toIsoString(patient.updated_at, builtAt),
    builtAt,
    payload,
  });
}

export function noData(domain: ContextFactDomain, note?: string): ContextExclusion {
  return note ? { domain, reason: 'no-data', note } : { domain, reason: 'no-data' };
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export async function loadAnchorPatient(
  clinicId: string,
  patientId: string,
): Promise<MinimalAnchorPatient> {
  const patient = await patientRepository.findById(clinicId, patientId);
  if (!patient) {
    throw new AppError('Patient not found', 404, 'PATIENT_NOT_FOUND', { patientId });
  }

  return {
    id: patient.id,
    given_name: patient.given_name,
    family_name: patient.family_name,
    preferred_name: patient.preferred_name,
    date_of_birth: patient.date_of_birth,
    emr_number: patient.emr_number,
    updated_at: patient.updated_at,
  };
}
