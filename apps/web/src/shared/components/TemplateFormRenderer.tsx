/**
 * Template Form Renderer
 *
 * Dynamically renders template fields as interactive UI components:
 * - heading       → Section header
 * - instruction   → Instruction text (info box)
 * - text_block    → Read-only reference text
 * - short_answer  → Text input
 * - yes_no        → Toggle buttons (Yes/No)
 * - multiple_choice → Radio-style chip selection (single)
 * - multi_select  → Checkbox-style chip selection (multi)
 * - likert        → Slider with labeled marks + chip quick-select
 * - score         → Auto-calculated score display with severity badge
 *
 * Used in Rating Scale dialog, Assessment forms, etc.
 */
import { useCallback } from 'react';
import {
  Alert, Box, Chip, Paper, Slider, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { DrawingFieldCanvas } from './DrawingFieldCanvas';
import { describeDrawingFieldForText } from './drawingField';

// ── Types ──

export interface TemplateField {
  /**
   * 'drawing' (P-CLAUDE-LANE 4B): tablet capture used by MMSE
   * intersecting pentagons + MoCA cube / clock items. The stored value
   * is a serialised DrawingPayload (see
   * packages/shared/src/drawingPayload.ts) in the FormValues string
   * slot. The renderer round-trips via the canonical helpers
   * tryParseDrawingPayload / serializeDrawingPayload. Not scorable
   * (isScorableField excludes it). formValuesToText emits a
   * "[drawing captured]" / "[drawing not captured]" marker via
   * describeDrawingFieldForText so the exported clinical record
   * carries the signal without embedding the raw strokes.
   */
  type: 'heading' | 'instruction' | 'text_block' | 'short_answer' | 'yes_no' |
        'multiple_choice' | 'multi_select' | 'likert' | 'score' | 'drawing';
  label?: string;
  text?: string;
  min?: number;
  max?: number;
  options?: string[];
  formula?: 'sum' | 'mean';
  // Optional list of field indexes to include in score/subscale calculations.
  // Indexes are 0-based and refer to this template's field array.
  itemIndexes?: number[];
  ranges?: Array<{ min: number; max: number; label: string }>;
}

export interface FormValues {
  [fieldIndex: string]: string | number | string[];
}

interface TemplateFormRendererProps {
  fields: TemplateField[];
  values: FormValues;
  onChange: (values: FormValues) => void;
  readOnly?: boolean;
}

function isScorableField(field: TemplateField): boolean {
  return field.type === 'likert' || field.type === 'yes_no';
}

function getScorableIndexes(fields: TemplateField[]): number[] {
  const out: number[] = [];
  fields.forEach((field, index) => {
    if (isScorableField(field)) out.push(index);
  });
  return out;
}

function sanitizeScoreIndexes(fields: TemplateField[], rawIndexes?: number[]): number[] {
  if (!rawIndexes || rawIndexes.length === 0) return [];
  const scorable = new Set(getScorableIndexes(fields));
  return rawIndexes.filter((idx) => Number.isInteger(idx) && scorable.has(idx));
}

function computeScoreForField(
  fields: TemplateField[],
  values: FormValues,
  scoreField?: TemplateField,
): {
  score: number;
  sum: number;
  count: number;
  itemIndexes: number[];
  itemScores: Record<string, number>;
} {
  const scopedIndexes = sanitizeScoreIndexes(fields, scoreField?.itemIndexes);
  const indexes = scopedIndexes.length > 0 ? scopedIndexes : getScorableIndexes(fields);
  let sum = 0;
  let count = 0;
  const itemScores: Record<string, number> = {};

  indexes.forEach((fieldIndex) => {
    const value = values[String(fieldIndex)];
    if (typeof value !== 'number') return;
    const itemLabel = fields[fieldIndex]?.label ?? `Item ${fieldIndex + 1}`;
    itemScores[itemLabel] = value;
    sum += value;
    count += 1;
  });

  const formula = scoreField?.formula ?? 'sum';
  const score = formula === 'mean' && count > 0 ? sum / count : sum;
  return { score, sum, count, itemIndexes: indexes, itemScores };
}

export function TemplateFormRenderer({ fields, values, onChange, readOnly = false }: TemplateFormRendererProps) {
  const setValue = useCallback((idx: number, val: string | number | string[]) => {
    onChange({ ...values, [String(idx)]: val });
  }, [values, onChange]);

  return (
    <Box>
      {fields.map((field, idx) => (
        <FieldRenderer
          key={idx}
          fields={fields}
          values={values}
          field={field}
          index={idx}
          value={values[String(idx)]}
          onValueChange={(v) => setValue(idx, v)}
          readOnly={readOnly}
        />
      ))}
    </Box>
  );
}

// ── Individual field renderer ──

function FieldRenderer({
  fields, values, field, index, value, onValueChange, readOnly,
}: {
  fields: TemplateField[];
  values: FormValues;
  field: TemplateField;
  index: number;
  value: string | number | string[] | undefined;
  onValueChange: (v: string | number | string[]) => void;
  readOnly: boolean;
}) {
  switch (field.type) {
    // ── Section Heading ──
    case 'heading':
      return (
        <Box sx={{ mt: index > 0 ? 2.5 : 0, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif"
            sx={{ color: '#327C8D', borderBottom: '2px solid #327C8D', pb: 0.5 }}>
            {field.text || field.label}
          </Typography>
        </Box>
      );

    // ── Instruction Text ──
    case 'instruction':
      return (
        <Alert severity="info" sx={{ my: 1, fontSize: 12, py: 0.5, '& .MuiAlert-message': { fontSize: 12 } }} icon={false}>
          <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {field.text || field.label}
          </Typography>
        </Alert>
      );

    // ── Reference Text Block ──
    case 'text_block':
      return (
        <Paper variant="outlined" sx={{ p: 1.5, my: 1, bgcolor: '#faf8f5' }}>
          <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
            {field.text || field.label}
          </Typography>
        </Paper>
      );

    // ── Short Answer ──
    case 'short_answer':
      return (
        <Box sx={{ my: 1.5 }}>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5, fontSize: 13 }}>
            {field.label}
          </Typography>
          <TextField
            fullWidth size="small" multiline rows={2}
            value={typeof value === 'string' ? value : ''}
            onChange={e => onValueChange(e.target.value)}
            disabled={readOnly}
            sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
          />
        </Box>
      );

    // ── Yes / No ──
    case 'yes_no':
      return (
        <Box sx={{ my: 1, display: 'flex', alignItems: 'center', gap: 2, py: 0.5, borderBottom: '1px solid #f0ebe4' }}>
          <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>{field.label}</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={value === 1 ? 'yes' : value === 0 ? 'no' : null}
            onChange={(_, v) => { if (v !== null) onValueChange(v === 'yes' ? 1 : 0); }}
            disabled={readOnly}
          >
            <ToggleButton value="yes" sx={{ fontSize: 11, px: 2, py: 0.5, textTransform: 'none',
              '&.Mui-selected': { bgcolor: '#E8F5E9', color: '#2E7D32' } }}>Yes</ToggleButton>
            <ToggleButton value="no" sx={{ fontSize: 11, px: 2, py: 0.5, textTransform: 'none',
              '&.Mui-selected': { bgcolor: '#FFEBEE', color: '#D32F2F' } }}>No</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      );

    // ── Multiple Choice (single select) ──
    case 'multiple_choice':
      return (
        <Box sx={{ my: 1.5 }}>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 0.75, fontSize: 13 }}>
            {field.label}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {(field.options ?? []).map((opt, i) => {
              const isSelected = value === opt || value === i;
              return (
                <Chip
                  key={i}
                  label={opt}
                  size="small"
                  onClick={readOnly ? undefined : () => onValueChange(opt)}
                  variant={isSelected ? 'filled' : 'outlined'}
                  sx={{
                    fontSize: 11, cursor: readOnly ? 'default' : 'pointer',
                    bgcolor: isSelected ? '#327C8D' : 'transparent',
                    color: isSelected ? '#fff' : 'text.primary',
                    borderColor: isSelected ? '#327C8D' : 'divider',
                    '&:hover': readOnly ? {} : { bgcolor: isSelected ? '#265f6d' : '#f0ebe4' },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      );

    // ── Multi Select (checkbox style) ──
    case 'multi_select': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <Box sx={{ my: 1.5 }}>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 0.75, fontSize: 13 }}>
            {field.label} <Typography component="span" variant="caption" color="text.secondary">(select all that apply)</Typography>
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {(field.options ?? []).map((opt, i) => {
              const isSelected = selected.includes(opt);
              return (
                <Chip
                  key={i}
                  label={opt}
                  size="small"
                  onClick={readOnly ? undefined : () => {
                    const next = isSelected ? selected.filter(s => s !== opt) : [...selected, opt];
                    onValueChange(next);
                  }}
                  variant={isSelected ? 'filled' : 'outlined'}
                  sx={{
                    fontSize: 11, cursor: readOnly ? 'default' : 'pointer',
                    bgcolor: isSelected ? '#b8621a' : 'transparent',
                    color: isSelected ? '#fff' : 'text.primary',
                    borderColor: isSelected ? '#b8621a' : 'divider',
                    '&:hover': readOnly ? {} : { bgcolor: isSelected ? '#d6741f' : '#f0ebe4' },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      );
    }

    // ── Likert Scale ──
    case 'likert': {
      const min = field.min ?? 0;
      const max = field.max ?? 4;
      const currentVal = typeof value === 'number' ? value : min;
      const hasOptions = field.options && field.options.length > 0;
      const range = max - min;
      const markStep = range > 20 ? (range >= 100 ? 10 : 5) : 1;
      const marks = hasOptions
        ? field.options!.map((opt, i) => {
            const numMatch = opt.match(/\((\d+)\)/);
            const val = numMatch ? parseInt(numMatch[1], 10) : min + i;
            return { value: val, label: '' };
          })
        : Array.from({ length: Math.floor(range / markStep) + 1 }, (_, i) => {
            const val = min + i * markStep;
            return { value: val, label: String(val) };
          });

      return (
        <Box sx={{ my: 1, py: 1, borderBottom: '1px solid #f0ebe4' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={500} sx={{ fontSize: 13, mb: 0.5 }}>
                {field.label}
              </Typography>
              {/* Quick-select chips for each option */}
              {hasOptions && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
                  {field.options!.map((opt, i) => {
                    const numMatch = opt.match(/\((\d+)\)/);
                    const chipVal = numMatch ? parseInt(numMatch[1], 10) : min + i;
                    const isSelected = currentVal === chipVal;
                    return (
                      <Chip
                        key={i}
                        label={opt}
                        size="small"
                        onClick={readOnly ? undefined : () => onValueChange(chipVal)}
                        variant={isSelected ? 'filled' : 'outlined'}
                        sx={{
                          fontSize: 10, height: 24, cursor: readOnly ? 'default' : 'pointer',
                          bgcolor: isSelected ? getLikertColor(chipVal, min, max) : 'transparent',
                          color: isSelected ? '#fff' : 'text.secondary',
                          borderColor: isSelected ? getLikertColor(chipVal, min, max) : '#e0dbd4',
                          '&:hover': readOnly ? {} : { borderColor: getLikertColor(chipVal, min, max) },
                        }}
                      />
                    );
                  })}
                </Box>
              )}
              {/* Slider */}
              {!hasOptions && (
                <Slider
                  value={currentVal}
                  onChange={(_, v) => !readOnly && onValueChange(v as number)}
                  min={min} max={max} step={1}
                  marks={marks}
                  disabled={readOnly}
                  sx={{ color: getLikertColor(currentVal, min, max), ml: 1, mr: 1 }}
                />
              )}
            </Box>
            <Box sx={{ minWidth: 40, textAlign: 'center', pt: 0.5 }}>
              <Typography variant="h6" fontWeight={800}
                sx={{ color: getLikertColor(currentVal, min, max), lineHeight: 1 }}>
                {currentVal}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>
                /{max}
              </Typography>
            </Box>
          </Box>
        </Box>
      );
    }

    // ── Drawing (tablet capture; MMSE pentagons + MoCA cube/clock) ──
    case 'drawing':
      return (
        <DrawingFieldCanvas
          label={field.label}
          value={value}
          onValueChange={(next) => onValueChange(next)}
          readOnly={readOnly}
        />
      );

    // ── Calculated Score ──
    case 'score': {
      const scoped = computeScoreForField(fields, values, field);
      const scoreVal = scoped.score;
      const displayScore = field.formula === 'mean' ? scoreVal.toFixed(2) : scoreVal;
      const severity = field.ranges?.find(r => scoreVal >= r.min && scoreVal <= r.max);
      const severityColor = severity
        ? getSeverityColor(severity.label)
        : '#327C8D';

      return (
        <Paper sx={{ my: 2, p: 2, bgcolor: '#f8f6f3', border: '2px solid', borderColor: severityColor + '40' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ fontSize: 11 }}>
                {field.label}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
                <Typography variant="h3" fontWeight={800} sx={{ color: severityColor, lineHeight: 1 }}>
                  {displayScore}
                </Typography>
                {severity && (
                  <Chip
                    label={severity.label}
                    sx={{ bgcolor: severityColor, color: '#fff', fontWeight: 700, fontSize: 12 }}
                  />
                )}
              </Box>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {scoped.count} items rated
              </Typography>
              {field.ranges && (
                <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {field.ranges.map((r, i) => (
                    <Typography key={i} variant="caption" sx={{
                      fontSize: 10,
                      color: scoreVal >= r.min && scoreVal <= r.max ? severityColor : 'text.disabled',
                      fontWeight: scoreVal >= r.min && scoreVal <= r.max ? 700 : 400,
                    }}>
                      {r.min}-{r.max}: {r.label}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        </Paper>
      );
    }

    default:
      return null;
  }
}

// ── Helpers ──

function getLikertColor(value: number, min: number, max: number): string {
  const ratio = max > min ? (value - min) / (max - min) : 0;
  if (ratio <= 0.25) return '#4CAF50';  // Green — low/none
  if (ratio <= 0.5) return '#FFC107';   // Amber — mild
  if (ratio <= 0.75) return '#b8621a';  // Orange — moderate
  return '#D32F2F';                      // Red — severe
}

function getSeverityColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('normal') || l.includes('minimal') || l.includes('absent') || l.includes('low') || l.includes('well') || l.includes('remission') || l.includes('no problem') || l.includes('below')) return '#4CAF50';
  if (l.includes('mild') || l.includes('minor') || l.includes('borderline') || l.includes('hazardous')) return '#FFC107';
  if (l.includes('moderate')) return '#b8621a';
  if (l.includes('severe') || l.includes('extreme') || l.includes('high') || l.includes('dependence') || l.includes('probable') || l.includes('substantial')) return '#D32F2F';
  return '#327C8D';
}

// ── Utility: Convert form values to plain text for saving ──
export function formValuesToText(fields: TemplateField[], values: FormValues): string {
  const lines: string[] = [];
  let aggregateSum = 0;
  let aggregateCount = 0;

  fields.forEach((f, i) => {
    const v = values[String(i)];
    switch (f.type) {
      case 'heading':
        lines.push(`\n=== ${f.text || f.label} ===`);
        break;
      case 'instruction':
        break; // Skip instructions in output
      case 'text_block':
        break; // Skip reference text
      case 'short_answer':
        lines.push(`${f.label}: ${typeof v === 'string' ? v : ''}`);
        break;
      case 'yes_no':
        lines.push(`${f.label}: ${v === 1 ? 'Yes' : v === 0 ? 'No' : 'Not answered'}`);
        if (typeof v === 'number') { aggregateSum += v; aggregateCount++; }
        break;
      case 'multiple_choice':
        lines.push(`${f.label}: ${v ?? 'Not selected'}`);
        break;
      case 'multi_select':
        lines.push(`${f.label}: ${Array.isArray(v) ? v.join(', ') : 'None selected'}`);
        break;
      case 'drawing': {
        const state = describeDrawingFieldForText(v);
        lines.push(
          `${f.label}: ${state === 'captured' ? '[drawing captured]' : '[drawing not captured]'}`,
        );
        break;
      }
      case 'likert': {
        const score = typeof v === 'number' ? v : (f.min ?? 0);
        const optLabel = f.options?.find(o => {
          const m = o.match(/\((\d+)\)/);
          return m && parseInt(m[1], 10) === score;
        });
        lines.push(`${f.label}: ${score}${optLabel ? ` — ${optLabel.replace(/\s*\(\d+\)\s*/, '')}` : ''}`);
        if (typeof v === 'number') { aggregateSum += v; aggregateCount++; }
        break;
      }
      case 'score': {
        const scoped = computeScoreForField(fields, values, f);
        const scoreVal = scoped.score;
        const fallbackScoreVal = f.formula === 'mean' ? (aggregateCount > 0 ? aggregateSum / aggregateCount : 0) : aggregateSum;
        const resolvedScore = Number.isFinite(scoreVal) ? scoreVal : fallbackScoreVal;
        const severity = f.ranges?.find(r => resolvedScore >= r.min && resolvedScore <= r.max);
        lines.push(`\n${f.label}: ${f.formula === 'mean' ? resolvedScore.toFixed(2) : resolvedScore}${severity ? ` — ${severity.label}` : ''}`);
        break;
      }
    }
  });

  return lines.filter(l => l !== undefined).join('\n').trim();
}

// ── Utility: Extract structured score data for saving ──
export function extractScoreData(fields: TemplateField[], values: FormValues): {
  totalScore: number;
  itemScores: Record<string, number>;
  severity?: string;
  itemCount: number;
  scoreBreakdowns: Array<{
    label: string;
    score: number;
    formula: 'sum' | 'mean';
    severity?: string;
    itemCount: number;
    itemIndexes: number[];
  }>;
} {
  const overall = computeScoreForField(fields, values);
  const allItemScores = overall.itemScores;

  const scoreFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.type === 'score');

  const scoreBreakdowns = scoreFields.map(({ field, index }) => {
    const scoped = computeScoreForField(fields, values, field);
    const severity = field.ranges?.find((r) => scoped.score >= r.min && scoped.score <= r.max)?.label;
    return {
      label: field.label ?? `Score ${index + 1}`,
      score: scoped.score,
      formula: field.formula ?? 'sum',
      severity,
      itemCount: scoped.count,
      itemIndexes: scoped.itemIndexes,
    };
  });

  const totalBreakdown =
    scoreBreakdowns.find((b) => b.label.toLowerCase().includes('total'))
    ?? scoreBreakdowns[0];
  const totalScore = totalBreakdown ? totalBreakdown.score : overall.sum;
  const severity = totalBreakdown?.severity;
  const itemCount = totalBreakdown?.itemCount ?? overall.count;

  return {
    totalScore,
    itemScores: allItemScores,
    severity,
    itemCount,
    scoreBreakdowns,
  };
}
