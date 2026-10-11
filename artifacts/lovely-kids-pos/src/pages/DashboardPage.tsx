import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { navigationGroups, posNavigation } from "../app/navigation";
import { usePosRuntime } from "../app/pos-context";
import {
  ApiError,
  getPosFinanceBankingReference,
  savePosExchangeRate,
  type PosFinanceCurrency,
} from "../lib/api";
import { formatBusinessDate } from "../lib/format";

function rateValue(currency: PosFinanceCurrency | undefined) {
  const value = currency?.latestRate?.ilsPerUnit;

  return value ? String(value) : "";
}

export default function DashboardPage() {
  const {
    token,
    user,
    session,
    openMessage,
    clearAuthentication,
  } = usePosRuntime();

  const [currencies, setCurrencies] = useState<PosFinanceCurrency[]>([]);
  const [usdRate, setUsdRate] = useState("");
  const [jodRate, setJodRate] = useState("");
  const [rateBusy, setRateBusy] = useState(false);
  const [rateMessage, setRateMessage] = useState("");
  const [rateError, setRateError] = useState("");

  async function loadRates() {
    try {
      const result = await getPosFinanceBankingReference(token);
      setCurrencies(result.currencies);
      setUsdRate(rateValue(result.currencies.find((item) => item.code === "USD")));
      setJodRate(rateValue(result.currencies.find((item) => item.code === "JOD")));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setRateError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل أسعار الصرف",
      );
    }
  }

  useEffect(() => {
    void loadRates();
  }, [token]);

  const latestRateDates = useMemo(
    () =>
      currencies
        .filter((item) => item.code === "USD" || item.code === "JOD")
        .map((item) => item.latestRate?.rateDate)
        .filter((value): value is string => Boolean(value)),
    [currencies],
  );

  async function saveRates() {
    if (!user?.isOwner || rateBusy) {
      return;
    }

    const values = [
      ["USD", usdRate],
      ["JOD", jodRate],
    ] as const;

    for (const [, value] of values) {
      const numeric = Number(value.trim().replace(",", "."));

      if (!Number.isFinite(numeric) || numeric <= 0) {
        setRateError("أدخل سعر صرف صحيحًا للدولار والدينار.");
        return;
      }
    }

    setRateBusy(true);
    setRateError("");
    setRateMessage("");

    try {
      for (const [currencyCode, ilsPerUnit] of values) {
        await savePosExchangeRate(token, {
          currencyCode,
          ilsPerUnit,
          source: "POS dashboard",
        });
      }

      await loadRates();
      setRateMessage("تم تحديث أسعار الصرف للحركات الجديدة.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setRateError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ أسعار الصرف",
      );
    } finally {
      setRateBusy(false);
    }
  }

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

      <section className="dashboard-fx-card">
        <div className="dashboard-fx-heading">
          <div>
            <span>سعر الصرف مقابل الشيكل</span>
            <strong>العملة الأساسية: ILS ₪</strong>
          </div>

          {latestRateDates.length > 0 && (
            <small>آخر تاريخ مسجل: {latestRateDates.sort().at(-1)}</small>
          )}
        </div>

        <div className="dashboard-fx-grid">
          <label>
            <span>1 USD =</span>
            <input
              dir="ltr"
              inputMode="decimal"
              value={usdRate}
              readOnly={!user?.isOwner}
              onChange={(event) => setUsdRate(event.target.value)}
              placeholder="مثال 3.20"
            />
            <b>₪</b>
          </label>

          <label>
            <span>1 JOD =</span>
            <input
              dir="ltr"
              inputMode="decimal"
              value={jodRate}
              readOnly={!user?.isOwner}
              onChange={(event) => setJodRate(event.target.value)}
              placeholder="مثال 4.50"
            />
            <b>₪</b>
          </label>

          {user?.isOwner && (
            <button
              className="secondary-button"
              type="button"
              disabled={rateBusy}
              onClick={() => void saveRates()}
            >
              {rateBusy ? "جاري الحفظ…" : "تحديث سعر الصرف"}
            </button>
          )}
        </div>

        {rateError && <div className="alert error-alert">{rateError}</div>}
        {rateMessage && <div className="alert success-alert">{rateMessage}</div>}

        <p>
          أي تعديل يطبق على الحركات الجديدة فقط؛ الحركات السابقة تحتفظ بسعر الصرف التاريخي المسجل عليها.
        </p>
      </section>

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
