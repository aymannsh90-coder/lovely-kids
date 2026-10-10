import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosCustomer,
  createPosCustomerReceipt,
  getPosCustomerLedger,
  getPosCustomers,
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
    session,
    clearAuthentication,
  } = usePosRuntime();

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

  const [receiptNotes, setReceiptNotes] =
    useState("");

  const [
    receiptBusy,
    setReceiptBusy,
  ] = useState(false);

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

  async function handleReceipt(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    const amount =
      Number(
        receiptAmount.replace(
          ",",
          ".",
        ),
      );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "أدخل مبلغ سند قبض صحيح",
      );
      return;
    }

    if (
      receiptMethod === "cash" &&
      !session
    ) {
      setError(
        "يجب فتح الصندوق لتسجيل سند قبض نقدي",
      );
      return;
    }

    setReceiptBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosCustomerReceipt(
          token,
          selected.id,
          {
            amount:
              amount.toFixed(2),

            paymentMethod:
              receiptMethod,

            registerKey:
              session?.registerKey ??
              "main",

            notes:
              receiptNotes.trim() ||
              undefined,

            idempotencyKey:
              key(
                "customer_receipt",
              ),
          },
        );

      setReceiptAmount("");
      setReceiptNotes("");

      await Promise.all([
        loadCustomers(true),
        loadLedger(selected.id),
      ]);

      setMessage(
        `تم حفظ سند القبض ${result.voucher.publicId}`,
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
      setReceiptBusy(false);
    }
  }

  return (
    <section
      className="work-panel"
      dir="rtl"
    >
      <div
        className="panel-heading"
        style={{
          marginBottom: 18,
        }}
      >
        <div>
          <h2>
            👨‍👩‍👧 حسابات الزبائن
          </h2>

          <p>
            الفواتير، سندات القبض،
            والرصيد المستحق أو الدائن.
          </p>
        </div>

        <button
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

      {showNew && (
        <form
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
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(240px, 320px) minmax(0, 1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <aside
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

        <main>
          {!selected ? (
            <div>
              اختر زبونًا لعرض حسابه.
            </div>
          ) : (
            <>
              <article
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

                <div
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
                </div>
              </article>

              <article
                style={{
                  padding: 18,
                  marginBottom: 16,
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
                  💰 سند قبض
                </h3>

                <p>
                  يمكن قبض أي مبلغ، حتى لو
                  أصبح للزبون رصيد عند المحل.
                </p>

                <form
                  onSubmit={
                    handleReceipt
                  }
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
                        setReceiptAmount(
                          event.target
                            .value,
                        )
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <div>
                    <span>
                      طريقة القبض
                    </span>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 7,
                      }}
                    >
                      <button
                        type="button"
                        className={
                          receiptMethod ===
                          "cash"
                            ? "primary-button"
                            : "secondary-button"
                        }
                        onClick={() =>
                          setReceiptMethod(
                            "cash",
                          )
                        }
                      >
                        💵 كاش
                      </button>

                      <button
                        type="button"
                        className={
                          receiptMethod ===
                          "card"
                            ? "primary-button"
                            : "secondary-button"
                        }
                        onClick={() =>
                          setReceiptMethod(
                            "card",
                          )
                        }
                      >
                        💳 فيزا
                      </button>
                    </div>
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
                        setReceiptNotes(
                          event.target
                            .value,
                        )
                      }
                      placeholder="اختياري"
                    />
                  </label>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      receiptBusy ||
                      (
                        receiptMethod ===
                          "cash" &&
                        !session
                      )
                    }
                  >
                    {receiptBusy
                      ? "جاري الحفظ..."
                      : "حفظ سند القبض"}
                  </button>
                </form>
              </article>

              <article
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
