import { useAuth as useClerkHook, useClerk, useUser } from "@clerk/expo";
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

// Extract a user-friendly message from a Clerk API error (classic API throws).
function clerkErrMsg(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    if ("errors" in err) {
      const errs = (err as { errors: Array<{ longMessage?: string; message?: string }> }).errors;
      if (Array.isArray(errs) && errs.length > 0) {
        return errs[0].longMessage || errs[0].message || fallback;
      }
    }
    if (err instanceof Error) return err.message || fallback;
  }
  return fallback;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, signOut: clerkSignOut, getToken } = useClerkHook();
  const clerk = useClerk();
  const { user: clerkUser } = useUser();

  const [dbUser, setDbUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  // Extra data (name, phone) collected at sign-up time; stored in a ref so
  // it's visible synchronously when the effect fires after setActive().
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

        // Sync extra fields from registration into our DB.
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
      if (!clerk.client) throw new Error("يرجى الانتظار...");

      // If a stale Clerk session exists (e.g. user was deleted from DB), sign
      // out first so signUp.create() doesn't throw "You're already signed in."
      if (clerkSignedIn) {
        try { await clerkSignOut(); } catch { /* ignore */ }
      }

      // Store extra data synchronously so the post-setActive effect can sync it.
      pendingRegRef.current = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
      };

      // Classic API: create a sign-up with email + password.
      try {
        await clerk.client.signUp.create({
          emailAddress: email.trim().toLowerCase(),
          password,
        });
      } catch (err) {
        pendingRegRef.current = null;
        throw new Error(clerkErrMsg(err, "فشل إنشاء الحساب"));
      }

      const su = clerk.client.signUp;

      if (su.status === "complete") {
        await clerk.setActive({ session: su.createdSessionId });
        setPendingVerification(false);
      } else if ((su.unverifiedFields as string[])?.includes("email_address")) {
        // Email verification required.
        try {
          await su.prepareEmailAddressVerification({ strategy: "email_code" });
        } catch (err) {
          throw new Error(clerkErrMsg(err, "فشل إرسال رمز التحقق"));
        }
        setPendingVerification(true);
      } else {
        pendingRegRef.current = null;
        throw new Error("فشل إنشاء الحساب، يرجى التحقق من البيانات");
      }
    },
    [clerk, clerkSignedIn, clerkSignOut]
  );

  // ─── verifyEmail ──────────────────────────────────────────────────────────
  const verifyEmail = useCallback(
    async (code: string) => {
      if (!clerk.client) throw new Error("يرجى الانتظار...");

      try {
        await clerk.client.signUp.attemptEmailAddressVerification({ code });
      } catch (err) {
        throw new Error(clerkErrMsg(err, "رمز التحقق غير صحيح أو منتهي الصلاحية"));
      }

      const su = clerk.client.signUp;
      if (su.status === "complete") {
        await clerk.setActive({ session: su.createdSessionId });
        setPendingVerification(false);
      } else {
        throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية");
      }
    },
    [clerk]
  );

  // ─── login ────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (identifier: string, password: string) => {
      if (!clerk.client) throw new Error("يرجى الانتظار...");

      let emailToUse = identifier.trim();

      // If a phone number was supplied, look up the associated email in the DB.
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

      // If a stale Clerk session exists (DB user missing), sign out first so
      // signIn.create() doesn't throw "You're already signed in."
      if (clerkSignedIn) {
        try { await clerkSignOut(); } catch { /* ignore */ }
      }

      // Classic API: create sign-in with identifier + password in one step.
      try {
        await clerk.client.signIn.create({ identifier: emailToUse, password });
      } catch (err) {
        throw new Error(clerkErrMsg(err, "البريد الإلكتروني أو كلمة المرور غير صحيحة"));
      }

      const si = clerk.client.signIn;
      if (si.status === "complete") {
        await clerk.setActive({ session: si.createdSessionId });
      } else {
        throw new Error("فشل تسجيل الدخول، تحقق من البيانات");
      }
    },
    [clerk, clerkSignedIn, clerkSignOut]
  );

  // ─── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await clerkSignOut();
    } catch { /* ignore */ }
    setDbUser(null);
    setPendingVerification(false);
    pendingRegRef.current = null;
  }, [clerkSignOut]);

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
