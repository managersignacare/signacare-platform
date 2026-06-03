import { useEffect, useRef } from 'react';
import { apiClient, setCsrfToken } from '../services/apiClient';

interface CsrfResponse {
  csrfToken: string;
}

// Fetches the CSRF token from the server on mount and stores it in memory
// via `setCsrfToken`. Automatically attached to every subsequent API
// request by the Axios request interceptor.
export function useCsrf(): void {
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    apiClient
      .get<CsrfResponse>('auth/csrf')
      .then(({ csrfToken }) => {
        setCsrfToken(csrfToken);
      })
      .catch(() => {
        // Non-fatal: requests will proceed without CSRF header until retry.
        // The server will reject state-mutating requests – safe degradation.
        fetchedRef.current = false;
      });
  }, []);
}
