import { useEffect, useMemo, useState } from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createDeliveryCompanySettlement,
  getDeliveryCompanies,
  getDeliveryCompanySettlementSummary,
  type PosDeliveryCompany,
  type PosDeliverySettlementSummary,
} from "../../lib/api";

function formatMoney(minor: number) {
  const amount = minor / 100;

  return `${amount.toLocaleString("ar", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₪`;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function DeliveryCompanyAccountingPage() {
  const {
    token,
    session,
    clearAuthentication,
  } = usePosRuntime();

  const [companies, setCompanies] =
    useState<PosDeliveryCompany[]>([]);

  const [companyId, setCompanyId] =
    useState<number | null>(null);

  const [summary, setSummary] =
    useState<PosDeliverySettlementSummary | null>(null);

  const [selectedIds, setSelectedIds] =
    useState<number[]>([]);

  const [receiptMethod, setReceiptMethod] =
    useState<"cash" | "bank">("cash");

  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadCompanies();
  }, [token]);

  useEffect(() => {
    if (companyId) {
      void loadSummary(companyId);
    }
  }, [companyId, token]);

  async function loadCompanies() {
    setLoading(true);
    setError("");

    try {
      const rows = await getDeliveryCompanies(token);

      setCompanies(rows);

      const active =
        rows.find((company) => company.status === "active") ??
        rows[0];

      setCompanyId(active?.id ?? null);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary(id = companyId) {
    if (!id) return;

    setLoading(true);
    setError("");

    try {
      const result =
        await getDeliveryCompanySettlementSummary(
          token,
          id,
        );

      setSummary(result);

      setSelectedIds((current) =>
        current.filter((orderId) =>
          result.unsettledOrders.some(
            (order) => order.id === orderId,
          ),
        ),
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  const selectedOrders = useMemo(() => {
    if (!summary) return [];

    const selected = new Set(selectedIds);

    return summary.unsettledOrders.filter((order) =>
      selected.has(order.id),
    );
  }, [summary, selectedIds]);

  const selectedTotalMinor = useMemo(
    () =>
      selectedOrders.reduce(
        (sum, order) => sum + order.amountMinor,
        0,
      ),
    [selectedOrders],
  );

  const allSelected =
    !!summary?.unsettledOrders.length &&
    selectedIds.length ===
      summary.unsettledOrders.length;

  function toggleOrder(orderId: number) {
    setSelectedIds((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId],
    );
  }

  function toggleAll() {
    if (!summary) return;

    setSelectedIds(
      allSelected
        ? []
        : summary.unsettledOrders.map(
            (order) => order.id,
          ),
    );
  }

  async function saveSettlement() {
    if (!companyId || saving) return;

    if (selectedIds.length === 0) {
      setError("اختر طلبًا واحدًا على الأقل.");
      return;
    }

    if (receiptMethod === "cash" && !session) {
      setError(
        "يجب فتح يوم العمل قبل تسجيل تحصيل نقدي.",
      );
      return;
    }

    const confirmed = window.confirm(
      [
        "تسجيل تسوية شركة التوصيل؟",
        "",
        `عدد الطلبات: ${selectedIds.length}`,
        `المبلغ: ${formatMoney(selectedTotalMinor)}`,
        `طريقة التحصيل: ${
          receiptMethod === "cash" ? "نقدي" : "بنك"
        }`,
        "",
        "سيتم إنشاء قيد محاسبي واحد للمبلغ الإجمالي.",
      ].join("\n"),
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createDeliveryCompanySettlement(
          token,
          companyId,
          {
            orderIds: selectedIds,
            receiptMethod,
            notes: notes.trim() || undefined,
          },
        );

      setMessage(
        `تم تسجيل التسوية بقيمة ${formatMoney(
          result.totalMinor,
        )}.`,
      );

      setSelectedIds([]);
      setNotes("");

      await loadSummary(companyId);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="accounting-invoice-page">
      <div className="panel-heading">
        <div className="panel-icon">🚚</div>

        <div>
          <h2>حساب شركة التوصيل</h2>
          <p>
            الطلبات المسلّمة غير المسوّاة والتحصيلات
            المجمعة من شركة التوصيل.
          </p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {message && (
        <div className="alert">
          {message}
        </div>
      )}

      <section className="accounting-invoice-card">
        <label>
          <span>شركة التوصيل</span>

          <select
            value={companyId ?? ""}
            onChange={(event) => {
              const id = Number(event.target.value);

              setCompanyId(
                Number.isSafeInteger(id) && id > 0
                  ? id
                  : null,
              );

              setSelectedIds([]);
            }}
          >
            {companies.map((company) => (
              <option
                value={company.id}
                key={company.id}
              >
                {company.name}
                {company.status === "inactive"
                  ? " — موقوفة"
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={!companyId || loading}
          onClick={() => void loadSummary()}
        >
          {loading ? "جارٍ التحديث..." : "تحديث الحساب"}
        </button>
      </section>

      {summary && (
        <>
          <section className="supplier-summary-grid">
            <article>
              <span>المبلغ غير المسوّى</span>
              <strong>
                {formatMoney(summary.outstandingMinor)}
              </strong>
            </article>

            <article>
              <span>طلبات غير مسوّاة</span>
              <strong>
                {summary.unsettledOrders.length}
              </strong>
            </article>

            <article>
              <span>شركة التوصيل</span>
              <strong>{summary.company.name}</strong>
            </article>

            <article>
              <span>التسويات السابقة</span>
              <strong>
                {summary.settlements.length}
              </strong>
            </article>
          </section>

          <section className="accounting-invoice-card">
            <div className="panel-heading">
              <div>
                <h2>الطلبات غير المسوّاة</h2>
                <p>
                  اختر الطلبات الداخلة في التحصيل الحالي.
                </p>
              </div>

              {summary.unsettledOrders.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                >
                  {allSelected
                    ? "إلغاء تحديد الكل"
                    : "تحديد الكل"}
                </button>
              )}
            </div>

            {summary.unsettledOrders.length === 0 ? (
              <p>لا توجد طلبات معلقة حاليًا.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>اختيار</th>
                      <th>الطلب</th>
                      <th>الزبون</th>
                      <th>المنطقة</th>
                      <th>إجمالي الطلب</th>
                      <th>أجرة التوصيل</th>
                      <th>المستحق لنا</th>
                    </tr>
                  </thead>

                  <tbody>
                    {summary.unsettledOrders.map(
                      (order) => (
                        <tr key={order.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(
                                order.id,
                              )}
                              onChange={() =>
                                toggleOrder(order.id)
                              }
                            />
                          </td>

                          <td>#{order.id}</td>
                          <td>{order.customerName || "—"}</td>
                          <td>{order.shippingZone || "—"}</td>

                          <td>
                            {formatMoney(
                              Math.round(
                                order.totalPrice * 100,
                              ),
                            )}
                          </td>

                          <td>
                            {formatMoney(
                              Math.round(
                                (order.deliveryCompanyCost ??
                                  0) * 100,
                              ),
                            )}
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                order.amountMinor,
                              )}
                            </strong>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {summary.unsettledOrders.length > 0 && (
            <section className="accounting-invoice-card">
              <h2>تسجيل التحصيل</h2>

              <label>
                <span>طريقة التحصيل</span>

                <select
                  value={receiptMethod}
                  onChange={(event) =>
                    setReceiptMethod(
                      event.target.value === "bank"
                        ? "bank"
                        : "cash",
                    )
                  }
                >
                  <option value="cash">
                    نقدي — يدخل الصندوق
                  </option>

                  <option value="bank">
                    بنك / تحويل
                  </option>
                </select>
              </label>

              <label>
                <span>ملاحظات</span>

                <input
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  placeholder="مثال: تحصيل أسبوعي"
                />
              </label>

              <p>
                المحدد: {selectedIds.length} طلب —{" "}
                <strong>
                  {formatMoney(selectedTotalMinor)}
                </strong>
              </p>

              <button
                type="button"
                disabled={
                  saving ||
                  selectedIds.length === 0 ||
                  (receiptMethod === "cash" && !session)
                }
                onClick={() => void saveSettlement()}
              >
                {saving
                  ? "جارٍ تسجيل التسوية..."
                  : "تسجيل تسوية مجمعة"}
              </button>
            </section>
          )}

          <section className="accounting-invoice-card">
            <h2>سجل التسويات</h2>

            {summary.settlements.length === 0 ? (
              <p>لا توجد تسويات سابقة.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>رقم التسوية</th>
                      <th>التاريخ</th>
                      <th>الطريقة</th>
                      <th>عدد الطلبات</th>
                      <th>المبلغ</th>
                      <th>الطلبات</th>
                    </tr>
                  </thead>

                  <tbody>
                    {summary.settlements.map(
                      (settlement) => (
                        <tr key={settlement.id}>
                          <td dir="ltr">
                            {settlement.publicId}
                          </td>

                          <td>
                            {settlement.businessDate}
                          </td>

                          <td>
                            {settlement.receiptMethod ===
                            "cash"
                              ? "نقدي"
                              : "بنك"}
                          </td>

                          <td>
                            {settlement.orders.length}
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                settlement.totalMinor,
                              )}
                            </strong>
                          </td>

                          <td>
                            {settlement.orders
                              .map(
                                (item) =>
                                  `#${item.orderId}`,
                              )
                              .join("، ")}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
