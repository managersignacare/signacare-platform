import { create } from 'zustand'

const DEFAULT_SIDEBAR_TITLE = 'Signacare'
const DEFAULT_SIDEBAR_SUBTITLE = 'Mental Health EMR'

export interface BrandingState {
  sidebarTitle: string
  sidebarSubtitle: string
  logoUrl: string
  loaded: boolean
  setBranding: (branding: {
    sidebarTitle?: string
    sidebarSubtitle?: string
    logoUrl?: string
  }) => void
  resetBranding: () => void
}

export const useBrandingStore = create<BrandingState>()((set) => ({
  sidebarTitle: DEFAULT_SIDEBAR_TITLE,
  sidebarSubtitle: DEFAULT_SIDEBAR_SUBTITLE,
  logoUrl: '',
  loaded: false,
  setBranding: (branding) =>
    set({
      sidebarTitle: branding.sidebarTitle || DEFAULT_SIDEBAR_TITLE,
      sidebarSubtitle: branding.sidebarSubtitle || DEFAULT_SIDEBAR_SUBTITLE,
      logoUrl: branding.logoUrl || '',
      loaded: true,
    }),
  resetBranding: () =>
    set({
      sidebarTitle: DEFAULT_SIDEBAR_TITLE,
      sidebarSubtitle: DEFAULT_SIDEBAR_SUBTITLE,
      logoUrl: '',
      loaded: false,
    }),
}))
