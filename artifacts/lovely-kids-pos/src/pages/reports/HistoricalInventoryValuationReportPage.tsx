import "./ReportVisualRefresh.css";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getHistoricalInventoryValuation,
  type HistoricalInventoryValuationProduct,
  type HistoricalInventoryValuationReport,
} from "../../lib/api";
import {
  exportReportAsExcel,
  printA4Report,
  type A4ReportOptions,
} from "../../lib/reportOutput";

function businessDateToday() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function money(
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

function numberValue(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
  ).format(value);
}

function sourceLabel(
  product:
    HistoricalInventoryValuationProduct,
) {
  switch (product.source) {
    case "ledger":
      return "سجل التكلفة";
    case "historical_cost":
      return "تكلفة تاريخية";
    case "untracked_quantity":
      return "كمية غير متتبعة";
    default:
      return "تكلفة ناقصة";
  }
}

function qualityLabel(
  product:
    HistoricalInventoryValuationProduct,
) {
  if (
    product.inventoryValueMinor ===
    null
  ) {
    return "غير مكتملة";
  }

  switch (
    product.costQuality
  ) {
    case "confirmed":
      return "مؤكدة";
    case "estimated":
      return "تقديرية";
    case "mixed":
      return "مختلطة";
    default:
      return product.quantity === 0
        ? "لا يوجد رصيد"
        : "غير محددة";
  }
}

function errorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "تعذر تحميل التقرير";
}

export default function HistoricalInventoryValuationReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    asOf,
    setAsOf,
  ] =
    useState(
      businessDateToday(),
    );

  const [
    report,
    setReport,
  ] =
    useState<
      HistoricalInventoryValuationReport | null
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
    query,
    setQuery,
  ] =
    useState("");

  const [
    showZero,
    setShowZero,
  ] =
    useState(false);

  async function loadReport(
    nextDate = asOf,
  ) {
    if (
      !nextDate
    ) {
      setError(
        "حدد تاريخ التقييم",
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data =
        await getHistoricalInventoryValuation(
          token,
          nextDate,
        );

      setReport(
        data,
      );
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
        errorMessage(
          caught,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport(
      businessDateToday(),
    );
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function submit(
    event: FormEvent,
  ) {
    event.preventDefault();
    void loadReport();
  }

  const visibleProducts =
    useMemo(() => {
      const normalized =
        query
          .trim()
          .toLowerCase();

      return (
        report?.products.filter(
          (product) => {
            if (
              !showZero &&
              (
                product.quantity ??
                0
              ) <= 0
            ) {
              return false;
            }

            if (
              !normalized
            ) {
              return true;
            }

            return [
              product.nameAr,
              product.productCode ??
                "",
              product.barcode ??
                "",
              product.category,
              product.productId,
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                normalized,
              );
          },
        ) ?? []
      );
    }, [
      report,
      query,
      showZero,
    ]);

  const visibleSummary =
    useMemo(() => {
      let quantity = 0;
      let valueMinor = 0;
      let valued = 0;
      let missing = 0;

      for (
        const product of
        visibleProducts
      ) {
        if (
          product.quantity !==
          null
        ) {
          quantity +=
            product.quantity;
        }

        if (
          product.inventoryValueMinor !==
          null
        ) {
          valueMinor +=
            product.inventoryValueMinor;

          if (
            (
              product.quantity ??
              0
            ) > 0
          ) {
            valued += 1;
          }
        } else if (
          (
            product.quantity ??
            0
          ) > 0
        ) {
          missing += 1;
        }
      }

      return {
        quantity,
        valueMinor,
        valued,
        missing,
      };
    }, [
      visibleProducts,
    ]);

  function buildOutput():
    A4ReportOptions | null {
    if (!report) {
      return null;
    }

    return {
      title:
        "تقييم المخزون بتاريخ",
      subtitle:
        "الكمية المتوفرة وتكلفة القطعة وقيمة المخزون بنهاية اليوم",
      period:
        `التاريخ: ${report.asOf}`,
      orientation:
        "landscape",
      summary: [
        {
          label:
            "الموديلات المعروضة",
          value:
            visibleProducts.length,
        },
        {
          label:
            "إجمالي القطع",
          value:
            numberValue(
              visibleSummary.quantity,
            ),
        },
        {
          label:
            "قيمة المخزون بالتكلفة",
          value:
            money(
              visibleSummary.valueMinor,
            ),
        },
        {
          label:
            "تغطية التكلفة العامة",
          value:
            `${report.summary.coveragePercent}%`,
        },
        {
          label:
            "أصناف ناقصة التكلفة",
          value:
            visibleSummary.missing,
        },
      ],
      sections: [
        {
          title:
            "تفاصيل التقييم",
          headers: [
            "رقم",
            "الكود",
            "الصنف",
            "التصنيف",
            "الكمية",
            "تكلفة القطعة",
            "إجمالي التكلفة",
            "جودة التكلفة",
            "المصدر",
          ],
          rows:
            visibleProducts.map(
              (product) => [
                product.productId,
                product.productCode ??
                  "—",
                product.nameAr,
                product.category,
                product.quantity ??
                  "غير متتبع",
                product.unitCostMinor ===
                  null
                  ? "—"
                  : money(
                      product.unitCostMinor,
                    ),
                product.inventoryValueMinor ===
                  null
                  ? "—"
                  : money(
                      product.inventoryValueMinor,
                    ),
                qualityLabel(
                  product,
                ),
                sourceLabel(
                  product,
                ),
              ],
            ),
        },
      ],
    };
  }

  function printReport() {
    const output =
      buildOutput();

    if (output) {
      printA4Report(
        output,
      );
    }
  }

  function exportExcel() {
    const output =
      buildOutput();

    if (output) {
      exportReportAsExcel(
        `inventory-valuation-${report?.asOf ?? asOf}.xls`,
        output,
      );
    }
  }

  return (
    <section
      className="lk-report-refresh lk-report-historical"
      dir="rtl"
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      <section
        className="work-panel lk-report-historical-panel"
        style={{
          padding: 18,
        }}
      >
        <div
          className="lk-report-historical-header"
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            gap: 16,
            alignItems:
              "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                color:
                  "#E91E8C",
                fontWeight: 800,
                marginBottom: 6,
              }}
            >
              المخزون · تقييم تاريخي
            </div>

            <h1
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              تقييم المخزون بتاريخ
            </h1>

            <p
              style={{
                margin: 0,
                color:
                  "#64748b",
              }}
            >
              اعرض كمية كل موديل وتكلفته وقيمة المخزون كما كانت مسجلة بنهاية تاريخ محدد.
            </p>
          </div>
        </div>

        <form
          className="lk-report-historical-filters"
          onSubmit={submit}
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "end",
            marginTop: 18,
          }}
        >
          <label
            style={{
              display: "grid",
              gap: 5,
            }}
          >
            <span>
              تاريخ التقييم
            </span>

            <input
              type="date"
              value={asOf}
              max={
                businessDateToday()
              }
              onChange={(
                event,
              ) =>
                setAsOf(
                  event.target
                    .value,
                )
              }
            />
          </label>

          <button
            type="submit"
            className="primary-button"
            disabled={loading}
          >
            {loading
              ? "جاري الحساب…"
              : "عرض التقييم"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={
              !report ||
              loading
            }
            onClick={
              printReport
            }
          >
            🖨️ طباعة A4
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={
              !report ||
              loading
            }
            onClick={
              exportExcel
            }
          >
            📊 Excel
          </button>
        </form>

        {report && (
          <div
            style={{
              marginTop: 10,
              color:
                "#64748b",
              fontSize: 12,
            }}
          >
            أقدم تاريخ متاح لإعادة بناء الكمية:{" "}
            <b>
              {
                report.minimumSupportedDate
              }
            </b>
          </div>
        )}
      </section>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {report && (
        <>
          {!report.summary
            .complete && (
            <div
              className="alert"
              style={{
                border:
                  "1px solid #f59e0b",
                background:
                  "#fffbeb",
                color:
                  "#92400e",
              }}
            >
              التقييم يحتوي على أصناف لا يمكن احتساب تكلفتها بالكامل في هذا التاريخ. المجموع لا يختلق تكلفة ناقصة؛ يظهر فقط القيمة المدعومة بالسجل.
            </div>
          )}

          <section
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(170px,1fr))",
              gap: 10,
            }}
          >
            {[
              [
                "الموديلات برصيد",
                numberValue(
                  report.summary.productsWithStock,
                ),
              ],
              [
                "إجمالي القطع",
                numberValue(
                  report.summary.totalQuantity,
                ),
              ],
              [
                "قيمة المخزون بالتكلفة",
                money(
                  report.summary.totalInventoryValueMinor,
                ),
              ],
              [
                "تغطية التكلفة",
                `${report.summary.coveragePercent}%`,
              ],
              [
                "من سجل التكلفة",
                numberValue(
                  report.summary.ledgerProducts,
                ),
              ],
              [
                "من تكلفة تاريخية",
                numberValue(
                  report.summary.historicalCostProducts,
                ),
              ],
              [
                "ناقص تكلفة",
                numberValue(
                  report.summary.missingCostProducts,
                ),
              ],
            ].map(
              ([
                label,
                value,
              ]) => (
                <article
                  key={label}
                  style={{
                    border:
                      "1px solid #dbe3ea",
                    borderRadius: 14,
                    padding: 14,
                    background:
                      "#fff",
                  }}
                >
                  <span
                    style={{
                      display:
                        "block",
                      color:
                        "#64748b",
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </span>

                  <strong
                    style={{
                      fontSize: 19,
                    }}
                  >
                    {value}
                  </strong>
                </article>
              ),
            )}
          </section>

          <section
            className="work-panel lk-report-historical-panel"
            style={{
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems:
                  "end",
                flexWrap: "wrap",
                justifyContent:
                  "space-between",
                marginBottom: 12,
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 5,
                  minWidth: 280,
                  flex: "1 1 320px",
                }}
              >
                <span>
                  بحث
                </span>

                <input
                  value={query}
                  onChange={(
                    event,
                  ) =>
                    setQuery(
                      event.target
                        .value,
                    )
                  }
                  placeholder="اسم الصنف، الكود، الباركود أو التصنيف"
                />
              </label>

              <label
                style={{
                  display: "flex",
                  gap: 7,
                  alignItems:
                    "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    showZero
                  }
                  onChange={(
                    event,
                  ) =>
                    setShowZero(
                      event.target
                        .checked,
                    )
                  }
                />

                إظهار الأصناف برصيد صفر
              </label>
            </div>

            <div
              style={{
                overflowX: "auto",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse:
                    "collapse",
                  minWidth: 980,
                }}
              >
                <thead>
                  <tr>
                    {[
                      "رقم",
                      "الكود",
                      "الصنف",
                      "التصنيف",
                      "الكمية",
                      "تكلفة القطعة",
                      "المجموع",
                      "جودة التكلفة",
                      "المصدر",
                    ].map(
                      (header) => (
                        <th
                          key={
                            header
                          }
                          style={{
                            padding:
                              "10px 8px",
                            borderBottom:
                              "1px solid #cbd5e1",
                            textAlign:
                              "right",
                            background:
                              "#f8fafc",
                          }}
                        >
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {visibleProducts.map(
                    (product) => (
                      <tr
                        key={
                          product.productId
                        }
                      >
                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          #{product.productId}
                        </td>

                        <td
                          dir="ltr"
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          {product.productCode ??
                            "—"}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                            fontWeight: 700,
                          }}
                        >
                          {product.nameAr}
                          {product.isHidden
                            ? " · مخفي"
                            : ""}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          {product.category}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                            fontWeight: 800,
                          }}
                        >
                          {product.quantity ??
                            "—"}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          {product.unitCostMinor ===
                          null
                            ? "—"
                            : money(
                                product.unitCostMinor,
                              )}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                            fontWeight: 800,
                          }}
                        >
                          {product.inventoryValueMinor ===
                          null
                            ? "—"
                            : money(
                                product.inventoryValueMinor,
                              )}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          {qualityLabel(
                            product,
                          )}
                        </td>

                        <td
                          style={{
                            padding: 8,
                            borderBottom:
                              "1px solid #eef2f7",
                          }}
                        >
                          {sourceLabel(
                            product,
                          )}
                        </td>
                      </tr>
                    ),
                  )}

                  {visibleProducts.length ===
                    0 && (
                    <tr>
                      <td
                        colSpan={9}
                        style={{
                          textAlign:
                            "center",
                          padding: 24,
                          color:
                            "#64748b",
                        }}
                      >
                        لا توجد أصناف مطابقة.
                      </td>
                    </tr>
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <th
                      colSpan={4}
                      style={{
                        padding: 10,
                        textAlign:
                          "right",
                      }}
                    >
                      إجمالي المعروض
                    </th>

                    <th
                      style={{
                        padding: 10,
                        textAlign:
                          "right",
                      }}
                    >
                      {numberValue(
                        visibleSummary.quantity,
                      )}
                    </th>

                    <th />

                    <th
                      style={{
                        padding: 10,
                        textAlign:
                          "right",
                      }}
                    >
                      {money(
                        visibleSummary.valueMinor,
                      )}
                    </th>

                    <th
                      colSpan={2}
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
