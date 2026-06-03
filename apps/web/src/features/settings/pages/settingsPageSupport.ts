export type BackupLocationType = 'local' | 's3' | 'azure' | 'gcs'
export type BackupLocationDraft = { name: string; path: string; type: BackupLocationType }

export interface BackupRunResultRow {
  location?: string
  success?: boolean
  filename?: string
  size?: string
  error?: string
}

export interface BackupLocationRow {
  id: string
  name?: string
  path?: string
  type?: string
}

export interface BackupHistoryRow {
  id?: string
  timestamp?: string
  filename?: string
  size?: string
  location?: string
  success?: boolean
}

export interface BackupLastRunRow {
  timestamp?: string
  filename?: string
  size?: string
  location?: string
}

export interface BackupScheduleSettings {
  enabled?: boolean
  frequency?: string
  time?: string
  dayOfWeek?: string | number
  retentionDays?: string | number
  [key: string]: unknown
}

export interface BackupConfigResponse {
  schedule?: BackupScheduleSettings
  locations?: BackupLocationRow[]
  history?: BackupHistoryRow[]
  lastBackup?: BackupLastRunRow
}

export interface BackupRunResponse {
  results?: BackupRunResultRow[]
}

export interface LicenseStatusPayload {
  valid?: boolean
  daysRemaining?: number
  gracePeriod?: boolean
  edition?: string
  maxUsers?: number | string
  organisationName?: string
  expiryDate?: string
  error?: string
}

export interface LicenseStatusResponse {
  license?: LicenseStatusPayload | null
}

export interface SendEmailResponse {
  method?: string
}

export type ClinicalPolicyRuleType = 'review_interval' | 'pathology_interval' | 'medication_monitoring' | 'custom' | string
export type ClinicalPolicyCategory = 'review' | 'pathology' | 'medication' | 'physical_health' | 'legal' | 'social' | string

export interface ClinicalPolicyParameters {
  intervalDays?: number | string
  alertDaysBefore?: number | string
  testType?: string
  role?: string
  [key: string]: unknown
}

export interface ClinicalPolicyRow {
  id: string
  name?: string
  description?: string
  rule_type?: string
  ruleType?: string
  category?: ClinicalPolicyCategory
  parameters?: ClinicalPolicyParameters | string | null
  llm_context?: string
  llmContext?: string
  is_active?: boolean
  isActive?: boolean
}

export interface ClinicalPoliciesResponse {
  policies?: ClinicalPolicyRow[]
}

export interface ClinicalPolicyMutationDto {
  name: string
  description?: string
  ruleType: ClinicalPolicyRuleType
  category: ClinicalPolicyCategory
  parameters: Record<string, unknown>
  llmContext?: string
}

export interface AiContextFileRow {
  id: string
  title?: string
  description?: string
  category?: string
  include_in_rag?: boolean
  is_active?: boolean
  token_estimate?: number
  content?: string
}

export interface AiContextFilesResponse {
  files?: AiContextFileRow[]
}

export interface AiContextCreateDto {
  title: string
  description?: string
  category: string
  content: string
  priority: number
}

export interface AiContextImportResponse {
  imported?: number
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

export function readErrorMessage(err: unknown, fallback: string): string {
  const rec = asRecord(err)
  if (!rec) return fallback
  const response = asRecord(rec.response)
  const data = asRecord(response?.data)
  if (typeof data?.details === 'string' && data.details.trim().length > 0) return data.details
  if (typeof data?.error === 'string' && data.error.trim().length > 0) return data.error
  if (typeof rec.message === 'string' && rec.message.trim().length > 0) return rec.message
  return fallback
}

export function readPolicyParameters(raw: ClinicalPolicyRow['parameters']): ClinicalPolicyParameters {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      const rec = asRecord(parsed)
      return rec ? (rec as ClinicalPolicyParameters) : {}
    } catch {
      return {}
    }
  }
  return raw
}
