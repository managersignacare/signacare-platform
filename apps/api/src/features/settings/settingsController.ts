// apps/api/src/features/settings/settingsController.ts
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { settingsService, DEFAULT_THRESHOLDS, THRESHOLD_FLOORS } from './settingsService'
import { AppError } from '../../shared/errors'

// BUG-403 cycle-2 (2026-05-03 L4 BLOCK absorb) — Layer 0 (Zod) defence.
// Note: deeper validation (floor / ceiling / relational ordering) lives
// in the service-layer (Layer A) so cron/internal callers cannot bypass.
const SetThresholdSchema = z.object({
  key: z.string().min(1),
  value: z.number().finite(),
})

const BulkSetThresholdsSchema = z.object({
  thresholds: z.record(z.string(), z.number().finite()),
})

export async function getThresholds(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId as string
    const thresholds = await settingsService.getThresholds(clinicId)
    res.json({ thresholds })
  } catch (err) {
    next(err)
  }
}

export async function setThreshold(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId as string
    const dto = SetThresholdSchema.parse(req.body)
    // BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT (2026-05-03) — pass actor
    // staffId so the service emits a THRESHOLD_UPDATE audit_log row.
    await settingsService.setThreshold(
      clinicId, dto.key, dto.value, undefined, false, req.user?.id,
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function bulkSetThresholds(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId as string
    const { thresholds } = BulkSetThresholdsSchema.parse(req.body)

    // BUG-403 cycle-2 (2026-05-03 L4 BLOCK absorb) — pre-validate the
    // FINAL state of paired thresholds (clozapine_anc_red +
    // clozapine_anc_amber) BEFORE issuing individual upserts. Without
    // this pre-check, concurrent service-level relational guards would
    // race against each other (each reads the OTHER's stale value), so
    // a legitimate "both stricter" or "both looser-within-floor" bulk
    // call could fail spuriously OR pass spuriously depending on the
    // direction of the change. Validating the final state in the
    // controller serialises the decision before any DB writes happen.
    const redKey = 'clozapine_anc_red_threshold'
    const amberKey = 'clozapine_anc_amber_threshold'
    if (redKey in thresholds || amberKey in thresholds) {
      const finalRed = redKey in thresholds ? thresholds[redKey] : DEFAULT_THRESHOLDS[redKey]
      const finalAmber = amberKey in thresholds ? thresholds[amberKey] : DEFAULT_THRESHOLDS[amberKey]
      if (finalRed >= finalAmber) {
        throw new AppError(
          `Threshold ordering violated in bulk request: clozapine_anc_red_threshold (${finalRed}) must be strictly less than clozapine_anc_amber_threshold (${finalAmber}).`,
          400,
          'THRESHOLD_ORDERING_VIOLATED',
        )
      }
      // Floor + ceiling pre-check (per-key) so the bulk path fails with
      // the canonical service-level error code shape.
      for (const key of [redKey, amberKey] as const) {
        if (key in thresholds) {
          const v = thresholds[key]
          const f = THRESHOLD_FLOORS[key]
          if (f && (v < f.min || v > f.max)) {
            throw new AppError(
              `Bulk threshold ${key}=${v} outside clinical-safety bounds [${f.min}, ${f.max}].`,
              400,
              v < f.min ? 'THRESHOLD_BELOW_FLOOR' : 'THRESHOLD_ABOVE_CEILING',
            )
          }
        }
      }
    }

    // Pair-validation done above; pass skipRelationalCheck=true to the
    // per-key setThreshold so paired writes don't race each other on
    // the redundant DB-side relational check (controller has already
    // validated the FINAL state). Floor / ceiling / key-whitelist
    // guards still run inside setThreshold.
    // BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT (2026-05-03) — pass actor
    // staffId so each per-key setThreshold emits a THRESHOLD_UPDATE
    // audit_log row.
    const pairedKeys = new Set([redKey, amberKey])
    const actorStaffId = req.user?.id
    await Promise.all(
      Object.entries(thresholds).map(([key, value]) =>
        settingsService.setThreshold(
          clinicId,
          key,
          value,
          undefined,
          pairedKeys.has(key),
          actorStaffId,
        ),
      ),
    )
    res.json({ ok: true, updated: Object.keys(thresholds).length })
  } catch (err) {
    next(err)
  }
}

