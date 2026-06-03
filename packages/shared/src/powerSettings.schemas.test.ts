import { describe, expect, it } from 'vitest'
import { SubscriberBrandingUpdateSchema } from './powerSettings.schemas'

describe('SubscriberBrandingUpdateSchema.logoUrl', () => {
  it('accepts absolute https URLs', () => {
    const parsed = SubscriberBrandingUpdateSchema.safeParse({
      logoUrl: 'https://cdn.example.com/brand/logo.png',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts local absolute upload paths', () => {
    const parsed = SubscriberBrandingUpdateSchema.safeParse({
      logoUrl: '/uploads/logos/clinic-12345.png',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts the bundled default logo path', () => {
    const parsed = SubscriberBrandingUpdateSchema.safeParse({
      logoUrl: '/signacare-logo.svg',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects non-url, non-path values', () => {
    const parsed = SubscriberBrandingUpdateSchema.safeParse({
      logoUrl: 'not-a-valid-url',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects local filesystem paths pasted from desktop', () => {
    const parsed = SubscriberBrandingUpdateSchema.safeParse({
      logoUrl:
        '/Users/drprakashkamath/Library/CloudStorage/OneDrive-SouthYarraFamilyDentalCare/Desktop/logo.png',
    })
    expect(parsed.success).toBe(false)
  })
})
