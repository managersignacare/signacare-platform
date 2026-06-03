// apps/web/src/features/auth/hooks/useCurrentUser.ts
import { useQuery } from '@tanstack/react-query';
import { authApi } from '../services/authApi';
import { useAuthStore } from '../../../store/authStore';
import { authKeys } from '../queryKeys';

export function useCurrentUser() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: authKeys.me(),
    queryFn: authApi.getMe,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}
