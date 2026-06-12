// apps/web/src/features/medications/components/MedHistoryPanel.tsx
//
// BUG-524-E — extracted from MedicationsTab.tsx (was L375-596) per the
// hybrid 2-tab split plan. Medication-history surface + AI summary +
// duration-label helper + medication-category inference. Imported by
// MedicationHistoryTab as the History sub-section (read-only past
// medications context).

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Paper,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Typography
} from '@mui/material';
import React from 'react';
import { useMemo, useState } from 'react';
import { llmAiJobsApi } from '../../../shared/services/llmAiJobsApi';
import { getIndicationDisplay } from './PrescribeDialog';
import type { MedicationRow } from '../types';


// Infer broad medication category from name keywords
export function inferMedCategory(name: string): string {
  const n = name.toLowerCase();
  if (/clozapine|olanzapine|quetiapine|risperidone|aripiprazole|paliperidone|ziprasidone|haloperidol|chlorpromazine|amisulpride|lurasidone|asenapine/.test(n)) return 'Antipsychotic';
  if (/sertraline|fluoxetine|escitalopram|citalopram|paroxetine|fluvoxamine|venlafaxine|desvenlafaxine|duloxetine|mirtazapine|amitriptyline|nortriptyline|bupropion|moclobemide/.test(n)) return 'Antidepressant';
  if (/lithium|valproate|lamotrigine|carbamazepine|oxcarbazepine/.test(n)) return 'Mood Stabiliser';
  if (/diazepam|lorazepam|clonazepam|alprazolam|midazolam|nitrazepam|temazepam/.test(n)) return 'Benzodiazepine';
  if (/zopiclone|zolpidem|melatonin/.test(n)) return 'Hypnotic';
  if (/methylphenidate|dexamphetamine|lisdexamfetamine|atomoxetine/.test(n)) return 'Stimulant / ADHD';
  if (/metformin|insulin|glipizide|sitagliptin/.test(n)) return 'Metabolic / Diabetes';
  if (/atorvastatin|rosuvastatin|simvastatin/.test(n)) return 'Lipid-lowering';
  if (/naltrexone|buprenorphine|methadone|acamprosate/.test(n)) return 'Addiction Medicine';
  if (/procyclidine|benztropine|biperiden/.test(n)) return 'Anticholinergic';
  if (/propranolol|atenolol|metoprolol/.test(n)) return 'Beta-blocker';
  return 'Other';
}

export function durationLabel(startStr: string | null, endStr: string | null, isActive: boolean): string {
  const start = startStr ? new Date(startStr) : null;
  if (!start) return '—';
  const end = isActive ? new Date() : (endStr ? new Date(endStr) : new Date());
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (days < 0) return '—';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}wk`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}yr`;
}

interface MedHistoryPanelProps { rows: MedicationRow[]; allMeds: MedicationRow[]; patientId: string }
export function MedHistoryPanel({ rows, allMeds, patientId }: MedHistoryPanelProps) {
  const [aiSummary, setAiSummary] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Group allMeds by medication name for longitudinal view
  const longitudinal = useMemo(() => {
    const map = new Map<string, MedicationRow[]>();
    for (const m of allMeds) {
      const key = (m.genericName || m.medicationName).toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    // Sort by category then name
    return Array.from(map.entries())
      .filter(([, meds]) => meds.length > 0)
      .map(([, meds]) => ({
        name: meds[0].medicationName,
        genericName: meds[0].genericName,
        category: inferMedCategory(meds[0].medicationName),
        trials: meds.sort((a, b) => new Date(a.prescribedAt ?? a.createdAt ?? 0).getTime() - new Date(b.prescribedAt ?? b.createdAt ?? 0).getTime()),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [allMeds]);

  // Group by category for display
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof longitudinal>();
    for (const item of longitudinal) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return map;
  }, [longitudinal]);

  const generateSummary = async () => {
    setGenerating(true);
    try {
      const medList = allMeds.map(m =>
        `${m.medicationName} ${m.dose} ${m.frequency} (${m.route}) — ${m.status}${m.prescribedAt ? `, prescribed ${m.prescribedAt}` : ''}`
      ).join('\n');
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'med-summary',
        data: `Generate a concise clinical medication history summary for this patient's medications:\n\n${medList}\n\nInclude: current medications, recent changes, ceased medications, and any notable patterns (polypharmacy, frequent changes, etc). Use Australian clinical terminology. Be concise and factual.`,
        patientId,
        enhance: false,
      });
      setAiSummary(result);
    } catch {
      setAiSummary('(AI summary unavailable — ensure local Ollama is running)');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Box>
      {/* Longitudinal Medication Summary */}
      <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Longitudinal Medication Summary ({allMeds.length} total)
      </Typography>
      {allMeds.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>No medication history recorded.</Alert>
      ) : (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 3 }}>
          {Array.from(byCategory.entries()).map(([category, items]) => (
            <React.Fragment key={category}>
              <Box sx={{ px: 2, py: 1, bgcolor: '#F5F5F5', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, color: '#3D484B' }}>{category}</Typography>
                <Chip label={items.length} size="small" sx={{ fontSize: 9, height: 16, ml: 0.5 }} />
              </Box>
              <Table size="small">
                <TableBody>
                  {items.map(item => (
                    item.trials.map((m, idx) => (
                      <TableRow key={m.id} hover sx={{ opacity: m.status === 'active' || m.status === 'tapering' ? 1 : 0.7 }}>
                        {idx === 0 ? (
                          <TableCell rowSpan={item.trials.length} sx={{ verticalAlign: 'top', borderRight: '1px solid', borderColor: 'divider', minWidth: 160, py: 1.5 }}>
                            <Typography variant="body2" fontWeight={600}>{item.name}</Typography>
                            {item.genericName && <Typography variant="caption" color="text.secondary" display="block">{item.genericName}</Typography>}
                            {item.trials.length > 1 && <Chip label={`${item.trials.length} trials`} size="small" sx={{ fontSize: 9, height: 16, mt: 0.5, bgcolor: '#E3F2FD', color: '#1565C0' }} />}
                          </TableCell>
                        ) : null}
                        <TableCell sx={{ minWidth: 80 }}>{m.dose}</TableCell>
                        <TableCell sx={{ minWidth: 100 }}>{m.frequency}</TableCell>
                        <TableCell sx={{ minWidth: 90 }}>
                          {(m.prescribedAt ?? m.createdAt) ? new Date(m.prescribedAt ?? m.createdAt).toLocaleDateString('en-AU') : '—'}
                        </TableCell>
                        <TableCell sx={{ minWidth: 70 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ color: m.status === 'active' ? '#2E7D32' : '#757575' }}>
                            {durationLabel(m.prescribedAt ?? m.createdAt, null, m.status === 'active' || m.status === 'tapering')}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={m.status} size="small"
                            color={m.status === 'active' ? 'success' : m.status === 'tapering' ? 'warning' : 'default'}
                            sx={{ fontSize: 10, textTransform: 'capitalize' }} />
                        </TableCell>
                      </TableRow>
                    ))
                  ))}
                </TableBody>
              </Table>
            </React.Fragment>
          ))}
        </Paper>
      )}

      {/* AI Narrative Summary */}
      <Card variant="outlined" sx={{ mb: 2, borderColor: '#b8621a', borderLeft: '4px solid #b8621a' }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 18 }} />
              <Typography variant="subtitle2" fontWeight={600}>AI Narrative Summary</Typography>
              <Chip label="AI" size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontSize: 9, height: 18 }} />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {aiSummary && !editingSummary && (
                <Button size="small" startIcon={<EditIcon sx={{ fontSize: 14 }} />} onClick={() => setEditingSummary(true)} sx={{ fontSize: 10, color: '#327C8D' }}>Edit</Button>
              )}
              <Button size="small" startIcon={generating ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                onClick={generateSummary} disabled={generating || !allMeds.length}
                sx={{ fontSize: 10, color: '#b8621a' }}>
                {generating ? 'Generating...' : aiSummary ? 'Regenerate' : 'Generate Summary'}
              </Button>
            </Box>
          </Box>
          {editingSummary ? (
            <Box>
              <TextField fullWidth multiline rows={5} value={aiSummary} onChange={e => setAiSummary(e.target.value)}
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setEditingSummary(false)} sx={{ color: '#327C8D' }}>Done Editing</Button>
              </Box>
            </Box>
          ) : aiSummary ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#3D484B', bgcolor: '#FAFAFA', p: 1.5, borderRadius: 1 }}>
              {aiSummary}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
              Click "Generate Summary" for an AI-powered narrative of this patient's medication history, patterns and changes.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Ceased Medications Table */}
      <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Ceased / Inactive Medications ({rows.length})
      </Typography>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer role="region" aria-label="Data table">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Medication', 'Dose', 'Frequency', 'Route', 'Prescribed', 'Flags', 'Status'].map(c => (
                  <TableCell key={c} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12 }}>{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows.length ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3 }}><Typography variant="body2" color="text.secondary">No ceased medications</Typography></TableCell></TableRow>
              ) : rows.map(m => (
                <TableRow key={m.id} hover sx={{ opacity: 0.7 }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{m.medicationName}</Typography>
                    {m.genericName && <Typography variant="caption" color="text.secondary" display="block">{m.genericName}</Typography>}
                    {getIndicationDisplay(m) && <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: '#1565C0', fontStyle: 'italic' }}>For: {getIndicationDisplay(m)}</Typography>}
                  </TableCell>
                  <TableCell>{m.dose}</TableCell>
                  <TableCell>{m.frequency}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{m.route}</TableCell>
                  <TableCell>{m.prescribedAt ? new Date(m.prescribedAt).toLocaleDateString('en-AU') : new Date(m.createdAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {m.isLai && <Chip label="LAI" size="small" sx={{ bgcolor: '#E3F2FD', color: '#1565C0', fontSize: 10, fontWeight: 700 }} />}
                      {m.isS8 && <Chip label="S8" size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontSize: 10, fontWeight: 700 }} />}
                    </Box>
                  </TableCell>
                  <TableCell><Chip label={m.status} size="small" sx={{ textTransform: 'capitalize', fontSize: 11 }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
