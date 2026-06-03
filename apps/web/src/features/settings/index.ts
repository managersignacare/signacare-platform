// apps/web/src/features/settings/index.ts
export { SettingsPage } from './pages/SettingsPage'
export { ThresholdsPanel } from './components/ThresholdsPanel'
export { ClinicProfilePanel } from './components/ClinicProfilePanel'
export { useThresholds, useSetThreshold, useBulkSetThresholds } from './hooks/useSettings'
export { settingsApi } from './services/settingsApi'