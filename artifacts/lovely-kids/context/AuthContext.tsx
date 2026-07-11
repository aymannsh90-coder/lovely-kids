import { useAuth as useClerkHook, useSignIn, useSignUp, useUser } from "@clerk/expo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  promoteToAdmin: (password: string) => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  updateProfile: (data: { name?: string; deliveryAddress?: string }) => Promise<void>;
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
  updateProfile: async () => {},
  pendingVerification: false,
  verifyEmail: async () => {},
});

async function parseError(res: Response, fallback: string) {
  try {
    const d = await res.json();
    return (d?.error as string) ?? fallback;
  } catch {
    return fallback;
  }
}

function isEmail(s: string) {
  return s.includes("@");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, signOut, getToken } = useClerkHook();
  const { user: clerkUser } = useUser();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [dbUser, setDbUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  // Extra data (name, phone) collected at sign-up time; stored in a ref so
  // it's visible synchronously when the effect fires after finalize().
  const pendingRegRef = useRef<{ name: string; phone: string; email: string } | null>(null);

  // Sync DB profile whenever Clerk auth state changes.
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!clerkSignedIn) {
      setDbUser(null);
      setInitialized(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        // Sync extra fields from registration into Supabase.
        const pending = pendingRegRef.current;
        if (pending) {
          pendingRegRef.current = null;
          await fetch(`${API_BASE}/api/auth/sync-user`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(pending),
          });
        }

        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        setDbUser(await res.json());
      } catch {
        // keep previous state on network failure
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, clerkSignedIn, clerkUser?.id, getToken]);

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (clerkSignedIn) return getToken();
    return null;
  }, [clerkSignedIn, getToken]);

  // ─── register ─────────────────────────────────────────────────────────────
  const register = useCallback(
    async (name: string, phone: string, email: string, password: string) => {
      if (!signUp) throw new Error("يرجى الانتظار...");

      // Store extra data synchronously so the post-finalize effect can sync it.
      pendingRegRef.current = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
      };

      // Use the combined password method (identifier + password in one call).
      const { error } = await signUp.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });

      if (error) throw new Error(error.longMessage || error.message || "فشل إنشاء الحساب");

      if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) throw new Error(finalizeError.longMessage || finalizeError.message || "فشل إتمام التسجيل");
        setPendingVerification(false);
      } else {
        // Email verification required — send the code.
        const { error: sendError } = await signUp.verifications.sendEmailCode();
        if (sendError) throw new Error(sendError.longMessage || sendError.message || "فشل إرسال رمز التحقق");
        setPendingVerification(true);
      }
    },
    [signUp]
  );

  // ─── verifyEmail ──────────────────────────────────────────────────────────
  const verifyEmail = useCallback(
    async (code: string) => {
      if (!signUp) throw new Error("يرجى الانتظار...");

      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) throw new Error(error.longMessage || error.message || "رمز التحقق غير صحيح أو منتهي الصلاحية");

      if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) throw new Error(finalizeError.longMessage || finalizeError.message || "فشل إتمام التسجيل");
        setPendingVerification(false);
      } else {
        throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية");
      }
    },
    [signUp]
  );

  // ─── login ────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (identifier: string, password: string) => {
      if (!signIn) throw new Error("يرجى الانتظار...");

      let emailToUse = identifier.trim();

      // If a phone number was supplied, look up the associated email in Supabase.
      if (!isEmail(emailToUse)) {
        const res = await fetch(`${API_BASE}/api/auth/lookup-phone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: emailToUse }),
        });
        if (!res.ok) {
          const err = await parseError(res, "رقم الجوال غير مسجل");
          throw new Error(err);
        }
        const data = (await res.json()) as { email: string };
        emailToUse = data.email;
      }

      // Use the combined password method (identifier + password in one call).
      const { error } = await signIn.password({ identifier: emailToUse, password });
      if (error) {
        // Clerk already has a session (e.g. residual browser session) — sync the
        // DB user from the existing token instead of failing with the Clerk error.
        if (clerkSignedIn) {
          try {
            const token = await getToken();
            if (token) {
              const meRes = await fetch(`${API_BASE}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (meRes.ok) {
                setDbUser(await meRes.json());
                return;
              }
            }
          } catch { /* fall through to original error */ }
        }
        throw new Error(error.longMessage || error.message || "البريد الإلكتروني أو كلمة المرور غير صحيحة");
      }

      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) throw new Error(finalizeError.longMessage || finalizeError.message || "فشل إتمام تسجيل الدخول");
      } else {
        throw new Error("فشل تسجيل الدخول، تحقق من البيانات");
      }
    },
    [signIn, clerkSignedIn, getToken]
  );

  // ─── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch { /* ignore */ }
    setDbUser(null);
    setPendingVerification(false);
    pendingRegRef.current = null;
  }, [signOut]);

  // ─── promoteToAdmin ───────────────────────────────────────────────────────
  const promoteToAdmin = useCallback(
    async (password: string) => {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/promote-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error(await parseError(res, "كلمة مرور الإدارة غير صحيحة"));
      setDbUser(await res.json());
    },
    [getAuthToken]
  );

  // ─── updateProfile ────────────────────────────────────────────────────────
  const updateProfile = useCallback(
    async (data: { name?: string; deliveryAddress?: string }) => {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول أولاً");
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await parseError(res, "فشل تحديث البيانات"));
      setDbUser(await res.json());
    },
    [getAuthToken]
  );

  const loading = !clerkLoaded || (clerkSignedIn === true && !initialized);

  return (
    <AuthContext.Provider
      value={{
        user: dbUser,
        loading,
        register,
        login,
        logout,
        promoteToAdmin,
        getAuthToken,
        updateProfile,
        pendingVerification,
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
