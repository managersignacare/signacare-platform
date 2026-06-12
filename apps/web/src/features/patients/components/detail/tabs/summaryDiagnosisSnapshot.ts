import { parseDate, type SummaryEpisodeRow } from './summaryTabDomain';

export interface SummaryDiagnosisLookupRow {
  name?: string | null;
  diagnosis?: string | null;
  episodeType?: string | null;
  episodeStatus?: string | null;
}

function firstNonEmptyValue(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function isOngoingEpisodeStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  return normalized === 'open' || normalized === 'onhold' || normalized === 'active';
}

function episodeRecencyRank(row: SummaryEpisodeRow): number {
  const preferred = parseDate(row.startDate) ?? parseDate(row.endDate);
  return preferred ? preferred.getTime() : 0;
}

export function resolvePrimaryDiagnosisSnapshot(
  episodes: SummaryEpisodeRow[],
  diagnosisRows: SummaryDiagnosisLookupRow[],
): { value: string; sub?: string } {
  const ongoingEpisodeWithDiagnosis = episodes.find((episode) => (
    isOngoingEpisodeStatus(episode.status)
      && firstNonEmptyValue([episode.primaryDiagnosis, episode.diagnoses])
  ));
  if (ongoingEpisodeWithDiagnosis) {
    return {
      value: firstNonEmptyValue([ongoingEpisodeWithDiagnosis.primaryDiagnosis, ongoingEpisodeWithDiagnosis.diagnoses]) ?? 'Not recorded',
      sub: ongoingEpisodeWithDiagnosis.title ?? ongoingEpisodeWithDiagnosis.episodeType ?? undefined,
    };
  }

  const mostRecentEpisodeWithDiagnosis = [...episodes]
    .sort((a, b) => episodeRecencyRank(b) - episodeRecencyRank(a))
    .find((episode) => firstNonEmptyValue([episode.primaryDiagnosis, episode.diagnoses]));
  if (mostRecentEpisodeWithDiagnosis) {
    return {
      value: firstNonEmptyValue([mostRecentEpisodeWithDiagnosis.primaryDiagnosis, mostRecentEpisodeWithDiagnosis.diagnoses]) ?? 'Not recorded',
      sub: mostRecentEpisodeWithDiagnosis.title ?? mostRecentEpisodeWithDiagnosis.episodeType ?? undefined,
    };
  }

  const diagnosisRow = diagnosisRows.find((row) => firstNonEmptyValue([row.name, row.diagnosis]));
  if (diagnosisRow) {
    return {
      value: firstNonEmptyValue([diagnosisRow.name, diagnosisRow.diagnosis]) ?? 'Not recorded',
      sub: diagnosisRow.episodeType ?? undefined,
    };
  }

  return { value: 'Not recorded' };
}
