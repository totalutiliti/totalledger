'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginResponse, User } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredAuth(): { accessToken: string; refreshToken: string; user: User } | null {
  if (typeof window === 'undefined') return null;
  try {
    const accessToken = localStorage.getItem('tl_access_token');
    const refreshToken = localStorage.getItem('tl_refresh_token');
    const userStr = localStorage.getItem('tl_user');
    if (accessToken && refreshToken && userStr) {
      const user = JSON.parse(userStr) as User;
      return { accessToken, refreshToken, user };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function storeAuth(accessToken: string, refreshToken: string, user: User): void {
  localStorage.setItem('tl_access_token', accessToken);
  localStorage.setItem('tl_refresh_token', refreshToken);
  localStorage.setItem('tl_user', JSON.stringify(user));
}

function clearAuth(): void {
  localStorage.removeItem('tl_access_token');
  localStorage.removeItem('tl_refresh_token');
  localStorage.removeItem('tl_user');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshTokenValue, setRefreshTokenValue] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored) {
      setAccessToken(stored.accessToken);
      setRefreshTokenValue(stored.refreshToken);
      setUser(stored.user);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Erro ao fazer login' }));
      throw new Error(
        (error as { message?: string }).message || 'Credenciais inválidas',
      );
    }

    const data = (await res.json()) as { data: LoginResponse };
    const { tokens, user: u } = data.data;

    storeAuth(tokens.accessToken, tokens.refreshToken, u);
    setAccessToken(tokens.accessToken);
    setRefreshTokenValue(tokens.refreshToken);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAccessToken(null);
    setRefreshTokenValue(null);
    setUser(null);
  }, []);

  const refreshAccessToken = useCallback(async () => {
    if (!refreshTokenValue) {
      logout();
      return;
    }

    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshTokenValue }),
    });

    if (!res.ok) {
      logout();
      return;
    }

    const data = (await res.json()) as {
      data: { accessToken: string; refreshToken: string };
    };
    const { accessToken: newAt, refreshToken: newRt } = data.data;

    if (user) {
      storeAuth(newAt, newRt, user);
    }
    setAccessToken(newAt);
    setRefreshTokenValue(newRt);
  }, [refreshTokenValue, user, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isAuthenticated: !!accessToken && !!user,
      isLoading,
      login,
      logout,
      refreshAccessToken,
    }),
    [user, accessToken, isLoading, login, logout, refreshAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return ctx;
}
