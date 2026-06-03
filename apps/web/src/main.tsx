// apps/web/src/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignacareThemeProvider } from './shared/theme/ThemeProvider';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Signacare root element #root not found in DOM');
}

createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SignacareThemeProvider>
        <App />
      </SignacareThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);