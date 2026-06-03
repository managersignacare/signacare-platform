// apps/web/src/features/risk-allergies/components/RiskAssessmentForm.tsx
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useForm, Controller, type SubmitHandler, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRiskTemplates, useRiskTemplate, useCreateRiskAssessment } from '../hooks/useRisk';
import {
  CreateRiskAssessmentSchema,
  scoreToRiskLevel,
} from '../types/riskTypes';
import type { CreateRiskAssessmentDTO, RiskTemplateSection } from '../types/riskTypes';
import { RiskScoreGauge } from './RiskScoreGauge';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type SectionScores = Record<string, number[]>;

export const RiskAssessmentForm: React.FC<Props> = ({
  patientId,
  episodeId,
  onSuccess,
  onCancel,
}) => {
  const { data: templates, isLoading: templatesLoading } = useRiskTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const { data: template } = useRiskTemplate(selectedTemplateId);

  const [sectionScores, setSectionScores] = useState<SectionScores>({});

  const totalScore = Object.values(sectionScores).reduce(
    (sum, itemArr) => sum + itemArr.reduce((s, v) => s + v, 0),
    0,
  );
  const maxScore = template?.totalMax ?? 0;
  const derivedLevel = template ? scoreToRiskLevel(totalScore, maxScore) : 'low';

  const {
    control,
    handleSubmit,
    register,
    setValue,
    formState: { errors },
  } = useForm<CreateRiskAssessmentDTO>({
    resolver: zodResolver(CreateRiskAssessmentSchema) as Resolver<CreateRiskAssessmentDTO>,
    defaultValues: {
      patientId,
      episodeId,
      overallRiskLevel: 'low',
      assessmentDate:   new Date().toISOString().slice(0, 10),
      assessmentType:   '',
    },
  });

  const createMutation = useCreateRiskAssessment();

  useEffect(() => {
    if (!template) return;
    const init: SectionScores = {};
    for (const section of template.sections) {
      init[section.id] = section.items.map(() => 0);
    }
    setSectionScores(init);
    setValue('assessmentType', template.name);
    setValue('templateInstanceId', template.id);
  }, [template, setValue]);

  useEffect(() => {
    setValue('totalScore', totalScore);
    setValue('overallRiskLevel', derivedLevel);
  }, [totalScore, derivedLevel, setValue]);

  const handleItemChange = (
    sectionId: string,
    itemIndex: number,
    value: number,
  ) => {
    setSectionScores((prev) => {
      const arr = [...(prev[sectionId] ?? [])];
      arr[itemIndex] = value;
      return { ...prev, [sectionId]: arr };
    });
  };

  const onSubmit: SubmitHandler<CreateRiskAssessmentDTO> = (dto) => {
    createMutation.mutate(dto, { onSuccess });
  };

  const renderSection = (section: RiskTemplateSection, sIdx: number) => (
    <Box key={section.id} mb={2}>
      <Typography variant="subtitle2" fontWeight={700} mb={1}>
        {sIdx + 1}. {section.label}
        <Typography component="span" variant="caption" color="text.secondary" ml={1}>
          (max {section.maxScore})
        </Typography>
      </Typography>
      {section.items.map((item, iIdx) => (
        <Box key={item.id} mb={1.5} pl={2}>
          <Typography variant="body2" fontWeight={500}>
            {item.label}
          </Typography>
          {item.description && (
            <Typography variant="caption" color="text.secondary">
              {item.description}
            </Typography>
          )}
          <Stack direction="row" spacing={2} alignItems="center" mt={0.5}>
            <Slider
              value={sectionScores[section.id]?.[iIdx] ?? 0}
              min={item.minValue}
              max={item.maxValue}
              step={1}
              marks
              valueLabelDisplay="auto"
              onChange={(_e, v) => handleItemChange(section.id, iIdx, v as number)}
              sx={{ flex: 1 }}
            />
            <Typography variant="body2" minWidth={28} textAlign="right">
              {sectionScores[section.id]?.[iIdx] ?? 0}
            </Typography>
          </Stack>
        </Box>
      ))}
      <Divider />
    </Box>
  );

  if (templatesLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress role="progressbar" aria-label="Loading" size={28} />
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack spacing={2.5}>

        <FormControl fullWidth error={!!errors.assessmentType}>
          <InputLabel>Assessment Template</InputLabel>
          <Select
            value={selectedTemplateId}
            label="Assessment Template"
            onChange={(e) => setSelectedTemplateId(e.target.value)}
          >
            {(templates ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
            ))}
          </Select>
          {errors.assessmentType && (
            <FormHelperText>{errors.assessmentType.message}</FormHelperText>
          )}
        </FormControl>

        <Stack direction="row" spacing={2}>
          <Controller
            name="assessmentDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Assessment Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                error={!!errors.assessmentDate}
                helperText={errors.assessmentDate?.message}
                sx={{ flex: 1 }}
              />
            )}
          />
          <Controller
            name="reviewDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Next Review Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                sx={{ flex: 1 }}
              />
            )}
          />
        </Stack>

        <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 1 }}>Risk Domains</Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {([
            { name: 'suicideRisk' as const, label: 'Suicide Risk' },
            { name: 'selfHarmRisk' as const, label: 'Self-Harm Risk' },
            { name: 'harmToOthersRisk' as const, label: 'Harm to Others' },
            { name: 'abscondingRisk' as const, label: 'Absconding Risk' },
            { name: 'vulnerabilityRisk' as const, label: 'Vulnerability Risk' },
          ]).map(({ name, label }) => (
            <Controller
              key={name}
              name={name}
              control={control}
              render={({ field: f }) => (
                <FormControlLabel
                  control={<Checkbox checked={!!f.value} onChange={e => f.onChange(e.target.checked)} size="small" />}
                  label={label}
                />
              )}
            />
          ))}
        </Stack>

        {template && (
          <Box>
            <Typography variant="subtitle1" fontWeight={700} mb={2}>
              {template.name} — Scoring
            </Typography>
            {template.sections.map(renderSection)}
          </Box>
        )}

        {template && maxScore > 0 && (
          <Box>
            <RiskScoreGauge
              score={totalScore}
              maxScore={maxScore}
              level={derivedLevel}
            />
          </Box>
        )}

        <TextField
          {...register('riskNarrative')}
          label="Findings / Assessment Notes"
          multiline
          rows={3}
          fullWidth
          placeholder="Document key clinical findings from the assessment..."
        />
        <TextField
          {...register('riskManagementPlan')}
          label="Risk Management Plan"
          multiline
          rows={3}
          fullWidth
          placeholder="Safety plan, actions, responsible clinicians, review triggers..."
        />
        <TextField
          {...register('protectiveFactors')}
          label="Protective Factors"
          multiline
          rows={2}
          fullWidth
          placeholder="Support networks, coping strategies, reasons for living..."
        />

        {createMutation.isError && (
          <Alert role="alert" severity="error">
            Failed to save assessment. Please try again.
          </Alert>
        )}

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button variant="outlined" onClick={onCancel} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending}
            startIcon={createMutation.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : null}
          >
            Save Assessment
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};
