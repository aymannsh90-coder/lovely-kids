import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import "./PartiesVisualRefresh.css";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  POS_REGISTER_KEY,
  createPosCustomer,
  createPosCustomerReceipt,
  createPosUnifiedPaymentVoucher,
  getCurrentCashSession,
  getPosBankAccounts,
  getPosCustomerLedger,
  getPosCustomers,
  type PosBankAccount,
  type PosCustomer,
  type PosCustomerLedgerResult,
} from "../../lib/api";

function formatMinor(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value) / 100)} ₪`;
}

function balanceText(value: number) {
  if (value > 0) {
    return `عليه ${formatMinor(value)}`;
  }

  if (value < 0) {
    return `له ${formatMinor(value)}`;
  }

  return "الحساب مسدد";
}

function balanceDirection(value: number) {
  if (value > 0) {
    return "مدين للمحل";
  }

  if (value < 0) {
    return "دائن — له عند المحل";
  }

  return "مسدد";
}

function key(prefix: string) {
  const uuid =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`;

  return `${prefix}_${uuid}`;
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع";
}

export default function CustomersPage() {
  const navigate = useNavigate();

  const {
    token,
    user,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();
  const canEditCustomers = Boolean(user?.isOwner || user?.isAdmin ||
    (user?.staffEnabled && user?.permissions?.includes("parties.edit")));
  const canSell = Boolean(user?.isOwner || user?.isAdmin ||
    (user?.staffEnabled && user?.permissions?.includes("sales.create")));


  const [
    customers,
    setCustomers,
  ] = useState<PosCustomer[]>([]);

  const [
    selectedId,
    setSelectedId,
  ] = useState<number | null>(null);

  const [
    ledger,
    setLedger,
  ] =
    useState<PosCustomerLedgerResult | null>(
      null,
    );

  const [query, setQuery] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [ledgerBusy, setLedgerBusy] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [showNew, setShowNew] =
    useState(false);

  const [newName, setNewName] =
    useState("");

  const [newPhone, setNewPhone] =
    useState("");

  const [newAddress, setNewAddress] =
    useState("");

  const [newNotes, setNewNotes] =
    useState("");

  const [receiptAmount, setReceiptAmount] =
    useState("");

  const [
    receiptMethod,
    setReceiptMethod,
  ] = useState<
    | "cash"
    | "card"
  >("cash");

  const [
    receiptCardProcessor,
    setReceiptCardProcessor,
  ] = useState<
    | "arab"
    | "bop"
    | null
  >(null);

  const [receiptNotes, setReceiptNotes] =
    useState("");

  const [
    receiptBusy,
    setReceiptBusy,
  ] = useState(false);

  const [voucherMode, setVoucherMode] =
    useState<"receipt" | "payment">("receipt");
  const [paymentMethod, setPaymentMethod] =
    useState<"cash" | "bank">("cash");
  const [paymentBankAccountId, setPaymentBankAccountId] =
    useState("");
  const [bankAccounts, setBankAccounts] =
    useState<PosBankAccount[]>([]);
  // Reuse the key after a network error: retrying must not create a second voucher.
  const pendingVoucherKeyRef = useRef<string | null>(null);

  function resetVoucherForm(mode?: "receipt" | "payment") {
    if (mode) setVoucherMode(mode);
    setReceiptAmount("");
    setReceiptNotes("");
    setReceiptMethod("cash");
    setReceiptCardProcessor(null);
    setPaymentMethod("cash");
    setPaymentBankAccountId("");
    pendingVoucherKeyRef.current = null;
  }

  useEffect(() => {
    if (!user?.isOwner) return;
    void getPosBankAccounts(token)
      .then((response) => setBankAccounts(
        response.results.filter((account) =>
          account.status === "active" && account.currencyCode === "ILS",
        ),
      ))
      .catch(() => setBankAccounts([]));
  }, [token, user?.isOwner]);

  useEffect(() => {
    // Default to settling a credit whenever the selected customer owes nothing
    // and has a positive amount to receive from the shop.
    resetVoucherForm(
      selected?.balanceMinor != null && selected.balanceMinor < 0
        ? "payment" : "receipt",
    );
  }, [selectedId]);

  const selected =
    useMemo(
      () =>
        customers.find(
          (customer) =>
            customer.id === selectedId,
        ) ?? null,
      [
        customers,
        selectedId,
      ],
    );

  async function loadCustomers(
    keepSelected = true,
  ) {
    setBusy(true);
    setError("");

    try {
      const response =
        await getPosCustomers(
          token,
          {
            status: "active",
          },
        );

      setCustomers(
        response.results,
      );

      if (
        keepSelected &&
        selectedId !== null &&
        response.results.some(
          (customer) =>
            customer.id ===
            selectedId,
        )
      ) {
        return;
      }

      if (
        response.results.length > 0
      ) {
        setSelectedId(
          response.results[0].id,
        );
      } else {
        setSelectedId(null);
      }
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
      setBusy(false);
    }
  }

  async function loadLedger(
    customerId: number,
  ) {
    setLedgerBusy(true);
    setError("");

    try {
      const result =
        await getPosCustomerLedger(
          token,
          customerId,
        );

      setLedger(result);
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
      setLedgerBusy(false);
    }
  }

  useEffect(() => {
    void loadCustomers(false);
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setLedger(null);
      return;
    }

    void loadLedger(selectedId);
  }, [selectedId]);

  const visibleCustomers =
    useMemo(() => {
      const normalized =
        query.trim().toLowerCase();

      if (!normalized) {
        return customers;
      }

      return customers.filter(
        (customer) =>
          [
            customer.name,
            customer.code,
            customer.phone ?? "",
          ].some((value) =>
            value
              .toLowerCase()
              .includes(
                normalized,
              ),
          ),
      );
    }, [
      customers,
      query,
    ]);

  async function handleCreateCustomer(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!canEditCustomers) return;

    if (!newName.trim()) {
      setError(
        "أدخل اسم الزبون",
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosCustomer(
          token,
          {
            name:
              newName.trim(),

            phone:
              newPhone.trim() ||
              undefined,

            address:
              newAddress.trim() ||
              undefined,

            notes:
              newNotes.trim() ||
              undefined,
          },
        );

      setNewName("");
      setNewPhone("");
      setNewAddress("");
      setNewNotes("");
      setShowNew(false);

      await loadCustomers(false);

      setSelectedId(
        result.customer.id,
      );

      setMessage(
        `تمت إضافة الزبون ${result.customer.name}`,
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
      setBusy(false);
    }
  }

  async function handleVoucher(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selected || !user?.isOwner || receiptBusy) return;

    const amount = Number(receiptAmount.replace(",", "."));
    const amountMinor = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount <= 0 ||
        !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
        Math.abs(amount - amountMinor / 100) > 0.000001) {
      setError("أدخل مبلغ سند صحيح بدقتين عشريتين");
      return;
    }

    if (voucherMode === "payment") {
      if (selected.balanceMinor >= 0) {
        setError("لا يوجد رصيد دائن للزبون يسمح بإنشاء سند صرف");
        return;
      }
      if (amountMinor > -selected.balanceMinor) {
        setError("مبلغ الصرف أكبر من الرصيد المستحق للزبون");
        return;
      }
      if (paymentMethod === "cash" && !session) {
        setError("يجب فتح الصندوق لتسجيل سند صرف نقدي");
        return;
      }
      if (paymentMethod === "bank" &&
          !bankAccounts.some((bank) => bank.id === Number(paymentBankAccountId))) {
        setError("اختر حسابًا بنكيًا نشطًا بالشيكل");
        return;
      }
    } else {
      if (receiptMethod === "cash" && !session) {
        setError("يجب فتح الصندوق لتسجيل سند قبض نقدي");
        return;
      }
      if (receiptMethod === "card" && !receiptCardProcessor) {
        setError("اختر ماكينة الفيزا: البنك العربي أو بنك فلسطين");
        return;
      }
    }

    setReceiptBusy(true);
    setError("");
    setMessage("");

    try {
      const idempotencyKey = pendingVoucherKeyRef.current ??
        key(voucherMode === "payment" ? "customer_refund" : "customer_receipt");
      pendingVoucherKeyRef.current = idempotencyKey;

      const result = voucherMode === "payment"
        ? await createPosUnifiedPaymentVoucher(token, {
            partyType: "customer",
            partyId: selected.id,
            amount: amountMinor.toFixed(0) === "0" ? "0.00" : (amountMinor / 100).toFixed(2),
            paymentMethod,
            registerKey: session?.registerKey ?? POS_REGISTER_KEY,
            bankAccountId: paymentMethod === "bank" ? Number(paymentBankAccountId) : undefined,
            notes: receiptNotes.trim() || undefined,
            idempotencyKey,
          })
        : await createPosCustomerReceipt(token, selected.id, {
            amount: (amountMinor / 100).toFixed(2),
            paymentMethod: receiptMethod,
            cardProcessor: receiptMethod === "card"
              ? receiptCardProcessor ?? undefined : undefined,
            registerKey: session?.registerKey ?? POS_REGISTER_KEY,
            notes: receiptNotes.trim() || undefined,
            idempotencyKey,
          });

      const savedMode = voucherMode;
      resetVoucherForm();
      await Promise.all([
        loadCustomers(true),
        loadLedger(selected.id),
      ]);
      setMessage(
        `تم حفظ سند ${savedMode === "payment" ? "الصرف" : "القبض"} ${result.voucher.publicId} بنجاح`,
      );
      // Do not turn a successfully posted voucher into an error if refreshing
      // the banner fails; the ledger and register are authoritative.
      void getCurrentCashSession(token, POS_REGISTER_KEY)
        .then((current) => setSession(current.session))
        .catch(() => {});
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }
      setError(errorText(caught));
    } finally {
      setReceiptBusy(false);
    }
  }

  return (
    <section
      className="work-panel lk-parties-refresh lk-customers-page"
      dir="rtl"
    >
      <div
        className="panel-heading lk-parties-hero"
      >
        <div>
          <h2>
            👨‍👩‍👧 حسابات الزبائن
          </h2>

          <p>
            الفواتير، سندات القبض والصرف،
            والرصيد المستحق أو الدائن.
          </p>
        </div>

        {canEditCustomers && <button
          type="button"
          className="primary-button"
          onClick={() =>
            setShowNew(
              (current) =>
                !current,
            )
          }
        >
          + زبون جديد
        </button>}
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

      {showNew && canEditCustomers && (
        <form
          className="lk-parties-create-form"
          onSubmit={
            handleCreateCustomer
          }
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(180px,1fr))",
            gap: 10,
            padding: 16,
            marginBottom: 18,
            border:
              "1px solid var(--border-color, #ddd)",
            borderRadius: 12,
          }}
        >
          <label>
            <span>اسم الزبون *</span>
            <input
              value={newName}
              onChange={(event) =>
                setNewName(
                  event.target.value,
                )
              }
              placeholder="اسم الزبون"
            />
          </label>

          <label>
            <span>الهاتف</span>
            <input
              dir="ltr"
              value={newPhone}
              onChange={(event) =>
                setNewPhone(
                  event.target.value,
                )
              }
              placeholder="05... / 09..."
            />
          </label>

          <label>
            <span>العنوان</span>
            <input
              value={newAddress}
              onChange={(event) =>
                setNewAddress(
                  event.target.value,
                )
              }
              placeholder="العنوان"
            />
          </label>

          <label>
            <span>ملاحظات</span>
            <input
              value={newNotes}
              onChange={(event) =>
                setNewNotes(
                  event.target.value,
                )
              }
              placeholder="اختياري"
            />
          </label>

          <div
            style={{
              display: "flex",
              alignItems: "end",
            }}
          >
            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {busy
                ? "جاري الحفظ..."
                : "حفظ الزبون"}
            </button>
          </div>
        </form>
      )}

      <div
        className="lk-parties-customer-layout"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(240px, 320px) minmax(0, 1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <aside
          className="lk-parties-customer-list"
          style={{
            border:
              "1px solid var(--border-color, #ddd)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 12,
            }}
          >
            <input
              value={query}
              onChange={(event) =>
                setQuery(
                  event.target.value,
                )
              }
              placeholder="بحث بالاسم أو الهاتف..."
              style={{
                width: "100%",
              }}
            />
          </div>

          <div
            style={{
              maxHeight: 650,
              overflow: "auto",
            }}
          >
            {busy &&
            customers.length === 0 ? (
              <div
                style={{
                  padding: 16,
                }}
              >
                جاري التحميل...
              </div>
            ) : visibleCustomers
                .length === 0 ? (
              <div
                style={{
                  padding: 16,
                }}
              >
                لا يوجد زبائن
              </div>
            ) : (
              visibleCustomers.map(
                (customer) => (
                  <button
                    key={
                      customer.id
                    }
                    type="button"
                    className={customer.id === selectedId ? "lk-parties-customer-entry is-active" : "lk-parties-customer-entry"}
                    onClick={() =>
                      setSelectedId(
                        customer.id,
                      )
                    }
                    style={{
                      width: "100%",
                      padding: 12,
                      textAlign:
                        "right",
                      border: 0,
                      borderBottom:
                        "1px solid #eee",
                      cursor:
                        "pointer",
                      background:
                        customer.id ===
                        selectedId
                          ? "rgba(59,130,246,.12)"
                          : "transparent",
                    }}
                  >
                    <strong>
                      {customer.name}
                    </strong>

                    <div
                      style={{
                        marginTop: 5,
                        fontSize: 13,
                      }}
                    >
                      {customer.phone ??
                        "بدون هاتف"}
                    </div>

                    <div
                      style={{
                        marginTop: 5,
                        fontWeight: 700,
                      }}
                    >
                      {balanceText(
                        customer.balanceMinor,
                      )}
                    </div>
                  </button>
                ),
              )
            )}
          </div>
        </aside>

        <main className="lk-parties-customer-main">
          {!selected ? (
            <div className="lk-parties-empty">
              اختر زبونًا لعرض حسابه.
            </div>
          ) : (
            <>
              <article
                className="lk-parties-customer-card"
                style={{
                  padding: 18,
                  marginBottom: 16,
                  border:
                    "1px solid var(--border-color, #ddd)",
                  borderRadius: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        marginTop: 0,
                      }}
                    >
                      {selected.name}
                    </h3>

                    <div>
                      {selected.phone ??
                        "بدون رقم هاتف"}
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                      }}
                    >
                      {selected.address ??
                        ""}
                    </div>
                  </div>

                  <div
                    style={{
                      textAlign:
                        "center",
                      minWidth: 180,
                    }}
                  >
                    <div>
                      الرصيد الحالي
                    </div>

                    <strong
                      style={{
                        display: "block",
                        marginTop: 6,
                        fontSize: 24,
                      }}
                    >
                      {balanceText(
                        selected.balanceMinor,
                      )}
                    </strong>

                    <small>
                      {balanceDirection(
                        selected.balanceMinor,
                      )}
                    </small>
                  </div>
                </div>

                {canSell && <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: 18,
                  }}
                >
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!session}
                    onClick={() =>
                      navigate(
                        `/sales/pos?customerId=${selected.id}&account=1`,
                      )
                    }
                  >
                    🧾 فاتورة جديدة على الحساب
                  </button>

                  {!session && (
                    <span
                      style={{
                        alignSelf:
                          "center",
                        fontSize: 13,
                      }}
                    >
                      افتح الصندوق أولًا
                      لإنشاء فاتورة بيع.
                    </span>
                  )}
                </div>}
              </article>

              {user?.isOwner && <article
                className="lk-parties-receipt-card"
                style={{
                  padding: 18,
                  marginBottom: 16,
                  border:
                    "1px solid var(--border-color, #ddd)",
                  borderRadius: 12,
                }}
              >
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button type="button" disabled={receiptBusy}
                    className={voucherMode === "receipt" ? "primary-button" : "secondary-button"}
                    onClick={() => resetVoucherForm("receipt")}>💰 سند قبض</button>
                  <button type="button" disabled={receiptBusy}
                    className={voucherMode === "payment" ? "primary-button" : "secondary-button"}
                    onClick={() => resetVoucherForm("payment")}>💸 سند صرف</button>
                </div>
                <h3 style={{ marginTop: 0 }}>
                  {voucherMode === "receipt" ? "💰 سند قبض" : "💸 سند صرف للزبون"}
                </h3>
                <p>
                  {voucherMode === "receipt"
                    ? "تسجيل مبلغ مستلم من الزبون، ويُضاف إلى الصندوق أو حساب الفيزا."
                    : selected.balanceMinor < 0
                      ? `للزبون رصيد دائن ${formatMinor(selected.balanceMinor)}. الصرف يُخفض المبلغ المستحق له ولا يُسجّل مصروفًا جديدًا.`
                      : "لا يوجد رصيد دائن لهذا الزبون. يمكن مراجعة كشف حسابه أولًا."}
                </p>
                {voucherMode === "payment" && selected.balanceMinor < 0 && (
                  <button type="button" className="secondary-button"
                    disabled={receiptBusy}
                    onClick={() => {
                      setReceiptAmount((Math.abs(selected.balanceMinor) / 100).toFixed(2));
                      pendingVoucherKeyRef.current = null;
                    }} style={{ marginBottom: 10 }}>
                    تعبئة كامل الرصيد المستحق للزبون ({formatMinor(selected.balanceMinor)})
                  </button>
                )}

                <form
                  onSubmit={handleVoucher}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(170px,1fr))",
                    gap: 10,
                    alignItems: "end",
                  }}
                >
                  <label>
                    <span>المبلغ</span>

                    <input
                      dir="ltr"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={
                        receiptAmount
                      }
                      onChange={(
                        event,
                      ) =>
                        (setReceiptAmount(event.target.value),
                         pendingVoucherKeyRef.current = null)
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <div>
                    <span>{voucherMode === "receipt" ? "طريقة القبض" : "طريقة الصرف"}</span>
                    {voucherMode === "receipt" ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                        <button type="button"
                          className={receiptMethod === "cash" ? "primary-button" : "secondary-button"}
                          onClick={() => {
                            setReceiptMethod("cash");
                            setReceiptCardProcessor(null);
                            pendingVoucherKeyRef.current = null;
                          }}>💵 كاش</button>
                        <button type="button"
                          className={receiptMethod === "card" && receiptCardProcessor === "arab"
                            ? "primary-button" : "secondary-button"}
                          onClick={() => {
                            setReceiptMethod("card");
                            setReceiptCardProcessor("arab");
                            pendingVoucherKeyRef.current = null;
                          }}>💳 فيزا البنك العربي</button>
                        <button type="button"
                          className={receiptMethod === "card" && receiptCardProcessor === "bop"
                            ? "primary-button" : "secondary-button"}
                          onClick={() => {
                            setReceiptMethod("card");
                            setReceiptCardProcessor("bop");
                            pendingVoucherKeyRef.current = null;
                          }}>💳 فيزا بنك فلسطين</button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 8, marginTop: 7 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button"
                            className={paymentMethod === "cash" ? "primary-button" : "secondary-button"}
                            onClick={() => {
                              setPaymentMethod("cash");
                              setPaymentBankAccountId("");
                              pendingVoucherKeyRef.current = null;
                            }}>💵 من الصندوق</button>
                          <button type="button"
                            className={paymentMethod === "bank" ? "primary-button" : "secondary-button"}
                            onClick={() => {
                              setPaymentMethod("bank");
                              pendingVoucherKeyRef.current = null;
                            }}>🏦 من حساب بنكي</button>
                        </div>
                        {paymentMethod === "bank" && (
                          <select value={paymentBankAccountId} disabled={receiptBusy}
                            onChange={(event) => {
                              setPaymentBankAccountId(event.target.value);
                              pendingVoucherKeyRef.current = null;
                            }}>
                            <option value="">اختر الحساب البنكي بالشيكل</option>
                            {bankAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.bank.nameAr} — {account.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>

                  <label>
                    <span>ملاحظات</span>

                    <input
                      value={
                        receiptNotes
                      }
                      onChange={(
                        event,
                      ) =>
                        (setReceiptNotes(event.target.value),
                         pendingVoucherKeyRef.current = null)
                      }
                      placeholder="اختياري"
                    />
                  </label>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={receiptBusy ||
                      (voucherMode === "payment"
                        ? (selected.balanceMinor >= 0 ||
                            (paymentMethod === "cash" && !session) ||
                            (paymentMethod === "bank" && !paymentBankAccountId))
                        : ((receiptMethod === "cash" && !session) ||
                            (receiptMethod === "card" && !receiptCardProcessor)))}
                  >
                    {receiptBusy
                      ? "جاري الحفظ..."
                      : voucherMode === "payment" ? "حفظ سند الصرف" : "حفظ سند القبض"}
                  </button>
                </form>
              </article>}

              <article
                className="lk-parties-ledger-card"
                style={{
                  padding: 18,
                  border:
                    "1px solid var(--border-color, #ddd)",
                  borderRadius: 12,
                }}
              >
                <h3
                  style={{
                    marginTop: 0,
                  }}
                >
                  📒 كشف الحساب
                </h3>

                {ledgerBusy ? (
                  <div>
                    جاري تحميل كشف
                    الحساب...
                  </div>
                ) : !ledger ||
                  ledger.entries.length ===
                    0 ? (
                  <div>
                    لا توجد حركات على
                    الحساب.
                  </div>
                ) : (
                  <div
                    style={{
                      overflowX:
                        "auto",
                    }}
                  >
                    <table
                      className="lk-parties-ledger-table"
                      style={{
                        width: "100%",
                        borderCollapse:
                          "collapse",
                      }}
                    >
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>البيان</th>
                          <th>عليه</th>
                          <th>له</th>
                        </tr>
                      </thead>

                      <tbody>
                        {ledger.entries.map(
                          (
                            entry,
                            index,
                          ) => (
                            <tr
                              key={`${entry.transactionId ?? "x"}_${index}`}
                            >
                              <td>
                                {entry.businessDate ??
                                  new Date(
                                    entry.createdAt,
                                  ).toLocaleDateString(
                                    "ar-PS",
                                  )}
                              </td>

                              <td>
                                {entry.memo ??
                                  entry.sourceEvent ??
                                  entry.transactionType ??
                                  "حركة حساب"}
                              </td>

                              <td>
                                {entry.debitMinor >
                                0
                                  ? formatMinor(
                                      entry.debitMinor,
                                    )
                                  : "—"}
                              </td>

                              <td>
                                {entry.creditMinor >
                                0
                                  ? formatMinor(
                                      entry.creditMinor,
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
