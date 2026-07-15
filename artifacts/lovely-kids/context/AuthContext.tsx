import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/constants/api";

export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string;
  isAdmin: boolean;
  avatarUrl: string | null;
  deliveryAddress: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  register: (name: string, phone: string, email: string, password: string) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  promoteToAdmin: (password: string) => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  updateProfile: (data: { name?: string; deliveryAddress?: string; phone?: string; email?: string; currentPassword?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  pendingVerification: boolean;
  verifyEmail: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  register: async () => {},
  login: async () => {},
  logout: async () => {},
  promoteToAdmin: async () => {},
  getAuthToken: async () => null,
  updateProfile: async (_data) => {},
  changePassword: async () => {},
  pendingVerification: false,
  verifyEmail: async () => {},
});

const SESSION_KEY = "session_token";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const d = await res.json();
    return (d?.error as string) ?? fallback;
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [dbUser, setDbUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);

  // On mount: restore session from AsyncStorage and verify it's still valid.
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(SESSION_KEY);
        if (token) {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            setSessionToken(token);
            setDbUser(await res.json());
          } else {
            await AsyncStorage.removeItem(SESSION_KEY);
          }
        }
      } catch {
        // Network error on startup — don't crash, just show login form.
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

  // Save a new session returned by /register or /login.
  const saveSession = useCallback(async (token: string, user: AuthUser) => {
    await AsyncStorage.setItem(SESSION_KEY, token);
    setSessionToken(token);
    setDbUser(user);
  }, []);

  // ─── register ─────────────────────────────────────────────────────────────
  const register = useCallback(
    async (name: string, phone: string, email: string, password: string) => {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, password }),
      });
      if (!res.ok) throw new Error(await parseError(res, "حدث خطأ في إنشاء الحساب"));
      const data = (await res.json()) as { token: string; user: AuthUser };
      await saveSession(data.token, data.user);
    },
    [saveSession]
  );

  // ─── login ────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      if (!res.ok) throw new Error(await parseError(res, "رقم الجوال أو كلمة المرور غير صحيحة"));
      const data = (await res.json()) as { token: string; user: AuthUser };
      await saveSession(data.token, data.user);
    },
    [saveSession]
  );

  // ─── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const token = sessionToken;
    setSessionToken(null);
    setDbUser(null);
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem("@lovely_kids_biometric_enabled");
    if (token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [sessionToken]);

  // ─── getAuthToken ─────────────────────────────────────────────────────────
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    return sessionToken;
  }, [sessionToken]);

  // ─── verifyEmail (no-op — no Clerk email verification in this flow) ────────
  const verifyEmail = useCallback(async (_code: string) => {
    // Registration completes immediately; no email verification step needed.
  }, []);

  // ─── promoteToAdmin ───────────────────────────────────────────────────────
  const promoteToAdmin = useCallback(
    async (password: string) => {
      if (!sessionToken) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/promote-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error(await parseError(res, "كلمة مرور الإدارة غير صحيحة"));
      setDbUser(await res.json());
    },
    [sessionToken]
  );

  // ─── updateProfile ────────────────────────────────────────────────────────
  const updateProfile = useCallback(
    async (data: { name?: string; deliveryAddress?: string; phone?: string; email?: string; currentPassword?: string }) => {
      if (!sessionToken) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await parseError(res, "فشل تحديث البيانات"));
      setDbUser(await res.json());
    },
    [sessionToken]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!sessionToken) throw new Error("يجب تسجيل الدخول أولاً");

      const res = await fetch(`${API_BASE}/api/auth/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        throw new Error(
          await parseError(res, "فشل تغيير كلمة المرور"),
        );
      }
    },
    [sessionToken],
  );

  return (
    <AuthContext.Provider
      value={{
        user: dbUser,
        loading: !initialized,
        register,
        login,
        logout,
        promoteToAdmin,
        getAuthToken,
        updateProfile,
        changePassword,
        pendingVerification: false,
        verifyEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
