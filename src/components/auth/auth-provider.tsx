"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SafeUser } from "@/lib/db-types";
import { utilisateurDepuisApi } from "@/lib/api-localization";
import { setLibraryScope } from "@/lib/library";

type AuthState = {
  user: SafeUser | null;
  loading: boolean;
  refresh: () => Promise<SafeUser | null>;
  signOut: () => Promise<void>;
  setUser: (user: SafeUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);
const SERVER_AUTH_FALLBACK: AuthState = {
  user: null,
  loading: true,
  refresh: async () => null,
  signOut: async () => undefined,
  setUser: () => undefined,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applyUser = useCallback((next: SafeUser | null) => {
    setUser(next);
    // Chaque compte a sa propre bibliothèque locale : on bascule avant de
    // déclencher la synchronisation, sinon les reprises se mélangent.
    setLibraryScope(next?.id ?? null);
    window.dispatchEvent(new CustomEvent("animevision:auth-changed", { detail: { userId: next?.id ?? null } }));
    const root = document.documentElement;
    root.dataset.theme = next?.preferences.appearance === "light" ? "light" : "dark";
    root.dataset.textSize = next?.preferences.textSize === "large" ? "large" : "normal";
    root.dataset.contrast = next?.preferences.highContrast ? "high" : "normal";
    if (next?.preferences.reduceMotion) root.classList.add("reduce-motion");
    else root.classList.remove("reduce-motion");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/authentification/me", { cache: "no-store" });
      if (!response.ok) {
        applyUser(null);
        return null;
      }
      const data = (await response.json()) as { utilisateur?: unknown };
      const user = utilisateurDepuisApi(data.utilisateur);
      applyUser(user);
      return user;
    } catch {
      applyUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/authentification/logout", { method: "POST" });
    } finally {
      applyUser(null);
      window.location.assign("/");
    }
  }, [applyUser]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, signOut, setUser: applyUser }),
    [user, loading, refresh, signOut, applyUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthState {
  // Les composants client sont aussi pré-rendus dans le flux serveur de Next.
  // À cette étape, le contexte client peut être absent; il sera fourni à l'hydratation.
  return useOptionalAuth() ?? SERVER_AUTH_FALLBACK;
}
