import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AI episode-save wiring', () => {
  const saveDialogSource = readFileSync(
    resolve(__dirname, '../../../shared/components/ui/AiGeneratedNoteSaveDialog.tsx'),
    'utf8',
  );
  const aiAgentSource = readFileSync(resolve(__dirname, './AiAgentPage.tsx'), 'utf8');
  const agenticSource = readFileSync(
    resolve(__dirname, '../../agentic-scribe/pages/AgenticScribePage.tsx'),
    'utf8',
  );

  it('saves AI-generated notes through the patient note route with an explicit episode id', () => {
    expect(saveDialogSource).toContain("apiClient.post<NoteCreateResponse>(`patients/${normalizedPatientId}/notes`, {");
    expect(saveDialogSource).toContain('episodeId,');
    expect(saveDialogSource).toContain("status: 'draft'");
    expect(saveDialogSource).toContain('isAiDraft: true');
  });

  it('stamps AI save requests with contact metadata for downstream contact creation context', () => {
    expect(saveDialogSource).toContain('contactMeta: {');
    expect(saveDialogSource).toContain('aiGeneratedSource: sourceKey');
    expect(saveDialogSource).toContain('aiGeneratedLabel: sourceLabel');
  });

  it('wires AI Assistant output and patient-scoped AI Agent chat through the shared save dialog', () => {
    expect(aiAgentSource).toContain("import { AiGeneratedNoteSaveDialog }");
    expect(aiAgentSource).toContain('open={saveDialogOpen}');
    expect(aiAgentSource).toContain("sourceKey={`ai_assistant:${selectedAction}`}");
    expect(aiAgentSource).toContain('Save to Episode');
    expect(aiAgentSource).toContain('sourceKey="ai_agent_chat"');
  });

  it('wires Agentic AI draft summaries through the shared save dialog', () => {
    expect(agenticSource).toContain('Save Draft Summary to Episode');
    expect(agenticSource).toContain('buildAgenticDraftSummaryNoteContent');
    expect(agenticSource).toContain('sourceKey="agentic_ai_draft_summary"');
  });
});
