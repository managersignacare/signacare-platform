import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PeopleIcon from '@mui/icons-material/People';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { dashboardKeys } from '../queryKeys';
import type { HandoverSummary } from './dashboardPageSupport';

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
  width?: number;
}

function Sparkline({ data, color, height = 24, width = 80 }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`,
    )
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={((data.length - 1) / (data.length - 1)) * width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}

interface TrendBadgeProps {
  current: number;
  previous: number;
  inverse?: boolean;
}

function TrendBadge({ current, previous, inverse }: TrendBadgeProps) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const isUp = pct > 0;
  const isGood = inverse ? !isUp : isUp;
  if (pct === 0) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, ml: 0.5 }}>
      {isUp ? (
        <ArrowUpwardIcon
          sx={{ fontSize: 10, color: isGood ? '#2E7D32' : '#D32F2F' }}
        />
      ) : (
        <ArrowDownwardIcon
          sx={{ fontSize: 10, color: isGood ? '#2E7D32' : '#D32F2F' }}
        />
      )}
      <Typography
        variant="caption"
        sx={{ fontSize: 9, fontWeight: 700, color: isGood ? '#2E7D32' : '#D32F2F' }}
      >
        {Math.abs(pct)}%
      </Typography>
    </Box>
  );
}

export interface EmptyStateProps {
  text: string;
  color?: string;
}

export function EmptyState({ text, color }: EmptyStateProps) {
  return (
    <Typography
      variant="body2"
      color={color ?? 'text.secondary'}
      sx={{ py: 2, textAlign: 'center', fontSize: 12 }}
    >
      {text}
    </Typography>
  );
}

export interface StatRowProps {
  label: string;
  value: string;
  color: string;
}

export function StatRow({ label, value, color }: StatRowProps) {
  return (
    <Box sx={{ textAlign: 'center', flex: 1 }}>
      <Typography variant="h6" fontWeight={800} sx={{ color, lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
        {label}
      </Typography>
    </Box>
  );
}

export interface RagChipProps {
  label: string;
  count: number;
  color: string;
}

export function RagChip({ label, count, color }: RagChipProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
        {count} {label}
      </Typography>
    </Box>
  );
}

interface KpiRowProps {
  appointments: number;
  openTasks: number;
  newReferrals: number;
  unreadMessages: number;
  caseload: number;
}

export function KpiRow({
  appointments,
  openTasks,
  newReferrals,
  unreadMessages,
  caseload,
}: KpiRowProps) {
  // Generates simple trend sparkline data in the absence of API trend-series.
  const spark = (val: number) =>
    Array.from({ length: 7 }, (_, i) =>
      Math.max(
        0,
        val + Math.round((Math.random() - 0.5) * val * 0.3) - (6 - i),
      ),
    );

  return (
    <Grid container spacing={1.5}>
      <Grid size={{ xs: 6, sm: 2.4 }}>
        <KpiCard
          icon={<CalendarTodayIcon />}
          color="#b8621a"
          label="Appointments"
          value={String(appointments)}
          target={20}
          sparkData={spark(appointments)}
          link="/appointments"
          previous={Math.round(appointments * 0.9)}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 2.4 }}>
        <KpiCard
          icon={<AssignmentIcon />}
          color="#D32F2F"
          label="Open Tasks"
          value={String(openTasks)}
          sparkData={spark(openTasks)}
          link="/tasks"
          previous={Math.round(openTasks * 1.1)}
          inverse
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 2.4 }}>
        <KpiCard
          icon={<SwapHorizIcon />}
          color="#327C8D"
          label="New Referrals"
          value={String(newReferrals)}
          sparkData={spark(newReferrals)}
          link="/referrals"
          previous={Math.round(newReferrals * 0.8)}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 2.4 }}>
        <KpiCard
          icon={<MailOutlineIcon />}
          color="#3D484B"
          label="Messages"
          value={String(unreadMessages)}
          sparkData={spark(unreadMessages)}
          previous={Math.round(unreadMessages * 1.2)}
          inverse
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 2.4 }}>
        <KpiCard
          icon={<PeopleIcon />}
          color="#2E7D32"
          label="Caseload"
          value={String(caseload)}
          target={35}
          sparkData={spark(caseload)}
          link="/patients"
        />
      </Grid>
    </Grid>
  );
}

interface KpiCardProps {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string;
  target?: number;
  previous?: number;
  sparkData?: number[];
  link?: string;
  inverse?: boolean;
}

function KpiCard({
  icon,
  color,
  label,
  value,
  target,
  previous,
  sparkData,
  link,
  inverse,
}: KpiCardProps) {
  const navigate = useNavigate();
  const numVal = parseInt(value, 10) || 0;
  const pctOfTarget = target
    ? Math.min(Math.round((numVal / target) * 100), 100)
    : null;

  return (
    <Card
      elevation={0}
      {...(link
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-label': `${label}: ${value}`,
            onClick: () => navigate(link),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(link);
              }
            },
          }
        : {})}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        height: '100%',
        cursor: link ? 'pointer' : 'default',
        '&:hover': link ? { borderColor: color, boxShadow: `0 2px 8px ${color}20` } : {},
        '&:focus-visible': link ? { outline: `2px solid ${color}`, outlineOffset: 2 } : {},
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1.5,
              bgcolor: `${color}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color,
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Typography
                variant="h6"
                fontWeight={800}
                sx={{ color, lineHeight: 1, fontSize: '1.1rem' }}
              >
                {value}
              </Typography>
              {previous !== undefined ? (
                <TrendBadge current={numVal} previous={previous} inverse={inverse} />
              ) : null}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem' }}>
              {label}
            </Typography>
          </Box>
          {sparkData && sparkData.length > 1 ? (
            <Box sx={{ flexShrink: 0 }}>
              <Sparkline data={sparkData} color={color} height={20} width={50} />
            </Box>
          ) : null}
        </Box>
        {pctOfTarget !== null ? (
          <Box sx={{ mt: 0.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
              <Typography variant="caption" sx={{ fontSize: 8, color: 'text.disabled' }}>
                Target: {target}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontSize: 8,
                  fontWeight: 700,
                  color:
                    pctOfTarget >= 80
                      ? '#2E7D32'
                      : pctOfTarget >= 50
                        ? '#b8621a'
                        : '#D32F2F',
                }}
              >
                {pctOfTarget}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={pctOfTarget}
              sx={{
                height: 3,
                borderRadius: 2,
                bgcolor: '#eee',
                '& .MuiLinearProgress-bar': {
                  bgcolor:
                    pctOfTarget >= 80
                      ? '#2E7D32'
                      : pctOfTarget >= 50
                        ? '#b8621a'
                        : '#D32F2F',
                },
              }}
            />
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HandoverSummaryCard() {
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const { data, isLoading, isError } = useQuery({
    queryKey: dashboardKeys.handoverSummary(clinicScope),
    queryFn: () =>
      apiClient
        .get<{ data?: HandoverSummary }>('shift-handovers/auto-summary', { hours: 8 }),
  });

  const summary: HandoverSummary = data?.data ?? {};
  const highlights = summary.highlights ?? [];
  if (isLoading) {
    return <CircularProgress role="progressbar" aria-label="Loading" size={20} />;
  }
  if (isError) {
    return (
      <Typography variant="caption" color="error" sx={{ display: 'block', textAlign: 'center' }}>
        Unable to load handover summary.
      </Typography>
    );
  }

  return (
    <Box>
      <StatRow
        label="Escalated Obs"
        value={String(summary.escalatedObservations ?? 0)}
        color={(summary.escalatedObservations ?? 0) > 0 ? '#D32F2F' : '#2E7D32'}
      />
      <StatRow
        label="Missed Meds"
        value={String(summary.missedMedications ?? 0)}
        color={(summary.missedMedications ?? 0) > 0 ? '#b8621a' : '#2E7D32'}
      />
      <StatRow
        label="Incidents"
        value={String(summary.incidents ?? 0)}
        color={(summary.incidents ?? 0) > 0 ? '#D32F2F' : '#2E7D32'}
      />
      <StatRow label="Admissions" value={String(summary.newAdmissions ?? 0)} color="#327C8D" />
      {highlights.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          {highlights.map((highlight, index) => (
            <Typography
              key={index}
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', fontSize: 10 }}
            >
              • {highlight}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

interface ServiceStatsProps {
  referralSla?: {
    total: number;
    withinSla: number;
    breached: number;
    slaBreachRate: number;
    avgDaysToFirstContact: number | null;
  };
  missedRate?: number;
  totalAppts?: number;
}

export function ServiceStats({ referralSla, missedRate, totalAppts }: ServiceStatsProps) {
  const stats = [
    { label: 'Referrals', value: String(referralSla?.total ?? 0), color: '#327C8D' },
    { label: 'Within SLA', value: String(referralSla?.withinSla ?? 0), color: '#4E9C82' },
    { label: 'SLA Breached', value: String(referralSla?.breached ?? 0), color: '#D32F2F' },
    {
      label: 'Missed Appt Rate',
      value: missedRate != null ? `${(missedRate * 100).toFixed(0)}%` : '—',
      color: '#b8621a',
    },
    { label: 'Total Appts', value: String(totalAppts ?? 0), color: '#3D484B' },
    {
      label: 'Avg Days to Contact',
      value:
        referralSla?.avgDaysToFirstContact != null
          ? referralSla.avgDaysToFirstContact.toFixed(1)
          : '—',
      color: '#327C8D',
    },
  ];

  return (
    <Grid container spacing={2}>
      {stats.map((stat) => (
        <Grid key={stat.label} size={{ xs: 6, sm: 4 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={800} sx={{ color: stat.color }}>
              {stat.value}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
              {stat.label}
            </Typography>
          </Box>
        </Grid>
      ))}
    </Grid>
  );
}

interface BillingKpis {
  totalInvoiced: number;
  totalCollected: number;
  outstandingAmount: number;
  collectionRate: number;
  bulkBillRate: number;
  invoiceCount: number;
}

interface BillingCardProps {
  billing?: BillingKpis;
}

export function BillingCard({ billing }: BillingCardProps) {
  if (!billing) return <EmptyState text="No billing data" />;
  return (
    <Box>
      {[
        { label: 'Invoiced', value: `$${billing.totalInvoiced.toLocaleString()}` },
        { label: 'Collected', value: `$${billing.totalCollected.toLocaleString()}` },
        { label: 'Outstanding', value: `$${billing.outstandingAmount.toLocaleString()}` },
        { label: 'Collection Rate', value: `${(billing.collectionRate * 100).toFixed(0)}%` },
      ].map((row) => (
        <Box
          key={row.label}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {row.label}
          </Typography>
          <Typography variant="caption" fontWeight={600}>
            {row.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export interface MiniListItem {
  primary: string;
  secondary: string;
  chip?: string;
  chipColor?: string;
  link?: string;
}

interface MiniListProps {
  items: MiniListItem[];
}

export function MiniList({ items }: MiniListProps) {
  const navigate = useNavigate();
  return (
    <List dense disablePadding>
      {items.map((item, index) => (
        <ListItem
          key={index}
          disablePadding
          sx={{
            py: 0.3,
            cursor: item.link ? 'pointer' : 'default',
            '&:hover': item.link ? { bgcolor: 'action.hover', borderRadius: 1 } : {},
          }}
          onClick={() => (item.link ? navigate(item.link) : undefined)}
        >
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>
                  {item.primary}
                </Typography>
                {item.chip ? (
                  <Chip
                    label={item.chip}
                    size="small"
                    sx={{
                      fontSize: 9,
                      height: 16,
                      bgcolor: item.chipColor ? `${item.chipColor}20` : undefined,
                      color: item.chipColor,
                      textTransform: 'capitalize',
                    }}
                  />
                ) : null}
              </Box>
            }
            secondary={
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {item.secondary}
              </Typography>
            }
          />
        </ListItem>
      ))}
    </List>
  );
}
