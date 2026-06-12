import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateClinicalAction = vi.fn();
const classifyWithHF = vi.fn();
const assertAiDecisionTokenMatchesAuth = vi.fn();
const enforceAiScopeForToolCall = vi.fn();
const assertToolCallAllowedByPolicy = vi.fn();
const writeToolAuditNonBlocking = vi.fn();
const listAvailableModels = vi.fn();

vi.mock('../../src/features/llm/modelRouter/modelRouter', () => ({
  generateClinicalAction,
}));

vi.mock('../../src/mcp/huggingfaceService', () => ({
  classifyWithHF,
}));

vi.mock('../../src/mcp/localLlmAgent', () => ({
  listAvailableModels,
}));

vi.mock('../../src/mcp/server/aiScopeEnforcement', () => ({
  assertAiDecisionTokenMatchesAuth,
  enforceAiScopeForToolCall,
}));

vi.mock('../../src/features/ai/tools/toolPolicy', () => ({
  assertToolCallAllowedByPolicy,
}));

vi.mock('../../src/mcp/server/mcpAudit', () => ({
  writeToolAuditNonBlocking,
}));

const { handleToolCall } = await import('../../src/mcp/server/mcpServer');

describe('mcpServer routed tool branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceAiScopeForToolCall.mockResolvedValue(null);
  });

  const auth = {
    clinicId: '11111111-1111-1111-1111-111111111111',
    staffId: '22222222-2222-2222-2222-222222222222',
    role: 'admin',
    permissions: [],
    aiDecisionToken: {
      tokenId: '33333333-3333-4333-8333-333333333333',
      clinicId: '11111111-1111-1111-1111-111111111111',
      staffId: '22222222-2222-2222-2222-222222222222',
      role: 'admin',
      permissions: [],
      allowedTools: ['generate_clinical_document', 'classify_text'],
      purposeOfUse: 'clinical' as const,
      scope: { level: 'clinic' as const },
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      signature: 'test-signature',
    },
    aiAllowedTools: ['generate_clinical_document', 'classify_text'],
    aiPurposeOfUse: 'clinical' as const,
    aiScope: { level: 'clinic' as const },
  };

  it('routes generate_clinical_document through generateClinicalAction', async () => {
    generateClinicalAction.mockResolvedValueOnce({
      text: 'Generated routed document.',
    });

    const result = await handleToolCall(
      {
        name: 'generate_clinical_document',
        arguments: {
          action: 'letter',
          data: 'Patient context',
          model: 'qwen2.5:32b',
          templateType: 'NDIS support letter',
        },
      },
      auth,
    );

    expect(generateClinicalAction).toHaveBeenCalledWith({
      clinicId: '11111111-1111-1111-1111-111111111111',
      action: 'letter',
      data: 'Patient context',
      templateType: 'NDIS support letter',
      requestedModel: 'qwen2.5:32b',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Generated routed document.' }],
    });
  });

  it('formats classify_text results from the HF classifier pipeline', async () => {
    classifyWithHF.mockResolvedValueOnce({
      sentiment: 'negative',
      riskLevel: 'moderate',
      emotions: [
        { label: 'sadness', score: 0.9 },
        { label: 'fear', score: 0.5 },
      ],
      suicideRisk: { label: 'low', score: 0.2 },
    });

    const result = await handleToolCall(
      {
        name: 'classify_text',
        arguments: {
          text: 'The patient reports hopelessness but denies intent.',
        },
      },
      auth,
    );

    expect(classifyWithHF).toHaveBeenCalledWith(
      'The patient reports hopelessness but denies intent.',
      'mentalbert',
    );
    expect(result.content[0]?.text).toContain('Sentiment: negative');
    expect(result.content[0]?.text).toContain('Risk level: moderate');
    expect(result.content[0]?.text).toContain('Suicide risk: low');
    expect(result.content[0]?.text).toContain('Top emotions: sadness, fear');
  });
});
