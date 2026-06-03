// apps/web/src/features/auth/hooks/useLogin.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { LoginDTO, MFAVerifyDTO } from '@signacare/shared';
import { authApi } from '../services/authApi';
import { useAuthStore } from '../../../store/authStore';
import { MFA_TEMP_KEY } from '../types/authTypes';
import { authKeys } from '../queryKeys';
import { useBrandingStore } from '../../../shared/store/brandingStore';

export function useLogin() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const resetBranding = useBrandingStore((s) => s.resetBranding);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: LoginDTO) => authApi.login(dto),
    onSuccess: (result) => {
      // Cross-tenant cache hard reset on identity transition. Without
      // this, query caches (e.g. staff/lookup, branding/me) can remain
      // fresh across re-login and briefly render the prior clinic's data.
      queryClient.clear();
      resetBranding();

      if (result.requiresMfa) {
        sessionStorage.setItem(MFA_TEMP_KEY, result.tempToken);
        void navigate('/mfa');
      } else if (result.mustChangePassword) {
        // Authenticate the session but redirect to force password change
        login(result.user);
        void navigate('/change-password?forced=1');
      } else {
        login(result.user);
        void queryClient.invalidateQueries({ queryKey: authKeys.all });
        void navigate('/dashboard');
      }
    },
  });
}

export function useVerifyMfa() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const resetBranding = useBrandingStore((s) => s.resetBranding);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (totpCode: string) => {
      const tempToken = sessionStorage.getItem(MFA_TEMP_KEY) ?? '';
      const dto: MFAVerifyDTO = { tempToken, token: totpCode };
      return authApi.verifyMfa(dto);
    },
    onSuccess: (user) => {
      sessionStorage.removeItem(MFA_TEMP_KEY);
      queryClient.clear();
      resetBranding();
      login(user);
      void queryClient.invalidateQueries({ queryKey: authKeys.all });
      void navigate('/dashboard');
    },
  });
}
