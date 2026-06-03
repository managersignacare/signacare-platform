// apps/web/src/features/reports/hooks/useReports.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../services/reportsApi';
import type { ReportFilters } from '../types/reportTypes';

const _reportsBase = ['reports'] as const;

export const reportKeys = {
  all: _reportsBase,
  encounters: (filters: ReportFilters) =>
    [..._reportsBase, 'encounters', filters] as const,
  outcomeDashboard: (filters: ReportFilters) =>
    [..._reportsBase, 'outcomes', 'dashboard', filters] as const,
  clinicians: [..._reportsBase, 'filters', 'clinicians'] as const,
};

export function useEncounterReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: reportKeys.encounters(filters),
    queryFn: () => reportsApi.getEncounterReport(filters),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOutcomeDashboard(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: reportKeys.outcomeDashboard(filters),
    queryFn: () => reportsApi.getOutcomeDashboard(filters),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClinicianFilter() {
  return useQuery({
    queryKey: reportKeys.clinicians,
    queryFn: () => reportsApi.getCliniciansForFilter(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportType,
      filters,
    }: {
      reportType: string;
      filters: ReportFilters;
    }) => reportsApi.generateReport(reportType, filters),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportKeys.all });
    },
  });
}

export function useDownloadReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      format,
    }: {
      reportId: string;
      format: 'csv' | 'pdf';
    }) => reportsApi.downloadReport(reportId, format),
    onSuccess: (blob, { format }) => {
      void qc.invalidateQueries({ queryKey: reportKeys.all });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signacare-report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
