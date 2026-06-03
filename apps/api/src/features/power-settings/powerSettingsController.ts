import type { Request, Response, NextFunction } from 'express'
import { SubscriberBrandingUpdateSchema } from '@signacare/shared'
import { powerSettingsService } from './powerSettingsService'

// GET /api/v1/power-settings/branding/me — get branding for the current user's clinic
export async function getMyBranding(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId as string
    const branding = await powerSettingsService.getBranding(clinicId)
    res.json({ branding })
  } catch (err) {
    next(err)
  }
}

// GET /api/v1/power-settings/branding — list all subscriber branding (superadmin)
export async function getAllBranding(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const branding = await powerSettingsService.getAllBranding()
    res.json({ branding })
  } catch (err) {
    next(err)
  }
}

// PUT /api/v1/power-settings/branding/:clinicId — upsert branding for a clinic (superadmin)
export async function upsertBranding(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.params.clinicId as string
    const dto = SubscriberBrandingUpdateSchema.parse(req.body)
    const branding = await powerSettingsService.upsertBranding(clinicId, dto)
    res.json({ branding })
  } catch (err) {
    next(err)
  }
}
