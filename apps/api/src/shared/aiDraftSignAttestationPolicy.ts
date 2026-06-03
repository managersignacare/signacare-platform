import type { AuthContext } from '@signacare/shared';

/**
 * BUG-WF51 / CC-6 safety lock:
 * enforce explicit clinician attestation for every AI-drafted note sign
 * transition with no runtime bypass flag path.
 */
export async function shouldEnforceAiDraftSignAttestation(
  _auth: AuthContext,
): Promise<boolean> {
  return true;
}
