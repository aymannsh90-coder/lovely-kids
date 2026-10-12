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
  setOwnerHistoricalCostRepair,
  setOwnerOpeningCost,
  type GrossProfitChannelSummary,
  type GrossProfitMissingCostProduct,
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


function missingCostChannelLabel(
  channel:
    GrossProfitMissingCostProduct["channels"][number],
) {
  return channel === "pos"
    ? "POS"
    : channel === "exchange"
      ? "تبديل"
      : "أونلاين";
}

function parseOpeningCostMinor(
  value: string,
) {
  const numeric =
    Number(
      value
        .trim()
        .replace(",", "."),
    );

  if (
    !Number.isFinite(numeric) ||
    numeric < 0
  ) {
    return null;
  }

  const minor =
    Math.round(numeric * 100);

  return Number.isSafeInteger(minor)
    ? minor
    : null;
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

        <Metric
          label="عدد عمليات التبديل"
          value={String(
            data.exchangeDocuments,
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

  const [
    missingCostsOpen,
    setMissingCostsOpen,
  ] = useState(false);

  const [
    openingCostInputs,
    setOpeningCostInputs,
  ] =
    useState<
      Record<string, string>
    >({});

  const [
    savingCostProductId,
    setSavingCostProductId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    costActionError,
    setCostActionError,
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

  async function handleCostAction(
    product:
      GrossProfitMissingCostProduct,
  ) {
    if (!token) {
      return;
    }

    const unitCostMinor =
      parseOpeningCostMinor(
        openingCostInputs[
          product.productId
        ] ?? "",
      );

    if (
      unitCostMinor === null
    ) {
      setCostActionError(
        "أدخل تكلفة صحيحة للقطعة بالشيكل.",
      );
      return;
    }

    setSavingCostProductId(
      product.productId,
    );
    setCostActionError("");

    const reportFrom =
      report?.range.from ??
      from;

    const reportTo =
      report?.range.to ??
      to;

    try {
      if (
        product.canSetOpeningCost
      ) {
        await setOwnerOpeningCost(
          token,
          {
            productId:
              product.productId,
            unitCostMinor,
            costQuality:
              "confirmed",
          },
        );
      } else {
        await setOwnerHistoricalCostRepair(
          token,
          {
            productId:
              product.productId,
            unitCostMinor,
            from:
              reportFrom,
            to:
              reportTo,
            costQuality:
              "confirmed",
          },
        );
      }

      setOpeningCostInputs(
        (current) => {
          const next = {
            ...current,
          };

          delete next[
            product.productId
          ];

          return next;
        },
      );

      await loadRange(
        reportFrom,
        reportTo,
      );
    } catch (error) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        clearAuthentication();
      }

      setCostActionError(
        errorMessage(error),
      );
    } finally {
      setSavingCostProductId(
        null,
      );
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

  useEffect(() => {
    if (!missingCostsOpen) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setMissingCostsOpen(
          false,
        );
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, [missingCostsOpen]);

  useEffect(() => {
    if (
      missingCostsOpen &&
      report &&
      report.missingCostProducts
        .length === 0
    ) {
      setMissingCostsOpen(false);
    }
  }, [
    missingCostsOpen,
    report,
  ]);

  const missingSoldQuantity =
    report?.missingCostProducts.reduce(
      (total, product) =>
        total +
        product.soldQuantity,
      0,
    ) ?? 0;

  return (
    <div
      dir="rtl"
      className="gross-profit-page"
    >
      <section
        className="gross-profit-hero"
      >
        <div className="gross-profit-hero-head">
          <div>
            <span className="gross-profit-eyebrow">
              التقارير المالية
            </span>

            <h1>
              مجمل الربح
            </h1>

            <p>
              قبل المصروفات التشغيلية — للمالك فقط
            </p>
          </div>

          {loading && (
            <strong className="gross-profit-loading">
              جارٍ الحساب...
            </strong>
          )}
        </div>

        <div className="gross-profit-presets">
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

        <div className="gross-profit-datebar">
          <label>
            <span>
              من تاريخ
            </span>

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
            <span>
              إلى تاريخ
            </span>

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
            عرض التقرير
          </button>
        </div>

        {error && (
          <div className="error-message gross-profit-error">
            {error}
          </div>
        )}
      </section>

      {report && (
        <>
          {report.warnings.length >
            0 && (
            <section className="gross-profit-warning">
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

          {report.missingCostProducts.length >
            0 && (
            <button
              type="button"
              className="gross-profit-missing-cost-card"
              onClick={() => {
                setCostActionError("");
                setMissingCostsOpen(true);
              }}
            >
              <span>
                أصناف مباعة بدون تكلفة
              </span>

              <strong>
                {report.missingCostProducts.length}
              </strong>

              <small>
                {missingSoldQuantity} قطعة ضمن الفترة — اضغط لإكمال التكلفة الناقصة
              </small>
            </button>
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

          <section className="gross-profit-note">
            <strong>
              ملاحظة محاسبية
            </strong>

            <p>
              الرقم المعروض هو
              مجمل الربح وليس صافي
              الربح. المصروفات التشغيلية
              المسجلة في النظام مثل
              الإيجار والكهرباء
              والرواتب والإعلانات
              لا تدخل في هذا التقرير.
              صافي الربح يحتاج تقريرًا
              مستقلًا يجمع مجمل الربح
              مع المصروفات التشغيلية.
            </p>
          </section>
        </>
      )}

      {missingCostsOpen &&
        report && (
        <div
          className="gross-profit-cost-modal-backdrop"
          role="presentation"
          onMouseDown={() =>
            setMissingCostsOpen(
              false,
            )
          }
        >
          <section
            className="gross-profit-cost-modal"
            role="dialog"
            aria-modal="true"
            aria-label="أصناف مباعة بدون تكلفة"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <header className="gross-profit-cost-modal-head">
              <div>
                <h2>
                  أصناف مباعة بدون تكلفة
                </h2>

                <p>
                  أدخل تكلفة القطعة صنفًا صنفًا. إذا لم تكن للصنف تكلفة حالية تُسجل كتكلفة افتتاحية، وإذا كان لديه سجل تكلفة قائم تُستكمل الحركة التاريخية فقط بدون تغيير تكلفة المخزون الحالية.
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setMissingCostsOpen(
                    false,
                  )
                }
              >
                إغلاق ×
              </button>
            </header>

            {costActionError && (
              <div className="alert error-alert gross-profit-cost-modal-error">
                {costActionError}
              </div>
            )}

            {report.unresolvedMissingCostLines >
              0 && (
              <div className="gross-profit-cost-modal-note">
                يوجد أيضًا {report.unresolvedMissingCostLines} سطر بيع قديم غير مربوط برقم صنف، لذلك يحتاج مراجعة منفصلة.
              </div>
            )}

            <div className="gross-profit-cost-list">
              {report.missingCostProducts.map(
                (product) => (
                  <article
                    className="gross-profit-cost-row"
                    key={
                      product.productId
                    }
                  >
                    <img
                      src={
                        product.image
                      }
                      alt=""
                    />

                    <div className="gross-profit-cost-product">
                      <strong>
                        {product.nameAr}
                      </strong>

                      <b>
                        كود الصنف:{" "}
                        {product.productCode ??
                          "غير متوفر"}
                      </b>

                      {product.barcode && (
                        <small dir="ltr">
                          Barcode:{" "}
                          {product.barcode}
                        </small>
                      )}

                      <div className="gross-profit-cost-badges">
                        {product.channels.map(
                          (channel) => (
                            <span
                              key={
                                channel
                              }
                            >
                              {missingCostChannelLabel(
                                channel,
                              )}
                            </span>
                          ),
                        )}

                        <span>
                          الكمية المباعة:{" "}
                          {product.soldQuantity}
                        </span>
                      </div>
                    </div>

                    <div className="gross-profit-cost-action">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={
                          openingCostInputs[
                            product.productId
                          ] ?? ""
                        }
                        onChange={(
                          event,
                        ) =>
                          setOpeningCostInputs(
                            (
                              current,
                            ) => ({
                              ...current,
                              [product.productId]:
                                event
                                  .target
                                  .value,
                            }),
                          )
                        }
                        placeholder={
                          product.canSetOpeningCost
                            ? "تكلفة القطعة بالشيكل"
                            : "تكلفة القطعة وقت البيع بالشيكل"
                        }
                      />

                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          savingCostProductId ===
                          product.productId
                        }
                        onClick={() =>
                          void handleCostAction(
                            product,
                          )
                        }
                      >
                        {savingCostProductId ===
                        product.productId
                          ? "جارٍ الحفظ..."
                          : product.canSetOpeningCost
                            ? "إضافة التكلفة الافتتاحية"
                            : "إكمال التكلفة التاريخية"}
                      </button>

                      {!product.canSetOpeningCost && (
                        <div className="gross-profit-cost-review">
                          سيتم حفظ التكلفة على الحركات القديمة الناقصة ضمن فترة التقرير فقط، بدون تغيير تكلفة المخزون الحالية أو الكمية.
                        </div>
                      )}
                    </div>
                  </article>
                ),
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
