"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, clearAuth } from "./api";

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  facilityId?: string | null;
  facility?: { id: string; name: string; code: string } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchFacility: (facilityId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("scm_user") || localStorage.getItem("medflow_user");
    if (stored && getToken()) {
      setUser(JSON.parse(stored));
      api<User>("/auth/me")
        .then((u) => {
          setUser(u);
          localStorage.setItem("scm_user", JSON.stringify(u));
        })
        .catch(() => clearAuth())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    setUser(res.user);
    localStorage.setItem("scm_user", JSON.stringify(res.user));
  };

  const logout = () => {
    clearAuth();
    setUser(null);
    window.location.href = "/login";
  };

  const switchFacility = async (facilityId: string) => {
    const res = await api<{ token: string; facility: { id: string; name: string; code: string } }>(
      "/auth/switch-facility",
      { method: "POST", body: JSON.stringify({ facilityId }) }
    );
    setToken(res.token);
    const updated = { ...user!, facilityId, facility: res.facility };
    setUser(updated);
    localStorage.setItem("scm_user", JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, switchFacility }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
