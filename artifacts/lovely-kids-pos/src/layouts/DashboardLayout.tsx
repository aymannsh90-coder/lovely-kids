import { Link, Outlet, useLocation } from "react-router-dom";

import { API_BASE_URL, POS_REGISTER_KEY } from "../lib/api";
import { findNavigationItem } from "../app/navigation";
import { usePosRuntime } from "../app/pos-context";
import { formatMoney } from "../lib/format";

export default function DashboardLayout() {
  const location = useLocation();

  const { user, session, handleLogout } = usePosRuntime();

  const currentItem = findNavigationItem(location.pathname);

  const isDashboard = location.pathname === "/";

  return (
    <main className="page routed-page">
      <section className="shell">
        <header className="app-topbar">
          <div className="app-title">
            <span className="brand">Lovely Kids</span>

            <h1>
              {isDashboard
                ? "نظام نقطة البيع"
                : (currentItem?.title ?? "نظام نقطة البيع")}
            </h1>

            <p>
              {isDashboard
                ? "إدارة المتجر من لوحة رئيسية منظمة وقابلة للتوسع."
                : currentItem?.description}
            </p>
          </div>

          <div className="topbar-actions">
            {!isDashboard && (
              <Link className="secondary-button route-home-button" to="/">
                ← الرئيسية
              </Link>
            )}

            <div className="user-chip">
              <span>المستخدم</span>
              <strong>{user?.name ?? "موظف"}</strong>
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
            <span className="session-label">حالة الصندوق</span>

            <strong>
              {session ? "يوم العمل مفتوح" : "لم يتم فتح يوم العمل"}
            </strong>
          </div>

          {session && (
            <>
              <div className="session-banner-value">
                <span>رصيد البداية</span>

                <strong>
                  {formatMoney(session.openingBalance, session.currencyCode)}
                </strong>
              </div>

              <div className="session-banner-value">
                <span>رقم الجلسة</span>

                <strong dir="ltr">#{session.id}</strong>
              </div>
            </>
          )}
        </section>

        <section className="route-content">
          <Outlet />
        </section>

        <footer className="footer">
          <div>
            <strong>المخزون:</strong>

            <span>مركزي وموحّد مع المتجر والتطبيق</span>
          </div>

          <div className="footer-technical">
            <code>{API_BASE_URL}</code>

            <code>الصندوق: {POS_REGISTER_KEY}</code>
          </div>
        </footer>
      </section>
    </main>
  );
}
