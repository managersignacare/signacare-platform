// apps/web/src/features/auth/pages/MfaPage.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MfaForm } from '../components/MfaForm';
import { MFA_TEMP_KEY } from '../types/authTypes';

export default function MfaPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionStorage.getItem(MFA_TEMP_KEY)) {
      void navigate('/login', { replace: true });
    }
  }, [navigate]);

  return <MfaForm />;
}
