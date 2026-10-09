import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUserDto } from "@mdb/shared";
import { useApi } from "./context";

type AuthState = {
  authenticated: boolean;
  user: AuthUserDto | null;
  /** True until the server has said who's signed in. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Who's signed in, asked of the server on start. How the session is kept is
 * the API client's business (a cookie on the web, a token in the app).
 */
export function AuthProvider({ children }: { children?: ReactNode }) {
  const api = useApi();
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [api]);

  const value: AuthState = {
    authenticated: user !== null,
    user,
    loading,
    login: async (username, password) => {
      await api.login(username, password);
      setUser((await api.me()).user);
    },
    register: async (username, password) => {
      await api.register(username, password);
      setUser((await api.me()).user);
    },
    logout: async () => {
      await api.logout();
      setUser(null);
    },
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
