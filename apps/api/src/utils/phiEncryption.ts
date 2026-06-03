/**
 * Compatibility wrapper for PHI encryption helpers.
 *
 * Canonical implementation lives in `shared/phiEncryption.ts`.
 * Keeping this module avoids broad import churn in legacy call-sites
 * while ensuring a single crypto + key-rotation implementation.
 */
export {
  encryptPhi,
  decryptPhi,
  isPhiEncryptionEnabled,
  PhiCryptoError,
} from '../shared/phiEncryption';

