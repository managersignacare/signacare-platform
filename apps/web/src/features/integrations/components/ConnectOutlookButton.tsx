// apps/web/src/features/integrations/components/ConnectOutlookButton.tsx
import { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';

export function ConnectOutlookButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get<{ url: string }>('integrations/outlook/auth-url');
      window.location.href = res.url;
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to get Outlook auth URL', err);
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={loading}>
      {loading ? 'Redirecting to Outlook…' : 'Connect Outlook calendar'}
    </button>
  );
}