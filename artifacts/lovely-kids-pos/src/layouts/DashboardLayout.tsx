import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import {
  findNavigationItem,
  posNavigation,
  type NavigationGroup,
} from "../app/navigation";
import { usePosRuntime } from "../app/pos-context";
import ClockWidget from "../components/ClockWidget";
import { API_BASE_URL, POS_REGISTER_KEY } from "../lib/api";
import { formatMoney } from "../lib/format";

type MenuSectionKey =
  "documents" | "inventory" | "parties" | "finance" | "reports";

interface MenuSection {
  key: MenuSectionKey;
  title: string;
  icon: string;
  groups: NavigationGroup[];
}

const menuSections: MenuSection[] = [
  {
    key: "documents",
    title: "الفواتير",
    icon: "🧾",
    groups: ["sales", "purchases"],
  },
  {
    key: "inventory",
    title: "الأصناف والمخزون",
    icon: "👕",
    groups: ["inventory"],
  },
  {
    key: "parties",
    title: "العملاء والموردون",
    icon: "👥",
    groups: ["parties"],
  },
  {
    key: "finance",
    title: "المالية",
    icon: "💰",
    groups: ["finance"],
  },
  {
    key: "reports",
    title: "التقارير",
    icon: "📊",
    groups: ["reports"],
  },
];

function findMenuSection(group: NavigationGroup | undefined) {
  if (!group) {
    return null;
  }

  return menuSections.find((section) => section.groups.includes(group)) ?? null;
}

export default function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, session, handleLogout } = usePosRuntime();

  const currentItem = findNavigationItem(location.pathname);
  const routeSection = findMenuSection(currentItem?.group);
  const isDashboard = location.pathname === "/";
  const isAdminPanel = location.pathname === "/admin";

  const [activeSectionKey, setActiveSectionKey] =
    useState<MenuSectionKey>("documents");

  useEffect(() => {
    if (routeSection) {
      setActiveSectionKey(routeSection.key);
    }
  }, [routeSection?.key]);

  const activeSection = useMemo(
    () =>
      menuSections.find((section) => section.key === activeSectionKey) ??
      menuSections[0],
    [activeSectionKey],
  );

  const activeItems = useMemo(
    () =>
      posNavigation.filter((item) => activeSection.groups.includes(item.group)),
    [activeSection],
  );

  const pageTitle = isDashboard
    ? "نظام إدارة Lovely Kids"
    : isAdminPanel
      ? "لوحة الإدارة"
      : (currentItem?.title ?? "نظام إدارة Lovely Kids");

  const pageDescription = isDashboard
    ? "المبيعات والمخزون والحسابات من شاشة واحدة."
    : isAdminPanel
      ? "إدارة المتجر الإلكتروني من داخل نظام نقطة البيع."
      : (currentItem?.description ?? "إدارة عمليات المتجر.");

  return (
    <main className="page routed-page pos-full-page">
      <section className="shell pos-full-shell">
        <div className="pos-shamel-menu-shell">
          <header className="pos-shamel-header">
            <Link className="pos-shamel-brand" to="/">
              <span className="pos-shamel-brand-mark" dir="ltr">
                LK
              </span>

              <span>
                <strong>Lovely Kids</strong>
                <small>نظام إدارة المتجر</small>
              </span>
            </Link>

            <div className="pos-shamel-page-title">
              <strong>{pageTitle}</strong>
              <span>{pageDescription}</span>
            </div>

            <div className="pos-shamel-session-state">
              <span
                className={
                  session
                    ? "pos-shamel-state pos-shamel-state-open"
                    : "pos-shamel-state pos-shamel-state-closed"
                }
              >
                <i />
                {session ? "الصندوق مفتوح" : "الصندوق مغلق"}
              </span>

              <small dir="ltr">Register: {POS_REGISTER_KEY}</small>
            </div>

            <ClockWidget showHomeButton={false} />

            <div className="pos-shamel-user">
              <span>
                <small>المستخدم</small>
                <strong>{user?.name ?? "موظف"}</strong>
              </span>

              <button type="button" onClick={() => void handleLogout()}>
                تسجيل الخروج
              </button>
            </div>
          </header>

          <nav
            className="pos-shamel-primary-menu"
            aria-label="الأقسام الرئيسية"
          >
            {menuSections.map((section) => (
              <button
                className={
                  !isAdminPanel && activeSectionKey === section.key
                    ? "pos-shamel-primary-button is-active"
                    : "pos-shamel-primary-button"
                }
                type="button"
                aria-pressed={!isAdminPanel && activeSectionKey === section.key}
                key={section.key}
                onClick={() => {
                  setActiveSectionKey(section.key);

                  if (isAdminPanel) {
                    const firstItem = posNavigation.find((item) =>
                      section.groups.includes(item.group),
                    );

                    if (firstItem) {
                      navigate(firstItem.path);
                    }
                  }
                }}
              >
                <span aria-hidden="true">{section.icon}</span>
                {section.title}
              </button>
            ))}

            {(user?.isAdmin || user?.isOwner) && (
              <button
                className={
                  isAdminPanel
                    ? "pos-shamel-primary-button is-active"
                    : "pos-shamel-primary-button"
                }
                type="button"
                aria-pressed={isAdminPanel}
                onClick={() => navigate("/admin")}
              >
                <span aria-hidden="true">⚙️</span>
                لوحة الإدارة
              </button>
            )}
          </nav>

          <nav
            hidden={isAdminPanel}
            className="pos-shamel-secondary-menu"
            aria-label={`عمليات ${activeSection.title}`}
          >
            <strong className="pos-shamel-secondary-title">
              {activeSection.title}
            </strong>

            <div className="pos-shamel-secondary-actions">
              {activeItems.map((item) => {
                const locked = item.requiresOpenSession && !session;

                if (locked) {
                  return (
                    <button
                      className="pos-shamel-secondary-button is-locked"
                      type="button"
                      disabled
                      title="يتطلب فتح يوم العمل"
                      key={item.key}
                    >
                      <span aria-hidden="true">{item.icon}</span>
                      {item.title}
                    </button>
                  );
                }

                return (
                  <NavLink
                    className={({ isActive }) =>
                      isActive
                        ? "pos-shamel-secondary-button is-active"
                        : "pos-shamel-secondary-button"
                    }
                    to={item.path}
                    key={item.key}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.title}

                    {item.status === "planned" && <small>قريبًا</small>}
                  </NavLink>
                );
              })}
            </div>
          </nav>
        </div>

        <section
          hidden={isAdminPanel}
          className={
            session
              ? "session-banner session-open pos-shamel-session-banner"
              : "session-banner session-closed pos-shamel-session-banner"
          }
        >
          <div className="session-indicator" />

          <div>
            <span className="session-label">حالة يوم العمل</span>

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

        <section
          className={
            isAdminPanel
              ? "route-content pos-admin-route-content"
              : "route-content"
          }
        >
          <Outlet />
        </section>

        <footer hidden={isAdminPanel} className="footer">
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
