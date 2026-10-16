import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosCardSettlement,
  getPosCardSettlements,
  reversePosCardSettlement,
  type PosCardProcessor,
  type PosCardSettlementSummary,
} from "../../lib/api";

function formatMinor(
  value: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(value / 100)} ₪`;
}

function moneyMinor(
  value: string,
) {
  const normalized =
    value.trim().replace(",", ".");

  if (!normalized) {
    return null;
  }

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }

  const minor =
    Math.round(amount * 100);

  if (
    !Number.isSafeInteger(minor) ||
    Math.abs(
      minor / 100 - amount,
    ) > 0.000001
  ) {
    return null;
  }

  return minor;
}

function errorText(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function createKey() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return `card_settlement_${crypto.randomUUID()}`;
  }

  return `card_settlement_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function processorLabel(
  processor:
    PosCardProcessor | null,
) {
  if (processor === "arab") {
    return "فيزا البنك العربي";
  }

  if (processor === "bop") {
    return "فيزا بنك فلسطين";
  }

  return "فيزا";
}

export default function CardSettlementsPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const [
    data,
    setData,
  ] =
    useState<
      PosCardSettlementSummary | null
    >(null);

  const [
    processor,
    setProcessor,
  ] =
    useState<
      PosCardProcessor
    >("arab");

  const [
    bankAccountId,
    setBankAccountId,
  ] =
    useState("");

  const [
    grossAmount,
    setGrossAmount,
  ] =
    useState("");

  const [
    netAmount,
    setNetAmount,
  ] =
    useState("");

  const [
    notes,
    setNotes,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    reversingId,
    setReversingId,
  ] =
    useState<
      number | null
    >(null);

  const [
    error,
    setError,
  ] =
    useState("");

  const settlementRequestRef =
    useRef<{
      key: string;
      signature: string;
    } | null>(
      null,
    );

  const [
    message,
    setMessage,
  ] =
    useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getPosCardSettlements(
          token,
        );

      setData(result);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorText(caught),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const terminal =
    useMemo(
      () =>
        data?.terminals.find(
          (item) =>
            item.processor ===
            processor,
        ) ?? null,
      [
        data,
        processor,
      ],
    );

  const eligibleBankAccounts =
    useMemo(
      () =>
        (
          data?.bankAccounts ??
          []
        ).filter(
          (account) => {
            const name =
              `${account.bankName} ${account.name}`
                .toLowerCase();

            return processor ===
              "arab"
              ? /العربي|arab/.test(
                  name,
                )
              : /فلسطين|palestine/.test(
                  name,
                );
          },
        ),
      [
        data,
        processor,
      ],
    );

  const grossMinor =
    moneyMinor(
      grossAmount,
    );

  const netMinor =
    moneyMinor(
      netAmount,
    );

  const feeMinor =
    grossMinor !== null &&
    netMinor !== null &&
    grossMinor >= netMinor
      ? grossMinor -
        netMinor
      : null;

  useEffect(() => {
    if (!data) {
      return;
    }

    const currentBank =
      eligibleBankAccounts.find(
        (account) =>
          String(account.id) ===
          bankAccountId,
      );

    if (currentBank) {
      return;
    }

    const preferred =
      eligibleBankAccounts[0] ??
      null;

    setBankAccountId(
      preferred
        ? String(preferred.id)
        : "",
    );
  }, [
    data,
    processor,
    bankAccountId,
    eligibleBankAccounts,
  ]);

  function useFullBalance() {
    const balance =
      terminal?.balanceMinor ??
      0;

    if (balance <= 0) {
      return;
    }

    const amount =
      (balance / 100)
        .toFixed(2);

    setGrossAmount(
      amount,
    );
    setNetAmount(
      amount,
    );
  }

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !terminal ||
      terminal.balanceMinor <=
        0
    ) {
      setError(
        "لا يوجد رصيد فيزا قيد التحصيل لهذه الماكينة.",
      );
      return;
    }

    if (
      grossMinor === null ||
      grossMinor <= 0
    ) {
      setError(
        "أدخل إجمالي التسوية.",
      );
      return;
    }

    if (
      netMinor === null ||
      netMinor <= 0
    ) {
      setError(
        "أدخل صافي المبلغ الواصل للبنك.",
      );
      return;
    }

    if (
      netMinor >
      grossMinor
    ) {
      setError(
        "صافي البنك لا يمكن أن يكون أكبر من إجمالي التسوية.",
      );
      return;
    }

    if (
      grossMinor >
      terminal.balanceMinor
    ) {
      setError(
        "إجمالي التسوية أكبر من رصيد الفيزا قيد التحصيل.",
      );
      return;
    }

    const bankId =
      Number(
        bankAccountId,
      );

    if (
      !Number.isSafeInteger(
        bankId,
      ) ||
      bankId <= 0
    ) {
      setError(
        "اختر الحساب البنكي الذي وصلت إليه التسوية.",
      );
      return;
    }

    const confirmed =
      window.confirm(
        [
          `تأكيد تسوية ${processorLabel(processor)}؟`,
          "",
          `إجمالي الفيزا: ${formatMinor(grossMinor)}`,
          `صافي البنك: ${formatMinor(netMinor)}`,
          `العمولة: ${formatMinor(feeMinor ?? 0)}`,
          "",
          "سيتم تخفيض حساب الفيزا الوسيط وزيادة البنك وتسجيل العمولة كمصروف.",
        ].join("\n"),
      );

    if (!confirmed) {
      return;
    }

    const signature =
      [
        processor,
        bankId,
        grossAmount.trim(),
        netAmount.trim(),
        notes.trim(),
      ].join("|");

    const request =
      settlementRequestRef.current &&
      settlementRequestRef.current
        .signature ===
        signature
        ? settlementRequestRef.current
        : {
            key:
              createKey(),
            signature,
          };

    settlementRequestRef.current =
      request;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosCardSettlement(
          token,
          {
            processor,
            bankAccountId:
              bankId,
            grossAmount:
              grossAmount.trim(),
            netAmount:
              netAmount.trim(),
            notes:
              notes.trim() ||
              undefined,
            idempotencyKey:
              request.key,
          },
        );

      settlementRequestRef.current =
        null;

      setGrossAmount("");
      setNetAmount("");
      setNotes("");

      await load();

      setMessage(
        result.alreadyCreated
          ? "تم تحميل التسوية المسجلة مسبقًا دون تكرارها."
          : `تم تسجيل التسوية ${result.transaction.publicId} بنجاح.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorText(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReverse(
    publicId: string,
    transactionId: number,
  ) {
    const reason =
      window.prompt(
        `سبب إلغاء التسوية ${publicId}:`,
      );

    if (!reason?.trim()) {
      return;
    }

    if (
      !window.confirm(
        "سيتم عكس حركة البنك والعمولة وحساب الفيزا بالكامل. متابعة؟",
      )
    ) {
      return;
    }

    setReversingId(
      transactionId,
    );
    setError("");
    setMessage("");

    try {
      const result =
        await reversePosCardSettlement(
          token,
          {
            publicId,
            reason:
              reason.trim(),
          },
        );

      await load();

      setMessage(
        result.alreadyReversed
          ? "هذه التسوية ملغاة مسبقًا."
          : `تم إلغاء التسوية ${publicId} بعكس محاسبي.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorText(caught),
      );
    } finally {
      setReversingId(
        null,
      );
    }
  }

  const hasBopBank =
    data?.bankAccounts.some(
      (account) =>
        /فلسطين|palestine/i.test(
          `${account.bankName} ${account.name}`,
        ),
    ) ?? false;

  return (
    <section
      className="work-panel"
      dir="rtl"
    >
      <div
        className="panel-heading"
        style={{
          marginBottom: 16,
        }}
      >
        <div>
          <h2>
            💳 تسويات الفيزا
          </h2>
          <p>
            مطابقة رصيد كل ماكينة
            فيزا مع المبلغ الذي وصل
            فعليًا للبنك وتسجيل العمولة
            تلقائيًا.
          </p>
        </div>

        <Link
          className="secondary-button"
          to="/finance/banking"
        >
          إدارة الحسابات البنكية
        </Link>
      </div>

      {error && (
        <div
          className="error-message"
          style={{
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            background:
              "rgba(16,185,129,.12)",
          }}
        >
          {message}
        </div>
      )}

      {!hasBopBank &&
        !loading && (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 10,
              background:
                "rgba(245,158,11,.12)",
            }}
          >
            لا يظهر حاليًا حساب بنكي
            باسم بنك فلسطين. يمكنك
            تسجيل مبيعات ماكينة بنك
            فلسطين في الحساب الوسيط،
            لكن قبل أول تسوية فعلية
            أضف حساب بنك فلسطين من
            صفحة البنوك.
          </div>
        )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(220px,1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {(data?.terminals ??
          [
            {
              processor:
                "arab" as const,
              label:
                "فيزا البنك العربي",
              financeAccountId:
                null,
              balanceMinor:
                0,
            },
            {
              processor:
                "bop" as const,
              label:
                "فيزا بنك فلسطين",
              financeAccountId:
                null,
              balanceMinor:
                0,
            },
          ]).map(
          (item) => (
            <button
              key={
                item.processor
              }
              type="button"
              className={
                processor ===
                item.processor
                  ? "primary-button"
                  : "secondary-button"
              }
              style={{
                minHeight: 92,
                textAlign:
                  "right",
              }}
              onClick={() => {
                setProcessor(
                  item.processor,
                );
                setGrossAmount(
                  "",
                );
                setNetAmount(
                  "",
                );
                setBankAccountId(
                  "",
                );
              }}
            >
              <span
                style={{
                  display:
                    "block",
                  opacity: 0.8,
                }}
              >
                {
                  item.label
                }
              </span>
              <strong
                style={{
                  display:
                    "block",
                  marginTop: 8,
                  fontSize: 22,
                }}
              >
                {formatMinor(
                  item.balanceMinor,
                )}
              </strong>
              <small>
                قيد التحصيل
              </small>
            </button>
          ),
        )}
      </div>

      <form
        onSubmit={
          handleSubmit
        }
        style={{
          padding: 16,
          border:
            "1px solid var(--border-color, #ddd)",
          borderRadius: 12,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
            gap: 12,
            flexWrap:
              "wrap",
            marginBottom: 14,
          }}
        >
          <div>
            <strong>
              تسوية{" "}
              {processorLabel(
                processor,
              )}
            </strong>
            <div>
              الرصيد الحالي:{" "}
              {formatMinor(
                terminal
                  ?.balanceMinor ??
                  0,
              )}
            </div>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={
              useFullBalance
            }
            disabled={
              !terminal ||
              terminal.balanceMinor <=
                0
            }
          >
            استخدام كامل الرصيد
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(190px,1fr))",
            gap: 12,
          }}
        >
          <label>
            <span>
              إجمالي تسوية الفيزا
            </span>
            <input
              dir="ltr"
              type="number"
              min="0.01"
              step="0.01"
              value={
                grossAmount
              }
              onChange={(
                event,
              ) =>
                setGrossAmount(
                  event.target
                    .value,
                )
              }
              placeholder="0.00"
            />
          </label>

          <label>
            <span>
              صافي الواصل للبنك
            </span>
            <input
              dir="ltr"
              type="number"
              min="0.01"
              step="0.01"
              value={
                netAmount
              }
              onChange={(
                event,
              ) =>
                setNetAmount(
                  event.target
                    .value,
                )
              }
              placeholder="0.00"
            />
          </label>

          <label>
            <span>
              عمولة الفيزا
            </span>
            <input
              dir="ltr"
              value={
                feeMinor ===
                null
                  ? "—"
                  : formatMinor(
                      feeMinor,
                    )
              }
              readOnly
            />
          </label>

          <label>
            <span>
              الحساب البنكي
            </span>
            <select
              value={
                bankAccountId
              }
              onChange={(
                event,
              ) =>
                setBankAccountId(
                  event.target
                    .value,
                )
              }
            >
              <option value="">
                اختر الحساب
              </option>
              {eligibleBankAccounts.map(
                (account) => (
                  <option
                    key={
                      account.id
                    }
                    value={
                      account.id
                    }
                  >
                    {
                      account.bankName
                    }{" "}
                    —{" "}
                    {
                      account.name
                    }
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        <label
          style={{
            display:
              "block",
            marginTop: 12,
          }}
        >
          <span>
            ملاحظات
          </span>
          <input
            value={notes}
            onChange={(
              event,
            ) =>
              setNotes(
                event.target
                  .value,
              )
            }
            placeholder="مثال: تسوية جهاز يوم الخميس"
          />
        </label>

        <button
          type="submit"
          className="primary-button"
          disabled={
            saving ||
            !terminal ||
            terminal.balanceMinor <=
              0
          }
          style={{
            marginTop: 14,
          }}
        >
          {saving
            ? "جاري تسجيل التسوية…"
            : "تسجيل التسوية"}
        </button>
      </form>

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h3
          style={{
            margin: 0,
          }}
        >
          سجل تسويات الفيزا
        </h3>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void load()
          }
          disabled={loading}
        >
          تحديث
        </button>
      </div>

      <div
        style={{
          overflowX:
            "auto",
          border:
            "1px solid var(--border-color, #ddd)",
          borderRadius: 12,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse:
              "collapse",
          }}
        >
          <thead>
            <tr>
              <th>التسوية</th>
              <th>التاريخ</th>
              <th>الماكينة</th>
              <th>الإجمالي</th>
              <th>البنك</th>
              <th>العمولة</th>
              <th>الحساب البنكي</th>
              <th>الحالة</th>
              <th>إجراء</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign:
                      "center",
                    padding: 20,
                  }}
                >
                  جاري التحميل…
                </td>
              </tr>
            ) : (
              data?.settlements
                .length ?? 0
            ) === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign:
                      "center",
                    padding: 20,
                  }}
                >
                  لا توجد تسويات
                  فيزا مسجلة بعد.
                </td>
              </tr>
            ) : (
              data!.settlements.map(
                (item) => (
                  <tr
                    key={
                      item
                        .transaction
                        .id
                    }
                  >
                    <td
                      dir="ltr"
                    >
                      {
                        item
                          .transaction
                          .publicId
                      }
                    </td>
                    <td>
                      {
                        item
                          .transaction
                          .businessDate
                      }
                    </td>
                    <td>
                      {processorLabel(
                        item.processor,
                      )}
                    </td>
                    <td>
                      {formatMinor(
                        item.grossMinor,
                      )}
                    </td>
                    <td>
                      {formatMinor(
                        item.netMinor,
                      )}
                    </td>
                    <td>
                      {formatMinor(
                        item.feeMinor,
                      )}
                    </td>
                    <td>
                      {item.bankAccountName ??
                        "—"}
                    </td>
                    <td>
                      {item
                        .transaction
                        .status ===
                      "posted"
                        ? "فعال"
                        : "ملغى"}
                    </td>
                    <td>
                      {item
                        .transaction
                        .status ===
                      "posted" ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={
                            reversingId ===
                            item
                              .transaction
                              .id
                          }
                          onClick={() =>
                            void handleReverse(
                              item
                                .transaction
                                .publicId,
                              item
                                .transaction
                                .id,
                            )
                          }
                        >
                          {reversingId ===
                          item
                            .transaction
                            .id
                            ? "جاري الإلغاء…"
                            : "إلغاء"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
