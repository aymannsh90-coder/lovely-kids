import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import "./FinanceVisualRefresh.css";
import {
  ApiError,
  POS_REGISTER_KEY,
  createPosCustomerReceipt,
  getCurrentCashSession,
  getPosCustomers,
  getPosFinanceVouchers,
  voidPosFinanceVoucher,
  type PosCustomer,
  type PosFinanceVoucher,
} from "../../lib/api";

function formatMinor(value: number) {
  return `${new Intl.NumberFormat("ar", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)} ₪`;
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function key(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`;

  return `${prefix}_${suffix}`;
}

function paymentLabel(
  method: PosFinanceVoucher["paymentMethod"],
  cardProcessor:
    | "arab"
    | "bop"
    | null
    | undefined,
) {
  if (method === "cash") {
    return "كاش";
  }

  if (method === "card") {
    return cardProcessor === "arab"
      ? "فيزا البنك العربي"
      : cardProcessor === "bop"
        ? "فيزا بنك فلسطين"
        : "فيزا / بطاقة قديمة";
  }

  if (method === "bank") {
    return "بنك";
  }

  return "غير نقدي";
}

export default function CustomerReceiptsPage() {
  const navigate = useNavigate();
  const {
    token,
    user,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [vouchers, setVouchers] = useState<PosFinanceVoucher[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<"all" | "posted" | "voided">("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editing, setEditing] =
    useState<PosFinanceVoucher | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editMethod, setEditMethod] =
    useState<"cash" | "card">("cash");
  const [
    editCardProcessor,
    setEditCardProcessor,
  ] = useState<
    | "arab"
    | "bop"
    | null
  >(null);
  const [editNotes, setEditNotes] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const [voucherResult, customerResult] =
        await Promise.all([
          getPosFinanceVouchers(token, {
            type: "customer_receipt",
          }),
          getPosCustomers(token),
        ]);

      setVouchers(voucherResult.results);
      setCustomers(customerResult.results);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }

  async function refreshSession() {
    try {
      const result =
        await getCurrentCashSession(
          token,
          POS_REGISTER_KEY,
        );

      setSession(result.session);
    } catch {
      // Keep the page usable even if the session banner refresh fails.
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const customerById =
    useMemo(() => {
      return new Map(
        customers.map((customer) => [
          customer.id,
          customer,
        ]),
      );
    }, [customers]);

  const visible =
    useMemo(() => {
      const normalized =
        query.trim().toLowerCase();

      return vouchers.filter((voucher) => {
        if (
          statusFilter !== "all" &&
          voucher.status !== statusFilter
        ) {
          return false;
        }

        if (!normalized) {
          return true;
        }

        const customer =
          voucher.partyId === null
            ? null
            : customerById.get(voucher.partyId) ?? null;

        return [
          voucher.publicId,
          voucher.businessDate,
          voucher.notes ?? "",
          customer?.name ?? "",
          customer?.code ?? "",
          customer?.phone ?? "",
          String(voucher.amountMinor / 100),
        ].some((value) =>
          value
            .toLowerCase()
            .includes(normalized),
        );
      });
    }, [
      vouchers,
      query,
      statusFilter,
      customerById,
    ]);

  async function handleVoid(
    voucher: PosFinanceVoucher,
  ) {
    if (!user?.isOwner) {
      setError(
        "إلغاء سند القبض متاح للمالك فقط.",
      );
      return;
    }

    if (voucher.status !== "posted") {
      return;
    }

    const customer =
      voucher.partyId === null
        ? null
        : customerById.get(voucher.partyId) ?? null;

    const reason =
      window.prompt(
        `سبب إلغاء سند ${voucher.publicId} للزبون ${customer?.name ?? "غير معروف"}:`,
        "سند قبض مسجل بالخطأ",
      );

    if (!reason?.trim()) {
      return;
    }

    const confirmed =
      window.confirm(
        `سيتم إلغاء السند ${voucher.publicId} وعكس أثره المحاسبي${voucher.paymentMethod === "cash" ? " وأثره على الصندوق" : ""}. هل تريد المتابعة؟`,
      );

    if (!confirmed) {
      return;
    }

    setBusyId(voucher.id);
    setError("");
    setMessage("");

    try {
      await voidPosFinanceVoucher(
        token,
        voucher.id,
        reason.trim(),
      );

      await Promise.all([
        refresh(),
        refreshSession(),
      ]);

      setMessage(
        `تم إلغاء سند القبض ${voucher.publicId} وعكس أثره بنجاح.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(
    voucher: PosFinanceVoucher,
  ) {
    if (!user?.isOwner) {
      setError(
        "تعديل سند القبض متاح للمالك فقط.",
      );
      return;
    }

    if (voucher.status !== "posted") {
      return;
    }

    if (
      voucher.paymentMethod !== "cash" &&
      voucher.paymentMethod !== "card"
    ) {
      setError(
        "هذا السند لا يمكن تعديله من هذه الشاشة.",
      );
      return;
    }

    setEditing(voucher);
    setEditAmount(
      (voucher.amountMinor / 100).toFixed(2),
    );
    setEditMethod(voucher.paymentMethod);
    setEditCardProcessor(
      voucher.cardProcessor ??
      null,
    );
    setEditNotes(voucher.notes ?? "");
    setError("");
    setMessage("");
  }

  async function handleEdit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!editing || editing.partyId === null) {
      return;
    }

    const amount =
      Number(
        editAmount
          .trim()
          .replace(",", "."),
      );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError("أدخل مبلغًا صحيحًا.");
      return;
    }

    if (
      editMethod === "cash" &&
      !session
    ) {
      setError(
        "يجب فتح الصندوق لإصدار سند قبض نقدي بديل.",
      );
      return;
    }

    if (
      editMethod === "card" &&
      !editCardProcessor
    ) {
      setError(
        "اختر ماكينة الفيزا للسند البديل.",
      );
      return;
    }

    const confirmed =
      window.confirm(
        "التعديل المالي لا يغيّر السند القديم بصمت. سيتم إلغاء السند الحالي بعكس محاسبي ثم إصدار سند بديل بالقيم الجديدة. متابعة؟",
      );

    if (!confirmed) {
      return;
    }

    setBusyId(editing.id);
    setError("");
    setMessage("");

    const oldPublicId =
      editing.publicId;
    const customerId =
      editing.partyId;

    try {
      await voidPosFinanceVoucher(
        token,
        editing.id,
        `تعديل سند القبض ${oldPublicId}`,
      );

      await refreshSession();

      let replacement;

      try {
        replacement =
          await createPosCustomerReceipt(
            token,
            customerId,
            {
              amount:
                amount.toFixed(2),
              paymentMethod:
                editMethod,
              cardProcessor:
                editMethod === "card"
                  ? editCardProcessor ??
                    undefined
                  : undefined,
              registerKey:
                session?.registerKey ??
                POS_REGISTER_KEY,
              notes:
                editNotes.trim() ||
                undefined,
              idempotencyKey:
                key(
                  "customer_receipt_edit",
                ),
            },
          );
      } catch (caught) {
        await Promise.all([
          refresh(),
          refreshSession(),
        ]);

        setEditing(null);

        throw new Error(
          `تم إلغاء السند القديم ${oldPublicId} بنجاح، لكن تعذر إصدار السند البديل. أنشئ سندًا جديدًا للزبون يدويًا. السبب: ${errorText(caught)}`,
        );
      }

      await Promise.all([
        refresh(),
        refreshSession(),
      ]);

      setEditing(null);
      setEditCardProcessor(
        null,
      );
      setMessage(
        `تم تعديل السند بأمان: أُلغي ${oldPublicId} وصدر السند البديل ${replacement.voucher.publicId}.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      className="work-panel lk-finance-refresh lk-finance-customer-receipts"
      dir="rtl"
    >
      <div
        className="panel-heading lk-finance-header"
        style={{
          marginBottom: 16,
        }}
      >
        <div>
          <h2>💵 سندات القبض</h2>
          <p>
            مراجعة سندات قبض الزبائن،
            إلغاؤها بعكس محاسبي، أو
            تعديلها بإلغاء السند القديم
            وإصدار بديل.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() =>
            navigate(
              "/parties/customers",
            )
          }
        >
          + سند قبض جديد
        </button>
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
          className="lk-finance-success"
          style={{
            padding: 12,
            marginBottom: 12,
            borderRadius: 10,
            background:
              "rgba(16,185,129,.12)",
          }}
        >
          {message}
        </div>
      )}

      <div
        className="lk-finance-filterbar"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(220px,1fr) 180px auto",
          gap: 10,
          marginBottom: 16,
          alignItems: "end",
        }}
      >
        <label>
          <span>بحث</span>
          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="رقم السند، الزبون، المبلغ..."
          />
        </label>

        <label>
          <span>الحالة</span>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as
                  | "all"
                  | "posted"
                  | "voided",
              )
            }
          >
            <option value="all">
              الكل
            </option>
            <option value="posted">
              فعال
            </option>
            <option value="voided">
              ملغى
            </option>
          </select>
        </label>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void refresh()
          }
          disabled={loading}
        >
          تحديث
        </button>
      </div>

      <div
        className="lk-finance-table-shell"
        style={{
          overflowX: "auto",
          border:
            "1px solid var(--border-color, #ddd)",
          borderRadius: 12,
        }}
      >
        <table
          className="lk-finance-table"
          style={{
            width: "100%",
            borderCollapse:
              "collapse",
          }}
        >
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>التاريخ</th>
              <th>الزبون</th>
              <th>المبلغ</th>
              <th>الطريقة</th>
              <th>الحالة</th>
              <th>ملاحظات</th>
              <th>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: 20,
                    textAlign:
                      "center",
                  }}
                >
                  جاري تحميل سندات
                  القبض...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: 20,
                    textAlign:
                      "center",
                  }}
                >
                  لا توجد سندات قبض
                  مطابقة.
                </td>
              </tr>
            ) : (
              visible.map(
                (voucher) => {
                  const customer =
                    voucher.partyId ===
                    null
                      ? null
                      : customerById.get(
                          voucher.partyId,
                        ) ?? null;

                  return (
                    <tr
                      key={
                        voucher.id
                      }
                    >
                      <td dir="ltr">
                        {
                          voucher.publicId
                        }
                      </td>

                      <td>
                        {
                          voucher.businessDate
                        }
                        <br />
                        <small>
                          {new Date(
                            voucher.createdAt,
                          ).toLocaleTimeString(
                            "ar-PS",
                            {
                              hour:
                                "2-digit",
                              minute:
                                "2-digit",
                            },
                          )}
                        </small>
                      </td>

                      <td>
                        <strong>
                          {customer?.name ??
                            `زبون #${voucher.partyId ?? "—"}`}
                        </strong>
                        <br />
                        <small>
                          {customer?.phone ??
                            customer?.code ??
                            ""}
                        </small>
                      </td>

                      <td>
                        <strong>
                          {formatMinor(
                            voucher.amountMinor,
                          )}
                        </strong>
                      </td>

                      <td>
                        {paymentLabel(
                          voucher.paymentMethod,
                          voucher.cardProcessor,
                        )}
                      </td>

                      <td>
                        {voucher.status ===
                        "posted" ? (
                          <strong
                            style={{
                              color:
                                "#047857",
                            }}
                          >
                            فعال
                          </strong>
                        ) : (
                          <span>
                            ملغى
                            {voucher.voidReason
                              ? ` — ${voucher.voidReason}`
                              : ""}
                          </span>
                        )}
                      </td>

                      <td>
                        {voucher.notes ??
                          "—"}
                      </td>

                      <td>
                        {voucher.status ===
                          "posted" &&
                        user?.isOwner ? (
                          <div
                            style={{
                              display:
                                "flex",
                              gap: 6,
                              flexWrap:
                                "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                busyId ===
                                voucher.id
                              }
                              onClick={() =>
                                openEdit(
                                  voucher,
                                )
                              }
                            >
                              تعديل
                            </button>

                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                busyId ===
                                voucher.id
                              }
                              onClick={() =>
                                void handleVoid(
                                  voucher,
                                )
                              }
                            >
                              إلغاء السند
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                },
              )
            )}
          </tbody>
        </table>
      </div>

      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        ملاحظة: السندات المالية لا
        تُحذف من السجل. الإلغاء ينشئ
        عكسًا محاسبيًا ويحافظ على أثر
        التدقيق. السند النقدي لا يمكن
        إلغاؤه بعد إغلاق جلسة الصندوق
        المرتبطة به.
      </p>

      {editing && (
        <div
          className="lk-finance-edit-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0,0,0,.35)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget &&
              busyId === null
            ) {
              setEditing(null);
            }
          }}
        >
          <form
            className="lk-finance-edit-modal"
            onSubmit={handleEdit}
            style={{
              width:
                "min(520px, 100%)",
              background: "white",
              borderRadius: 14,
              padding: 20,
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <h3
                style={{
                  marginTop: 0,
                }}
              >
                تعديل سند قبض
              </h3>
              <div dir="ltr">
                {
                  editing.publicId
                }
              </div>
            </div>

            <label>
              <span>المبلغ</span>
              <input
                dir="ltr"
                type="number"
                min="0.01"
                step="0.01"
                value={editAmount}
                onChange={(event) =>
                  setEditAmount(
                    event.target.value,
                  )
                }
                disabled={
                  busyId !== null
                }
              />
            </label>

            <label>
              <span>طريقة القبض</span>
              <select
                value={editMethod}
                onChange={(event) => {
                  const value =
                    event.target.value as
                      | "cash"
                      | "card";

                  setEditMethod(
                    value,
                  );

                  if (
                    value !== "card"
                  ) {
                    setEditCardProcessor(
                      null,
                    );
                  }
                }}
                disabled={
                  busyId !== null
                }
              >
                <option value="cash">
                  كاش
                </option>
                <option value="card">
                  فيزا / بطاقة
                </option>
              </select>
            </label>

            {editMethod ===
              "card" && (
              <label>
                <span>
                  ماكينة الفيزا
                </span>
                <select
                  value={
                    editCardProcessor ??
                    ""
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditCardProcessor(
                      event.target.value ===
                        "arab" ||
                      event.target.value ===
                        "bop"
                        ? event.target.value
                        : null,
                    )
                  }
                  disabled={
                    busyId !== null
                  }
                >
                  <option value="">
                    اختر الماكينة
                  </option>
                  <option value="arab">
                    البنك العربي
                  </option>
                  <option value="bop">
                    بنك فلسطين
                  </option>
                </select>
              </label>
            )}

            <label>
              <span>ملاحظات</span>
              <input
                value={editNotes}
                onChange={(event) =>
                  setEditNotes(
                    event.target.value,
                  )
                }
                disabled={
                  busyId !== null
                }
              />
            </label>

            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background:
                  "rgba(245,158,11,.12)",
                fontSize: 13,
              }}
            >
              التعديل يلغي السند القديم
              بعكس محاسبي ثم يصدر سندًا
              بديلًا، حتى يبقى السجل
              المالي قابلًا للتدقيق.
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent:
                  "flex-end",
              }}
            >
              <button
                type="button"
                className="secondary-button"
                disabled={
                  busyId !== null
                }
                onClick={() =>
                  setEditing(null)
                }
              >
                رجوع
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={
                  busyId !== null
                }
              >
                {busyId !== null
                  ? "جاري التعديل..."
                  : "حفظ التعديل"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
