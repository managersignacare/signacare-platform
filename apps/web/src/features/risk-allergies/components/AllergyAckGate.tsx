// apps/web/src/features/risk-allergies/components/AllergyAckGate.tsx
//
// BUG-393 — clinician allergy-acknowledgement gate.
//
// Before a clinician can interact with medication / prescription UI for
// a patient, they must explicitly acknowledge the patient's active
// allergy list. Acknowledgement is per-session + per-patient + per-
// allergen-hash: if the allergy list changes, the hash changes and the
// gate re-triggers.
//
// Design:
//   - Fetches `useAllergies(patientId, true)` to get the active allergen set
//   - Hashes the active allergen set into a short string (stable across sessions)
//   - Reads `sessionStorage` for an ack matching (patientId, hash)
//   - If missing: renders a modal-style overlay showing the allergies +
//     an "I have reviewed these allergies" button. Children are hidden
//     behind the overlay.
//   - On click: writes the ack to sessionStorage + shows children.
//   - Re-renders when patientId changes OR when the allergen list changes
//     (hash differs), forcing re-ack.
//
// The gate does NOT reset on window reload — sessionStorage persists
// for the tab. Fresh tab / fresh session = fresh ack. This matches the
// clinical intent (a clinician arriving at a patient's chart should
// acknowledge allergies once per session per patient).

import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Stack, Typography } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAllergies } from '../hooks/useAllergies';

interface Props {
  patientId: string;
  /** The gated children (MedicationsTab content). */
  children: React.ReactNode;
}

interface AllergenRow {
  id: string;
  allergenName?: string;
  allergen_name?: string;
  allergen?: string;
  name?: string;
  status?: string;
  severity?: string;
}

/**
 * Produce a short deterministic hash of the active allergen set.
 * Used as the session-storage key suffix so a change in the allergy list
 * re-triggers the gate.
 */
export function hashAllergens(rows: AllergenRow[]): string {
  const items = rows
    .map((r) => (r.allergenName ?? r.allergen_name ?? r.allergen ?? r.name ?? '?').toLowerCase())
    .sort()
    .join('|');
  // Tiny non-cryptographic hash (djb2) — fine for a session-storage key
  let h = 5381;
  for (let i = 0; i < items.length; i += 1) {
    h = ((h << 5) + h + items.charCodeAt(i)) | 0;
  }
  return `${items.length}_${Math.abs(h).toString(36)}`;
}

export function ackStorageKey(patientId: string, allergenHash: string): string {
  return `allergy-ack:${patientId}:${allergenHash}`;
}

export function readAck(patientId: string, allergenHash: string): boolean {
  if (typeof window === 'undefined') return false; // SSR / test fallback
  try {
    return window.sessionStorage.getItem(ackStorageKey(patientId, allergenHash)) === '1';
  } catch {
    return false;
  }
}

export function writeAck(patientId: string, allergenHash: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ackStorageKey(patientId, allergenHash), '1');
  } catch {
    // SecurityError on some privacy-mode browsers — ignored. The
    // gate will then re-trigger on next render; acceptable degradation.
  }
}

export const AllergyAckGate: React.FC<Props> = ({ patientId, children }) => {
  const { data: rawAllergies, isLoading, isError } = useAllergies(patientId, true);
  const allergies: AllergenRow[] = useMemo(
    () => (Array.isArray(rawAllergies) ? (rawAllergies as AllergenRow[]) : []),
    [rawAllergies],
  );
  const allergenHash = useMemo(() => hashAllergens(allergies), [allergies]);

  // sessionStorage is the source of truth across tabs. React state is a
  // cache for re-render triggering. On mount + on hash change (allergy
  // list update) we re-read sessionStorage. The `allergy-ack-changed`
  // window event lets the click handler nudge the state without a
  // full page reload.
  const [acknowledged, setAcknowledged] = useState<boolean>(() =>
    readAck(patientId, allergenHash),
  );

  useEffect(() => {
    setAcknowledged(readAck(patientId, allergenHash));
    function onAckChanged() {
      setAcknowledged(readAck(patientId, allergenHash));
    }
    window.addEventListener('allergy-ack-changed', onAckChanged);
    return () => window.removeEventListener('allergy-ack-changed', onAckChanged);
  }, [patientId, allergenHash]);

  // While the allergy query is loading, render children pessimistically
  // hidden so a fast clinician can't click through before the gate decides.
  // Once data lands we either show the overlay or the children.
  if (isLoading) {
    return (
      <Box py={4} display="flex" justifyContent="center">
        <Typography variant="caption" color="text.secondary">
          Loading allergy list…
        </Typography>
      </Box>
    );
  }

  // L3-absorb 2026-04-24: fail CLOSED on query error. Pre-absorb, an
  // `isError` response silently fell through to the NKA ("no known
  // allergies") branch — a clinician could acknowledge an empty set
  // that was actually a failed-to-load list, then prescribe without
  // seeing real allergies. Clinical-safety: when we can't verify the
  // list, we must block the flow and surface a reload prompt.
  if (isError) {
    return (
      <Alert severity="error" variant="filled" sx={{ mb: 2 }}>
        <AlertTitle>Unable to load allergy list</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          The patient&apos;s allergy list could not be fetched. Prescribing is
          blocked until the list reloads. Refresh the page to retry; if the
          problem persists contact support immediately.
        </Typography>
        <Button
          variant="contained"
          onClick={() => window.location.reload()}
          sx={{ bgcolor: '#fff', color: '#B71C1C', fontWeight: 700 }}
          data-testid="allergy-ack-reload"
        >
          Reload page
        </Button>
      </Alert>
    );
  }

  if (acknowledged) {
    return <>{children}</>;
  }

  const hasAllergies = allergies.length > 0;

  return (
    <Box>
      <Alert
        severity={hasAllergies ? 'warning' : 'info'}
        icon={hasAllergies ? <WarningAmberRoundedIcon /> : <CheckCircleOutlineIcon />}
        variant="filled"
        sx={{ mb: 2 }}
      >
        <AlertTitle>
          {hasAllergies
            ? `Review the patient's ${allergies.length} active allerg${allergies.length > 1 ? 'ies' : 'y'} before prescribing`
            : 'No Known Allergies (NKA) — confirm before prescribing'}
        </AlertTitle>
        {hasAllergies && (
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
            {allergies.map((a) => (
              <Chip
                key={a.id}
                label={a.allergenName ?? a.allergen_name ?? a.allergen ?? a.name ?? '?'}
                size="small"
                sx={{
                  bgcolor: '#fff',
                  color: '#B71C1C',
                  fontWeight: 700,
                  border: '1px solid #EF9A9A',
                }}
              />
            ))}
          </Stack>
        )}
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          Per AHPRA clinical-safety policy + TGA good-prescribing-practice, you
          must acknowledge this patient&apos;s allergy status before any
          medication action (new prescription, dose change, administration).
          This acknowledgement lasts for the current browser session and
          resets if the allergy list changes.
        </Typography>
        <Button
          variant="contained"
          onClick={() => {
            writeAck(patientId, allergenHash);
            setAcknowledged(true);
            // Broadcast so any other AllergyAckGate instance for the
            // same (patientId, hash) on the page updates in lockstep.
            window.dispatchEvent(new Event('allergy-ack-changed'));
          }}
          sx={{ bgcolor: '#B71C1C', '&:hover': { bgcolor: '#7F0000' }, fontWeight: 700 }}
          data-testid="allergy-ack-confirm"
        >
          I have reviewed these allergies
        </Button>
      </Alert>
      {/*
        Children are NOT rendered while the gate is active. This is an
        unusual pattern — most gates render children faded/disabled. We
        hard-hide because the clinical intent is that the clinician CANNOT
        interact with the UI until they've explicitly acknowledged.
      */}
    </Box>
  );
};
