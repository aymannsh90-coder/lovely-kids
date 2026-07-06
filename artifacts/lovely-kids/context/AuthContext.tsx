import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth as useClerkAuth } from "@clerk/expo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { API_BASE } from "@/constants/api";

export interface AuthUser {
  id: string;
  phone: string | null;
  name: string;
  isAdmin: boolean;
  avatarUrl: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  register: (name: string, phone: string, password: string) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  promoteToAdmin: (password: string) => Promise<void>;
  getAuthToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  register: async () => {},
  login: async () => {},
  logout: async () => {},
  promoteToAdmin: async () => {},
  getAuthToken: async () => null,
});

async function parseErrorMessage(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return (data?.error as string) ?? fallback;
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [legacyToken, setLegacyToken] = useState<string | null>(null);
  const [legacyUser, setLegacyUser] = useState<AuthUser | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [clerkSyncedUser, setClerkSyncedUser] = useState<AuthUser | null>(null);

  const {
    isLoaded: clerkLoaded,
    isSignedIn: clerkSignedIn,
    signOut: clerkSignOut,
    getToken: clerkGetToken,
  } = useClerkAuth();

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem("auth_token"),
          AsyncStorage.getItem("auth_user"),
        ]);
        if (storedToken && storedUser) {
          setLegacyToken(storedToken);
          setLegacyUser(JSON.parse(storedUser));
        }
      } finally {
        setLegacyLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!clerkLoaded || legacyToken) {
      return;
    }
    if (!clerkSignedIn) {
      setClerkSyncedUser(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const clerkToken = await clerkGetToken();
        if (!clerkToken) return;
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${clerkToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setClerkSyncedUser(data);
      } catch {
        // keep previous state on network failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, clerkSignedIn, legacyToken, clerkGetToken]);

  const persist = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    setLegacyToken(nextToken);
    setLegacyUser(nextUser);
    await AsyncStorage.setItem("auth_token", nextToken);
    await AsyncStorage.setItem("auth_user", JSON.stringify(nextUser));
  }, []);

  const register = useCallback(
    async (name: string, phone: string, password: string) => {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, password }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "فشل إنشاء الحساب"));
      }
      const data = await res.json();
      await persist(data.token, data.user);
    },
    [persist]
  );

  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "فشل تسجيل الدخول"));
      }
      const data = await res.json();
      await persist(data.token, data.user);
    },
    [persist]
  );

  const getAuthToken = useCallback(async () => {
    if (legacyToken) return legacyToken;
    if (clerkSignedIn) return clerkGetToken();
    return null;
  }, [legacyToken, clerkSignedIn, clerkGetToken]);

  const logout = useCallback(async () => {
    if (legacyToken) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${legacyToken}` },
        });
      } catch {
      }
      setLegacyToken(null);
      setLegacyUser(null);
      await AsyncStorage.multiRemove(["auth_token", "auth_user"]);
    }
    if (clerkSignedIn) {
      try {
        await clerkSignOut();
      } catch {
      }
      setClerkSyncedUser(null);
    }
  }, [legacyToken, clerkSignedIn, clerkSignOut]);

  const promoteToAdmin = useCallback(
    async (password: string) => {
      const authToken = await getAuthToken();
      if (!authToken) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/promote-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "كلمة مرور الإدارة غير صحيحة"));
      }
      const updated = await res.json();
      if (legacyToken) {
        setLegacyUser(updated);
        await AsyncStorage.setItem("auth_user", JSON.stringify(updated));
      } else {
        setClerkSyncedUser(updated);
      }
    },
    [legacyToken, getAuthToken]
  );

  const user = legacyUser ?? clerkSyncedUser;
  const loading = legacyLoading || !clerkLoaded;

  return (
    <AuthContext.Provider
      value={{ user, loading, register, login, logout, promoteToAdmin, getAuthToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
