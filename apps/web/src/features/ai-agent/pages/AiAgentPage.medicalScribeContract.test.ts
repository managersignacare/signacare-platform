import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AI Assistant medical scribe navigation contract', () => {
  const aiAgentSource = readFileSync(resolve(__dirname, './AiAgentPage.tsx'), 'utf8');
  const breadcrumbsSource = readFileSync(
    resolve(__dirname, '../../../shared/components/ui/Breadcrumbs.tsx'),
    'utf8',
  );
  const shortcutsSource = readFileSync(
    resolve(__dirname, '../../../shared/components/ui/KeyboardShortcuts.tsx'),
    'utf8',
  );
  const commandPaletteSource = readFileSync(
    resolve(__dirname, '../../../shared/components/ui/CommandPalette.tsx'),
    'utf8',
  );

  it('labels the AI Assistant launcher tab and CTA as Medical Scribe', () => {
    expect(aiAgentSource).toContain('label="Medical Scribe"');
    expect(aiAgentSource).toContain('Open Medical Scribe');
    expect(aiAgentSource).toContain('Ambient recording with optional agentic follow-through drafts');
    expect(aiAgentSource).toContain('data-testid="aiagent-open-medical-scribe"');
  });

  it('keeps route affordances aligned around Medical Scribe in shared navigation surfaces', () => {
    expect(breadcrumbsSource).toContain("'agentic-scribe': 'Medical Scribe'");
    expect(shortcutsSource).toContain("label: 'Go to Medical Scribe'");
    expect(commandPaletteSource).toContain("label: 'Medical Scribe'");
    expect(commandPaletteSource).toContain("id: 'nav-medical-scribe'");
  });
});
