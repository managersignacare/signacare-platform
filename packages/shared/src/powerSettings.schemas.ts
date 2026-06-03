import { z } from 'zod'

const LOCAL_FILESYSTEM_PATH_RE = /^\/(Users|home|Volumes|private|var|etc)\//i

export const SubscriberBrandingLogoUrlSchema = z
  .union([
    z.string().url(),
    // Local blob backend returns app-relative paths (`/uploads/...`).
    z
      .string()
      .startsWith('/')
      .refine(
        (value) => {
          if (LOCAL_FILESYSTEM_PATH_RE.test(value)) return false
          return value.startsWith('/uploads/') || value === '/signacare-logo.svg'
        },
        {
          message:
            'Use Upload Logo File or a public URL. Local filesystem paths are not supported.',
        },
      ),
    z.literal(''),
  ])
  .optional()

export const SubscriberBrandingUpdateSchema = z.object({
  sidebarTitle: z.string().max(200).optional(),
  sidebarSubtitle: z.string().max(200).optional(),
  logoUrl: SubscriberBrandingLogoUrlSchema,
})
export type SubscriberBrandingUpdateDTO = z.infer<typeof SubscriberBrandingUpdateSchema>

export const SubscriberBrandingResponseSchema = SubscriberBrandingUpdateSchema.extend({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type SubscriberBrandingResponse = z.infer<typeof SubscriberBrandingResponseSchema>
