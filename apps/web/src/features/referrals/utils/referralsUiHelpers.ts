export const PERIOD_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '1m', label: 'Last Month' },
  { value: '3m', label: 'Last 3 Months' },
  { value: '6m', label: 'Last 6 Months' },
  { value: '12m', label: 'Last 12 Months' },
] as const;

export function periodToDateRange(period: string): { fromDate?: string; toDate?: string } {
  if (period === 'all') return {};
  const now = new Date();
  const from = new Date(now);
  if (period === '7d') from.setDate(from.getDate() - 7);
  else if (period === '1m') from.setMonth(from.getMonth() - 1);
  else if (period === '3m') from.setMonth(from.getMonth() - 3);
  else if (period === '6m') from.setMonth(from.getMonth() - 6);
  else if (period === '12m') from.setFullYear(from.getFullYear() - 1);
  return { fromDate: from.toISOString().split('T')[0], toDate: now.toISOString().split('T')[0] };
}

export function readApiError(err: unknown): string {
  const maybe = err as { response?: { data?: { error?: string } }; message?: string };
  return maybe?.response?.data?.error ?? maybe?.message ?? 'Unknown error';
}

const ACCEPTED_STATUSES = new Set([
  'accepted',
  'appointment_booked',
]);

const REJECTED_STATUSES = new Set([
  'rejected',
  'redirected',
  'expired',
  'closed_no_response',
]);

export function isAcceptedReferralStatus(status: string | null | undefined): boolean {
  return ACCEPTED_STATUSES.has((status ?? '').toLowerCase());
}

export function isRejectedReferralStatus(status: string | null | undefined): boolean {
  return REJECTED_STATUSES.has((status ?? '').toLowerCase());
}

export function isActiveIntakeReferralStatus(status: string | null | undefined): boolean {
  return !isAcceptedReferralStatus(status) && !isRejectedReferralStatus(status);
}
