import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, setClientSessionToken } from '@/lib/api';
import type { PlatformSettings, UserAccount, UserRole } from '@/types';

interface AuthContextValue {
  user: UserAccount | null;
  settings: PlatformSettings | null;
  loading: boolean;
  login: (username: string, password: string, expectedRole?: UserRole) => Promise<UserAccount>;
  registerParent: (payload: Record<string, unknown>) => Promise<UserAccount>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_SETTINGS: PlatformSettings = {
  schoolName: 'Bright Riders School',
  schoolCampus: 'Abu Dhabi Campus, UAE',
  currencyCode: 'AED',
  cancellationCutoffMinutes: 60,
  collectionSlots: [
    {
      id: 'morning-recess',
      label: 'Morning Recess (09:45 AM – 10:15 AM)',
      shortLabel: '09:45 AM – 10:15 AM',
    },
    {
      id: 'junior-lunch',
      label: 'Primary Lunch Break (12:00 PM – 12:40 PM)',
      shortLabel: '12:00 PM – 12:40 PM',
    },
    {
      id: 'senior-lunch',
      label: 'Secondary Lunch Break (12:45 PM – 01:25 PM)',
      shortLabel: '12:45 PM – 01:25 PM',
    },
    {
      id: 'after-school',
      label: 'After-School Dismissal Snack (02:15 PM – 02:40 PM)',
      shortLabel: '02:15 PM – 02:40 PM',
    },
  ],
  paymentMode: 'brs_sandbox_aed',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: UserAccount; settings: PlatformSettings }>('/api/auth/me');
      setUser(data.user);
      setSettings(data.settings);
    } catch {
      setClientSessionToken(null);
      setUser(null);
      try {
        const pub = await apiFetch<{ settings: PlatformSettings }>('/api/auth/public-config');
        setSettings(pub.settings);
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (username: string, password: string, expectedRole?: UserRole) => {
      const data = await apiFetch<{
        sessionToken?: string;
        user: UserAccount;
        settings: PlatformSettings;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, expectedRole }),
      });
      if (data.sessionToken) {
        setClientSessionToken(data.sessionToken);
      }
      setUser(data.user);
      setSettings(data.settings);
      return data.user;
    },
    []
  );

  const registerParent = useCallback(async (payload: Record<string, unknown>) => {
    const data = await apiFetch<{
      sessionToken?: string;
      user: UserAccount;
      settings: PlatformSettings;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setClientSessionToken(data.sessionToken);
    }
    setUser(data.user);
    setSettings(data.settings);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setClientSessionToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        settings,
        loading,
        login,
        registerParent,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
