import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AddNoteDialog documentation contract', () => {
  const source = readFileSync(resolve(__dirname, './AddNoteDialog.tsx'), 'utf8');

  it('keeps the main note dialog free of embedded AI and scribe actions', () => {
    expect(source).toContain('AI Assistant and Medical Scribe are available from the main sidebar.');
    expect(source).not.toContain('Start Medical Scribe');
    expect(source).not.toContain('Open ambient recorder');
  });

  it('supports post-save letter generation for provider, patient, and support person flows', () => {
    expect(source).toContain('Save & Generate Letter');
    expect(source).toContain("handleSaveAndGenerateLetter('provider')");
    expect(source).toContain("handleSaveAndGenerateLetter('patient')");
    expect(source).toContain("handleSaveAndGenerateLetter('support_person')");
    expect(source).toContain('<LetterGeneratorDialog');
  });

  it('uses the canonical templates surface rather than the legacy staff-settings feed', () => {
    expect(source).toContain('useTemplates({');
    expect(source).toContain("status: 'published'");
    expect(source).not.toContain("staff-settings/templates");
  });
});
