// apps/web/src/features/medications/components/PrescribeDialog.tsx
//
// BUG-524-B — extracted from MedicationsTab.tsx (was L2258-2597) per
// the hybrid 2-tab split plan. Bundles together the prescribing-domain
// surface: RxNorm drug search, PBS streamlined codes, and the dialog
// component used by Current / LAI / Clozapine sub-sections of
// ActiveMedicationsTab.
//
// Imported by ActiveMedicationsTab (single dialog instance per tab,
// driven by sub-section open/close state). Future BUG-524-D's LaiPanel
// + BUG-524-C's ClozapinePanel keep their own open/close handlers but
// share this single component.

import SearchIcon from '@mui/icons-material/Search';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { MfaChallengeDialog } from '../../../shared/components/ui/MfaChallengeDialog';
import { patientMedicationsKeys, patientsKeys } from '../../patients/queryKeys';
import type { MedicationRow, RxDrugResult } from '../types';

interface RxNavApproxCandidate {
  rxcui?: string;
}

interface RxNavApproxResponse {
  approximateGroup?: {
    candidate?: RxNavApproxCandidate[];
  };
}

// ── RxNorm Drug Search Hook ──
export function useRxDrugSearch(query: string) {
  return useQuery({
    queryKey: patientsKeys.rxnormSearch(query),
    queryFn: async (): Promise<RxDrugResult[]> => {
      if (query.length < 2) return [];
      // Step 1: Use approximateTerm for partial name matching
      const approxResp = await fetch(`https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=15`);
      const approxData: RxNavApproxResponse = await approxResp.json();
      const candidates = approxData.approximateGroup?.candidate ?? [];
      if (!candidates.length) return [];

      // Step 2: Get properties for each rxcui
      const results: RxDrugResult[] = [];
      const rxcuis = candidates.map((c) => c.rxcui).filter(Boolean).slice(0, 15);
      for (const rxcui of rxcuis) {
        try {
          const propResp = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/properties.json`);
          const propData = await propResp.json();
          const props = propData?.properties;
          if (props) {
            results.push({
              rxcui: props.rxcui,
              name: props.name,
              synonym: props.synonym ?? '',
              tty: props.tty ?? '',
            });
          }
        } catch { /* intentional silent — RxNav drug-name enrichment best-effort; failure leaves the search-result entry without the cosmetic name fields, user-typed input still works */ }
      }
      // Deduplicate by name
      const seen = new Map<string, RxDrugResult>();
      for (const r of results) {
        const key = r.name.toLowerCase();
        if (!seen.has(key) || r.tty === 'SCD') seen.set(key, r);
      }
      return Array.from(seen.values()).slice(0, 20);
    },
    enabled: query.length >= 2,
    staleTime: 60_000,
  });
}

// ── PBS Streamlined Code Lookup ──
export const PBS_STREAMLINED_CODES: Record<string, { code: string; restriction: string }[]> = {
  olanzapine: [{ code: '5824', restriction: 'Schizophrenia' }],
  risperidone: [{ code: '5826', restriction: 'Schizophrenia' }],
  paliperidone: [{ code: '9522', restriction: 'Schizophrenia — LAI' }, { code: '10187', restriction: 'Schizoaffective disorder — LAI' }],
  aripiprazole: [{ code: '9098', restriction: 'Schizophrenia' }, { code: '10406', restriction: 'Schizophrenia — LAI' }],
  quetiapine: [{ code: '8418', restriction: 'Schizophrenia' }, { code: '8419', restriction: 'Bipolar disorder' }],
  clozapine: [{ code: '1928', restriction: 'Treatment-resistant schizophrenia' }],
  lithium: [{ code: '2434', restriction: 'Bipolar disorder / Mood stabilisation' }],
  sodium_valproate: [{ code: '2614', restriction: 'Epilepsy / Bipolar disorder' }],
  valproate: [{ code: '2614', restriction: 'Epilepsy / Bipolar disorder' }],
  lamotrigine: [{ code: '8102', restriction: 'Epilepsy / Bipolar maintenance' }],
  carbamazepine: [{ code: '1326', restriction: 'Epilepsy / Trigeminal neuralgia' }],
  sertraline: [{ code: '8538', restriction: 'Major depressive disorder / OCD / PTSD' }],
  fluoxetine: [{ code: '1655', restriction: 'Major depressive disorder / OCD' }],
  escitalopram: [{ code: '8846', restriction: 'Major depressive disorder / GAD' }],
  venlafaxine: [{ code: '8296', restriction: 'Major depressive disorder / GAD' }],
  desvenlafaxine: [{ code: '9529', restriction: 'Major depressive disorder' }],
  duloxetine: [{ code: '8805', restriction: 'Major depressive disorder / GAD / Neuropathic pain' }],
  mirtazapine: [{ code: '2553', restriction: 'Major depressive disorder' }],
  diazepam: [{ code: '1586', restriction: 'Anxiety / Muscle spasm / Epilepsy' }],
  temazepam: [{ code: '2655', restriction: 'Insomnia (short-term)' }],
  melatonin: [{ code: '10925', restriction: 'Insomnia in adults ≥55' }],
  zuclopenthixol: [{ code: '5828', restriction: 'Schizophrenia — LAI' }],
  flupentixol: [{ code: '5825', restriction: 'Schizophrenia — LAI' }],
  haloperidol: [{ code: '5823', restriction: 'Schizophrenia' }],
  amisulpride: [{ code: '8340', restriction: 'Schizophrenia' }],
  ziprasidone: [{ code: '8533', restriction: 'Schizophrenia / Bipolar mania' }],
  lurasidone: [{ code: '10574', restriction: 'Schizophrenia' }],
  brexpiprazole: [{ code: '11396', restriction: 'Schizophrenia' }],
  cariprazine: [{ code: '12108', restriction: 'Schizophrenia' }],
};

/** Get the indication for display — uses saved indication or derives from PBS codes */
export function getIndicationDisplay(m: { indication?: string | null; medicationName?: string; genericName?: string | null }): string | null {
  if (m.indication) return m.indication;
  // Derive from PBS codes based on drug name
  const name = m.genericName ?? m.medicationName ?? '';
  const codes = getPbsCodes(name);
  if (codes.length > 0) return codes[0].restriction;
  return null;
}

export function getPbsCodes(drugName: string): { code: string; restriction: string }[] {
  const lower = drugName.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, codes] of Object.entries(PBS_STREAMLINED_CODES)) {
    if (lower.includes(key.replace(/_/g, ''))) return codes;
  }
  return [];
}

// ── PrescribeDialog ──
export const PBS_AUTHORITIES = ['General Schedule', 'Streamlined Authority', 'Phone Authority', 'Written Authority', 'Private (non-PBS)'];
// BUG-604 — these arrays are SCOPED to the PBS prescription form
// (Title-case routes; latin clinical abbreviations like BD/TDS/Mane/Nocte
// for prescription-pad-friendly rendering). They DELIBERATELY differ
// from the generic `ROUTES` + `FREQUENCIES` exports in
// `apps/web/src/features/medications/types/medicationTypes.ts` which
// are lower-case + plain-English (e.g. "twice daily") for generic
// display contexts. Pre-fix both pairs of arrays were named identically
// (`ROUTES` / `FREQUENCIES`) and BOTH exported, risking that a future
// contributor would import the wrong one (CLAUDE.md Standard 3 SSoT).
// Post-fix the prescribing-specific arrays are renamed to
// `PRESCRIBING_ROUTES` / `PRESCRIBING_FREQUENCIES` and unexported
// (consumed only internally by this PrescribeDialog file).
const PRESCRIBING_ROUTES = ['Oral', 'IM', 'IV', 'SC', 'Sublingual', 'Topical', 'PR', 'Inhaled', 'Intranasal'];
const PRESCRIBING_FREQUENCIES = ['Once daily', 'BD (twice daily)', 'TDS (three times daily)', 'QID (four times daily)', 'Nocte', 'Mane', 'PRN', 'Weekly', 'Fortnightly', '3-weekly', '4-weekly (monthly)', '10-weekly', '12-weekly (3-monthly)', '26-weekly (6-monthly)', 'Stat', 'Custom'];

export interface PrescribeDialogProps { open: boolean; onClose: () => void; patientId: string; defaultLai?: boolean; defaultClozapine?: boolean;
  defaultMedName?: string; defaultGeneric?: string; defaultDose?: string; defaultRoute?: string; defaultFrequency?: string; defaultS8?: boolean;
  onPrintPrescription?: (med: MedicationRow) => void; }

export function PrescribeDialog({ open, onClose, patientId, defaultLai, defaultClozapine, defaultMedName, defaultGeneric, defaultDose, defaultRoute, defaultFrequency, defaultS8, onPrintPrescription }: PrescribeDialogProps) {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = React.useState('');
  const [medication, setMedication] = React.useState('');
  const [genericName, setGenericName] = React.useState('');
  const [dose, setDose] = React.useState('');
  const [route, setRoute] = React.useState('Oral');
  const [frequency, setFrequency] = React.useState(defaultLai ? '4-weekly (monthly)' : 'Once daily');
  const [quantity, setQuantity] = React.useState('');
  const [repeats, setRepeats] = React.useState('');
  const [pbsAuthority, setPbsAuthority] = React.useState('General Schedule');
  const [streamlinedCode, setStreamlinedCode] = React.useState('');
  const [isLai, setIsLai] = React.useState(!!defaultLai);
  const [isS8, setIsS8] = React.useState(!!defaultS8);
  const [isClozapine, setIsClozapine] = React.useState(!!defaultClozapine);
  const [indication, setIndication] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // Auto-populate from represcribe defaults
  React.useEffect(() => {
    if (defaultMedName) { setMedication(defaultMedName); setSearchInput(defaultMedName); }
    if (defaultGeneric) setGenericName(defaultGeneric);
    if (defaultDose) setDose(defaultDose);
    if (defaultRoute) setRoute(defaultRoute.charAt(0).toUpperCase() + defaultRoute.slice(1));
    if (defaultFrequency) setFrequency(defaultFrequency);
    if (defaultLai) setIsLai(true);
    if (defaultClozapine) setIsClozapine(true);
    if (defaultS8) setIsS8(true);
  }, [defaultMedName, defaultGeneric, defaultDose, defaultRoute, defaultFrequency, defaultLai, defaultClozapine, defaultS8]);

  const { data: drugResults, isLoading: searchLoading } = useRxDrugSearch(searchInput);

  // PBS code lookup based on selected medication
  const pbsCodes = useMemo(() => getPbsCodes(medication || searchInput), [medication, searchInput]);

  const handleDrugSelect = (_: React.SyntheticEvent, value: string | RxDrugResult | null) => {
    if (typeof value === 'string' || !value) return;
    // Parse the RxNorm name: e.g. "olanzapine 10 MG Oral Tablet" → medication, dose, route
    const name = value.name;
    setMedication(name);

    // Extract generic name (first word typically)
    const parts = name.split(' ');
    setGenericName(parts[0] ?? '');

    // Try to extract dose from name
    const doseMatch = name.match(/(\d+(?:\.\d+)?)\s*(MG|MCG|ML|MG\/ML)/i);
    if (doseMatch) setDose(`${doseMatch[1]}${doseMatch[2].toLowerCase()}`);

    // Try to extract route
    if (/oral/i.test(name)) setRoute('Oral');
    else if (/inject|intramuscular/i.test(name)) { setRoute('IM'); if (defaultLai === undefined) setIsLai(true); }
    else if (/intravenous/i.test(name)) setRoute('IV');
    else if (/subcutaneous/i.test(name)) setRoute('SC');
    else if (/topical/i.test(name)) setRoute('Topical');
    else if (/inhal/i.test(name)) setRoute('Inhaled');

    // Auto-detect LAI from known LAI drug names
    if (/paliperidone.*palmitate|aripiprazole.*lauroxil|aripiprazole.*monohydrate|zuclopenthixol.*decanoate|flupentixol.*decanoate|haloperidol.*decanoate|risperidone.*ISM|invega|sustenna|aristada|abilify.*maintena/i.test(name)) {
      setRoute('IM'); setIsLai(true);
    }

    // Auto-detect clozapine
    if (/clozapine/i.test(name)) setIsClozapine(true);

    // Auto-set streamlined code and indication if available
    const codes = getPbsCodes(name);
    if (codes.length === 1) {
      setPbsAuthority('Streamlined Authority');
      setStreamlinedCode(codes[0].code);
      setIndication(codes[0].restriction);
    } else if (codes.length > 1) {
      // Set indication from first code as default, user can change
      setIndication(codes[0].restriction);
    }
  };

  const handleSave = async () => {
    if (!patientId || !medication.trim() || !dose.trim()) return;
    setSaving(true);
    // BUG-P3 — submit closure so we can re-invoke after a successful
    // step-up challenge (PRES-7 DH-3869 + DH-4155 §3). The backend
    // returns 403 STEP_UP_REQUIRED when a Schedule 8 mutation is sent
    // without a recent verify-mfa-challenge / verify-password-challenge.
    const performSave = async () => {
      await apiClient.post('medications', {
        patientId,
        episodeId: undefined,
        medicationName: medication.trim(),
        genericName: genericName.trim() || undefined,
        dose: dose.trim(),
        route: route.toLowerCase(),
        frequency,
        quantity: quantity ? parseInt(quantity, 10) : undefined,
        repeats: repeats ? parseInt(repeats, 10) : undefined,
        startDate: new Date().toISOString().slice(0, 10),
        isLai,
        isS8,
        isClozapine,
        indication: indication.trim() || undefined,
        prescriberId: undefined,
      });
    };
    try {
      await performSave();
      qc.invalidateQueries({ queryKey: patientMedicationsKeys.byPatient(patientId) });
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { code?: string; error?: string } }; message?: string };
      const code = e?.response?.data?.code;
      if (e?.response?.status === 403 && code === 'STEP_UP_REQUIRED') {
        // Open MfaChallengeDialog; on success, retry the save.
        setStepUpRetry(() => performSave);
        setStepUpOpen(true);
      } else {
        alert(`Failed to save: ${e?.response?.data?.error ?? e?.message ?? 'Unknown error'}`);
      }
    } finally {
      setSaving(false);
    }
  };

  // BUG-P3 — step-up state. The pendingRetry closure captures whatever
  // mutation triggered the 403 so we can re-invoke after the dialog
  // resolves successfully. setStepUpRetry takes a thunk because React
  // setState eagerly invokes function arguments — wrapping in (() => fn)
  // is the canonical "store a function" idiom.
  const [stepUpOpen, setStepUpOpen] = React.useState(false);
  const [stepUpRetry, setStepUpRetry] = React.useState<(() => Promise<void>) | null>(null);
  const handleStepUpVerified = async () => {
    setStepUpOpen(false);
    if (!stepUpRetry) return;
    setSaving(true);
    try {
      await stepUpRetry();
      qc.invalidateQueries({ queryKey: patientMedicationsKeys.byPatient(patientId) });
      setStepUpRetry(null);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      alert(`Failed to save after verification: ${e?.response?.data?.error ?? e?.message ?? 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    {/* BUG-P3 — MfaChallengeDialog opens on 403 STEP_UP_REQUIRED to satisfy the
        PRES-7 / DH-4155 §3 re-authentication mandate for S8 prescribing. */}
    <MfaChallengeDialog
      open={stepUpOpen}
      onClose={() => { setStepUpOpen(false); setStepUpRetry(null); }}
      onVerified={handleStepUpVerified}
      title="Schedule 8 Re-authentication"
      description="Schedule 8 prescribing requires fresh verification (PRES-7 / DH-4155 §3). Please confirm your identity to continue."
    />
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        {defaultClozapine ? 'Prescribe Clozapine' : defaultLai ? 'Prescribe LAI Medication' : 'Prescribe Medication'}
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {/* Drug Search — RxNorm */}
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              freeSolo
              options={drugResults ?? []}
              getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
              loading={searchLoading}
              inputValue={searchInput}
              onInputChange={(_, v) => setSearchInput(v)}
              onChange={handleDrugSelect}
              renderOption={(props, opt) => (
                <Box component="li" {...props} key={opt.rxcui} sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={500}>{opt.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{opt.tty} — RxCUI: {opt.rxcui}</Typography>
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Search Medication (RxNorm / PBS) *" size="small" placeholder="Type drug name... e.g. olanzapine, paliperidone"
                  slotProps={{ input: { ...params.InputProps, startAdornment: <SearchIcon sx={{ color: 'text.disabled', mr: 0.5, fontSize: 18 }} /> } }} />
              )}
            />
          </Grid>

          {/* PBS Streamlined Codes */}
          {pbsCodes.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" sx={{ py: 0.5, '& .MuiAlert-message': { fontSize: 12 } }}>
                <strong>PBS Streamlined Codes:</strong>{' '}
                {pbsCodes.map((c, i) => (
                  <Chip key={i} label={`${c.code} — ${c.restriction}`} size="small"
                    onClick={() => { setPbsAuthority('Streamlined Authority'); setStreamlinedCode(c.code); setIndication(c.restriction); }}
                    sx={{ fontSize: 10, mr: 0.5, cursor: 'pointer', bgcolor: streamlinedCode === c.code ? '#E3F2FD' : undefined }} />
                ))}
              </Alert>
            </Grid>
          )}

          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Medication Name *" fullWidth size="small" value={medication} onChange={e => setMedication(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Generic Name" fullWidth size="small" value={genericName} onChange={e => setGenericName(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Indication" fullWidth size="small" value={indication} onChange={e => setIndication(e.target.value)}
              placeholder="e.g. Schizophrenia, Major depressive disorder"
              helperText={pbsCodes.length > 0 ? 'Auto-populated from PBS authority code. Edit if needed.' : 'Enter the clinical indication for this medication.'} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Dose *" fullWidth size="small" value={dose} onChange={e => setDose(e.target.value)} placeholder="e.g. 10mg" /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small"><InputLabel>Route</InputLabel>
              <Select value={route} onChange={e => setRoute(e.target.value)} label="Route">
                {PRESCRIBING_ROUTES.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small"><InputLabel>Frequency</InputLabel>
              <Select value={frequency} onChange={e => setFrequency(e.target.value)} label="Frequency">
                {PRESCRIBING_FREQUENCIES.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}><TextField label="Quantity" fullWidth size="small" value={quantity} onChange={e => setQuantity(e.target.value)} /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><TextField label="Repeats" fullWidth size="small" value={repeats} onChange={e => setRepeats(e.target.value)} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small"><InputLabel>PBS Authority</InputLabel>
              <Select value={pbsAuthority} onChange={e => setPbsAuthority(e.target.value)} label="PBS Authority">
                {PBS_AUTHORITIES.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          {(pbsAuthority === 'Streamlined Authority' || pbsAuthority === 'Phone Authority') && (
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Authority/Streamlined Code" fullWidth size="small" value={streamlinedCode} onChange={e => setStreamlinedCode(e.target.value)} /></Grid>
          )}
          {frequency === 'Custom' && (
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Custom Frequency" fullWidth size="small" placeholder="e.g. Every 5 weeks" /></Grid>
          )}
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel control={<Switch size="small" checked={isLai} onChange={(_, v) => setIsLai(v)} />} label={<Typography variant="body2">LAI</Typography>} />
              <FormControlLabel control={<Switch size="small" checked={isS8} onChange={(_, v) => setIsS8(v)} />} label={<Typography variant="body2">Schedule 8</Typography>} />
              <FormControlLabel control={<Switch size="small" checked={isClozapine} onChange={(_, v) => setIsClozapine(v)} />} label={<Typography variant="body2">Clozapine</Typography>} />
              <FormControlLabel control={<Switch size="small" />} label={<Typography variant="body2">Private Script</Typography>} />
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small"><InputLabel>Prescription Setting</InputLabel>
              <Select value="outpatient" label="Prescription Setting">
                <MenuItem value="outpatient">Outpatient</MenuItem>
                <MenuItem value="inpatient">Inpatient (Hospital)</MenuItem>
                <MenuItem value="discharge">Discharge</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Authority Number" fullWidth size="small" /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="eRx Token" fullWidth size="small" placeholder="For electronic prescribing" /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Pharmacy" fullWidth size="small" placeholder="Preferred pharmacy" /></Grid>
          <Grid size={{ xs: 12 }}><TextField label="Instructions" fullWidth size="small" multiline rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Patient directions e.g. Take with food, avoid alcohol" /></Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="outlined" sx={{ borderColor: '#327C8D', color: '#327C8D' }} disabled={!medication.trim() || !dose.trim()} onClick={() => {
          if (!onPrintPrescription) return;
          const medRow: MedicationRow = { id: '', medicationName: medication, genericName: genericName || null, dose, frequency, route: route.toLowerCase(), status: 'active', isLai, isClozapine, isS8, laiFrequency: null, laiNextDue: null, laiLastAdmin: null, prescribedAt: null, prescriber: null, createdAt: new Date().toISOString(), quantity: quantity ? parseInt(quantity, 10) : null, repeats: repeats ? parseInt(repeats, 10) : null, pbsCode: streamlinedCode || null };
          onPrintPrescription(medRow);
        }}>Print Prescription</Button>
        <Button variant="contained" disabled={!medication.trim() || !dose.trim() || saving} onClick={handleSave}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Prescribe & Save'}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
