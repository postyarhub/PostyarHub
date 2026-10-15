import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiRequestError, setCsrfToken, type MeResponse } from '../lib/api';
import { setAppTimeZone } from './format';

interface AuthState {
  loading: boolean;
  me: MeResponse | null;
  refresh: () => Promise<void>;
  establish: (data: MeResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const establish = useCallback((data: MeResponse) => {
    setCsrfToken(data.csrfToken);
    setAppTimeZone(data.user.timezone);
    setMe(data);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<MeResponse>('/api/v1/auth/me');
      establish(data);
    } catch (err) {
      const authFailure = err instanceof ApiRequestError && (err.code === 'AUTH_REQUIRED' || err.code === 'SESSION_EXPIRED');
      if (authFailure) {
        setMe(null);
        setCsrfToken(null);
      }
      setLoading(false);
    }
  }, [establish]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } finally {
      setMe(null);
      setCsrfToken(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ loading, me, refresh, establish, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
