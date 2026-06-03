// apps/web/src/features/calendar/hooks/useCalendarBlocks.ts
//
// Phase 13 PR3 — read + write hooks for the per-clinician availability
// blocks. Every mutation invalidates calendarKeys.blocks(clinicianId)
// AND calendarKeys.today(clinicianId, *) per CLAUDE.md §4.1 so the
// grid editor and the today panel both refresh without a manual
// reload after a paint operation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvailabilityBlock,
  AvailabilityBlockCreateDTO,
  AvailabilityBlockUpdateDTO,
} from '@signacare/shared';
import { calendarApi } from '../services/calendarApi';
import { calendarKeys } from '../queryKeys';

export function useCalendarBlocks(clinicianId?: string) {
  return useQuery({
    queryKey: calendarKeys.blocks(clinicianId),
    queryFn: () =>
      calendarApi
        .listBlocks(clinicianId ? { clinicianId } : undefined)
        .then((r) => r.blocks),
    staleTime: 30_000,
  });
}

export function useCreateBlock(clinicianId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: AvailabilityBlockCreateDTO) => calendarApi.createBlock(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.blocks(clinicianId) });
      qc.invalidateQueries({ queryKey: calendarKeys.todayAll() });
    },
  });
}

export function useUpdateBlock(clinicianId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: AvailabilityBlockUpdateDTO;
    }): Promise<AvailabilityBlock> => calendarApi.updateBlock(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.blocks(clinicianId) });
      qc.invalidateQueries({ queryKey: calendarKeys.todayAll() });
    },
  });
}

export function useDeleteBlock(clinicianId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => calendarApi.deleteBlock(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.blocks(clinicianId) });
      qc.invalidateQueries({ queryKey: calendarKeys.todayAll() });
    },
  });
}
