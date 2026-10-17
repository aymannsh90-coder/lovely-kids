import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  POS_REGISTER_KEY,
  createPosExpense,
  createPosForeignCurrencyCustomerReceipt,
  createPosUnifiedPaymentVoucher,
  createPosUnifiedReceiptVoucher,
  getCurrentCashSession,
  getDeliveryCompanies,
  getPosBankAccounts,
  getPosFinanceBankingReference,
  getPosFinanceCashAccounts,
  getPosCustomers,
  getPosEmployees,
  getPosExpenseCategories,
  getPosSuppliers,
  type PosBankAccount,
  type PosCustomer,
  type PosDeliveryCompany,
  type PosEmployee,
  type PosExpenseCategory,
  type PosFinanceCashAccount,
  type PosFinanceCurrency,
  type PosSupplier,
} from "../../lib/api";

type Mode =
  | "receipt"
  | "payment";

type ReceiptParty =
  | "customer"
  | "employee"
  | "supplier"
  | "delivery_company";

type PaymentParty =
  | "customer"
  | "employee"
  | "supplier"
  | "expense";

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function newIdempotencyKey(
  prefix: string,
) {
  const suffix =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}`;

  return `${prefix}:${suffix}`;
}

function validAmount(value: string) {
  const normalized =
    value
      .trim()
      .replace(",", ".");

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount.toFixed(2);
}

export default function UnifiedPartyVoucherPage({
  mode,
}: {
  mode: Mode;
}) {
  const navigate =
    useNavigate();

  const {
    token,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [customers, setCustomers] =
    useState<PosCustomer[]>([]);
  const [employees, setEmployees] =
    useState<PosEmployee[]>([]);
  const [suppliers, setSuppliers] =
    useState<PosSupplier[]>([]);
  const [
    deliveryCompanies,
    setDeliveryCompanies,
  ] =
    useState<
      PosDeliveryCompany[]
    >([]);
  const [
    expenseCategories,
    setExpenseCategories,
  ] =
    useState<
      PosExpenseCategory[]
    >([]);
  const [bankAccounts, setBankAccounts] =
    useState<PosBankAccount[]>([]);

  const [
    foreignCashAccounts,
    setForeignCashAccounts,
  ] = useState<
    PosFinanceCashAccount[]
  >([]);

  const [
    financeCurrencies,
    setFinanceCurrencies,
  ] = useState<
    PosFinanceCurrency[]
  >([]);


  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");

  const [
    partyType,
    setPartyType,
  ] = useState<
    ReceiptParty | PaymentParty
  >(
    mode === "receipt"
      ? "customer"
      : "supplier",
  );

  const [partyId, setPartyId] =
    useState("");
  const [
    expenseCategoryId,
    setExpenseCategoryId,
  ] =
    useState("");

  const [
    employeePaymentType,
    setEmployeePaymentType,
  ] =
    useState<
      "advance" | "payable"
    >("advance");

  const [amount, setAmount] =
    useState("");

  const [
    paymentMethod,
    setPaymentMethod,
  ] =
    useState<
      "cash" | "bank"
    >("cash");

  const [
    bankAccountId,
    setBankAccountId,
  ] =
    useState("");

  const [
    foreignCashMode,
    setForeignCashMode,
  ] = useState(false);

  const [
    foreignCashAccountId,
    setForeignCashAccountId,
  ] = useState("");

  const [
    foreignAmount,
    setForeignAmount,
  ] = useState("");

  const [
    foreignExchangeRate,
    setForeignExchangeRate,
  ] = useState("");

  const [notes, setNotes] =
    useState("");

  async function loadReference() {
    setLoading(true);
    setError("");

    try {
      const [
        customerResult,
        employeeResult,
        supplierResult,
        deliveryResult,
        categoryResult,
        bankResult,
        cashResult,
        bankingReference,
      ] =
        await Promise.all([
          getPosCustomers(
            token,
            {
              status:
                "active",
            },
          ),
          getPosEmployees(
            token,
            {
              status:
                "active",
            },
          ),
          getPosSuppliers(
            token,
            {
              status:
                "active",
            },
          ),
          getDeliveryCompanies(
            token,
          ),
          getPosExpenseCategories(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
          getPosFinanceCashAccounts(
            token,
          ),
          getPosFinanceBankingReference(
            token,
          ),
        ]);

      setCustomers(
        customerResult.results,
      );
      setEmployees(
        employeeResult.results,
      );
      setSuppliers(
        supplierResult.results,
      );
      setDeliveryCompanies(
        deliveryResult.filter(
          (item) =>
            item.status ===
            "active",
        ),
      );
      setExpenseCategories(
        categoryResult.results.filter(
          (item) =>
            item.status ===
            "active",
        ),
      );
      setBankAccounts(
        bankResult.results.filter(
          (item) =>
            item.status ===
              "active" &&
            item.currencyCode ===
              "ILS",
        ),
      );
      setForeignCashAccounts(
        cashResult.results.filter(
          (item) =>
            item.currencyCode !==
              "ILS",
        ),
      );
      setFinanceCurrencies(
        bankingReference.currencies.filter(
          (item) =>
            item.status ===
            "active",
        ),
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
        errorText(caught),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReference();
  }, [mode]);

  useEffect(() => {
    setPartyId("");
    setExpenseCategoryId("");
    setMessage("");
    setError("");
  }, [partyType]);

  const partyOptions =
    useMemo(() => {
      if (
        partyType ===
          "customer"
      ) {
        return customers.map(
          (item) => ({
            id:
              String(item.id),
            label:
              `${item.name} — رصيد ${(item.balanceMinor / 100).toFixed(2)} ₪`,
          }),
        );
      }

      if (
        partyType ===
          "employee"
      ) {
        return employees.map(
          (item) => ({
            id:
              String(item.id),
            label:
              `${item.name} — سلفة ${(item.advanceMinor / 100).toFixed(2)} ₪ — مستحق ${(item.payableMinor / 100).toFixed(2)} ₪`,
          }),
        );
      }

      if (
        partyType ===
          "supplier"
      ) {
        return suppliers.map(
          (item) => ({
            id:
              String(item.id),
            label:
              `${item.name} — مستحق ${((item.dueMinor ?? 0) / 100).toFixed(2)} ₪`,
          }),
        );
      }

      if (
        partyType ===
          "delivery_company"
      ) {
        return deliveryCompanies.map(
          (item) => ({
            id:
              String(item.id),
            label:
              item.name,
          }),
        );
      }

      return [];
    }, [
      partyType,
      customers,
      employees,
      suppliers,
      deliveryCompanies,
    ]);

  async function refreshSession() {
    const result =
      await getCurrentCashSession(
        token,
        POS_REGISTER_KEY,
      );

    setSession(
      result.session,
    );
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    const normalizedAmount =
      validAmount(amount);

    if (!normalizedAmount) {
      setError(
        "أدخل مبلغًا صحيحًا أكبر من صفر.",
      );
      return;
    }

    if (
      paymentMethod ===
        "cash" &&
      !session
    ) {
      setError(
        "يجب فتح الصندوق أولًا للحركة النقدية.",
      );
      return;
    }

    if (
      paymentMethod ===
        "bank" &&
      !bankAccountId
    ) {
      setError(
        "اختر الحساب البنكي.",
      );
      return;
    }

    if (
      mode === "receipt" &&
      partyType ===
        "delivery_company"
    ) {
      navigate(
        "/finance/delivery-company",
      );
      return;
    }

    if (
      mode === "payment" &&
      partyType ===
        "expense"
    ) {
      if (!expenseCategoryId) {
        setError(
          "اختر تصنيف المصروف.",
        );
        return;
      }

      setSaving(true);

      try {
        const result =
          await createPosExpense(
            token,
            {
              expenseCategoryId:
                Number(
                  expenseCategoryId,
                ),
              amount:
                normalizedAmount,
              paymentMethod,
              registerKey:
                POS_REGISTER_KEY,
              bankAccountId:
                paymentMethod ===
                  "bank"
                  ? Number(
                      bankAccountId,
                    )
                  : undefined,
              notes:
                notes.trim() ||
                undefined,
              idempotencyKey:
                newIdempotencyKey(
                  "voucher_payment_expense",
                ),
            },
          );

        await refreshSession();

        setMessage(
          `تم حفظ سند الصرف ${result.voucher.publicId} بنجاح.`,
        );
        setAmount("");
        setNotes("");
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
          errorText(caught),
        );
      } finally {
        setSaving(false);
      }

      return;
    }

    if (!partyId) {
      setError(
        "اختر الطرف المالي.",
      );
      return;
    }

    setSaving(true);

    try {
      const common = {
        partyType:
          partyType as
            | "customer"
            | "employee"
            | "supplier"
            | "delivery_company",
        partyId:
          Number(partyId),
        amount:
          normalizedAmount,
        paymentMethod,
        registerKey:
          POS_REGISTER_KEY,
        bankAccountId:
          paymentMethod ===
            "bank"
            ? Number(
                bankAccountId,
              )
            : undefined,
        notes:
          notes.trim() ||
          undefined,
        idempotencyKey:
          newIdempotencyKey(
            mode === "receipt"
              ? "voucher_receipt"
              : "voucher_payment",
          ),
      };

      const result =
        mode === "receipt"
          ? await createPosUnifiedReceiptVoucher(
              token,
              common,
            )
          : await createPosUnifiedPaymentVoucher(
              token,
              {
                ...common,
                employeePaymentType:
                  partyType ===
                    "employee"
                    ? employeePaymentType
                    : undefined,
              },
            );

      await refreshSession();

      setMessage(
        `تم حفظ ${mode === "receipt" ? "سند القبض" : "سند الصرف"} ${result.voucher.publicId} بنجاح.`,
      );
      setAmount("");
      setNotes("");
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
        errorText(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  const isReceipt =
    mode === "receipt";

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
            {isReceipt
              ? "💵 سند قبض"
              : "💸 سند صرف"}
          </h2>

          <p>
            {isReceipt
              ? "تسجيل مبلغ داخل إلى الصندوق أو البنك مقابل حساب طرف مالي."
              : "تسجيل مبلغ خارج من الصندوق أو البنك إلى طرف مالي أو مصروف."}
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              "/vouchers/register",
            )
          }
        >
          سجل السندات
        </button>
      </div>

      <form
        onSubmit={submit}
        style={{
          display: "grid",
          gap: 16,
          maxWidth: 820,
        }}
      >
        <label>
          <span>
            {isReceipt
              ? "قبض من"
              : "صرف إلى"}
          </span>

          <select
            value={partyType}
            disabled={
              saving ||
              loading
            }
            onChange={(event) =>
              setPartyType(
                event.target.value as
                  | ReceiptParty
                  | PaymentParty,
              )
            }
          >
            {isReceipt ? (
              <>
                <option value="customer">
                  زبون
                </option>
                <option value="employee">
                  موظف — تسديد سلفة
                </option>
                <option value="supplier">
                  مورد / تاجر — إرجاع مبلغ لنا
                </option>
                <option value="delivery_company">
                  شركة توصيل
                </option>
              </>
            ) : (
              <>
                <option value="supplier">
                  مورد / تاجر
                </option>
                <option value="employee">
                  موظف
                </option>
                <option value="customer">
                  زبون — إقراض / سحب نقدي على حسابه
                </option>
                <option value="expense">
                  مصروف / فاتورة تشغيلية
                </option>
              </>
            )}
          </select>
        </label>

        {partyType ===
          "expense" ? (
          <label>
            <span>
              تصنيف المصروف
            </span>

            <select
              value={
                expenseCategoryId
              }
              onChange={(event) =>
                setExpenseCategoryId(
                  event.target.value,
                )
              }
              disabled={
                saving ||
                loading
              }
            >
              <option value="">
                اختر التصنيف
              </option>

              {expenseCategories.map(
                (item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.name}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : (
          <label>
            <span>
              {partyType ===
              "delivery_company"
                ? "شركة التوصيل"
                : "الطرف"}
            </span>

            <select
              value={partyId}
              onChange={(event) =>
                setPartyId(
                  event.target.value,
                )
              }
              disabled={
                saving ||
                loading
              }
            >
              <option value="">
                اختر
              </option>

              {partyOptions.map(
                (item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.label}
                  </option>
                ),
              )}
            </select>
          </label>
        )}

        {!isReceipt &&
          partyType ===
            "employee" && (
          <label>
            <span>
              نوع الصرف للموظف
            </span>

            <select
              value={
                employeePaymentType
              }
              onChange={(event) =>
                setEmployeePaymentType(
                  event.target.value as
                    | "advance"
                    | "payable",
                )
              }
              disabled={saving}
            >
              <option value="advance">
                سلفة جديدة
              </option>
              <option value="payable">
                دفع مستحقات / راتب مستحق
              </option>
            </select>
          </label>
        )}

        {isReceipt &&
          partyType ===
            "delivery_company" && (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background:
                "rgba(59,130,246,.10)",
            }}
          >
            قبض شركة التوصيل يجب أن
            يبقى مربوطًا بالطلبات التي
            تم تحصيلها حتى لا تتكرر
            الذمة. عند الحفظ سيتم نقلك
            إلى شاشة تسوية شركة
            التوصيل.
          </div>
        )}

        <label>
          <span>المبلغ ₪</span>
          <input
            dir="ltr"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) =>
              setAmount(
                event.target.value,
              )
            }
            disabled={saving}
          />
        </label>

        <label>
          <span>
            {isReceipt
              ? "الإيداع في"
              : "الصرف من"}
          </span>

          <select
            value={paymentMethod}
            onChange={(event) =>
              setPaymentMethod(
                event.target.value as
                  | "cash"
                  | "bank",
              )
            }
            disabled={saving}
          >
            <option value="cash">
              الصندوق الرئيسي
            </option>
            <option value="bank">
              حساب بنكي
            </option>
          </select>
        </label>

        {paymentMethod ===
          "bank" && (
          <label>
            <span>
              الحساب البنكي
            </span>

            <select
              value={bankAccountId}
              onChange={(event) =>
                setBankAccountId(
                  event.target.value,
                )
              }
              disabled={saving}
            >
              <option value="">
                اختر حسابًا بالشيكل
              </option>

              {bankAccounts.map(
                (account) => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {
                      account.bank
                        .nameAr
                    }{" "}
                    — {account.name}
                  </option>
                ),
              )}
            </select>
          </label>
        )}

        <label>
          <span>
            البيان / الملاحظات
          </span>
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) =>
              setNotes(
                event.target.value,
              )
            }
            disabled={saving}
            placeholder={
              isReceipt
                ? "مثال: دفعة على الحساب"
                : "مثال: دفعة للمورد / سلفة / فاتورة كهرباء"
            }
          />
        </label>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {message && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background:
                "rgba(16,185,129,.12)",
            }}
          >
            {message}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="submit"
            className="primary-button"
            disabled={
              saving ||
              loading
            }
          >
            {saving
              ? "جاري الحفظ..."
              : isReceipt &&
                  partyType ===
                    "delivery_company"
                ? "فتح تسوية شركة التوصيل"
                : isReceipt
                  ? "حفظ سند القبض"
                  : "حفظ سند الصرف"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => {
              setAmount("");
              setNotes("");
              setError("");
              setMessage("");
            }}
          >
            تفريغ
          </button>
        </div>
      </form>
    </section>
  );
}
