# BUG-441 — phiEncryption fail-fast — Plan

## Root cause (verified via code read)

Three silent `catch` blocks swallow PHI crypto failures:

1. **`apps/api/src/shared/phiEncryption.ts:60-62`** — `encryptPhi`:
   ```typescript
   try { ... } catch { return plaintext; } // P0: writes plaintext into ENCRYPTED columns
   ```
2. **`apps/api/src/shared/phiEncryption.ts:85-87`** — `decryptPhi` same pattern (returns ciphertext-as-is)
3. **`apps/api/src/utils/phiEncryption.ts:59-62`** — duplicate `decryptPhi` same pattern

**Why it matters:** a wrong-length key, HSM blip, or corrupted auth-tag causes silent plaintext storage / leak with zero operator log. This is the "compliance-catastrophic" class per Wave 6c findings.

## Gold-standard fix

1. Introduce `PhiCryptoError` class in `shared/phiEncryption.ts`:
   ```typescript
   export class PhiCryptoError extends Error {
     constructor(
       public readonly op: 'encrypt' | 'decrypt',
       public readonly reason: 'bad_key' | 'bad_tag' | 'bad_format' | 'internal',
       cause: unknown,
     ) { super(`PHI ${op} failed: ${reason}`); this.cause = cause; }
   }
   ```
2. Replace every silent catch with:
   ```typescript
   catch (err) {
     logger.error({ err, op: '<encrypt|decrypt>', reason: '<class>' }, 'PHI crypto failure');
     throw new PhiCryptoError('<op>', '<reason>', err);
   }
   ```
3. `decryptPhi` preserves the legitimate "looks like plaintext" legacy-passthrough (no `iv:tag:ciphertext` format marker) — that's NOT a decryption failure, it's legacy data detection. Only throw when the input LOOKED encrypted but decryption THEN failed (auth-tag mismatch, key mismatch, truncated buffer).
4. Apply identical pattern to `utils/phiEncryption.ts`.

## Files touched

- `apps/api/src/shared/phiEncryption.ts` — add `PhiCryptoError` + logger import + replace 2 silent catches
- `apps/api/src/utils/phiEncryption.ts` — add logger import + replace 1 silent catch (+ reuse `PhiCryptoError` from shared)
- `apps/api/tests/phi-encryption.test.ts` — extend with 4 new cases:
  1. encryptPhi with invalid key length throws PhiCryptoError('encrypt', 'bad_key')
  2. decryptPhi with tampered ciphertext (iv:tag:bad-data) throws PhiCryptoError('decrypt', 'bad_tag')
  3. decryptPhi with plaintext (no colons) passes through unchanged (legacy-compat)
  4. decryptPhi with colon-count 3 but garbage base64 throws PhiCryptoError
- `docs/quality/fix-registry.md` — add `R-FIX-BUG-441-PHI-FAIL-FAST` row

## Risk / impact

- Callers that previously got silent plaintext fallback will now see exceptions.
- Callers of `encryptPatientPhi` / `decryptPatientPhi` (patientRepository.ts): the wrapper iterates fields; one field's failure throws, propagating to the caller. This is CORRECT for patient-write paths — a failed save must not masquerade as success.
- Callers via `utils/phiEncryption.ts` (patientService.ts): same. The wrapping async functions don't swallow; error propagates to the Express handler's try/catch → next(err) → 500.
- All 500s on PHI operations will be logged with `kind=PhiCryptoError` which Azure Monitor can alert on.

## Follow-up BUG

- **BUG-483 (S2 post-staging)** — consolidate duplicate `utils/phiEncryption.ts` into `shared/phiEncryption.ts` (single canonical PHI crypto module). Out of scope for BUG-441 (scope creep); the fail-fast behaviour must land first.

## L3/L4/L5 expected

- L3: always
- L4: YES — `shared/` touched + PHI encryption is a patient-safety gate (semantic trigger per §13.5)
- L5: YES — `shared/` touched + security boundary change
