export function toErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const maybeErr = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  if (typeof maybeErr.response?.data?.error === 'string' && maybeErr.response.data.error.trim()) {
    return maybeErr.response.data.error;
  }
  if (typeof maybeErr.response?.data?.message === 'string' && maybeErr.response.data.message.trim()) {
    return maybeErr.response.data.message;
  }
  if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) {
    return maybeErr.message;
  }
  return fallback;
}

interface TeamAssignmentResolverRow {
  effectivePrimaryClinicianId?: string | null;
  openEpisodePrimaryClinicianId?: string | null;
  primaryClinicianId?: string | null;
  openEpisodeKeyWorkerId?: string | null;
  keyWorkerId?: string | null;
  mdt?: Array<Record<string, unknown>> | null;
  orgUnitId?: string | null;
  openEpisodeTeamId?: string | null;
}

export function resolvePrimaryClinicianId(row: TeamAssignmentResolverRow): string | null {
  return row.effectivePrimaryClinicianId
    ?? row.openEpisodePrimaryClinicianId
    ?? row.primaryClinicianId
    ?? row.openEpisodeKeyWorkerId
    ?? row.keyWorkerId
    ?? null;
}

export function rowIncludesClinician(
  row: TeamAssignmentResolverRow,
  clinicianId: string | null | undefined,
): boolean {
  if (!clinicianId) return false;
  const candidates = [
    row.primaryClinicianId,
    row.effectivePrimaryClinicianId,
    row.openEpisodePrimaryClinicianId,
    row.openEpisodeKeyWorkerId,
    row.keyWorkerId,
  ];
  if (candidates.some((value) => value === clinicianId)) {
    return true;
  }

  const mdt = Array.isArray(row.mdt) ? row.mdt : [];
  for (const item of mdt) {
    const staffIdValue = item?.staff_id ?? item?.staffId;
    if (typeof staffIdValue === 'string' && staffIdValue === clinicianId) {
      return true;
    }
  }
  return false;
}

export function resolveTeamId(row: TeamAssignmentResolverRow): string | null {
  return row.orgUnitId ?? row.openEpisodeTeamId ?? null;
}
