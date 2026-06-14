import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PowerSettingsPage clinical-note template ownership', () => {
  const pageSource = readFileSync(resolve(__dirname, './PowerSettingsPage.tsx'), 'utf8');
  const panelSource = readFileSync(
    resolve(__dirname, '..', 'components', 'ClinicalNoteTemplatesPanel.tsx'),
    'utf8',
  );

  it('surfaces a dedicated Power Settings tab for editable clinical-note templates', () => {
    expect(pageSource).toContain('<Tab label="Clinical Note Templates" value="clinical-note-templates" />');
    expect(pageSource).toContain("{tab === 'clinical-note-templates' && <ClinicalNoteTemplatesPanel />}");
  });

  it('pins the panel to the canonical Clinical Notes template category', () => {
    expect(panelSource).toContain("const CLINICAL_NOTES_CATEGORY = 'Clinical Notes';");
    expect(panelSource).toContain('initialCategory={CLINICAL_NOTES_CATEGORY}');
    expect(panelSource).toContain('Manage the default Australian mental-health note templates');
  });
});
