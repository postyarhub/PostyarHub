import './lib/routeEvents';
import './wordpressTools';
import './lib/planAccessRuntime';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './lib/toast';
import './styles/theme.css';
import './styles/shell.css';
import './styles/landing.css';
import './styles/chart.css';
import './theme.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

/**
 * Register the PWA service worker (production builds only).
 * Registration must never break the app or log noisy errors: any failure is
 * swallowed silently, and unsupported browsers (e.g. Safari private mode)
 * simply skip registration.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Vite statically replaces import.meta.env at build time; the cast keeps
  // strict tsc happy without adding ambient type references.
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if (!env || !env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

registerServiceWorker();
