import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useAuthStore } from '../../../shared/store/authStore'
import {
  type ClinicSubscriptionOverview,
  type SubscriptionSummary,
  subscriptionApi,
} from '../services/subscriptionApi'

function computeAnnualTotal(subscription: SubscriptionSummary): number {
  const perSeatYear = subscription.pricePerYear ?? (subscription.pricePerMonth * 12)
  const gross = perSeatYear * subscription.seats
  if ((subscription.discountPercent ?? 0) > 0) {
    return gross * (1 - ((subscription.discountPercent ?? 0) / 100))
  }
  if ((subscription.discountAmount ?? 0) > 0) {
    return Math.max(0, gross - (subscription.discountAmount ?? 0))
  }
  return gross
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const ms = new Date(date).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

export default function SubscriptionPage() {
  const user = useAuthStore((s) => s.user)
  const [rows, setRows] = useState<ClinicSubscriptionOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await subscriptionApi.getOverview())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load subscription overview'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.role === 'superadmin') {
      void load()
      return
    }
    setLoading(false)
  }, [user?.role])

  if (user?.role !== 'superadmin') {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied. Only Signacare platform superadmin users can view subscription operations.
        </Alert>
      </Box>
    )
  }

  const configuredCount = rows.filter((r) => r.subscription).length
  const activeCount = rows.filter((r) => r.subscription?.status === 'active').length

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3 }}>
        <Box>
          <Typography
            variant="h5"
            fontWeight={700}
            fontFamily="Albert Sans, sans-serif"
            sx={{ color: '#3D484B' }}
          >
            Subscription Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Onboarded clinics: {rows.length} • configured subscriptions: {configuredCount} • active: {activeCount}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load subscription overview: {error}
        </Alert>
      )}

      {loading && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Loading subscription details...
        </Alert>
      )}

      {!loading && rows.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No onboarded clinics found.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row) => {
          const sub = row.subscription
          const renewalDays = daysUntil(sub?.renewalDate ?? null)
          const showRenewalWarning = sub?.status === 'active' && renewalDays != null && renewalDays <= (sub.reminderDays ?? 30)

          return (
            <Paper
              key={row.clinicId}
              variant="outlined"
              sx={{
                p: 3,
                borderLeft: `4px solid ${
                  sub?.status === 'active' ? '#327C8D' : sub?.status ? '#9E9E9E' : '#D32F2F'
                }`,
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    {row.clinicName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.clinicEmail ?? 'No clinic email set'} • {row.clinicIsActive ? 'Clinic active' : 'Clinic inactive'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  {showRenewalWarning && (
                    <Chip
                      icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
                      label={`Renew in ${renewalDays}d`}
                      size="small"
                      color="warning"
                      sx={{ fontSize: 11 }}
                    />
                  )}
                  <Chip
                    label={sub?.status ?? 'not configured'}
                    color={sub?.status === 'active' ? 'success' : sub ? 'default' : 'error'}
                    sx={{ textTransform: 'capitalize' }}
                  />
                </Box>
              </Box>

              {!sub && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Subscription is not configured for this clinic yet.
                </Alert>
              )}

              {sub && (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Plan</Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ textTransform: 'capitalize' }}>
                      {sub.planType}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Seats</Typography>
                    <Typography variant="body2" fontWeight={600}>{sub.seats}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Price</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      ${sub.pricePerMonth}/seat/mo
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Annual</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      ${computeAnnualTotal(sub).toLocaleString()}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Period</Typography>
                    <Typography variant="body2">
                      {new Date(sub.startDate).toLocaleDateString('en-AU')} —{' '}
                      {sub.endDate ? new Date(sub.endDate).toLocaleDateString('en-AU') : 'Open'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography variant="caption" color="text.secondary">Renewal</Typography>
                    <Typography
                      variant="body2"
                      color={showRenewalWarning ? 'error' : 'text.primary'}
                      fontWeight={showRenewalWarning ? 600 : 400}
                    >
                      {sub.renewalDate ? new Date(sub.renewalDate).toLocaleDateString('en-AU') : 'Not set'}
                    </Typography>
                  </Grid>
                </Grid>
              )}
            </Paper>
          )
        })}
      </Box>

      <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 4, mb: 1.5, color: '#3D484B' }}>
        Available Plans
      </Typography>
      <Grid container spacing={2}>
        {[
          { plan: 'Monthly', price: '$149', per: '/seat/month', desc: 'Flexible monthly billing', highlight: false },
          { plan: 'Annual', price: '$1,490', per: '/seat/year', desc: 'Save 17% with annual billing', highlight: true },
          { plan: 'Long Term', price: 'Custom', per: '', desc: 'Multi-year enterprise pricing', highlight: false },
        ].map((plan) => (
          <Grid key={plan.plan} size={{ xs: 12, sm: 4 }}>
            <Card variant="outlined" sx={{ borderColor: plan.highlight ? '#b8621a' : 'divider', bgcolor: plan.highlight ? '#FFF8F2' : '#fff' }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2" fontWeight={600}>{plan.plan}</Typography>
                <Typography variant="h5" fontWeight={800} color={plan.highlight ? '#b8621a' : '#3D484B'}>
                  {plan.price}
                  <Typography component="span" variant="caption" color="text.secondary">{plan.per}</Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">{plan.desc}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

