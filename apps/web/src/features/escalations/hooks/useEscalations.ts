import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { escalationApi } from '../services/escalationApi';
import { escalationKeys } from '../queryKeys';
import type {
  CreateEscalationDTO,
  UpdateEscalationDTO,
} from '../types/escalationTypes';

// Re-export for existing consumers that imported escalationKeys from this hook file.
export { escalationKeys };

interface MutationErrorShape {
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: string;
      code?: string;
    };
  };
}

function asMutationError(err: unknown): MutationErrorShape {
  return typeof err === 'object' && err !== null ? (err as MutationErrorShape) : {};
}

function getErrorMessage(err: unknown): string {
  const parsed = asMutationError(err);
  return parsed.response?.data?.error ?? parsed.message ?? 'Unknown';
}

function isOptimisticLockConflict(err: unknown): boolean {
  const parsed = asMutationError(err);
  return parsed.response?.status === 409 && parsed.response?.data?.code === 'OPTIMISTIC_LOCK_CONFLICT';
}

export function useEscalations(patientId: string, episodeId?: string) {
  return useQuery({
    queryKey: episodeId
      ? escalationKeys.byEpisode(patientId, episodeId)
      : escalationKeys.all(patientId),
    queryFn: () => escalationApi.listByPatient(patientId, episodeId),
    enabled: Boolean(patientId),
    staleTime: 5 * 60 * 1000, // Keep cached for 5 min to survive tab switches
    gcTime: 10 * 60 * 1000,   // Don't garbage collect for 10 min
  });
}

export function useEscalation(id: string) {
  return useQuery({
    queryKey: escalationKeys.detail(id),
    queryFn: () => escalationApi.getById(id),
    enabled: Boolean(id),
  });
}

export function useCreateEscalation(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEscalationDTO) => escalationApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
    },
    onError: (err: unknown) => alert(`Failed to create escalation: ${getErrorMessage(err)}`),
  });
}

export function useUpdateEscalation(patientId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateEscalationDTO) => escalationApi.update(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
      qc.invalidateQueries({ queryKey: escalationKeys.detail(id) });
    },
    onError: (err: unknown) => alert(`Failed to update escalation: ${getErrorMessage(err)}`),
  });
}

export function useAcknowledgeEscalation(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => escalationApi.acknowledge(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
      qc.invalidateQueries({ queryKey: escalationKeys.detail(id) });
    },
    onError: (err: unknown) => alert(`Failed to acknowledge: ${getErrorMessage(err)}`),
  });
}

export function useResolveEscalation(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion. Caller
    // reads from cached EscalationResponse.lockVersion. On 409 the helper
    // throws AppError(409, 'OPTIMISTIC_LOCK_CONFLICT'); UI invalidates +
    // surfaces refresh-and-retry message.
    mutationFn: ({ id, notes, expectedLockVersion }: { id: string; notes: string; expectedLockVersion: number }) =>
      escalationApi.resolve(id, notes, expectedLockVersion),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
      qc.invalidateQueries({ queryKey: escalationKeys.detail(id) });
    },
    onError: (err: unknown) => {
      if (isOptimisticLockConflict(err)) {
        qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
        alert('Another clinician edited this escalation. The list has been refreshed — please review and retry.');
        return;
      }
      alert(`Failed to resolve: ${getErrorMessage(err)}`);
    },
  });
}

export function useAddEscalationNote(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion.
    mutationFn: ({ id, notes, expectedLockVersion }: { id: string; notes: string; expectedLockVersion: number }) =>
      escalationApi.addNote(id, notes, expectedLockVersion),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
      qc.invalidateQueries({ queryKey: escalationKeys.detail(id) });
    },
    onError: (err: unknown) => {
      if (isOptimisticLockConflict(err)) {
        qc.invalidateQueries({ queryKey: escalationKeys.all(patientId) });
        alert('Another clinician edited this escalation. The list has been refreshed — please review and retry.');
        return;
      }
      alert(`Failed to add note: ${getErrorMessage(err)}`);
    },
  });
}
