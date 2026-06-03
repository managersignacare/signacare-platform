/**
 * apps/web/src/features/reports/pages/ComplianceDashboardPage.tsx
 *
 * Compliance dashboard — a single React page rendering a dozen
 * metrics a clinic's compliance officer / manager would look at
 * in a weekly review. All data comes from one GET to
 * /api/v1/reports/compliance/summary which in turn reads the
 * tamper-evident audit log + patient_outreach_log + patient_flags
 * + legal_orders + staff_module_access.
 *
 * No new BI tool dependency. Keeps the page small, queryable, and
 * testable — a clinic admin can verify the numbers against direct
 * SQL any time.
 */
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import React from 'react'
import { apiClient } from '../../../shared/services/apiClient'
import { reportsKeys } from '../queryKeys'

interface ComplianceSummary {
  clinicId: string
  generatedAt: string
  governance: {
    forbiddenAccessLast7Days: number
    breakGlassLast30Days: number
    llmBypassLast30Days: number
    llmBypassLast90Days: number
    failedLoginsLast24h: number
    lockedAccountsNow: number
  }
  clinicalSafety: {
    laiOverdueCount: number
    clozapineAmberCount: number
    clozapineRedCount: number
    mhaOrdersExpiringNext7Days: number
  }
  patientEngagement: {
    patientsWithSmsConsent: number
    patientsWithVivaInstalled: number
    totalActivePatients: number
    smsConsentRate: number
    vivaAdoptionRate: number
  }
  outreach: {
    last30DayAttempts: number
    last30DaySkipped: number
    skipRate: number
    overrideCount: number
  }
  accessControl: {
    moduleGrantCoverage: Array<{
      module: string
      grants: number
      writeGrants: number
      explicitDenies: number
    }>
  }
  platformReliability: {
    shutdownRunsLast24Hours: number
    shutdownHookTimeoutsLast24Hours: number
    shutdownHookFailuresLast24Hours: number
    maxShutdownHookDurationMsLast24Hours: number
    lastShutdownTotalDurationMs: number | null
  }
}

interface ShutdownObservabilityResponse {
  generatedAt: string
  isShuttingDown: boolean
  runCount: number
  runsLast24Hours: number
  lastRun: {
    signal: string
    startedAt: string
    completedAt: string
    totalDurationMs: number
    budgetMs: number
    budgetExhausted: boolean
    hookCount: number
  } | null
  aggregatesLast24Hours: {
    hooksCompleted: number
    hooksFailed: number
    hooksTimedOut: number
    hooksSkippedBudget: number
    avgHookDurationMs: number
    maxHookDurationMs: number
  }
  perHookLast24Hours: Array<{
    hookName: string
    priority: number
    invocations: number
    completed: number
    failed: number
    timedOut: number
    skippedBudget: number
    avgDurationMs: number
    maxDurationMs: number
    maxTimeoutMs: number
  }>
}

const MetricCard: React.FC<{
  label: string
  value: string | number
  severity?: 'ok' | 'warn' | 'critical'
  sub?: string
}> = ({ label, value, severity = 'ok', sub }) => {
  const color =
    severity === 'critical' ? '#b71c1c' : severity === 'warn' ? '#b8621a' : '#2e7d32'
  return (
    <Card variant="outlined" sx={{ minWidth: 180, flex: '1 1 200px' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" sx={{ color, fontWeight: 700, mt: 0.5 }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

const ComplianceDashboardPage: React.FC = () => {
  const { data, isLoading, isError, error } = useQuery<ComplianceSummary>({
    queryKey: reportsKeys.complianceSummary(),
    queryFn: () => apiClient.get<ComplianceSummary>('reports/compliance/summary'),
    staleTime: 60_000,
  })
  const {
    data: shutdownObs,
    isError: isShutdownObsError,
  } = useQuery<ShutdownObservabilityResponse>({
    queryKey: reportsKeys.complianceShutdownObservability(),
    queryFn: () => apiClient.get<ShutdownObservabilityResponse>('reports/compliance/shutdown-observability'),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (isError || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          Could not load the compliance summary:{' '}
          {error instanceof Error ? error.message : 'unknown error'}
        </Alert>
      </Box>
    )
  }

  const g = data.governance
  const c = data.clinicalSafety
  const p = data.patientEngagement
  const o = data.outreach
  const pr = data.platformReliability

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: '#3D484B' }}>
          Compliance dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Reads directly from the tamper-evident audit log, outreach log, patient flags,
          legal orders, and staff module-access grants. Generated at{' '}
          {new Date(data.generatedAt).toLocaleString()}.
        </Typography>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* ── Governance ──────────────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Governance
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: 'wrap' }}>
        <MetricCard
          label="Forbidden access (7d)"
          value={g.forbiddenAccessLast7Days}
          severity={g.forbiddenAccessLast7Days === 0 ? 'ok' : g.forbiddenAccessLast7Days < 5 ? 'warn' : 'critical'}
          sub="403 + FORBIDDEN audit rows"
        />
        <MetricCard
          label="Break-glass (30d)"
          value={g.breakGlassLast30Days}
          severity={g.breakGlassLast30Days === 0 ? 'ok' : 'warn'}
          sub="emergency elevations"
        />
        <MetricCard
          label="LLM bypass (30d)"
          value={g.llmBypassLast30Days}
          severity={g.llmBypassLast30Days === 0 ? 'ok' : 'warn'}
          sub="admin/superadmin bypass usage"
        />
        <MetricCard
          label="LLM bypass (90d)"
          value={g.llmBypassLast90Days}
          severity={g.llmBypassLast90Days === 0 ? 'ok' : 'warn'}
          sub="long-window governance trend"
        />
        <MetricCard
          label="Failed logins (24h)"
          value={g.failedLoginsLast24h}
          severity={g.failedLoginsLast24h === 0 ? 'ok' : g.failedLoginsLast24h < 10 ? 'warn' : 'critical'}
        />
        <MetricCard
          label="Locked accounts (now)"
          value={g.lockedAccountsNow}
          severity={g.lockedAccountsNow === 0 ? 'ok' : 'warn'}
        />
      </Stack>

      {/* ── Platform reliability (BUG-308) ───────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Platform reliability (shutdown)
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <MetricCard
          label="Shutdown runs (24h)"
          value={pr.shutdownRunsLast24Hours}
          severity="ok"
        />
        <MetricCard
          label="Hook timeouts (24h)"
          value={pr.shutdownHookTimeoutsLast24Hours}
          severity={pr.shutdownHookTimeoutsLast24Hours === 0 ? 'ok' : 'critical'}
        />
        <MetricCard
          label="Hook failures (24h)"
          value={pr.shutdownHookFailuresLast24Hours}
          severity={pr.shutdownHookFailuresLast24Hours === 0 ? 'ok' : 'warn'}
        />
        <MetricCard
          label="Max hook duration (24h)"
          value={`${pr.maxShutdownHookDurationMsLast24Hours} ms`}
          severity={pr.maxShutdownHookDurationMsLast24Hours < 10_000 ? 'ok' : 'warn'}
        />
        <MetricCard
          label="Last shutdown total"
          value={pr.lastShutdownTotalDurationMs != null ? `${pr.lastShutdownTotalDurationMs} ms` : 'N/A'}
          severity={pr.lastShutdownTotalDurationMs != null && pr.lastShutdownTotalDurationMs > 20_000 ? 'warn' : 'ok'}
        />
      </Stack>
      {isShutdownObsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Shutdown observability detail could not be loaded. Summary metrics are still shown.
        </Alert>
      )}
      {shutdownObs && (
        <Paper variant="outlined" sx={{ mb: 4 }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              Per-hook metrics (last 24h)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Generated {new Date(shutdownObs.generatedAt).toLocaleString()}.
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Hook</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Invocations</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Timed out</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Failed</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Avg duration (ms)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Max duration (ms)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Max timeout (ms)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shutdownObs.perHookLast24Hours.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography variant="caption" color="text.secondary">
                        No shutdown runs in the last 24 hours.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  shutdownObs.perHookLast24Hours.map((row) => (
                    <TableRow key={row.hookName} hover>
                      <TableCell>{row.hookName}</TableCell>
                      <TableCell align="right">{row.invocations}</TableCell>
                      <TableCell align="right">{row.timedOut}</TableCell>
                      <TableCell align="right">{row.failed}</TableCell>
                      <TableCell align="right">{row.avgDurationMs}</TableCell>
                      <TableCell align="right">{row.maxDurationMs}</TableCell>
                      <TableCell align="right">{row.maxTimeoutMs}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── Clinical safety ─────────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Clinical safety
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: 'wrap' }}>
        <MetricCard
          label="LAI overdue"
          value={c.laiOverdueCount}
          severity={c.laiOverdueCount === 0 ? 'ok' : 'critical'}
          sub="active patient_flags"
        />
        <MetricCard
          label="Clozapine AMBER"
          value={c.clozapineAmberCount}
          severity={c.clozapineAmberCount === 0 ? 'ok' : 'warn'}
          sub="RANZCP ANC classifier"
        />
        <MetricCard
          label="Clozapine RED"
          value={c.clozapineRedCount}
          severity={c.clozapineRedCount === 0 ? 'ok' : 'critical'}
          sub="RANZCP ANC classifier"
        />
        <MetricCard
          label="MHA expiring (7d)"
          value={c.mhaOrdersExpiringNext7Days}
          severity={c.mhaOrdersExpiringNext7Days === 0 ? 'ok' : 'warn'}
          sub="active legal_orders"
        />
      </Stack>

      {/* ── Patient engagement ──────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Patient engagement &amp; consent
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <MetricCard
          label="Active patients"
          value={p.totalActivePatients}
        />
        <MetricCard
          label="SMS consent"
          value={pct(p.smsConsentRate)}
          sub={`${p.patientsWithSmsConsent} patients`}
          severity={p.smsConsentRate > 0.5 ? 'ok' : 'warn'}
        />
        <MetricCard
          label="Viva installed"
          value={pct(p.vivaAdoptionRate)}
          sub={`${p.patientsWithVivaInstalled} patients`}
          severity={p.vivaAdoptionRate > 0.3 ? 'ok' : 'warn'}
        />
      </Stack>
      <Box sx={{ maxWidth: 600, mb: 4 }}>
        <Typography variant="caption" color="text.secondary">
          Viva adoption (FCM tokens on file)
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, p.vivaAdoptionRate * 100)}
          sx={{ height: 10, borderRadius: 1, mt: 0.5 }}
        />
      </Box>

      {/* ── Outreach ────────────────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Patient outreach (30 days)
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: 'wrap' }}>
        <MetricCard label="Delivery attempts" value={o.last30DayAttempts} />
        <MetricCard
          label="Skipped"
          value={o.last30DaySkipped}
          sub={`${pct(o.skipRate)} skip rate`}
          severity={o.skipRate < 0.1 ? 'ok' : o.skipRate < 0.3 ? 'warn' : 'critical'}
        />
        <MetricCard
          label="Manual overrides"
          value={o.overrideCount}
          sub="clinician-forced channel"
          severity={o.overrideCount === 0 ? 'ok' : 'warn'}
        />
      </Stack>

      {/* ── Module access coverage ──────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
        Module access coverage
      </Typography>
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Module</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Total grants</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Write grants</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Explicit denies</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.accessControl.moduleGrantCoverage.map((m) => (
                <TableRow key={m.module} hover>
                  <TableCell>{m.module}</TableCell>
                  <TableCell align="right">{m.grants}</TableCell>
                  <TableCell align="right">{m.writeGrants}</TableCell>
                  <TableCell align="right">
                    {m.explicitDenies > 0 ? (
                      <Chip label={m.explicitDenies} size="small" color="error" />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  )
}

export default ComplianceDashboardPage
