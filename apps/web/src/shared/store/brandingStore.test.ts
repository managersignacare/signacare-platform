import { beforeEach, describe, expect, it } from 'vitest';
import { useBrandingStore } from './brandingStore';

describe('brandingStore', () => {
  beforeEach(() => {
    useBrandingStore.getState().resetBranding();
  });

  it('falls back to defaults when setBranding receives an empty payload', () => {
    useBrandingStore.getState().setBranding({});
    const state = useBrandingStore.getState();
    expect(state.sidebarTitle).toBe('Signacare');
    expect(state.sidebarSubtitle).toBe('Mental Health EMR');
    expect(state.logoUrl).toBe('');
    expect(state.loaded).toBe(true);
  });

  it('resetBranding clears loaded state and restores defaults', () => {
    useBrandingStore.getState().setBranding({
      sidebarTitle: 'Custom',
      sidebarSubtitle: 'Custom Subtitle',
      logoUrl: '/uploads/logos/custom.png',
    });
    useBrandingStore.getState().resetBranding();
    const state = useBrandingStore.getState();
    expect(state.sidebarTitle).toBe('Signacare');
    expect(state.sidebarSubtitle).toBe('Mental Health EMR');
    expect(state.logoUrl).toBe('');
    expect(state.loaded).toBe(false);
  });
});

