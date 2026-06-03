// apps/web/src/features/pathology/hooks/usePathology.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pathologyApi } from '../services/pathologyApi';
import { pathologyKeys } from '../queryKeys';
import type { CreateLabOrderDTO } from '../types/pathologyTypes';

export const useLabOrders = (patientId: string) =>
  useQuery({
    queryKey: pathologyKeys.orders(patientId),
    queryFn: () => pathologyApi.listOrders(patientId),
    enabled: !!patientId,
  });

export const useLabOrder = (id: string) =>
  useQuery({
    queryKey: pathologyKeys.order(id),
    queryFn: () => pathologyApi.getOrder(id),
    enabled: !!id,
  });

export const useLabResults = (patientId: string) =>
  useQuery({
    queryKey: pathologyKeys.results(patientId),
    queryFn: () => pathologyApi.listResults(patientId),
    enabled: !!patientId,
  });

export const useCreateLabOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLabOrderDTO) => pathologyApi.createOrder(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: pathologyKeys.all }),
  });
};

export const useCancelLabOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pathologyApi.cancelOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: pathologyKeys.all }),
  });
};

export const useAcknowledgeCriticalResult = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resultId: string) =>
      pathologyApi.acknowledgeCritical(resultId),
    onSuccess: () => qc.invalidateQueries({ queryKey: pathologyKeys.all }),
  });
};
