import {
  useEffect,
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

import {
} from "../../lib/format";

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

  // Lovely Kids business week:
  // Saturday -> Friday.
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

function errorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "تعذر تحميل التقرير";
}

function reportNumber(
  value: number,
) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatReportMoney(
  valueMinor: number,
) {
  return `${reportNumber(valueMinor / 100)} ₪`;
}

function percent(
  value: number | null,
) {
  return value === null
    ? "—"
    : `${reportNumber(value)}%`;
}

const cardStyle = {
  border:
    "1px solid #e5e7eb",

  borderRadius: 16,

  background:
    "#ffffff",

  padding: 16,
} as const;

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 10,
} as const;

function Metric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        border:
          "1px solid #eef0f2",
        borderRadius: 12,
        padding: 12,
        background:
          strong
            ? "#f7fbff"
            : "#fafafa",
      }}
    >
      <div
        style={{
          color: "#667085",
          fontSize: 13,
          marginBottom: 6,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontWeight:
            strong
              ? 900
              : 800,
          fontSize:
            strong
              ? 21
              : 17,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChannelCard({
  title,
  data,
  showDelivery = false,
}: {
  title: string;
  data:
    GrossProfitChannelSummary;
  showDelivery?: boolean;
}) {
  return (
    <section
      style={cardStyle}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 19,
          }}
        >
          {title}
        </h2>

        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color:
              data.costCoverageComplete
                ? "#087a55"
                : "#b42318",
          }}
        >
          تغطية التكلفة:{" "}
          {reportNumber(data.costCoveragePercent)}
          %
        </div>
      </div>

      <div
        style={
          metricGridStyle
        }
      >
        <Metric
          label="المبيعات"
          value={formatReportMoney(
            data.salesMinor,
          )}
        />

        <Metric
          label="المردودات"
          value={formatReportMoney(
            data.returnsMinor,
          )}
        />

        <Metric
          label="صافي المبيعات"
          value={formatReportMoney(
            data.netSalesMinor,
          )}
          strong
        />

        <Metric
          label={
            data.costCoverageComplete
              ? "تكلفة البضاعة المباعة"
              : "التكلفة المسجلة فقط"
          }
          value={formatReportMoney(
            data.cogsKnownMinor,
          )}
        />

        <Metric
          label="مجمل الربح"
          value={
            data.grossProfitMinor ===
            null
              ? "غير مكتمل"
              : formatReportMoney(
                  data.grossProfitMinor,
                )
          }
          strong
        />

        <Metric
          label="هامش مجمل الربح"
          value={percent(
            data.grossMarginPercent,
          )}
        />

        <Metric
          label="عدد عمليات البيع"
          value={String(
            data.documents,
          )}
        />

        <Metric
          label="عدد المردودات"
          value={String(
            data.returnDocuments,
          )}
        />

        {showDelivery && (
          <>
            <Metric
              label="التوصيل المحصل من الزبائن"
              value={formatReportMoney(
                data.shippingChargedMinor,
              )}
            />

            <Metric
              label="تكلفة شركة التوصيل"
              value={formatReportMoney(
                data.deliveryCompanyCostMinor,
              )}
            />

            <Metric
              label="أثر التوصيل"
              value={formatReportMoney(
                data.deliveryImpactMinor,
              )}
            />

            <Metric
              label="الربح بعد أثر التوصيل"
              value={
                data.profitAfterDeliveryMinor ===
                null
                  ? "غير مكتمل"
                  : formatReportMoney(
                      data.profitAfterDeliveryMinor,
                    )
              }
              strong
            />
          </>
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          color: "#667085",
          fontSize: 12,
        }}
      >
        حالة التكلفة:{" "}
        {data.costQuality ===
        "confirmed"
          ? "مؤكدة"
          : data.costQuality ===
              "mixed"
            ? "مختلطة / تتضمن تقدير"
            : data.costQuality ===
                "incomplete"
              ? "غير مكتملة"
              : "لا توجد حركة تكلفة في الفترة"}
      </div>
    </section>
  );
}

export default function GrossProfitReportPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

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
    } catch (error) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        clearAuthentication();
      }

      setError(
        errorMessage(error),
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
    void loadRange(
      initial.from,
      initial.to,
    );
    // Initial report only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div
      dir="rtl"
      style={{
        display: "grid",
        gap: 16,
        paddingBottom: 30,
      }}
    >
      <section
        style={cardStyle}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                margin:
                  "0 0 5px",
                fontSize: 24,
              }}
            >
              مجمل الربح
            </h1>

            <div
              style={{
                color: "#667085",
                fontSize: 13,
              }}
            >
              قبل المصروفات التشغيلية — للمالك فقط
            </div>
          </div>

          {loading && (
            <strong>
              جارٍ الحساب...
            </strong>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <button
            type="button"
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
            onClick={() =>
              applyPreset(
                monthRange(),
              )
            }
          >
            هذا الشهر
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems:
              "end",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <label>
            <div
              style={{
                fontSize: 12,
                marginBottom: 5,
              }}
            >
              من تاريخ
            </div>

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
            <div
              style={{
                fontSize: 12,
                marginBottom: 5,
              }}
            >
              إلى تاريخ
            </div>

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
            عرض التقرير
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              color: "#b42318",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}
      </section>

      {report && (
        <>
          {report.warnings.length >
            0 && (
            <section
              style={{
                ...cardStyle,
                borderColor:
                  "#f79009",
                background:
                  "#fffaf0",
              }}
            >
              <strong>
                تنبيه على دقة التقرير
              </strong>

              <ul
                style={{
                  marginBottom: 0,
                }}
              >
                {report.warnings.map(
                  (
                    warning,
                  ) => (
                    <li
                      key={
                        warning
                      }
                    >
                      {warning}
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          <ChannelCard
            title="الإجمالي"
            data={
              report.channels
                .total
            }
            showDelivery
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            <ChannelCard
              title="المحل — POS"
              data={
                report.channels
                  .pos
              }
            />

            <ChannelCard
              title="المتجر الإلكتروني"
              data={
                report.channels
                  .online
              }
              showDelivery
            />
          </div>

          <section
            style={{
              ...cardStyle,
              background:
                "#f9fafb",
            }}
          >
            <strong>
              ملاحظة محاسبية
            </strong>

            <p
              style={{
                marginBottom: 0,
                lineHeight: 1.8,
                color: "#475467",
              }}
            >
              الرقم المعروض هو
              مجمل الربح وليس صافي
              الربح. المصروفات مثل
              الإيجار والكهرباء
              والرواتب والإعلانات
              غير محسوبة بعد.
              عند إضافة نظام
              المصروفات لاحقاً سيتم
              احتساب صافي الربح.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
