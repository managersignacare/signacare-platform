// apps/web/src/features/audit/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the audit log page.
// Centralized so paginated/filtered audit-log queries stay invalidatable as
// a group when audit-log writes happen elsewhere (CLAUDE.md §4.1).
export interface AuditLogFilters {
  page: number;
  actionFilter?: string;
  moduleFilter?: string;
}

export const auditKeys = {
  all: ['audit-log'] as const,
  list: (filters: AuditLogFilters) =>
    [...auditKeys.all, filters] as const,
} as const;
