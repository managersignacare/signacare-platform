import { Alert, Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { canAccessRoute } from '../../utils/frontendAccessPolicy';

interface RouteAccessGuardProps {
  children: React.ReactNode;
  routePath?: string;
}

export function RouteAccessGuard({
  children,
  routePath,
}: RouteAccessGuardProps): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const targetPath = routePath ?? location.pathname;

  if (!canAccessRoute(user, targetPath)) {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied for this route.
        </Alert>
      </Box>
    );
  }

  return <>{children}</>;
}

