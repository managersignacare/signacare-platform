// apps/web/src/features/reports/services/reportsApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  ReportFilters,
  EncounterReportRow,
  OutcomeDashboardData,
  ReportSummary,
  StaffOption,
} from '../types/reportTypes';
import type {
  AdminReportMetadataResponse,
  AdminReportDetailsResponse,
  AdminReportFilters,
  AdminReportMetricKey,
  AdminReportOverviewResponse,
  AdminReportTrendGranularity,
  AdminReportTrendsResponse,
} from '@signacare/shared';

const BASE = 'reports';

export const reportsApi = {
  getEncounterReport: async (filters: ReportFilters): Promise<EncounterReportRow[]> => {
    const data = await apiClient.get<EncounterReportRow[]>(`${BASE}/encounters`, {
      params: filters,
    });
    return data;
  },

  getOutcomeDashboard: async (filters: ReportFilters): Promise<OutcomeDashboardData> => {
    const data = await apiClient.get<OutcomeDashboardData>(`${BASE}/outcomes/dashboard`, {
      params: filters,
    });
    return data;
  },

  generateReport: async (
    reportType: string,
    filters: ReportFilters,
  ): Promise<ReportSummary> => {
    const data = await apiClient.post<ReportSummary>(`${BASE}/generate`, {
      reportType,
      ...filters,
    });
    return data;
  },

  downloadReport: async (reportId: string, format: 'csv' | 'pdf'): Promise<Blob> => {
    const response = await apiClient.instance.get<Blob>(`${BASE}/${reportId}/download`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  },

  getCliniciansForFilter: async (): Promise<StaffOption[]> => {
    const data = await apiClient.get<StaffOption[]>(`${BASE}/filters/clinicians`);
    return data;
  },

  getAdminReportMetadata: async (): Promise<AdminReportMetadataResponse> => {
    const data = await apiClient.get<AdminReportMetadataResponse>(`${BASE}/admin-report/metadata`);
    return data;
  },

  getAdminReportOverview: async (
    filters: AdminReportFilters,
  ): Promise<AdminReportOverviewResponse> => {
    const data = await apiClient.get<AdminReportOverviewResponse>(
      `${BASE}/admin-report/overview`,
      filters as unknown as Record<string, unknown>,
    );
    return data;
  },

  getAdminReportDetails: async (
    filters: AdminReportFilters & { metricKey: AdminReportMetricKey; limit?: number },
  ): Promise<AdminReportDetailsResponse> => {
    const data = await apiClient.get<AdminReportDetailsResponse>(
      `${BASE}/admin-report/details`,
      filters as unknown as Record<string, unknown>,
    );
    return data;
  },

  getAdminReportTrends: async (
    filters: AdminReportFilters & { metrics?: string; granularity?: AdminReportTrendGranularity },
  ): Promise<AdminReportTrendsResponse> => {
    const data = await apiClient.get<AdminReportTrendsResponse>(
      `${BASE}/admin-report/trends`,
      filters as unknown as Record<string, unknown>,
    );
    return data;
  },

  exportAdminReport: async (params: {
    filters: AdminReportFilters;
    view: 'overview' | 'details' | 'trends';
    format: 'csv' | 'pdf';
    metricKey?: AdminReportMetricKey;
    metrics?: string;
    granularity?: AdminReportTrendGranularity;
    limit?: number;
  }): Promise<Blob> => {
    const query = {
      ...params.filters,
      view: params.view,
      format: params.format,
      metricKey: params.metricKey,
      metrics: params.metrics,
      granularity: params.granularity,
      limit: params.limit,
    };
    const response = await apiClient.instance.get<Blob>(`${BASE}/admin-report/export`, {
      params: query,
      responseType: 'blob',
    });
    return response.data;
  },
};
