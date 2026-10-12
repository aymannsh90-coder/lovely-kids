import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getGrossProfitReport,
  type GrossProfitChannelSummary,
  type GrossProfitReport,
} from "../../lib/api";

function dateInput(
  date: Date,
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      date.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function todayRange() {
  const today =
    dateInput(
      new Date(),
    );

  return {
    from: today,
    to: today,
  };
}

function weekRange() {
  const end =
    new Date();

  const start =
    new Date(end);

  const daysSinceSaturday =
    (start.getDay() + 1) % 7;

  start.setDate(
    start.getDate() -
      daysSinceSaturday,
  );

  return {
    from:
      dateInput(start),
    to:
      dateInput(end),
  };
}

function monthRange() {
  const end =
    new Date();

  const start =
    new Date(
      end.getFullYear(),
      end.getMonth(),
      1,
    );

  return {
    from:
      dateInput(start),
    to:
      dateInput(end),
  };
}

function formatMoney(
  minor: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(minor / 100)} ₪`;
}

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
  ).format(value);
}

function averageMinor(
  channel:
    GrossProfitChannelSummary,
) {
  if (
    channel.documents <= 0
  ) {
    return 0;
  }

  return Math.round(
    channel.salesMinor /
      channel.documents,
  );
}

function percent(
  part: number,
  total: number,
) {
  if (total <= 0) {
    return 0;
  }

  return Math.round(
    (part / total) *
      1000,
  ) / 10;
}

function MetricCard({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        emphasis
          ? "sales-analytics-metric is-emphasis"
          : "sales-analytics-metric"
      }
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && (
        <small>{hint}</small>
      )}
    </article>
  );
}

function ChannelCard({
  title,
  icon,
  channel,
  share,
}: {
  title: string;
  icon: string;
  channel:
    GrossProfitChannelSummary;
  share: number;
}) {
  return (
    <article className="sales-analytics-channel">
      <div className="sales-analytics-channel-head">
        <div>
          <span
            className="sales-analytics-channel-icon"
            aria-hidden="true"
          >
            {icon}
          </span>

          <div>
            <h3>{title}</h3>
            <small>
              {share.toFixed(1)}% من صافي المبيعات
            </small>
          </div>
        </div>

        <strong>
          {formatMoney(
            channel.netSalesMinor,
          )}
        </strong>
      </div>

      <div className="sales-analytics-channel-grid">
        <div>
          <span>
            إجمالي المبيعات
          </span>
          <strong>
            {formatMoney(
              channel.salesMinor,
            )}
          </strong>
        </div>

        <div>
          <span>
            المردودات
          </span>
          <strong>
            {formatMoney(
              channel.returnsMinor,
            )}
          </strong>
        </div>

        <div>
          <span>
            عدد العمليات
          </span>
          <strong>
            {formatNumber(
              channel.documents,
            )}
          </strong>
        </div>

        <div>
          <span>
            متوسط الفاتورة/الطلب
          </span>
          <strong>
            {formatMoney(
              averageMinor(
                channel,
              ),
            )}
          </strong>
        </div>
      </div>
    </article>
  );
}

function ChannelDonut({
  posMinor,
  onlineMinor,
}: {
  posMinor: number;
  onlineMinor: number;
}) {
  const safePos =
    Math.max(
      0,
      posMinor,
    );

  const safeOnline =
    Math.max(
      0,
      onlineMinor,
    );

  const total =
    safePos +
    safeOnline;

  const posShare =
    percent(
      safePos,
      total,
    );

  const onlineShare =
    total > 0
      ? Math.max(
          0,
          Math.round(
            (
              100 -
              posShare
            ) *
              10,
          ) / 10,
        )
      : 0;

  const circumference =
    2 *
    Math.PI *
    42;

  const posDash =
    circumference *
    (posShare / 100);

  const onlineDash =
    circumference *
    (onlineShare / 100);

  return (
    <section className="sales-analytics-split-card">
      <div className="sales-analytics-section-title">
        <div>
          <h2>
            توزيع صافي المبيعات
          </h2>
          <p>
            مقارنة المحل بالمتجر الإلكتروني ضمن الفترة المختارة.
          </p>
        </div>
      </div>

      <div className="sales-analytics-donut-layout">
        <div
          className="sales-analytics-donut"
          role="img"
          aria-label={
            total > 0
              ? `المحل ${posShare}%، المتجر الإلكتروني ${onlineShare}%`
              : "لا توجد مبيعات ضمن الفترة"
          }
        >
          <svg
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            <circle
              className="sales-analytics-donut-track"
              cx="50"
              cy="50"
              r="42"
            />

            {total > 0 && (
              <>
                <circle
                  className="sales-analytics-donut-pos"
                  cx="50"
                  cy="50"
                  r="42"
                  strokeDasharray={`${posDash} ${circumference - posDash}`}
                  strokeDashoffset="0"
                />

                <circle
                  className="sales-analytics-donut-online"
                  cx="50"
                  cy="50"
                  r="42"
                  strokeDasharray={`${onlineDash} ${circumference - onlineDash}`}
                  strokeDashoffset={- posDash}
                />
              </>
            )}
          </svg>

          <div>
            <strong>
              {total > 0
                ? "100%"
                : "—"}
            </strong>
            <span>
              صافي المبيعات
            </span>
          </div>
        </div>

        <div className="sales-analytics-legend">
          <div>
            <i className="is-pos" />
            <span>
              <b>المحل — POS</b>
              <small>
                {formatMoney(
                  posMinor,
                )}
              </small>
            </span>
            <strong>
              {posShare.toFixed(1)}%
            </strong>
          </div>

          <div>
            <i className="is-online" />
            <span>
              <b>
                المتجر الإلكتروني
              </b>
              <small>
                {formatMoney(
                  onlineMinor,
                )}
              </small>
            </span>
            <strong>
              {onlineShare.toFixed(1)}%
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SalesAnalyticsPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const initial =
    todayRange();

  const [from, setFrom] =
    useState(
      initial.from,
    );

  const [to, setTo] =
    useState(
      initial.to,
    );

  const [
    report,
    setReport,
  ] =
    useState<
      GrossProfitReport | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  async function loadRange(
    nextFrom: string,
    nextTo: string,
  ) {
    if (!token) {
      return;
    }

    if (
      !nextFrom ||
      !nextTo ||
      nextFrom > nextTo
    ) {
      setError(
        "تأكد من فترة التقرير.",
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result =
        await getGrossProfitReport(
          token,
          nextFrom,
          nextTo,
        );

      setReport(result);
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل تحليلات المبيعات",
      );
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(
    range: {
      from: string;
      to: string;
    },
  ) {
    setFrom(range.from);
    setTo(range.to);

    void loadRange(
      range.from,
      range.to,
    );
  }

  useEffect(() => {
    const range =
      todayRange();

    setFrom(range.from);
    setTo(range.to);

    void loadRange(
      range.from,
      range.to,
    );
    // Initial report only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const channelShares =
    useMemo(() => {
      const pos =
        Math.max(
          0,
          report?.channels.pos
            .netSalesMinor ??
            0,
        );

      const online =
        Math.max(
          0,
          report?.channels.online
            .netSalesMinor ??
            0,
        );

      const total =
        pos + online;

      return {
        pos:
          percent(
            pos,
            total,
          ),
        online:
          percent(
            online,
            total,
          ),
      };
    }, [report]);

  const total =
    report?.channels.total;

  return (
    <div
      className="sales-analytics-page"
      dir="rtl"
    >
      <section className="sales-analytics-hero">
        <div>
          <span className="sales-analytics-eyebrow">
            التقارير
          </span>
          <h1>
            تحليلات المبيعات
          </h1>
          <p>
            نظرة سريعة على المبيعات وصافيها وأداء المحل والمتجر الإلكتروني.
          </p>
        </div>

        {report && (
          <div className="sales-analytics-range-label">
            <span>
              الفترة المعروضة
            </span>
            <strong dir="ltr">
              {report.range.from}
              {" → "}
              {report.range.to}
            </strong>
          </div>
        )}
      </section>

      <section className="sales-analytics-filters">
        <div className="sales-analytics-presets">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              applyPreset(
                todayRange(),
              )
            }
          >
            اليوم
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              applyPreset(
                weekRange(),
              )
            }
          >
            هذا الأسبوع
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              applyPreset(
                monthRange(),
              )
            }
          >
            هذا الشهر
          </button>
        </div>

        <div className="sales-analytics-custom-range">
          <label>
            <span>من تاريخ</span>
            <input
              type="date"
              value={from}
              onChange={(
                event,
              ) =>
                setFrom(
                  event.target
                    .value,
                )
              }
            />
          </label>

          <label>
            <span>إلى تاريخ</span>
            <input
              type="date"
              value={to}
              onChange={(
                event,
              ) =>
                setTo(
                  event.target
                    .value,
                )
              }
            />
          </label>

          <button
            type="button"
            className="primary-button"
            disabled={
              loading ||
              !from ||
              !to
            }
            onClick={() =>
              void loadRange(
                from,
                to,
              )
            }
          >
            {loading
              ? "جاري التحميل…"
              : "عرض"}
          </button>
        </div>
      </section>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {total && (
        <>
          <section className="sales-analytics-metrics">
            <MetricCard
              label="إجمالي المبيعات"
              value={formatMoney(
                total.salesMinor,
              )}
              hint="قبل خصم المردودات"
            />

            <MetricCard
              label="المردودات"
              value={formatMoney(
                total.returnsMinor,
              )}
              hint={
                total.returnDocuments >
                0
                  ? `${formatNumber(total.returnDocuments)} عملية مردود`
                  : "لا توجد مردودات"
              }
            />

            <MetricCard
              label="صافي المبيعات"
              value={formatMoney(
                total.netSalesMinor,
              )}
              hint="المبيعات بعد المردودات"
              emphasis
            />

            <MetricCard
              label="عدد الفواتير والطلبات"
              value={formatNumber(
                total.documents,
              )}
              hint="POS + الطلبات الإلكترونية المكتملة"
            />

            <MetricCard
              label="متوسط الفاتورة/الطلب"
              value={formatMoney(
                averageMinor(
                  total,
                ),
              )}
              hint="إجمالي المبيعات ÷ عدد العمليات"
            />
          </section>

          <section className="sales-analytics-channel-layout">
            <ChannelCard
              title="المحل — POS"
              icon="🏬"
              channel={
                report.channels.pos
              }
              share={
                channelShares.pos
              }
            />

            <ChannelCard
              title="المتجر الإلكتروني"
              icon="🌐"
              channel={
                report.channels.online
              }
              share={
                channelShares.online
              }
            />
          </section>

          <ChannelDonut
            posMinor={
              report.channels.pos
                .netSalesMinor
            }
            onlineMinor={
              report.channels.online
                .netSalesMinor
            }
          />

          <section className="sales-analytics-methodology">
            <strong>
              كيف تُحسب الأرقام؟
            </strong>

            <p>
              مبيعات المحل تشمل فواتير POS المكتملة ضمن تاريخ إنشائها في توقيت فلسطين، وتُخصم مردودات POS المكتملة. المتجر الإلكتروني يشمل الطلبات التي أصبحت حالتها منجزة ومُرحّلة ماليًا ضمن الفترة. مبلغ المتجر الإلكتروني هنا هو قيمة البضاعة بدون رسوم التوصيل.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
