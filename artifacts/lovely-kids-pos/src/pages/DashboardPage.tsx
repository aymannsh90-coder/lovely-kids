import { Link } from "react-router-dom";

import { navigationGroups, posNavigation } from "../app/navigation";
import { usePosRuntime } from "../app/pos-context";
import { formatBusinessDate } from "../lib/format";

export default function DashboardPage() {
  const { session, openMessage } = usePosRuntime();

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <span className="dashboard-kicker">الصفحة الرئيسية</span>

          <h2>اختر العملية المطلوبة</h2>

          <p>
            كل قسم له صفحة مستقلة، ويمكن إضافة أقسام جديدة مستقبلًا دون خلط
            العمليات في شاشة واحدة.
          </p>
        </div>

        <div className="dashboard-session-summary">
          <span>جلسة الصندوق</span>

          <strong>{session ? `مفتوحة — #${session.id}` : "غير مفتوحة"}</strong>

          {session && <small>{formatBusinessDate(session.businessDate)}</small>}

          {!session && (
            <Link className="primary-button" to="/cash-session">
              فتح يوم العمل
            </Link>
          )}
        </div>
      </section>

      {openMessage && (
        <div className="alert success-alert dashboard-alert">{openMessage}</div>
      )}

      {navigationGroups.map((group) => {
        const items = posNavigation.filter((item) => item.group === group.key);

        return (
          <section className="dashboard-group" key={group.key}>
            <div className="dashboard-group-heading">
              <div>
                <h2>{group.title}</h2>
                <p>{group.description}</p>
              </div>
            </div>

            <div className="dashboard-grid">
              {items.map((item) => {
                const locked = item.requiresOpenSession && !session;

                const content = (
                  <>
                    <span className="dashboard-card-icon" aria-hidden="true">
                      {item.icon}
                    </span>

                    <div className="dashboard-card-body">
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                    </div>

                    <div className="dashboard-card-footer">
                      <span
                        className={
                          item.status === "ready"
                            ? "dashboard-badge badge-ready"
                            : "dashboard-badge badge-planned"
                        }
                      >
                        {locked
                          ? "يتطلب فتح اليوم"
                          : item.status === "ready"
                            ? "جاهز"
                            : "قيد التجهيز"}
                      </span>

                      {!locked && <span className="dashboard-arrow">←</span>}
                    </div>
                  </>
                );

                if (locked) {
                  return (
                    <button
                      className="dashboard-card dashboard-card-locked"
                      type="button"
                      disabled
                      key={item.key}
                    >
                      {content}
                    </button>
                  );
                }

                return (
                  <Link
                    className="dashboard-card"
                    to={item.path}
                    key={item.key}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
