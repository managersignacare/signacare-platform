import LockIcon from '@mui/icons-material/Lock';
import { Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  canApproveEctTmsForms,
  canCompleteEctTmsForms,
  isPrescriberSystemRole,
  requiresConsultantApprovalForEctTms,
} from '@signacare/shared';
import React from 'react';
import { patientsKeys } from '../../../queryKeys';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../../shared/store/authStore';
import type { StaffPrescriberRow } from './ectTabSupport';

export function useEctPrescriberStatus() {
  const userRole = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const { data } = useQuery({
    queryKey: patientsKeys.staffPrescriber(userId),
    queryFn: async () => {
      if (!userId) return { isPrescriber: false, prescriberNumber: null };
      try {
        const staff = await apiClient.get<StaffPrescriberRow>(`staff/${userId}`);
        const num = staff?.prescriberNumber ?? staff?.prescriber_number ?? null;
        return { isPrescriber: isPrescriberSystemRole(userRole) && !!num, prescriberNumber: num };
      } catch {
        return { isPrescriber: false, prescriberNumber: null };
      }
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  return data ?? { isPrescriber: false, prescriberNumber: null };
}

export function EctPrescriberGate({ children }: { children: React.ReactNode }) {
  const { isPrescriber } = useEctPrescriberStatus();
  if (isPrescriber) return <>{children}</>;
  return (
    <Alert role="alert" severity="warning" icon={<LockIcon />} sx={{ fontSize: 12 }}>
      <strong>Prescriber role required.</strong> Only prescriber system roles with a registered prescriber number can create ECT prescriptions.
      Contact your administrator to assign a prescriber role and add your prescriber number in Staff Management.
    </Alert>
  );
}

export function EctTmsRoleWorkflowNotice({
  role,
  modality,
}: {
  role: string | null | undefined;
  modality: 'ECT' | 'TMS';
}) {
  if (requiresConsultantApprovalForEctTms(role)) {
    return (
      <Alert severity="info">
        This {modality} form will save as pending consultant approval. A prescriber consultant must approve it before it is treated as final.
      </Alert>
    );
  }
  if (canApproveEctTmsForms(role)) {
    return (
      <Alert severity="success">
        You are signed in as a prescriber consultant. Saving this {modality} form records consultant approval immediately.
      </Alert>
    );
  }
  if (!canCompleteEctTmsForms(role)) {
    return (
      <Alert severity="warning" icon={<LockIcon />}>
        {modality} forms can only be completed by psychiatry prescriber roles.
      </Alert>
    );
  }
  return null;
}
