/**
 * BUG-393 — AllergyAckGate unit tests.
 *
 * Tests the pure helpers (`hashAllergens`, `ackStorageKey`, `readAck`,
 * `writeAck`) and the key invariants:
 *   1. Hash is stable for identical allergen sets regardless of order
 *   2. Hash differs when the allergen set differs
 *   3. Storage key includes patientId + hash for unique ack per patient
 *   4. readAck returns false when no ack present
 *   5. writeAck + readAck round-trip
 *   6. Different patient = different storage key = independent ack
 *
 * Component render tests are out of scope for this unit file (pattern
 * matches AvailabilityGridEditor.test.tsx which tests logic only; MUI
 * component render is covered by the E2E medication-tab tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { hashAllergens, ackStorageKey, readAck, writeAck } from './AllergyAckGate';

describe('AllergyAckGate — pure helpers', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.sessionStorage.clear();
  });

  describe('hashAllergens', () => {
    it('produces a stable hash for identical allergen lists', () => {
      const rows = [
        { id: '1', allergenName: 'Penicillin' },
        { id: '2', allergenName: 'Sulfa' },
      ];
      const a = hashAllergens(rows);
      const b = hashAllergens(rows);
      expect(a).toBe(b);
      expect(a).not.toBe(''); // non-empty
    });

    it('is order-independent (sorts allergens)', () => {
      const rows1 = [
        { id: '1', allergenName: 'Penicillin' },
        { id: '2', allergenName: 'Sulfa' },
      ];
      const rows2 = [
        { id: '2', allergenName: 'Sulfa' },
        { id: '1', allergenName: 'Penicillin' },
      ];
      expect(hashAllergens(rows1)).toBe(hashAllergens(rows2));
    });

    it('differs when the allergen set differs', () => {
      const rows1 = [{ id: '1', allergenName: 'Penicillin' }];
      const rows2 = [{ id: '1', allergenName: 'Sulfa' }];
      expect(hashAllergens(rows1)).not.toBe(hashAllergens(rows2));
    });

    it('differs when a new allergen is added', () => {
      const rows1 = [{ id: '1', allergenName: 'Penicillin' }];
      const rows2 = [
        { id: '1', allergenName: 'Penicillin' },
        { id: '2', allergenName: 'Sulfa' },
      ];
      expect(hashAllergens(rows1)).not.toBe(hashAllergens(rows2));
    });

    it('handles the NKA case (empty list) with a stable zero-length hash', () => {
      const a = hashAllergens([]);
      const b = hashAllergens([]);
      expect(a).toBe(b);
    });

    it('case-insensitively matches "penicillin" and "Penicillin"', () => {
      const rows1 = [{ id: '1', allergenName: 'Penicillin' }];
      const rows2 = [{ id: '1', allergenName: 'penicillin' }];
      expect(hashAllergens(rows1)).toBe(hashAllergens(rows2));
    });

    it('falls back across allergen field-name variants (legacy snake_case + new camelCase)', () => {
      const rows1 = [{ id: '1', allergenName: 'Penicillin' }];
      const rows2 = [{ id: '1', allergen_name: 'Penicillin' }];
      expect(hashAllergens(rows1)).toBe(hashAllergens(rows2));
    });
  });

  describe('ackStorageKey', () => {
    it('composes patientId + hash into a namespaced key', () => {
      const key = ackStorageKey('patient-abc', 'hash-xyz');
      expect(key).toBe('allergy-ack:patient-abc:hash-xyz');
    });
  });

  describe('readAck / writeAck (sessionStorage round-trip)', () => {
    // vitest.config.ts is deliberately non-DOM (React 19 component-render
    // tests go through Playwright, not vitest). In this Node env
    // `typeof window === 'undefined'` so writeAck/readAck are no-ops
    // and always return false. We exercise the round-trip inside a
    // stubbed window object. The live-browser behaviour is covered by
    // the MedicationsTab E2E spec.
    const stub = () => {
      const store = new Map<string, string>();
      (globalThis as unknown as { window?: unknown }).window = {
        sessionStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          },
          removeItem: (k: string) => {
            store.delete(k);
          },
          clear: () => store.clear(),
        },
      };
      return () => {
        delete (globalThis as unknown as { window?: unknown }).window;
      };
    };

    it('readAck returns false when no ack was written', () => {
      const restore = stub();
      try {
        expect(readAck('patient-1', 'hash-1')).toBe(false);
      } finally {
        restore();
      }
    });

    it('writeAck + readAck round-trip for the same (patient, hash) tuple', () => {
      const restore = stub();
      try {
        writeAck('patient-1', 'hash-1');
        expect(readAck('patient-1', 'hash-1')).toBe(true);
      } finally {
        restore();
      }
    });

    it('acks are patient-scoped — ack for patient-A does NOT apply to patient-B', () => {
      const restore = stub();
      try {
        writeAck('patient-A', 'hash-1');
        expect(readAck('patient-B', 'hash-1')).toBe(false);
      } finally {
        restore();
      }
    });

    it('acks are hash-scoped — ack for hash-1 does NOT apply to hash-2', () => {
      const restore = stub();
      try {
        writeAck('patient-1', 'hash-1');
        // Simulate the allergy list changing → hash changes
        expect(readAck('patient-1', 'hash-2')).toBe(false);
      } finally {
        restore();
      }
    });
  });
});
