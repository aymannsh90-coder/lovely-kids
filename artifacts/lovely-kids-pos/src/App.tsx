import { useEffect, useState, type FormEvent } from "react";

import AppRouter from "./app/router";
import { PosRuntimeProvider } from "./app/pos-context";

import {
  POS_REGISTER_KEY,
  ApiError,
  closeCashSession,
  getCurrentCashSession,
  getCurrentPosUser,
  loginPos,
  logoutPos,
  openCashSession,
  type CashSession,
  type PosUser,
} from "./lib/api";
import { formatMoney } from "./lib/format";

const tokenStorageKey = "lovely_kids_pos_session";

function isMobilePosHost() {
  const host = window.location.hostname;

  return (
    host === "mpos.lovelykids.net" ||
    host === "lovely-kids-mobile-pos.pages.dev" ||
    host.endsWith(".lovely-kids-mobile-pos.pages.dev")
  );
}

function getStoredToken(): string | null {
  const sessionToken =
    sessionStorage.getItem(tokenStorageKey);

  if (!isMobilePosHost()) {
    return sessionToken;
  }

  try {
    const persistentToken =
      localStorage.getItem(tokenStorageKey);

    if (persistentToken) {
      return persistentToken;
    }

    if (sessionToken) {
      localStorage.setItem(
        tokenStorageKey,
        sessionToken,
      );

      sessionStorage.removeItem(
        tokenStorageKey,
      );
    }
  } catch {
    // إذا منع المتصفح التخزين الدائم نستخدم جلسة عادية.
  }

  return sessionToken;
}

function storeToken(value: string) {
  if (isMobilePosHost()) {
    try {
      localStorage.setItem(
        tokenStorageKey,
        value,
      );

      sessionStorage.removeItem(
        tokenStorageKey,
      );

      return;
    } catch {
      // نرجع إلى sessionStorage إذا تعذر التخزين الدائم.
    }
  }

  sessionStorage.setItem(
    tokenStorageKey,
    value,
  );
}

function removeStoredToken() {
  sessionStorage.removeItem(
    tokenStorageKey,
  );

  try {
    localStorage.removeItem(
      tokenStorageKey,
    );
  } catch {
    // لا شيء.
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع";
}

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    getStoredToken(),
  );

  const [phase, setPhase] = useState<"booting" | "logged-out" | "ready">(
    token ? "booting" : "logged-out",
  );

  const [user, setUser] = useState<PosUser | null>(null);

  const [session, setSession] = useState<CashSession | null>(null);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [openingBalance, setOpeningBalance] = useState("0.00");

  const [openingNote, setOpeningNote] = useState("");
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openMessage, setOpenMessage] = useState("");

  const [closingBalance, setClosingBalance] = useState("");

  const [closingNote, setClosingNote] = useState("");

  const [closeBusy, setCloseBusy] = useState(false);

  const [closeError, setCloseError] = useState("");

  function clearAuthentication() {
    removeStoredToken();
    setToken(null);
    setUser(null);
    setSession(null);
    setPhase("logged-out");
  }

  useEffect(() => {
    if (!token) {
      setPhase("logged-out");
      return;
    }

    let cancelled = false;

    async function restoreSession() {
      setPhase("booting");

      try {
        const [currentUser, currentSession] = await Promise.all([
          getCurrentPosUser(token as string),
          getCurrentCashSession(token as string, POS_REGISTER_KEY),
        ]);

        if (!currentUser.isAdmin && !currentUser.isOwner) {
          throw new Error("هذا الحساب لا يملك صلاحية استخدام نقطة البيع");
        }

        if (!cancelled) {
          setUser(currentUser);
          setSession(currentSession.session);
          setPhase("ready");
        }
      } catch {
        if (!cancelled) {
          clearAuthentication();
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!session) {
      setClosingBalance("");
      setClosingNote("");
      setCloseError("");
      return;
    }

    const expected = session.expectedBalance ?? session.openingBalance;

    setClosingBalance(expected.toFixed(2));
  }, [session]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!phone.trim() || !password) {
      setLoginError("أدخل رقم الهاتف وكلمة المرور");
      return;
    }

    setLoginBusy(true);
    setLoginError("");

    try {
      const result = await loginPos(phone.trim(), password);

      if (!result.user.isAdmin && !result.user.isOwner) {
        await logoutPos(result.token).catch(() => undefined);

        throw new Error("هذا الحساب لا يملك صلاحية استخدام نقطة البيع");
      }

      const current = await getCurrentCashSession(
        result.token,
        POS_REGISTER_KEY,
      );

      storeToken(result.token);

      setUser(result.user);
      setSession(current.session);
      setPassword("");
      setToken(result.token);
      setPhase("ready");
    } catch (error) {
      setLoginError(errorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    const currentToken = token;

    clearAuthentication();

    if (currentToken) {
      await logoutPos(currentToken).catch(() => undefined);
    }
  }

  async function handleOpenDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      clearAuthentication();
      return;
    }

    const numericBalance = Number(openingBalance);

    if (
      openingBalance.trim() === "" ||
      !Number.isFinite(numericBalance) ||
      numericBalance < 0
    ) {
      setOpenError("أدخل رصيد بداية صحيحًا وغير سالب");
      return;
    }

    setOpenBusy(true);
    setOpenError("");
    setOpenMessage("");

    try {
      const result = await openCashSession(token, {
        registerKey: POS_REGISTER_KEY,
        openingBalance: openingBalance.trim(),
        openingNote: openingNote.trim(),
      });

      setSession(result.session);
      setOpeningNote("");

      setOpenMessage(
        result.alreadyOpen
          ? "الجلسة كانت مفتوحة مسبقًا وتم تحميلها."
          : "تم فتح يوم العمل بنجاح.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthentication();
        return;
      }

      setOpenError(errorMessage(error));
    } finally {
      setOpenBusy(false);
    }
  }

  async function handleCloseDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !session) {
      return;
    }

    const numericBalance = Number(closingBalance);

    if (
      closingBalance.trim() === "" ||
      !Number.isFinite(numericBalance) ||
      numericBalance < 0
    ) {
      setCloseError("أدخل المبلغ الفعلي الموجود في الصندوق");
      return;
    }

    const confirmed = window.confirm(
      "هل أنت متأكد من إغلاق يوم العمل؟ بعد الإغلاق لن يمكن إضافة مبيعات إلى هذه الجلسة.",
    );

    if (!confirmed) {
      return;
    }

    setCloseBusy(true);
    setCloseError("");
    setOpenMessage("");

    try {
      const result = await closeCashSession(token, {
        sessionId: session.id,
        registerKey: session.registerKey,
        closingBalance: closingBalance.trim(),
        closingNote: closingNote.trim(),
      });

      let varianceMessage = "رصيد الصندوق مطابق للرصيد المتوقع.";

      if (result.variance > 0) {
        varianceMessage = `توجد زيادة بقيمة ${formatMoney(
          result.variance,
          result.session.currencyCode,
        )}.`;
      } else if (result.variance < 0) {
        varianceMessage = `يوجد نقص بقيمة ${formatMoney(
          Math.abs(result.variance),
          result.session.currencyCode,
        )}.`;
      }

      setSession(null);
      setOpeningBalance("0.00");
      setClosingNote("");
      setCloseError("");

      setOpenMessage(`تم إغلاق يوم العمل بنجاح. ${varianceMessage}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthentication();
        return;
      }

      setCloseError(errorMessage(error));
    } finally {
      setCloseBusy(false);
    }
  }

  if (phase === "booting") {
    return (
      <main className="page centered-page">
        <section className="loading-card">
          <div className="loading-mark">LK</div>
          <h1>جاري تجهيز نقطة البيع</h1>
          <p>يتم التحقق من الجلسة الحالية…</p>
        </section>
      </main>
    );
  }

  if (phase === "logged-out") {
    return (
      <main className="page auth-page">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="brand">Lovely Kids</span>
            <span className="version">POS V1</span>
          </div>

          <h1>تسجيل دخول نقطة البيع</h1>

          <p className="auth-description">
            الدخول مخصص للمالك والمديرين المصرح لهم فقط.
          </p>

          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              <span>رقم الهاتف</span>
              <input
                dir="ltr"
                inputMode="tel"
                name="username"
                autoComplete="username"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="05XXXXXXXX"
                disabled={loginBusy}
              />
            </label>

            <label>
              <span>كلمة المرور</span>
              <input
                dir="ltr"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loginBusy}
              />
            </label>

            {loginError && (
              <div className="alert error-alert">{loginError}</div>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={loginBusy}
            >
              {loginBusy ? "جاري تسجيل الدخول…" : "دخول"}
            </button>
          </form>

          <div className="security-note">
            لا تُحفظ كلمة المرور على هذا الجهاز.
          </div>
        </section>
      </main>
    );
  }

  return (
    <PosRuntimeProvider
      value={{
        token: token as string,
        user,
        session,
        setSession,
        clearAuthentication,
        handleLogout,
        openingBalance,
        setOpeningBalance,
        openingNote,
        setOpeningNote,
        openBusy,
        openError,
        openMessage,
        handleOpenDay,
        closingBalance,
        setClosingBalance,
        closingNote,
        setClosingNote,
        closeBusy,
        closeError,
        handleCloseDay,
      }}
    >
      <AppRouter />
    </PosRuntimeProvider>
  );
}
