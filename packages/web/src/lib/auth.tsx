import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUserDto } from "@mdb/shared";
import { api } from "./api";
import { IS_NATIVE, nativeRetryAuth, nativeSignOut, onAuthChanged } from "./platform";

type AuthState = {
  authenticated: boolean;
  user: AuthUserDto | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      let r = await api.me().catch(() => null);
      if (IS_NATIVE && !r?.authenticated && (await nativeRetryAuth())) r = await api.me().catch(() => null);
      setUser(r?.user ?? null);
      setLoading(false);
    };
    void check();
    // The app signs in and out outside React (OAuth redirect, expired refresh token).
    return IS_NATIVE ? onAuthChanged(() => void check()) : undefined;
  }, []);

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
      if (IS_NATIVE) await nativeSignOut();
      else await api.logout();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
