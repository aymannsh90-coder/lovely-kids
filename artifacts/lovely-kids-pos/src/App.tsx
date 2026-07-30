import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  API_BASE_URL,
  ApiError,
  getCurrentCashSession,
  getCurrentPosUser,
  loginPos,
  logoutPos,
  openCashSession,
  type CashSession,
  type PosUser,
} from "./lib/api";

const tokenStorageKey = "lovely_kids_pos_session";

const modules = [
  {
    key: "open-day",
    title: "فتح اليوم",
    description:
      "إدخال رصيد بداية الصندوق وبدء جلسة العمل.",
    icon: "💰",
    requiresOpenSession: false,
  },
  {
    key: "sale",
    title: "فاتورة مبيعات",
    description:
      "مسح الباركود، إضافة الأصناف وإتمام البيع.",
    icon: "🧾",
    requiresOpenSession: true,
  },
  {
    key: "expenses",
    title: "مصروفات اليوم",
    description:
      "تسجيل السحوبات والمصروفات المرتبطة باليوم.",
    icon: "💸",
    requiresOpenSession: true,
  },
  {
    key: "invoices",
    title: "فواتير اليوم",
    description:
      "مراجعة الفواتير التي أُنشئت خلال جلسة اليوم.",
    icon: "📋",
    requiresOpenSession: true,
  },
  {
    key: "close-day",
    title: "تقرير نهاية اليوم",
    description:
      "ملخص المبيعات والمصروفات ورصيد الصندوق.",
    icon: "📊",
    requiresOpenSession: true,
  },
];

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع";
}

function formatMoney(
  amount: number,
  currencyCode = "ILS",
) {
  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatBusinessDate(value: string) {
  const date = new Date(`${value}T12:00:00`);

  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "full",
  }).format(date);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem(tokenStorageKey),
  );

  const [phase, setPhase] = useState<
    "booting" | "logged-out" | "ready"
  >(token ? "booting" : "logged-out");

  const [user, setUser] = useState<PosUser | null>(
    null,
  );

  const [session, setSession] =
    useState<CashSession | null>(null);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [openingBalance, setOpeningBalance] =
    useState("0.00");

  const [openingNote, setOpeningNote] = useState("");
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openMessage, setOpenMessage] = useState("");

  function clearAuthentication() {
    sessionStorage.removeItem(tokenStorageKey);
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
        const [currentUser, currentSession] =
          await Promise.all([
            getCurrentPosUser(token as string),
            getCurrentCashSession(token as string),
          ]);

        if (
          !currentUser.isAdmin &&
          !currentUser.isOwner
        ) {
          throw new Error(
            "هذا الحساب لا يملك صلاحية استخدام نقطة البيع",
          );
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

  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!phone.trim() || !password) {
      setLoginError(
        "أدخل رقم الهاتف وكلمة المرور",
      );
      return;
    }

    setLoginBusy(true);
    setLoginError("");

    try {
      const result = await loginPos(
        phone.trim(),
        password,
      );

      if (
        !result.user.isAdmin &&
        !result.user.isOwner
      ) {
        await logoutPos(result.token).catch(
          () => undefined,
        );

        throw new Error(
          "هذا الحساب لا يملك صلاحية استخدام نقطة البيع",
        );
      }

      const current =
        await getCurrentCashSession(result.token);

      sessionStorage.setItem(
        tokenStorageKey,
        result.token,
      );

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
      await logoutPos(currentToken).catch(
        () => undefined,
      );
    }
  }

  async function handleOpenDay(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!token) {
      clearAuthentication();
      return;
    }

    const numericBalance = Number(
      openingBalance,
    );

    if (
      openingBalance.trim() === "" ||
      !Number.isFinite(numericBalance) ||
      numericBalance < 0
    ) {
      setOpenError(
        "أدخل رصيد بداية صحيحًا وغير سالب",
      );
      return;
    }

    setOpenBusy(true);
    setOpenError("");
    setOpenMessage("");

    try {
      const result = await openCashSession(
        token,
        {
          registerKey: "main",
          openingBalance:
            openingBalance.trim(),
          openingNote: openingNote.trim(),
        },
      );

      setSession(result.session);
      setOpeningNote("");

      setOpenMessage(
        result.alreadyOpen
          ? "الجلسة كانت مفتوحة مسبقًا وتم تحميلها."
          : "تم فتح يوم العمل بنجاح.",
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setOpenError(errorMessage(error));
    } finally {
      setOpenBusy(false);
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
            الدخول مخصص للمالك والمديرين المصرح لهم
            فقط.
          </p>

          <form
            className="auth-form"
            onSubmit={handleLogin}
          >
            <label>
              <span>رقم الهاتف</span>
              <input
                dir="ltr"
                inputMode="tel"
                autoComplete="username"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value)
                }
                placeholder="05XXXXXXXX"
                disabled={loginBusy}
              />
            </label>

            <label>
              <span>كلمة المرور</span>
              <input
                dir="ltr"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                disabled={loginBusy}
              />
            </label>

            {loginError && (
              <div className="alert error-alert">
                {loginError}
              </div>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={loginBusy}
            >
              {loginBusy
                ? "جاري تسجيل الدخول…"
                : "دخول"}
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
    <main className="page">
      <section className="shell">
        <header className="header">
          <div>
            <span className="brand">
              Lovely Kids
            </span>

            <h1>نظام نقطة البيع</h1>

            <p>
              إدارة المبيعات اليومية من مخزون موحّد
              مع المتجر الإلكتروني والتطبيق.
            </p>
          </div>

          <div className="header-actions">
            <div className="user-chip">
              <span>المستخدم</span>
              <strong>{user?.name}</strong>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleLogout()}
            >
              تسجيل الخروج
            </button>
          </div>
        </header>

        <section
          className={
            session
              ? "session-banner session-open"
              : "session-banner session-closed"
          }
        >
          <div className="session-indicator" />

          <div>
            <span className="session-label">
              حالة الصندوق
            </span>

            <strong>
              {session
                ? "يوم العمل مفتوح"
                : "لم يتم فتح يوم العمل"}
            </strong>
          </div>

          {session && (
            <div className="session-banner-value">
              <span>رصيد البداية</span>
              <strong>
                {formatMoney(
                  session.openingBalance,
                  session.currencyCode,
                )}
              </strong>
            </div>
          )}
        </section>

        {!session ? (
          <section className="work-panel">
            <div className="panel-heading">
              <div className="panel-icon">💰</div>

              <div>
                <h2>فتح اليوم</h2>
                <p>
                  أدخل المبلغ الموجود فعليًا داخل
                  الصندوق قبل بدء المبيعات.
                </p>
              </div>
            </div>

            <form
              className="open-day-form"
              onSubmit={handleOpenDay}
            >
              <label>
                <span>رصيد بداية الصندوق</span>

                <div className="money-input">
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={openingBalance}
                    onChange={(event) =>
                      setOpeningBalance(
                        event.target.value,
                      )
                    }
                    disabled={openBusy}
                  />

                  <span>₪</span>
                </div>
              </label>

              <label>
                <span>
                  ملاحظة الافتتاح
                  <small> اختياري</small>
                </span>

                <textarea
                  maxLength={500}
                  rows={3}
                  value={openingNote}
                  onChange={(event) =>
                    setOpeningNote(
                      event.target.value,
                    )
                  }
                  placeholder="مثال: رصيد مُرحّل من اليوم السابق"
                  disabled={openBusy}
                />
              </label>

              {openError && (
                <div className="alert error-alert">
                  {openError}
                </div>
              )}

              {openMessage && (
                <div className="alert success-alert">
                  {openMessage}
                </div>
              )}

              <button
                className="primary-button open-button"
                type="submit"
                disabled={openBusy}
              >
                {openBusy
                  ? "جاري فتح اليوم…"
                  : "فتح يوم العمل"}
              </button>
            </form>
          </section>
        ) : (
          <section className="work-panel">
            <div className="panel-heading">
              <div className="panel-icon">✅</div>

              <div>
                <h2>بيانات جلسة اليوم</h2>
                <p>
                  جلسة الصندوق نشطة ويمكن البدء
                  بعمليات البيع.
                </p>
              </div>
            </div>

            <div className="session-details">
              <div>
                <span>تاريخ العمل</span>
                <strong>
                  {formatBusinessDate(
                    session.businessDate,
                  )}
                </strong>
              </div>

              <div>
                <span>وقت الافتتاح</span>
                <strong>
                  {formatDateTime(
                    session.openedAt,
                  )}
                </strong>
              </div>

              <div>
                <span>رصيد البداية</span>
                <strong>
                  {formatMoney(
                    session.openingBalance,
                    session.currencyCode,
                  )}
                </strong>
              </div>

              <div>
                <span>رقم الجلسة</span>
                <strong dir="ltr">
                  #{session.id}
                </strong>
              </div>
            </div>

            {session.openingNote && (
              <div className="session-note">
                <span>ملاحظة الافتتاح</span>
                <p>{session.openingNote}</p>
              </div>
            )}

            {openMessage && (
              <div className="alert success-alert">
                {openMessage}
              </div>
            )}
          </section>
        )}

        <section
          className="modules"
          aria-label="أقسام النظام"
        >
          {modules.map((module) => {
            const locked =
              module.requiresOpenSession &&
              !session;

            let badge = "الخطوة التالية";

            if (module.key === "open-day") {
              badge = session
                ? "مفتوح"
                : "جاهز";
            } else if (locked) {
              badge = "يتطلب فتح اليوم";
            }

            return (
              <article
                className={
                  locked
                    ? "module-card module-locked"
                    : "module-card"
                }
                key={module.key}
              >
                <span
                  className="module-icon"
                  aria-hidden="true"
                >
                  {module.icon}
                </span>

                <h2>{module.title}</h2>
                <p>{module.description}</p>

                <span className="coming-soon">
                  {badge}
                </span>
              </article>
            );
          })}
        </section>

        <footer className="footer">
          <div>
            <strong>المخزون:</strong>
            <span>
              مركزي وموحّد مع المتجر والتطبيق
            </span>
          </div>

          <code>{API_BASE_URL}</code>
        </footer>
      </section>
    </main>
  );
}
