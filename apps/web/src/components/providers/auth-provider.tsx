"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest, apiRequestWithRefresh, type AuthPayload, type User } from "@/lib/api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearAuth = useCallback(() => {
    setUser(null);
    setError(null);
    if (typeof window !== "undefined") {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("netsleuth:")) window.localStorage.removeItem(key);
      }
    }
  }, []);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequestWithRefresh<AuthPayload>("/api/v1/auth/me");
      setUser(payload.user);
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        clearAuth();
        router.replace("/login");
      } else if (requestError instanceof ApiError) {
        setError(requestError.message);
      } else {
        setError("Unable to verify your session.");
      }
    } finally {
      setLoading(false);
    }
  }, [clearAuth, router]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await apiRequest<undefined>("/api/v1/auth/logout", { method: "POST" });
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Logout failed. Please try again.");
      return;
    }
    clearAuth();
    router.replace("/login");
  }, [clearAuth, router]);

  const value = useMemo(
    () => ({ user, loading, error, refreshUser, logout, clearAuth }),
    [user, loading, error, refreshUser, logout, clearAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
