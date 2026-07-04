import AsyncStorage from "@react-native-async-storage/async-storage";
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
  phone: string;
  name: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  register: (name: string, phone: string, password: string) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  promoteToAdmin: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  register: async () => {},
  login: async () => {},
  logout: async () => {},
  promoteToAdmin: async () => {},
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem("auth_token"),
          AsyncStorage.getItem("auth_user"),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken);
    setUser(nextUser);
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

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
      }
    }
    setToken(null);
    setUser(null);
    await AsyncStorage.multiRemove(["auth_token", "auth_user"]);
  }, [token]);

  const promoteToAdmin = useCallback(
    async (password: string) => {
      if (!token) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/promote-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "كلمة مرور الإدارة غير صحيحة"));
      }
      const updated = await res.json();
      setUser(updated);
      await AsyncStorage.setItem("auth_user", JSON.stringify(updated));
    },
    [token]
  );

  return (
    <AuthContext.Provider
      value={{ user, token, loading, register, login, logout, promoteToAdmin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
