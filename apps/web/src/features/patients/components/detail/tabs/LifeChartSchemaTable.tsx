import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import type { LifeChartSchemaDoc, LifeChartSchemaRow } from './lifeChartSchemaDomain';
import { createEmptySchemaRow } from './lifeChartSchemaDomain';

interface LifeChartSchemaTableProps {
  schemaDoc: LifeChartSchemaDoc;
  onChange: (next: LifeChartSchemaDoc) => void;
  onGenerateAi: () => Promise<void> | void;
  onSave: () => Promise<void> | void;
  onResetHeuristic: () => void;
  generatingAi: boolean;
  saving: boolean;
  error: string;
  info: string;
}

type EditableHeaderKey =
  | 'disorderLabel'
  | 'primaryDomain'
  | 'baselineLabel'
  | 'symptomMode'
  | 'clinicTimeZone'
  | 'chronology';

function cellSx(): Record<string, unknown> {
  return { py: 0.75, px: 0.75, borderColor: '#EEE' };
}

function inputSx(multiline = false): Record<string, unknown> {
  return {
    minWidth: multiline ? 180 : 120,
    '& .MuiInputBase-input': { fontSize: 11, py: multiline ? 0.8 : 0.6 },
  };
}

export function LifeChartSchemaTable({
  schemaDoc,
  onChange,
  onGenerateAi,
  onSave,
  onResetHeuristic,
  generatingAi,
  saving,
  error,
  info,
}: LifeChartSchemaTableProps): React.ReactElement {
  const rows = schemaDoc.rows;
  const markManualUpdate = (doc: LifeChartSchemaDoc): LifeChartSchemaDoc => ({
    ...doc,
    generatedBy: 'manual',
    updatedAt: new Date().toISOString(),
    audit: {
      ...doc.audit,
      lastEditedAt: new Date().toISOString(),
      lastEditedByMode: 'manual',
      manualEditCount: (doc.audit?.manualEditCount ?? 0) + 1,
    },
  });

  const updateHeader = (key: EditableHeaderKey, value: string): void => {
    onChange(markManualUpdate({
      ...schemaDoc,
      [key]: value,
    }));
  };

  const updateRow = (id: string, patch: Partial<LifeChartSchemaRow>): void => {
    onChange(markManualUpdate({
      ...schemaDoc,
      rows: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = (): void => {
    onChange(markManualUpdate({
      ...schemaDoc,
      rows: [
        ...rows,
        createEmptySchemaRow({
          intervalLabel: `Interval ${rows.length + 1}`,
          symptomChannel: schemaDoc.primaryDomain.includes('mood') ? 'depression' : 'general',
          primaryState: schemaDoc.baselineLabel || 'Baseline',
          primaryScore: 0,
        }),
      ],
    }));
  };

  const removeRow = (id: string): void => {
    onChange(markManualUpdate({
      ...schemaDoc,
      rows: rows.filter((r) => r.id !== id),
    }));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '4px solid #327C8D' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
        <TextField
          size="small"
          label="Disorder Focus"
          value={schemaDoc.disorderLabel}
          onChange={(e) => updateHeader('disorderLabel', e.target.value)}
          sx={{ minWidth: 230 }}
        />
        <TextField
          size="small"
          label="Primary Symptom Domain"
          value={schemaDoc.primaryDomain}
          onChange={(e) => updateHeader('primaryDomain', e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          label="Baseline Label"
          value={schemaDoc.baselineLabel}
          onChange={(e) => updateHeader('baselineLabel', e.target.value)}
          sx={{ minWidth: 240 }}
        />
        <TextField
          size="small"
          label="Mode"
          value={schemaDoc.symptomMode}
          onChange={(e) => updateHeader('symptomMode', e.target.value)}
          sx={{ width: 140 }}
          helperText="bidirectional | severity"
        />
        <TextField
          size="small"
          label="Clinic Timezone"
          value={schemaDoc.clinicTimeZone}
          onChange={(e) => updateHeader('clinicTimeZone', e.target.value)}
          sx={{ minWidth: 190 }}
          helperText="IANA zone"
        />
        <TextField
          size="small"
          label="Chronology"
          value={schemaDoc.chronology}
          onChange={(e) => updateHeader('chronology', e.target.value)}
          sx={{ minWidth: 160 }}
          helperText="most_recent_first | oldest_first"
        />
      </Stack>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
          Editable Textual Schema (Chart Source of Truth)
        </Typography>
        <Chip size="small" label={`rows: ${rows.length}`} sx={{ height: 18, fontSize: 10 }} />
        <Chip size="small" label={`source: ${schemaDoc.generatedBy}`} sx={{ height: 18, fontSize: 10 }} />
        <Chip size="small" label={`rev: ${schemaDoc.audit.revision}`} sx={{ height: 18, fontSize: 10 }} />
        <Chip size="small" label={`tz: ${schemaDoc.clinicTimeZone}`} sx={{ height: 18, fontSize: 10 }} />
        <Tooltip title="AI drafts schema JSON from clinical history. You can manually edit every field.">
          <Button
            size="small"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => void onGenerateAi()}
            disabled={generatingAi}
            sx={{ ml: 'auto', color: '#327C8D', textTransform: 'none' }}
          >
            {generatingAi ? 'Generating...' : 'Generate AI Schema'}
          </Button>
        </Tooltip>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={addRow}
          sx={{ color: '#327C8D', textTransform: 'none' }}
        >
          Add Row
        </Button>
        <Button
          size="small"
          onClick={onResetHeuristic}
          sx={{ color: '#6b7280', textTransform: 'none' }}
        >
          Reset Auto
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SaveOutlinedIcon />}
          onClick={() => void onSave()}
          disabled={saving}
          sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}
        >
          {saving ? 'Saving...' : 'Save Schema'}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {info && <Alert severity="info" sx={{ mb: 1 }}>{info}</Alert>}
      <Alert severity="warning" sx={{ mb: 1 }}>
        Governance: dates are clinic-local civil dates; same-channel overlaps are merged at save; medication bars are categorical timelines (not mg-comparable severity).
      </Alert>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 2400 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: '#FAFAFA' }}>
              <TableCell sx={cellSx()}>Time Interval</TableCell>
              <TableCell sx={cellSx()}>Symptom Channel</TableCell>
              <TableCell sx={cellSx()}>Symptom Onset</TableCell>
              <TableCell sx={cellSx()}>Onset Precision</TableCell>
              <TableCell sx={cellSx()}>Symptom Remission</TableCell>
              <TableCell sx={cellSx()}>Remission Precision</TableCell>
              <TableCell sx={cellSx()}>Date Certainty</TableCell>
              <TableCell sx={cellSx()}>Remission Status</TableCell>
              <TableCell sx={cellSx()}>Symptom / Severity State</TableCell>
              <TableCell sx={cellSx()}>Score (-4..4)</TableCell>
              <TableCell sx={cellSx()}>Active Medications & Dosages</TableCell>
              <TableCell sx={cellSx()}>Documented Life Events</TableCell>
              <TableCell sx={cellSx()}>Triggers</TableCell>
              <TableCell sx={cellSx()}>Interventions</TableCell>
              <TableCell sx={cellSx()}>Inter-episode Functioning</TableCell>
              <TableCell sx={cellSx()}>Substance Use Pattern</TableCell>
              <TableCell sx={cellSx()}>Hospitalisation / ACIS</TableCell>
              <TableCell sx={cellSx()}>Evidence Anchors</TableCell>
              <TableCell sx={cellSx()}>Notes</TableCell>
              <TableCell sx={cellSx()}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.intervalLabel}
                    onChange={(e) => updateRow(row.id, { intervalLabel: e.target.value })}
                    sx={inputSx()}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.symptomChannel}
                    onChange={(e) => updateRow(row.id, { symptomChannel: e.target.value as LifeChartSchemaRow['symptomChannel'] })}
                    sx={{ ...inputSx(), minWidth: 150 }}
                    helperText="mania_hypomania | depression | psychosis | anxiety_trauma | substance | functioning | general"
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    type="date"
                    value={row.startDate}
                    onChange={(e) => updateRow(row.id, { startDate: e.target.value })}
                    sx={inputSx()}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.startDatePrecision}
                    onChange={(e) => updateRow(row.id, { startDatePrecision: e.target.value as LifeChartSchemaRow['startDatePrecision'] })}
                    sx={{ width: 110, '& .MuiInputBase-input': { fontSize: 11, py: 0.6 } }}
                    helperText="day|month|year|unknown"
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    type="date"
                    value={row.endDate}
                    onChange={(e) => updateRow(row.id, { endDate: e.target.value })}
                    sx={inputSx()}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.endDatePrecision}
                    onChange={(e) => updateRow(row.id, { endDatePrecision: e.target.value as LifeChartSchemaRow['endDatePrecision'] })}
                    sx={{ width: 110, '& .MuiInputBase-input': { fontSize: 11, py: 0.6 } }}
                    helperText="day|month|year|unknown"
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.dateCertainty}
                    onChange={(e) => updateRow(row.id, { dateCertainty: e.target.value as LifeChartSchemaRow['dateCertainty'] })}
                    sx={{ width: 120, '& .MuiInputBase-input': { fontSize: 11, py: 0.6 } }}
                    helperText="exact|estimated|unknown"
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.remissionStatus}
                    onChange={(e) => updateRow(row.id, { remissionStatus: e.target.value as LifeChartSchemaRow['remissionStatus'] })}
                    sx={{ width: 120, '& .MuiInputBase-input': { fontSize: 11, py: 0.6 } }}
                    helperText="remitted|ongoing|unclear"
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    value={row.primaryState}
                    onChange={(e) => updateRow(row.id, { primaryState: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    type="number"
                    inputProps={{ min: -4, max: 4, step: 0.1 }}
                    value={row.primaryScore}
                    onChange={(e) => updateRow(row.id, { primaryScore: Number(e.target.value) })}
                    sx={{ width: 95, '& .MuiInputBase-input': { fontSize: 11, py: 0.6 } }}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.medications}
                    onChange={(e) => updateRow(row.id, { medications: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.lifeEvents}
                    onChange={(e) => updateRow(row.id, { lifeEvents: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.triggers}
                    onChange={(e) => updateRow(row.id, { triggers: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.interventions}
                    onChange={(e) => updateRow(row.id, { interventions: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.interEpisodeFunctioning}
                    onChange={(e) => updateRow(row.id, { interEpisodeFunctioning: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.substanceUse}
                    onChange={(e) => updateRow(row.id, { substanceUse: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.hospitalization}
                    onChange={(e) => updateRow(row.id, { hospitalization: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.provenance.evidenceAnchors.join('\n')}
                    onChange={(e) => updateRow(row.id, {
                      provenance: {
                        ...row.provenance,
                        evidenceAnchors: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .slice(0, 12),
                        confidence: row.provenance.confidence,
                      },
                    })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <TextField
                    size="small"
                    multiline
                    minRows={2}
                    value={row.notes}
                    onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                    sx={inputSx(true)}
                  />
                </TableCell>
                <TableCell sx={cellSx()}>
                  <IconButton size="small" onClick={() => removeRow(row.id)} aria-label="Delete row">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}
