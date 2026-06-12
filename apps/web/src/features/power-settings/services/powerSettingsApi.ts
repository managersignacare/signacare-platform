import { apiClient } from '../../../shared/services/apiClient'

export interface SubscriberBranding {
  id: string
  clinicId: string
  sidebarTitle: string
  sidebarSubtitle: string
  logoUrl: string
  createdAt: string
  updatedAt: string
}

export interface ClinicListItem {
  id: string
  name: string
}

export interface LevelLabel {
  id: string
  clinicId: string
  level: number
  label: string
}

export interface ClinicAiRuntimeSettings {
  clinicId: string
  llmBackend: 'local_ollama' | 'azure_openai'
  scribeRuntimeMode: 'standard' | 'agentic'
  localStyleAdapterModelName: string | null
}

export interface RuntimeHealthStatusEntry {
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE' | 'ERROR'
  error?: string
  endpoint?: string | null
  authMode?: 'managed_identity' | 'api_key'
  missingEnvVars?: string[]
  backend?: 'azure_openai'
}

export interface AiRuntimeHealthSnapshot {
  ollama: RuntimeHealthStatusEntry
  whisper: RuntimeHealthStatusEntry
  azureOpenAi: RuntimeHealthStatusEntry
}

export const powerSettingsApi = {
  getMyBranding(): Promise<SubscriberBranding | null> {
    return apiClient
      .get<{ branding: SubscriberBranding | null }>('power-settings/branding/me')
      .then((r) => r.branding)
  },

  getAllBranding(): Promise<SubscriberBranding[]> {
    return apiClient
      .get<{ branding: SubscriberBranding[] }>('power-settings/branding')
      .then((r) => r.branding)
  },

  upsertBranding(
    clinicId: string,
    data: { sidebarTitle?: string; sidebarSubtitle?: string; logoUrl?: string },
  ): Promise<SubscriberBranding> {
    return apiClient
      .put<{ branding: SubscriberBranding }>(`power-settings/branding/${clinicId}`, data)
      .then((r) => r.branding)
  },

  getAllClinics(): Promise<ClinicListItem[]> {
    return apiClient
      .get<ClinicListItem[]>('clinics/lookup')
      .then((r) => Array.isArray(r) ? r : [])
  },

  getClinicLevelLabels(clinicId: string): Promise<LevelLabel[]> {
    return apiClient
      .get<{ labels: LevelLabel[] }>(`power-settings/level-labels/${clinicId}`)
      .then((r) => r.labels)
  },

  getClinicAiRuntimeSettings(clinicId: string): Promise<ClinicAiRuntimeSettings> {
    return apiClient.get<ClinicAiRuntimeSettings>(`power-settings/clinics/${clinicId}/ai-runtime`)
  },

  getAiRuntimeHealth(): Promise<AiRuntimeHealthSnapshot> {
    return apiClient
      .get<{ integrations: AiRuntimeHealthSnapshot }>('health/integrations')
      .then((response) => response.integrations)
  },

  setClinicAiRuntimeSettings(
    clinicId: string,
    data: {
      llmBackend?: 'local_ollama' | 'azure_openai'
      scribeRuntimeMode?: 'standard' | 'agentic'
      localStyleAdapterModelName?: string | null
    },
  ): Promise<ClinicAiRuntimeSettings> {
    return apiClient.put<ClinicAiRuntimeSettings>(`power-settings/clinics/${clinicId}/ai-runtime`, data)
  },

  setClinicLevelLabels(
    clinicId: string,
    labels: Array<{ level: number; label: string }>,
  ): Promise<LevelLabel[]> {
    return apiClient
      .put<{ labels: LevelLabel[] }>(`power-settings/level-labels/${clinicId}`, { labels })
      .then((r) => r.labels)
  },

  // BUG-374a — Data retention configuration (Q3b superadmin-only setters).
  getRetention(): Promise<RetentionState> {
    return apiClient.get<RetentionState>('power-settings/retention')
  },

  setRetentionYears(years: number): Promise<{ ok: true }> {
    return apiClient.put<{ ok: true }>('power-settings/retention', { years })
  },

  setRetentionPurgeEnabled(enabled: boolean, reason: string): Promise<{ ok: true }> {
    return apiClient.put<{ ok: true }>('power-settings/retention/purge-enabled', { enabled, reason })
  },

  // BUG-374b Part 2 — manager-approval workflow (Q-F triple-lock 3rd gate).
  // Approver MUST be admin/superadmin AND a different staff member than
  // the superadmin who set retention_purge_enabled (segregation of duties,
  // enforced server-side).
  approveRetentionPurge(reason: string): Promise<{ ok: true }> {
    return apiClient.post<{ ok: true }>('power-settings/retention/manager-approval', { reason })
  },

  revokeRetentionPurgeApproval(reason: string): Promise<{ ok: true }> {
    return apiClient.post<{ ok: true }>('power-settings/retention/manager-approval/revoke', { reason })
  },

  // BUG-P2 — Per-clinic session-idle-timeout (PRES-6 DH-3869).
  getSessionIdle(): Promise<SessionIdleState> {
    return apiClient.get<SessionIdleState>('power-settings/session-idle')
  },

  setSessionIdle(minutes: number | null): Promise<{
    clinicSessionIdleMinutes: number | null
    applied: 'on-next-login'
  }> {
    return apiClient.put<{
      clinicSessionIdleMinutes: number | null
      applied: 'on-next-login'
    }>('power-settings/session-idle', { minutes })
  },
}

// BUG-P2 — Session idle configuration response shape.
export interface SessionIdleState {
  /** Per-clinic override; null = use server default. */
  clinicSessionIdleMinutes: number | null
  /** Server default (= PRES-6 ceiling). */
  serverDefaultMinutes: number
  /** PRES-6 floor (5 min). */
  pres6FloorMinutes: number
  /** PRES-6 ceiling (15 min). */
  pres6CeilingMinutes: number
}

// BUG-374a — Retention configuration response shape (matches
// retentionSettingRoutes GET handler).
// BUG-374b Part 2 — extended with manager-approval state (Q-F gate #3).
// L5 absorb-1 — `managerApprovalActive` + `managerApprovalRemainingDays`
// are server-computed via `retentionApprovalService.getState`. The UI
// MUST consume these directly rather than re-deriving from approvedAt /
// approvedBy / enabledBy (eliminates BUG-416 fail-OPEN anti-pattern shape
// and browser-vs-server clock drift on a destructive surface).
export interface RetentionState {
  dataRetentionYears: number
  retentionPurgeEnabled: boolean
  retentionPurgeEnabledAt: string | null
  retentionPurgeEnabledByStaffId: string | null
  retentionPurgeManagerApprovedByStaffId: string | null
  retentionPurgeManagerApprovedAt: string | null
  managerApprovalActive: boolean
  managerApprovalTtlDays: number
  managerApprovalRemainingDays: number | null
  floorYears: number
  ceilingYears: number
}
