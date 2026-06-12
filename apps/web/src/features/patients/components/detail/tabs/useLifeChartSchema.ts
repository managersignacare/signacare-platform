import React from 'react';
import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import { patientsKeys } from '../../../queryKeys';
import {
  extractErrorMessage,
  type SummaryEpisodeRow,
  type SummaryMedicationRow,
  type SummaryNoteRow,
  type SummaryPatientProfile,
} from './summaryTabDomain';
import {
  LIFECHART_SCHEMA_NOTE_TITLE,
  LIFECHART_SCHEMA_NOTE_TYPE,
  buildHeuristicSchemaDoc,
  buildLifeChartSchemaPrompt,
  normalizeSchemaDoc,
  parseSchemaDocFromLlm,
  stringifySchemaDoc,
  type LifeChartSchemaDoc,
} from './lifeChartSchemaDomain';
import { listArtifactNotes } from './summaryArtifacts';
import type { SummarySignoffRecord } from './summarySignoffTypes';

export interface UseLifeChartSchemaInput {
  patientId: string;
  patient: SummaryPatientProfile;
  episodes: SummaryEpisodeRow[] | undefined;
  notes: SummaryNoteRow[] | undefined;
  medications: SummaryMedicationRow[] | undefined;
  lifeChartSignoff?: SummarySignoffRecord;
}

export function useLifeChartSchema(input: UseLifeChartSchemaInput) {
  const qc = useQueryClient();
  const {
    patientId,
    patient,
    episodes,
    notes,
    medications,
    lifeChartSignoff,
  } = input;
  const allEpisodes = episodes ?? [];
  const allNotes = notes ?? [];
  const allMeds = medications ?? [];
  const [schemaDoc, setSchemaDoc] = React.useState<LifeChartSchemaDoc | null>(null);
  const [schemaLoading, setSchemaLoading] = React.useState(false);
  const [schemaSaving, setSchemaSaving] = React.useState(false);
  const [schemaError, setSchemaError] = React.useState('');
  const [schemaInfo, setSchemaInfo] = React.useState('');
  const schemaInitializedRef = React.useRef(false);

  const schemaArtifactVersions = React.useMemo(
    () => listArtifactNotes(allNotes, LIFECHART_SCHEMA_NOTE_TYPE),
    [allNotes],
  );
  const persistedSchemaNote = React.useMemo(
    () => schemaArtifactVersions[0] ?? null,
    [schemaArtifactVersions],
  );
  const schemaHistory = React.useMemo(
    () => schemaArtifactVersions.slice(1),
    [schemaArtifactVersions],
  );

  React.useEffect(() => {
    if (schemaInitializedRef.current) return;
    if (episodes === undefined || notes === undefined || medications === undefined) return;
    const fallbackDoc = buildHeuristicSchemaDoc(patient, allEpisodes, allNotes, allMeds);
    if (persistedSchemaNote?.content) {
      try {
        const parsed = normalizeSchemaDoc(JSON.parse(persistedSchemaNote.content), fallbackDoc);
        if (parsed) {
          setSchemaDoc(parsed.generatedBy === 'heuristic' ? fallbackDoc : parsed);
          schemaInitializedRef.current = true;
          return;
        }
      } catch (err) {
        console.warn('LifeChart schema parse failed; falling back to heuristic model', err);
      }
    }
    setSchemaDoc(fallbackDoc);
    schemaInitializedRef.current = true;
  }, [patient, episodes, notes, medications, allEpisodes, allNotes, allMeds, persistedSchemaNote]);

  const resetSchemaHeuristic = React.useCallback(() => {
    setSchemaDoc(buildHeuristicSchemaDoc(patient, allEpisodes, allNotes, allMeds));
    setSchemaInfo('Schema reset from clinical data.');
    setSchemaError('');
  }, [patient, allEpisodes, allNotes, allMeds]);

  const generateSchemaWithAi = React.useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError('');
    setSchemaInfo('');
    try {
      const prompt = buildLifeChartSchemaPrompt({
        patient,
        episodes: allEpisodes,
        notes: allNotes,
        medications: allMeds,
        clinicTimeZone: schemaDoc?.clinicTimeZone ?? DEFAULT_CLINIC_TIME_ZONE,
      });
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'lifechart-schema',
        data: prompt,
        patientId,
        enhance: true,
      });
      const fallback = buildHeuristicSchemaDoc(patient, allEpisodes, allNotes, allMeds);
      const parsed = parseSchemaDocFromLlm(result, fallback);
      if (!parsed) {
        setSchemaError('AI returned an invalid schema format. You can keep editing the existing schema manually.');
        return;
      }
      setSchemaDoc(parsed);
      setSchemaInfo('AI schema generated. Review and edit before saving.');
    } catch (err) {
      setSchemaError(extractErrorMessage(err, 'Failed to generate lifechart schema.'));
    } finally {
      setSchemaLoading(false);
    }
  }, [patient, allEpisodes, allNotes, allMeds, patientId, schemaDoc?.clinicTimeZone]);

  const saveSchema = React.useCallback(async () => {
    if (!schemaDoc) return;
    setSchemaSaving(true);
    setSchemaError('');
    setSchemaInfo('');
    try {
      const content = stringifySchemaDoc(schemaDoc);
      if (persistedSchemaNote?.id && !lifeChartSignoff) {
        await apiClient.patch(`patients/${patientId}/notes/${persistedSchemaNote.id}`, {
          title: LIFECHART_SCHEMA_NOTE_TITLE,
          noteType: LIFECHART_SCHEMA_NOTE_TYPE,
          content,
          status: 'draft',
        });
      } else {
        await apiClient.post(`patients/${patientId}/notes`, {
          title: LIFECHART_SCHEMA_NOTE_TITLE,
          noteType: LIFECHART_SCHEMA_NOTE_TYPE,
          content,
          status: 'draft',
          isAiDraft: true,
        });
      }
      await qc.invalidateQueries({ queryKey: patientsKeys.notesLifechart(patientId) });
      setSchemaInfo('Schema saved.');
    } catch (err) {
      setSchemaError(extractErrorMessage(err, 'Failed to save lifechart schema.'));
    } finally {
      setSchemaSaving(false);
    }
  }, [schemaDoc, persistedSchemaNote?.id, patientId, qc, lifeChartSignoff]);

  return {
    schemaDoc,
    setSchemaDoc,
    schemaLoading,
    schemaSaving,
    schemaError,
    setSchemaError,
    schemaInfo,
    setSchemaInfo,
    schemaHistory,
    generateSchemaWithAi,
    resetSchemaHeuristic,
    saveSchema,
  };
}
