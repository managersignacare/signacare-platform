// apps/web/src/features/auth/hooks/useLogout.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/authApi';
import { useAuthStore } from '../../../store/authStore';
import { MFA_TEMP_KEY } from '../types/authTypes';
import { useBrandingStore } from '../../../shared/store/brandingStore';

export function useLogout() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const resetBranding = useBrandingStore((s) => s.resetBranding);
  const queryClient = useQueryClient();

  // @no-invalidate-needed: queryClient.clear() is a stronger cache reset than per-key invalidation on logout.
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      sessionStorage.removeItem(MFA_TEMP_KEY);
      logout();
      resetBranding();
      queryClient.clear();
      void navigate('/login', { replace: true });
    },
  });
}
