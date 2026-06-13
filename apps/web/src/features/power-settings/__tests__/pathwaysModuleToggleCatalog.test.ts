import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ALL_MODULES } from '../pages/powerSettingsPageSupport';

const onboardingWizardSource = readFileSync(
  resolve(__dirname, '..', 'components', 'OnboardingWizard.tsx'),
  'utf8',
);
const sidebarSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'shared', 'components', 'ui', 'Sidebar.tsx'),
  'utf8',
);
const powerSettingsPageSource = readFileSync(
  resolve(__dirname, '..', 'pages', 'PowerSettingsPage.tsx'),
  'utf8',
);

describe('BUG-PATHWAYS-MODULE-TOGGLE-CATALOG', () => {
  it('includes pathways in Power Settings module catalog', () => {
    const found = ALL_MODULES.find((m) => m.key === 'pathways');
    expect(found).toBeTruthy();
    expect(found?.label).toContain('Pathways');
  });

  it('includes pathways in onboarding defaults and selectable modules', () => {
    expect(onboardingWizardSource).toContain("'pathways'");
    expect(onboardingWizardSource).toContain("{ key: 'pathways', label: 'Treatment Pathways' }");
  });

  it('includes agentic-ai-scribe in Power Settings and onboarding catalogs', () => {
    const found = ALL_MODULES.find((m) => m.key === 'agentic-ai-scribe');
    expect(found).toBeTruthy();
    expect(found?.label).toContain('Medical Scribe Drafting');
    expect(onboardingWizardSource).toContain("{ key: 'agentic-ai-scribe', label: 'Medical Scribe Drafting' }");
  });

  it('uses canonical module keys for ambient scribe and AI agent in catalogs', () => {
    expect(ALL_MODULES.find((m) => m.key === 'medical-scribe')).toBeTruthy();
    expect(ALL_MODULES.find((m) => m.key === 'ai-agent')).toBeTruthy();
    expect(onboardingWizardSource).toContain("{ key: 'medical-scribe', label: 'Medical Scribe (Ambient)' }");
    expect(onboardingWizardSource).toContain("{ key: 'ai-agent', label: 'AI Agent' }");
    expect(onboardingWizardSource).not.toContain("key: 'ai_scribe'");
    expect(onboardingWizardSource).not.toContain("key: 'ai_agent'");
  });

  it('maps agentic-scribe nav route to clinic module key', () => {
    expect(sidebarSource).toContain("'agentic-scribe': 'agentic-ai-scribe'");
  });

  it('treats agentic-ai-scribe as default-disabled until explicitly enabled', () => {
    expect(powerSettingsPageSource).toContain("'agentic-ai-scribe'");
    expect(powerSettingsPageSource).toContain('DEFAULT_DISABLED_MODULE_KEYS');
  });
});
