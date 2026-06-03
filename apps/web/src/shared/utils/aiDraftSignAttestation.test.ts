import { describe, expect, it } from 'vitest';
import {
  canSignAiDraftNote,
  requiresAiDraftSignAttestation,
} from './aiDraftSignAttestation';

describe('aiDraftSignAttestation', () => {
  it('requires attestation for AI drafts', () => {
    expect(requiresAiDraftSignAttestation(true)).toBe(true);
  });

  it('does not require attestation for non-AI notes', () => {
    expect(requiresAiDraftSignAttestation(false)).toBe(false);
  });

  it('blocks signing when attestation is required but unchecked', () => {
    expect(canSignAiDraftNote(true, false)).toBe(false);
  });

  it('allows signing when attestation is required and checked', () => {
    expect(canSignAiDraftNote(true, true)).toBe(true);
  });
});
