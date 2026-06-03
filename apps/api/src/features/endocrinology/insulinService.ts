// apps/api/src/features/endocrinology/insulinService.ts
import {
  CreateInsulinRegimenDTO,
  InsulinRegimenResponse,
  InsulinBolusDoses,
} from '@signacare/shared';
import type { AuthContext } from '@signacare/shared';
import { insulinRegimenRepository, InsulinRegimenRowWithPrescriber } from './insulinRepository';
import { HttpError } from '../../shared/errors';
import auditLogService from '../../utils/audit';
import { db } from '../../db/db';
import { prescriptionService } from '../prescriptions/prescriptionService';
import logger from '../../utils/logger';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function parseBolus(value: unknown): InsulinBolusDoses | null {
  if (!value) return null;
  if (typeof value === 'object') return value as InsulinBolusDoses;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as InsulinBolusDoses; } catch { return null; }
  }
  return null;
}

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Render the regimen as a single human-readable string for the
 * patient_medications row. Kept short so it fits the standard medication
 * row; the full breakdown is always available on the Insulin Regimen
 * tab inside Medications.
 */
function renderRegimenLabel(dto: CreateInsulinRegimenDTO): string {
  const parts: string[] = [];
  if (dto.basalDrug) {
    const dose = dto.basalDoseUnits != null ? `${dto.basalDoseUnits}U` : '';
    const freq = dto.basalFrequency ? ` ${dto.basalFrequency}` : '';
    parts.push(`Basal: ${dto.basalDrug}${dose ? ` ${dose}` : ''}${freq}`);
  }
  if (dto.bolusDrug || dto.bolusDoses) {
    const b = dto.bolusDoses ?? {};
    const meals: string[] = [];
    if (b.breakfast != null) meals.push(`B${b.breakfast}`);
    if (b.lunch != null)     meals.push(`L${b.lunch}`);
    if (b.dinner != null)    meals.push(`D${b.dinner}`);
    if (b.bedtime != null)   meals.push(`BT${b.bedtime}`);
    parts.push(`Bolus: ${dto.bolusDrug ?? ''}${meals.length ? ` ${meals.join('/')}` : ''}`.trim());
  }
  return parts.length > 0 ? `Insulin regimen — ${parts.join(' · ')}` : 'Insulin regimen';
}

function renderRegimenDose(dto: CreateInsulinRegimenDTO): string {
  if (dto.basalDoseUnits != null) return `${dto.basalDoseUnits}U basal`;
  if (dto.bolusDoses) return 'See bolus breakdown';
  return 'Variable';
}

function mapRow(row: InsulinRegimenRowWithPrescriber): InsulinRegimenResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    basalDrug: row.basal_drug,
    basalDoseUnits: num(row.basal_dose_units),
    basalFrequency: row.basal_frequency,
    bolusDrug: row.bolus_drug,
    bolusDoses: parseBolus(row.bolus_doses),
    correctionFactor: num(row.correction_factor),
    carbRatio: num(row.carb_ratio),
    targetLow: num(row.target_low),
    targetHigh: num(row.target_high),
    validFrom: toIso(row.valid_from)!,
    validTo: toIso(row.valid_to),
    note: row.note,
    prescribedBy: row.prescribed_by,
    prescribedByName:
      row.prescribed_by_given_name && row.prescribed_by_family_name
        ? `${row.prescribed_by_given_name} ${row.prescribed_by_family_name}`
        : null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class InsulinService {
  async listHistory(clinicId: string, patientId: string): Promise<InsulinRegimenResponse[]> {
    const rows = await insulinRegimenRepository.listHistory(clinicId, patientId);
    return rows.map(mapRow);
  }

  async findCurrent(clinicId: string, patientId: string): Promise<InsulinRegimenResponse | null> {
    const row = await insulinRegimenRepository.findCurrent(clinicId, patientId);
    return row ? mapRow(row) : null;
  }

  async createNewVersion(
    auth: AuthContext,
    dto: CreateInsulinRegimenDTO,
  ): Promise<InsulinRegimenResponse> {
    // BUG-292 — AuthContext migration to support prescriber-barrier
    // gate in prescriptionService.create/cancel called below.
    const clinicId = auth.clinicId;
    const actorId = auth.staffId;
    if (dto.targetLow != null && dto.targetHigh != null && dto.targetLow >= dto.targetHigh) {
      throw new HttpError(422, 'INVALID_TARGET_RANGE', 'targetLow must be less than targetHigh');
    }
    const created = await insulinRegimenRepository.createNewVersion({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      basal_drug: dto.basalDrug ?? null,
      basal_dose_units: dto.basalDoseUnits != null ? String(dto.basalDoseUnits) : null,
      basal_frequency: dto.basalFrequency ?? null,
      bolus_drug: dto.bolusDrug ?? null,
      bolus_doses: dto.bolusDoses ?? null,
      correction_factor: dto.correctionFactor != null ? String(dto.correctionFactor) : null,
      carb_ratio: dto.carbRatio != null ? String(dto.carbRatio) : null,
      target_low: dto.targetLow != null ? String(dto.targetLow) : null,
      target_high: dto.targetHigh != null ? String(dto.targetHigh) : null,
      note: dto.note ?? null,
      prescribed_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'insulin_regimens',
      recordId: created.id,
      newData: {
        basalDrug: created.basal_drug,
        bolusDrug: created.bolus_drug,
      },
    });

    // Mirror the regimen into patient_medications so it appears in the
    // unified Current Medications list. Cease any prior insulin_regimen
    // medication for this patient first so there is exactly one active
    // regimen row at a time — matches the versioning semantics of the
    // insulin_regimens table itself.
    try {
      await db('patient_medications')
        .where({
          clinic_id: clinicId,
          patient_id: dto.patientId,
          category: 'insulin_regimen',
          status: 'active',
        })
        .whereNull('deleted_at')
        .update({ status: 'ceased', updated_at: new Date() });

      // @code-columns-exempt: pre-R2 drift on patient_medications: medication_name, is_clozapine, is_s8, prescribed_at, prescriber. Baseline 20260701000000 is the fix.
      await db('patient_medications').insert({
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        medication_name: renderRegimenLabel(dto),
        generic_name: 'Insulin regimen',
        dose: renderRegimenDose(dto),
        frequency: 'Multiple',
        route: 'subcutaneous',
        status: 'active',
        is_lai: false,
        is_clozapine: false,
        is_s8: false,
        prescribed_at: new Date().toISOString().slice(0, 10),
        prescriber: null,
        indication: 'Diabetes management',
        prescribed_by_specialty_code: 'endocrinology',
        category: 'insulin_regimen',
        created_at: new Date(),
        updated_at: new Date(),
      });
    } catch (err) {
      // The regimen itself is the source of truth; mirroring is best-
      // effort. Log and continue rather than rolling back the insulin
      // write — a user can re-trigger the mirror by saving again.
      logger.warn({ err }, '[insulinService] failed to mirror regimen into patient_medications');
    }

    // Mirror the regimen into the prescriptions table so it inherits the
    // full eRx ETP2 lifecycle:
    //   - prescriptionService.create writes the row and audit-logs (ERX001
    //     payload data)
    //   - prescriptionService.submitErx → escriptService.submitPrescription
    //     issues the eScript token (ERX001)
    //   - prescriptionService.cancel + escriptService.cancelToken (ERX023)
    //     cancels prior regimen prescriptions when superseded
    //   - escriptService.amendPrescription (ERX027) covers in-place dose
    //     adjustments
    //   - escriptService.ceasePrescription (ERX061) covers regimen cease
    //   - escriptService.reactivatePrescription (ERX019) and reissueToken
    //     (ERX065) are available via the same client
    // The regimen always wins as the source of truth — if the prescription
    // mirror fails (eRx adapter down, etc.) we log and keep the regimen.
    try {
      // Cancel prior insulin regimen prescriptions in the same patient so
      // there is exactly one active "Insulin regimen" prescription at a time.
      const priorRows = await db('prescriptions')
        .where({ clinic_id: clinicId, patient_id: dto.patientId, status: 'active' })
        .whereILike('generic_name', 'Insulin regimen%');
      for (const p of priorRows) {
        try {
          // BUG-371b — opt-locked. Pass row's current lock_version
          // (read from the SELECT above). Concurrent edit during
          // insulin-regimen replacement is rare but possible (admin
          // edit + clinician swap simultaneously); on conflict the
          // helper throws AppError(409) which the catch logs.
          // BUG-553 — automatic cancellation reason for the supersession
          // flow (one canonical reason for every insulin-regimen swap so
          // forensic dashboards can group replacements vs operator-driven
          // cancellations).
          await prescriptionService.cancel(
            auth,
            p.id,
            p.lock_version,
            'Superseded by new insulin regimen',
          );
        } catch (err) {
          logger.warn({ err, prescriptionId: p.id }, '[insulinService] failed to cancel prior insulin prescription');
        }
      }

      // Create the new prescription. Defaults are conservative (1-month
      // supply, 5 repeats) — clinicians can customise via the regular
      // prescriptions UI in a follow-up.
      await prescriptionService.create(auth, {
        patientId: dto.patientId,
        episodeId: dto.episodeId ?? undefined,
        genericName: renderRegimenLabel(dto),
        brandName: dto.basalDrug ?? dto.bolusDrug ?? undefined,
        dose: renderRegimenDose(dto),
        route: 'subcutaneous',
        frequency: 'Multiple per day',
        directions: dto.note ?? undefined,
        quantity: 1, // one regimen pack
        repeats: 5,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
        prescribedDate: new Date().toISOString().slice(0, 10),
        isElectronic: true,
        notes: `Insulin regimen ${created.id}`,
      });
    } catch (err) {
      logger.warn({ err }, '[insulinService] failed to mirror regimen into prescriptions');
    }

    return mapRow(created as InsulinRegimenRowWithPrescriber);
  }
}

export const insulinService = new InsulinService();
