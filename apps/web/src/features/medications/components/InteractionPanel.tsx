// apps/web/src/features/medications/components/InteractionPanel.tsx
//
// BUG-524-A — extracted from MedicationsTab.tsx (was L94-156 + L239-457)
// per the hybrid 2-tab split plan. Carries the BUG-521 drug-interaction
// fabrication-prevention classifier (`classifyInteractionResult`) and
// the InteractionPanel component that consumes it.
//
// Imported by ActiveMedicationsTab as the prescribing-surface header
// (renders below AllergyPanel above the active sub-section toggle).
// NOT consumed by MedicationHistoryTab.

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SyncIcon from '@mui/icons-material/Sync';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Collapse, IconButton,
  List, ListItem, ListItemText, Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';

interface DrugInteraction {
  pair: string[];
  description: string;
  severity: string;
}

interface InteractionConceptLike {
  minConceptItem?: {
    name?: string;
  };
}

/**
 * BUG-521 — pure helper extracted for testability. Pre-fix the
 * InteractionPanel collapsed three semantically distinct end states
 * (success-clean, partial-skip, hard-failure) into a single
 * `checked: boolean` flag, rendering "No interactions detected" green
 * for ALL of them. The clinical fatality scenario: RxNav timeout →
 * catch fires → UI shows "No interactions detected" → clinician
 * confirms prescription → patient receives contraindicated combination.
 *
 * Post-fix: `classifyInteractionResult` returns one of five status
 * states. The component renders amber/red banners with explicit
 * "verify manually before prescribing" CTAs on `'partial'` and
 * `'failed'` so the clinician cannot mistake a failed check for a
 * clean check.
 */
export type InteractionCheckStatus =
  | 'idle'
  | 'checking'
  | 'success'
  | 'partial'
  | 'failed';

export interface InteractionResultInputs {
  activeMedCount: number;
  rxcuiResolutionFailures: string[];
  resolvedRxcuiCount: number;
  outerFetchThrew: boolean;
  outerErrorMessage: string | null;
  interactionServiceUnavailable?: boolean;
  interactionServiceReason?: string | null;
}

export interface InteractionResultOutputs {
  status: InteractionCheckStatus;
  failureReason: string | null;
}

export function classifyInteractionResult(
  args: InteractionResultInputs,
): InteractionResultOutputs {
  if (args.interactionServiceUnavailable) {
    return {
      status: 'partial',
      failureReason:
        args.interactionServiceReason
        ?? 'Automated drug-interaction service is unavailable. Verify interactions manually before prescribing.',
    };
  }
  if (args.outerFetchThrew) {
    return {
      status: 'failed',
      failureReason: `Drug interaction check failed: ${args.outerErrorMessage ?? 'unknown error'}. Verify manually before prescribing.`,
    };
  }
  if (args.resolvedRxcuiCount < 2) {
    if (args.rxcuiResolutionFailures.length > 0) {
      return {
        status: 'failed',
        failureReason: `Could not look up medication identifiers (${args.rxcuiResolutionFailures.join(', ')}) — verify manually before prescribing.`,
      };
    }
    // Genuinely fewer than 2 active meds — legitimate clean state.
    return { status: 'success', failureReason: null };
  }
  // resolvedRxcuiCount >= 2
  if (args.rxcuiResolutionFailures.length > 0) {
    return {
      status: 'partial',
      failureReason: `Could not check ${args.rxcuiResolutionFailures.length} of ${args.activeMedCount} medications: ${args.rxcuiResolutionFailures.join(', ')}. Verify manually.`,
    };
  }
  return { status: 'success', failureReason: null };
}

// InteractionPanel only consumes `medicationName` + `genericName` from each
// active med — narrow prop type to avoid coupling to the full MedicationRow
// shape which lives in MedicationsTab.tsx until BUG-524-F renames it.
interface InteractionMed { medicationName: string; genericName: string | null }

interface InteractionPanelProps { activeMeds: InteractionMed[] }
export function InteractionPanel({ activeMeds }: InteractionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<InteractionCheckStatus>('idle');
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [failureReason, setFailureReason] = useState<string | null>(null);

  const checkInteractions = useCallback(async () => {
    if (activeMeds.length < 2) return;
    setStatus('checking');
    setFailureReason(null);

    // Step 1: Resolve RxCUIs for each active medication. Pre-fix this
    // loop's silent `} catch { /* skip */ }` (BUG-521) silently dropped
    // any med whose lookup failed; combined with the outer catch, a
    // total RxNav failure rendered as "No interactions detected" green.
    // Post-fix: accumulate `failedNames` so partial / total failures
    // route through `classifyInteractionResult` to a visible
    // partial/failed banner with "verify manually before prescribing".
    const failedNames: string[] = [];
    const rxcuiMap: Record<string, string> = {};
    let outerThrew = false;
    let outerErrorMessage: string | null = null;

    try {
      for (const med of activeMeds) {
        const searchName = med.genericName || med.medicationName;
        try {
          const resp = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(searchName)}&search=2`);
          if (!resp.ok) {
            failedNames.push(med.medicationName);
            continue;
          }
          const data = await resp.json();
          const ids = data?.idGroup?.rxnormId;
          if (ids?.length) {
            rxcuiMap[med.medicationName] = ids[0];
          } else {
            // 200 OK with no rxnormId — count as resolution failure.
            failedNames.push(med.medicationName);
          }
        } catch (err) {
          failedNames.push(med.medicationName);
          console.warn('InteractionPanel: RxCUI lookup failed', { kind: 'rxcui_lookup_failed', med: med.medicationName, err });
        }
      }
      const rxcuis = Object.values(rxcuiMap);

      // Step 2: cross-check interactions if we have >= 2 resolved RxCUIs.
      const pairs: DrugInteraction[] = [];
      if (rxcuis.length >= 2) {
        const resp = await fetch(`https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=${rxcuis.join('+')}`);
        if (!resp.ok) {
          if (resp.status === 404 || resp.status === 410) {
            // RxNav retired the public DDI API (Jan 2024 notice). Surface as
            // a controlled partial-warning state instead of a raw status leak.
            setInteractions([]);
            const classified = classifyInteractionResult({
              activeMedCount: activeMeds.length,
              rxcuiResolutionFailures: failedNames,
              resolvedRxcuiCount: rxcuis.length,
              outerFetchThrew: false,
              outerErrorMessage: null,
              interactionServiceUnavailable: true,
              interactionServiceReason:
                'Automated NLM drug-interaction feed is unavailable. Verify interactions manually before prescribing.',
            });
            setStatus(classified.status);
            setFailureReason(classified.failureReason);
            return;
          }
          throw new Error(`RxNav interaction-list returned ${resp.status}`);
        }
        const data = await resp.json();
        const interactionGroups = data?.fullInteractionTypeGroup ?? [];
        for (const group of interactionGroups) {
          for (const type of group.fullInteractionType ?? []) {
            for (const pair of type.interactionPair ?? []) {
              const concepts: InteractionConceptLike[] = Array.isArray(pair.interactionConcept)
                ? (pair.interactionConcept as InteractionConceptLike[])
                : [];
              pairs.push({
                pair: concepts.map((c) => c.minConceptItem?.name ?? ''),
                description: pair.description ?? '',
                severity: pair.severity ?? 'N/A',
              });
            }
          }
        }
      }
      setInteractions(pairs);

      const classified = classifyInteractionResult({
        activeMedCount: activeMeds.length,
        rxcuiResolutionFailures: failedNames,
        resolvedRxcuiCount: rxcuis.length,
        outerFetchThrew: false,
        outerErrorMessage: null,
        interactionServiceUnavailable: false,
        interactionServiceReason: null,
      });
      setStatus(classified.status);
      setFailureReason(classified.failureReason);
    } catch (err) {
      outerThrew = true;
      outerErrorMessage = err instanceof Error ? err.message : String(err);
      console.warn('InteractionPanel: interaction-list fetch failed', { kind: 'interaction_check_failed', err });
      setInteractions([]);
      const classified = classifyInteractionResult({
        activeMedCount: activeMeds.length,
        rxcuiResolutionFailures: failedNames,
        resolvedRxcuiCount: Object.keys(rxcuiMap).length,
        outerFetchThrew: outerThrew,
        outerErrorMessage,
        interactionServiceUnavailable: false,
        interactionServiceReason: null,
      });
      setStatus(classified.status);
      setFailureReason(classified.failureReason);
    }
  }, [activeMeds]);

  const hasInteractions = interactions.length > 0;
  const isChecked = status === 'success' || status === 'partial' || status === 'failed';

  return (
    <Box sx={{ mb: 2 }}>
      {/*
        BUG-522 — pre-fix SafeScript summary Card REMOVED (parent flex
        wrapper also dropped per BUG-522 absorb-1 L3 F3). The card
        displayed an aggregate count derived from the LOCAL DB only,
        and a green negative-result message when the count was zero —
        a clinical-safety false-negative class: a clinician seeing
        the green "no risk" message could conclude the patient has no
        doctor-shopping history when in reality only the Victorian
        SafeScript real-time prescription-monitoring registry knows
        about S8 prescriptions from OTHER providers. The local DB only
        sees prescriptions issued through Signacare. Removing the card
        eliminates the false-confidence failure mode.

        BUG-550 — surface the EXISTING SafeScript real-time PMP check
        at the aggregate MedicationsTab level (CORRECTED scope per L3
        absorb-1 F1). The integration ALREADY ships at the point-of-
        prescribe path:
          - apps/api/src/integrations/safeScript/safeScriptService.ts
            (OAuth2 + checkPatient + enforceSafeScriptCheck + audit)
          - apps/api/src/features/prescriptions/prescriptionService.ts
            line 169 (calls safeScriptService.checkPatient on every
            prescription create)
          - apps/web/src/features/medications/components/
            SafeScriptPanel.tsx (Red/Amber/Green UI on prescribe form)
          - apps/api/src/shared/assertProductionIntegrationsConfigured.ts
            line 95-96 (gates production startup on SAFESCRIPT_* env)
        BUG-550 reduces to: gate aggregate-card re-introduction on
        `safeScriptService.isConfigured()`, query cross-provider supply
        history, render Red/Amber/Green like SafeScriptPanel does today.

        Until BUG-550 surfaces the aggregate view, S8 status remains
        visible inline on each medication row via the existing `isS8`
        flag and SafeScriptPanel runs at point-of-prescribe.
      */}
      <Card variant="outlined" sx={{
        flex: 1,
        borderColor:
          status === 'failed' ? '#D32F2F'
          : status === 'partial' ? '#ED6C02'
          : hasInteractions ? '#D32F2F'
          : '#9C27B0',
      }}>
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <WarningAmberIcon sx={{
              color:
                status === 'failed' ? '#D32F2F'
                : status === 'partial' ? '#ED6C02'
                : hasInteractions ? '#D32F2F'
                : '#9C27B0',
              fontSize: 20,
            }} />
            <Typography variant="body2" fontWeight={600} sx={{
              color:
                status === 'failed' ? '#D32F2F'
                : status === 'partial' ? '#ED6C02'
                : hasInteractions ? '#D32F2F'
                : '#9C27B0',
            }}>
              Drug Interactions
            </Typography>
            {!isChecked ? (
              <Button size="small" startIcon={status === 'checking' ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <SyncIcon sx={{ fontSize: 14 }} />}
                onClick={checkInteractions} disabled={status === 'checking' || activeMeds.length < 2}
                sx={{ ml: 1, fontSize: 10, color: '#9C27B0' }}>
                {status === 'checking' ? 'Checking NLM...' : 'Check Interactions'}
              </Button>
            ) : status === 'success' ? (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {hasInteractions
                  ? `${interactions.length} interaction(s) found`
                  : activeMeds.length < 2
                    ? 'Only 1 medication — no pairs to check'
                    : 'No interactions detected'}
              </Typography>
            ) : null}
            {hasInteractions && (
              <IconButton size="small" aria-label={expanded ? 'Collapse interactions' : 'Expand interactions'} onClick={() => setExpanded(!expanded)} sx={{ ml: 'auto' }}>
                {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            )}
          </Box>
          {status === 'partial' && failureReason && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#ED6C02', fontSize: 11 }}>
              {failureReason}
            </Typography>
          )}
          {status === 'failed' && failureReason && (
            <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ color: '#D32F2F', fontSize: 11, fontWeight: 600 }}>
                Drug interaction check FAILED — verify manually before prescribing. {failureReason}
              </Typography>
              <Button size="small" onClick={checkInteractions} sx={{ fontSize: 10, color: '#D32F2F' }}>
                Retry
              </Button>
            </Box>
          )}
          <Collapse in={expanded}>
            <List dense disablePadding sx={{ mt: 1 }}>
              {interactions.map((ix, i) => (
                <ListItem key={i} disablePadding sx={{ py: 0.3 }}>
                  <ListItemText
                    primary={<Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>{ix.pair.join(' ↔ ')}</Typography>}
                    secondary={<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{ix.description}</Typography>}
                  />
                  <Chip label={ix.severity} size="small" color={ix.severity === 'high' ? 'error' : 'warning'} sx={{ fontSize: 9, height: 18 }} />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}
