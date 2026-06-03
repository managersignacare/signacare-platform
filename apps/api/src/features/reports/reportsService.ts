// apps/api/src/features/reports/reports.service.ts
import type {
  ReportFilters,
  EncounterReportRow,
  OutcomeDashboardData,
  OutcomeMeasureTrend,
  OutcomeMeasurePoint,
  ReportSummary,
  StaffOption,
  GenerateReportDTO,
} from '@signacare/shared';
import { reportsRepository, type OutcomeDataRow } from './reportsRepository';
import { writeAuditLog } from '../../utils/audit';

type Instrument = 'PHQ9' | 'GAD7' | 'K10' | 'HONOS' | 'BPRS' | 'DASS21';

function toDateStr(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().split('T')[0]
    : String(value).split('T')[0];
}

function computeTrend(scores: number[]): OutcomeMeasureTrend['trend'] {
  if (scores.length < 2) return 'insufficientdata';
  const delta = scores[scores.length - 1] - scores[0];
  const threshold = Math.max(scores[0] * 0.1, 1);
  if (delta < -threshold) return 'improving';
  if (delta > threshold) return 'deteriorating';
  return 'stable';
}

function buildCsv(rows: unknown[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const keys = Object.keys(rows[0] as object);
  const escape = (v: unknown) =>
    `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
  const header = keys.join(',');
  const lines = rows.map((r) =>
    keys.map((k) => escape((r as Record<string, unknown>)[k])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

export const reportsService = {
  async getEncounterReport(
    clinicId: string,
    actorId: string,
    filters: ReportFilters,
  ): Promise<EncounterReportRow[]> {
    const rows = await reportsRepository.getEncounterRows(clinicId, filters);
    await writeAuditLog({ clinicId, actorId,
      action: 'READ',
      tableName: 'report_encounters',
      recordId: clinicId,
    });
    return rows;
  },

  async getOutcomeDashboard(
    clinicId: string,
    actorId: string,
    filters: ReportFilters,
  ): Promise<OutcomeDashboardData> {
    const rows: OutcomeDataRow[] = await reportsRepository.getOutcomeRows(
      clinicId,
      filters,
    );

    // Group rows by patient + instrument to build per-patient trend lines
    const grouped = new Map<string, OutcomeDataRow[]>();
    for (const row of rows) {
      const key = `${row.patient_id}::${row.instrument}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    const trends: OutcomeMeasureTrend[] = [];
    for (const pts of grouped.values()) {
      const sorted = [...pts].sort(
        (a, b) =>
          new Date(a.assessmentdate).getTime() -
          new Date(b.assessmentdate).getTime(),
      );

      const dataPoints: OutcomeMeasurePoint[] = sorted.map((p) => ({
        date: toDateStr(p.assessmentdate),
        patientId: p.patient_id,
        instrument: p.instrument as Instrument,
        score: Number(p.totalscore ?? 0),
        interpretation: p.scoreband ?? null,
        clinicianName: p.clinicianname,
      }));

      const scores = dataPoints.map((d) => d.score);
      trends.push({
        patientId: sorted[0].patient_id,
        patientName: sorted[0].patientname,
        instrument: sorted[0].instrument as Instrument,
        dataPoints,
        baselineScore: scores.length > 0 ? scores[0] : null,
        latestScore: scores.length > 0 ? scores[scores.length - 1] : null,
        trend: computeTrend(scores),
      });
    }

    // Cohort averages: group all rows by date + instrument
    const cohortMap = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
      const key = `${toDateStr(row.assessmentdate)}::${row.instrument}`;
      if (!cohortMap.has(key)) cohortMap.set(key, { sum: 0, count: 0 });
      const entry = cohortMap.get(key)!;
      entry.sum += Number(row.totalscore ?? 0);
      entry.count += 1;
    }

    const cohortAverageByDate = Array.from(cohortMap.entries())
      .map(([key, { sum, count }]) => {
        const [date, instrument] = key.split('::');
        return { date, instrument, avgScore: sum / count, count };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    await writeAuditLog({ clinicId, actorId,
      action: 'READ',
      tableName: 'report_outcomes_dashboard',
      recordId: clinicId,
    });

    return {
      filters,
      trends,
      cohortAverageByDate,
      generatedAt: new Date().toISOString(),
    };
  },

  async generateReport(
    clinicId: string,
    actorId: string,
    dto: GenerateReportDTO,
  ): Promise<ReportSummary> {
    const filters: ReportFilters = {
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      clinicianStaffId: dto.clinicianStaffId,
      episodeType: dto.episodeType,
      format: dto.format,
    };

    let rows: unknown[] = [];
    if (dto.reportType === 'encounters') {
      rows = await reportsRepository.getEncounterRows(clinicId, filters);
    } else if (dto.reportType === 'outcomes') {
      rows = await reportsRepository.getOutcomeRows(clinicId, filters);
    }
    // billing / referrals / missedappointments: wire additional repo methods here

    const run = await reportsRepository.createReportRun(
      clinicId,
      actorId,
      dto.reportType,
      filters,
      dto.format,
      rows.length,
      rows,
    );

    await writeAuditLog({ clinicId, actorId,
      action: 'CREATE',
      tableName: 'report_runs',
      recordId: run.id,
    });

    return {
      reportId: run.id,
      reportType: run.report_type,
      filters,
      totalRows: run.total_rows,
      generatedAt: run.generated_at.toISOString(),
    };
  },

  async downloadReport(
    clinicId: string,
    reportId: string,
    format: 'csv' | 'pdf',
  ): Promise<{ data: Buffer; mimeType: string; filename: string }> {
    const run = await reportsRepository.findReportRun(clinicId, reportId);
    if (!run) {
      const err = new Error('Report not found') as Error & { code: string };
      err.code = 'NOT_FOUND';
      throw err;
    }

    const rows = Array.isArray(run.result_data) ? run.result_data : [];

    if (format === 'csv') {
      return {
        data: Buffer.from(buildCsv(rows), 'utf-8'),
        mimeType: 'text/csv',
        filename: `signacare-report-${reportId}.csv`,
      };
    }

    // PDF: plain-text fallback — replace with puppeteer or pdfmake in production
    const text = [
      'Signacare EMR Report',
      `Report ID   : ${reportId}`,
      `Report Type : ${run.report_type}`,
      `Generated   : ${run.generated_at.toISOString()}`,
      `Total Rows  : ${run.total_rows}`,
      '',
      buildCsv(rows),
    ].join('\n');

    return {
      data: Buffer.from(text, 'utf-8'),
      mimeType: 'application/pdf',
      filename: `signacare-report-${reportId}.pdf`,
    };
  },

  async getCliniciansForFilter(clinicId: string): Promise<StaffOption[]> {
    return reportsRepository.getCliniciansForFilter(clinicId);
  },
};
