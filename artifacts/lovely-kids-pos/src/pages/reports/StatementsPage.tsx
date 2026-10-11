import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  getPosCustomers,
  getPosFinanceAccountStatement,
  getPosFinanceStatementReference,
  getPosSuppliers,
  type PosCustomer,
  type PosFinanceAccountStatement,
  type PosFinanceStatementReference,
  type PosSupplier,
} from "../../lib/api";

type StatementMode =
  | "cash"
  | "bank"
  | "customers"
  | "suppliers"
  | "expense";

function localDate(
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

function initialRange() {
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
      localDate(start),
    to:
      localDate(end),
  };
}

function money(
  minor: number,
  currency = "ILS",
) {
  const symbol =
    currency === "USD"
      ? "$"
      : currency === "JOD"
        ? "JD"
        : "₪";

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)} ${symbol}`;
}

function errorText(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "تعذر تحميل الكشف";
}

export default function StatementsPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const range =
    useMemo(
      initialRange,
      [],
    );

  const [mode, setMode] =
    useState<StatementMode>(
      "cash",
    );

  const [
    reference,
    setReference,
  ] = useState<
    PosFinanceStatementReference | null
  >(null);

  const [
    accountId,
    setAccountId,
  ] = useState<
    number | null
  >(null);

  const [from, setFrom] =
    useState(
      range.from,
    );

  const [to, setTo] =
    useState(
      range.to,
    );

  const [
    statement,
    setStatement,
  ] = useState<
    PosFinanceAccountStatement | null
  >(null);

  const [
    customers,
    setCustomers,
  ] = useState<
    PosCustomer[]
  >([]);

  const [
    suppliers,
    setSuppliers,
  ] = useState<
    PosSupplier[]
  >([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function loadReference() {
    try {
      const [
        ref,
        customerResult,
        supplierResult,
      ] =
        await Promise.all([
          getPosFinanceStatementReference(
            token,
          ),
          getPosCustomers(
            token,
          ),
          getPosSuppliers(
            token,
          ),
        ]);

      setReference(
        ref,
      );

      setCustomers(
        customerResult.results,
      );

      setSuppliers(
        supplierResult.results,
      );

      setAccountId(
        ref.cashAccounts[0]
          ?.id ??
        null,
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
    }
  }

  useEffect(() => {
    void loadReference();
  }, [token]);

  function switchMode(
    next: StatementMode,
  ) {
    setMode(next);
    setStatement(null);
    setError("");

    if (!reference) {
      setAccountId(null);
      return;
    }

    if (next === "cash") {
      setAccountId(
        reference.cashAccounts[0]
          ?.id ??
        null,
      );
    } else if (
      next === "bank"
    ) {
      setAccountId(
        reference.bankAccounts[0]
          ?.financeAccountId ??
        null,
      );
    } else if (
      next === "expense"
    ) {
      setAccountId(
        reference.expenseCategories[0]
          ?.financeAccountId ??
        null,
      );
    } else {
      setAccountId(null);
    }
  }

  async function loadStatement() {
    if (
      !accountId ||
      !from ||
      !to
    ) {
      setError(
        "اختر الحساب والفترة.",
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result =
        await getPosFinanceAccountStatement(
          token,
          {
            accountId,
            from,
            to,
          },
        );

      setStatement(
        result,
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
      setLoading(false);
    }
  }

  const customerTotals =
    useMemo(
      () =>
        customers.reduce(
          (
            result,
            customer,
          ) => {
            if (
              customer.balanceMinor >
              0
            ) {
              result.receivable +=
                customer.balanceMinor;
            } else if (
              customer.balanceMinor <
              0
            ) {
              result.credit +=
                Math.abs(
                  customer.balanceMinor,
                );
            }

            return result;
          },
          {
            receivable: 0,
            credit: 0,
          },
        ),
      [customers],
    );

  const supplierTotals =
    useMemo(
      () =>
        suppliers.reduce(
          (
            result,
            supplier,
          ) => {
            result.due +=
              supplier.dueMinor ??
              0;

            result.credit +=
              supplier.supplierCreditMinor ??
              0;

            return result;
          },
          {
            due: 0,
            credit: 0,
          },
        ),
      [suppliers],
    );

  const accountOptions =
    mode === "cash"
      ? (
          reference?.cashAccounts.map(
            (account) => ({
              id:
                account.id,
              label:
                account.name,
            }),
          ) ??
          []
        )
      : mode === "bank"
        ? (
            reference?.bankAccounts.map(
              (account) => ({
                id:
                  account.financeAccountId,
                label:
                  `${account.bankName} — ${account.name} (${account.currencyCode})`,
              }),
            ) ??
            []
          )
        : mode === "expense"
          ? (
              reference?.expenseCategories.map(
                (category) => ({
                  id:
                    category.financeAccountId,
                  label:
                    category.name,
                }),
              ) ??
              []
            )
          : [];

  return (
    <section
      className="finance-statements-page"
      dir="rtl"
    >
      <header className="finance-statements-heading">
        <div>
          <span>الكشوفات المالية</span>
          <h1>كشوفات</h1>
          <p>
            الصندوق والبنوك وأرصدة الزبائن والموردين وتحليل المصروفات حسب الفترة.
          </p>
        </div>
      </header>

      <div className="finance-statement-tabs">
        <button
          className={mode === "cash" ? "is-active" : ""}
          type="button"
          onClick={() => switchMode("cash")}
        >
          💰 كشف حساب الصندوق
        </button>

        <button
          className={mode === "bank" ? "is-active" : ""}
          type="button"
          onClick={() => switchMode("bank")}
        >
          🏦 كشف حساب البنك
        </button>

        <button
          className={mode === "customers" ? "is-active" : ""}
          type="button"
          onClick={() => switchMode("customers")}
        >
          👥 أرصدة الزبائن
        </button>

        <button
          className={mode === "suppliers" ? "is-active" : ""}
          type="button"
          onClick={() => switchMode("suppliers")}
        >
          🚚 أرصدة الموردين
        </button>

        <button
          className={mode === "expense" ? "is-active" : ""}
          type="button"
          onClick={() => switchMode("expense")}
        >
          📊 تحليل حساب / مصروف
        </button>
      </div>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {(mode === "cash" ||
        mode === "bank" ||
        mode === "expense") && (
        <>
          <section className="finance-statement-filters">
            <label>
              <span>
                {mode === "cash"
                  ? "الصندوق"
                  : mode === "bank"
                    ? "الحساب البنكي"
                    : "الحساب / المصروف"}
              </span>

              <select
                value={
                  accountId ??
                  ""
                }
                onChange={(
                  event,
                ) =>
                  setAccountId(
                    Number(
                      event.target
                        .value,
                    ) ||
                      null,
                  )
                }
              >
                {accountOptions.map(
                  (option) => (
                    <option
                      value={
                        option.id
                      }
                      key={
                        option.id
                      }
                    >
                      {
                        option.label
                      }
                    </option>
                  ),
                )}
              </select>
            </label>

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
              className="primary-button"
              type="button"
              disabled={
                loading ||
                !accountId
              }
              onClick={() =>
                void loadStatement()
              }
            >
              {loading
                ? "جاري التحميل…"
                : "عرض الكشف"}
            </button>
          </section>

          {statement && (
            <>
              <section className="finance-statement-summary">
                <article>
                  <span>
                    رصيد أول المدة
                  </span>
                  <strong>
                    {money(
                      statement.openingBalanceMinor,
                      statement.account.currencyCode,
                    )}
                  </strong>
                </article>

                <article>
                  <span>
                    إجمالي المدين
                  </span>
                  <strong>
                    {money(
                      statement.periodDebitMinor,
                    )}
                  </strong>
                </article>

                <article>
                  <span>
                    إجمالي الدائن
                  </span>
                  <strong>
                    {money(
                      statement.periodCreditMinor,
                    )}
                  </strong>
                </article>

                <article>
                  <span>
                    رصيد آخر المدة
                  </span>
                  <strong>
                    {money(
                      statement.closingBalanceMinor,
                      statement.account.currencyCode,
                    )}
                  </strong>
                </article>
              </section>

              <section className="finance-statement-table-card">
                <div className="finance-statement-table-title">
                  <div>
                    <strong>
                      {statement.account.name}
                    </strong>
                    <span>
                      {statement.range.from} — {statement.range.to}
                    </span>
                  </div>

                  <span>
                    {statement.entries.length} حركة
                  </span>
                </div>

                <div className="finance-statement-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>المرجع</th>
                        <th>البيان</th>
                        <th>مدين</th>
                        <th>دائن</th>
                        <th>الرصيد</th>
                      </tr>
                    </thead>

                    <tbody>
                      {statement.entries.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            لا توجد حركات في الفترة المحددة.
                          </td>
                        </tr>
                      ) : (
                        statement.entries.map(
                          (entry) => (
                            <tr key={entry.lineId}>
                              <td>
                                {entry.businessDate}
                              </td>

                              <td dir="ltr">
                                {entry.publicId}
                              </td>

                              <td>
                                {entry.memo ||
                                  entry.transactionNotes ||
                                  `${entry.sourceType} / ${entry.sourceEvent}`}
                              </td>

                              <td>
                                {entry.debitMinor > 0
                                  ? money(entry.debitMinor)
                                  : "—"}
                              </td>

                              <td>
                                {entry.creditMinor > 0
                                  ? money(entry.creditMinor)
                                  : "—"}
                              </td>

                              <td>
                                <strong>
                                  {money(
                                    entry.runningBalanceMinor,
                                    statement.account.currencyCode,
                                  )}
                                </strong>
                              </td>
                            </tr>
                          ),
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {mode === "customers" && (
        <>
          <section className="finance-statement-summary">
            <article>
              <span>إجمالي مستحق لنا</span>
              <strong>{money(customerTotals.receivable)}</strong>
            </article>

            <article>
              <span>أرصدة دائنة للزبائن</span>
              <strong>{money(customerTotals.credit)}</strong>
            </article>

            <article>
              <span>عدد الزبائن</span>
              <strong>{customers.length}</strong>
            </article>
          </section>

          <section className="finance-statement-table-card">
            <div className="finance-statement-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الزبون</th>
                    <th>الهاتف</th>
                    <th>الحالة</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>

                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.name}</td>
                      <td dir="ltr">{customer.phone || "—"}</td>
                      <td>
                        {customer.balanceMinor > 0
                          ? "مدين للمتجر"
                          : customer.balanceMinor < 0
                            ? "له رصيد"
                            : "مسدد"}
                      </td>
                      <td>
                        <strong>{money(customer.balanceMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {mode === "suppliers" && (
        <>
          <section className="finance-statement-summary">
            <article>
              <span>المستحق للموردين</span>
              <strong>{money(supplierTotals.due)}</strong>
            </article>

            <article>
              <span>رصيد لنا عند الموردين</span>
              <strong>{money(supplierTotals.credit)}</strong>
            </article>

            <article>
              <span>عدد الموردين</span>
              <strong>{suppliers.length}</strong>
            </article>
          </section>

          <section className="finance-statement-table-card">
            <div className="finance-statement-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المورد</th>
                    <th>إجمالي المشتريات</th>
                    <th>المدفوع</th>
                    <th>المستحق</th>
                    <th>رصيد لنا</th>
                  </tr>
                </thead>

                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td>{supplier.name}</td>
                      <td>{money(supplier.totalPurchasesMinor ?? 0)}</td>
                      <td>{money(supplier.paidMinor ?? 0)}</td>
                      <td><strong>{money(supplier.dueMinor ?? 0)}</strong></td>
                      <td>{money(supplier.supplierCreditMinor ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
