import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useCsrf } from '../../hooks/useCsrf';
import { useInactivityTimer } from '../../hooks/useInactivityTimer';
import { useBrandingLoader } from '../../hooks/useBrandingLoader';
import { SessionWarningDialog } from '../ui/SessionWarningDialog';

interface Props {
  children: React.ReactNode;
}

export function AuthGuard({ children }: Props): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const requiresMfa = useAuthStore((s) => s.requiresMfa);
  const location = useLocation();

  useCsrf();
  useInactivityTimer();
  useBrandingLoader();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiresMfa) {
    return <Navigate to="/mfa" state={{ from: location }} replace />;
  }

  return (
    <>
      {children}
      <SessionWarningDialog />
    </>
  );
}
