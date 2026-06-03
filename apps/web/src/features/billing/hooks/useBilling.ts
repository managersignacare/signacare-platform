import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../services/billingApi';
import { billingKeys } from '../queryKeys';
import type { InvoiceCreateDTO, PaymentCreateDTO, InvoiceApproveDTO } from '@signacare/shared';
import type { ClaimResponse, SubmitClaimDTO } from '../types/billingTypes';

export const useInvoices = (params: {
  patientId?: string;
  status?: string;
  billingType?: string;
}) =>
  useQuery({
    queryKey: billingKeys.invoices(params),
    queryFn: () => billingApi.listInvoices(params),
  });

export const useInvoice = (id: string) =>
  useQuery({
    queryKey: billingKeys.invoice(id),
    queryFn: () => billingApi.getInvoice(id),
    enabled: !!id,
  });

export const useCreateInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: InvoiceCreateDTO) => billingApi.createInvoice(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useApproveInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: InvoiceApproveDTO }) => billingApi.approveInvoice(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useSendInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingApi.sendInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useCancelInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingApi.voidInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useRecordPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: PaymentCreateDTO) => billingApi.recordPayment(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

// Legacy — kept for backward compat with old ClaimStatusPanel
export const useClaims = (_params: Record<string, string | undefined>) =>
  useQuery({
    queryKey: billingKeys.claims(),
    queryFn: () => Promise.resolve<ClaimResponse[]>([]),
  });

export const useSubmitClaim = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (_dto: SubmitClaimDTO) => Promise.resolve({ ok: true } as const),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
};
