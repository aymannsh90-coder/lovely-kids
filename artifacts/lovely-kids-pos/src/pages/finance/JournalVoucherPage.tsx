import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import "./FinanceVisualRefresh.css";
import {
  ApiError,
  POS_REGISTER_KEY,
  createPosUnifiedJournalVoucher,
  getCurrentCashSession,
  getDeliveryCompanies,
  getPosBankAccounts,
  getPosCustomers,
  getPosEmployees,
  getPosExpenseCategories,
  getPosFinanceStatementReference,
  getPosSuppliers,
  type PosBankAccount,
  type PosCustomer,
  type PosDeliveryCompany,
  type PosEmployee,
  type PosExpenseCategory,
  type PosFinanceStatementReference,
  type PosSupplier,
  type PosUnifiedVoucherAccountRef,
} from "../../lib/api";

type RefKind =
  | "cash"
  | "bank"
  | "customer"
  | "employee_advance"
  | "employee_payable"
  | "supplier"
  | "delivery_company"
  | "expense"
  | "finance_account";

interface DraftRef {
  kind: RefKind;
  id: string;
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function idempotencyKey() {
  const suffix =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}`;

  return `voucher_journal:${suffix}`;
}

function validAmount(value: string) {
  const numeric =
    Number(
      value
        .trim()
        .replace(",", "."),
    );

  if (
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    return null;
  }

  return numeric.toFixed(2);
}

export default function JournalVoucherPage() {
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
    journalAccounts,
    setJournalAccounts,
  ] =
    useState<
      PosFinanceStatementReference[
        "journalAccounts"
      ]
    >([]);

  const [from, setFrom] =
    useState<DraftRef>({
      kind: "cash",
      id: "",
    });
  const [to, setTo] =
    useState<DraftRef>({
      kind: "customer",
      id: "",
    });

  const [amount, setAmount] =
    useState("");
  const [notes, setNotes] =
    useState("");
  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
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
        statementReference,
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
          getPosFinanceStatementReference(
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
      setJournalAccounts(
        statementReference
          .journalAccounts,
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
  }, []);

  const optionsByKind =
    useMemo(() => {
      return {
        bank:
          bankAccounts.map(
            (item) => ({
              id:
                String(item.id),
              label:
                `${item.bank.nameAr} — ${item.name}`,
            }),
          ),
        customer:
          customers.map(
            (item) => ({
              id:
                String(item.id),
              label:
                `${item.name} — رصيد ${(item.balanceMinor / 100).toFixed(2)} ₪`,
            }),
          ),
        employee_advance:
          employees.map(
            (item) => ({
              id:
                String(item.id),
              label:
                `${item.name} — سلفة ${(item.advanceMinor / 100).toFixed(2)} ₪`,
            }),
          ),
        employee_payable:
          employees.map(
            (item) => ({
              id:
                String(item.id),
              label:
                `${item.name} — مستحق ${(item.payableMinor / 100).toFixed(2)} ₪`,
            }),
          ),
        supplier:
          suppliers.map(
            (item) => ({
              id:
                String(item.id),
              label:
                item.name,
            }),
          ),
        delivery_company:
          deliveryCompanies.map(
            (item) => ({
              id:
                String(item.id),
              label:
                item.name,
            }),
          ),
        expense:
          expenseCategories.map(
            (item) => ({
              id:
                String(item.id),
              label:
                item.name,
            }),
          ),
        finance_account:
          journalAccounts.map(
            (item) => ({
              id:
                String(item.id),
              label:
                item.name,
            }),
          ),
      };
    }, [
      bankAccounts,
      customers,
      employees,
      suppliers,
      deliveryCompanies,
      expenseCategories,
      journalAccounts,
    ]);

  function toApiRef(
    draft: DraftRef,
  ): PosUnifiedVoucherAccountRef {
    if (
      draft.kind === "cash"
    ) {
      return {
        kind: "cash",
        registerKey:
          POS_REGISTER_KEY,
      };
    }

    const id =
      Number(draft.id);

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      throw new Error(
        "اختر الحساب / الطرف المطلوب.",
      );
    }

    if (
      draft.kind === "bank"
    ) {
      return {
        kind: "bank",
        bankAccountId:
          id,
      };
    }

    if (
      draft.kind ===
        "customer"
    ) {
      return {
        kind: "customer",
        customerId:
          id,
      };
    }

    if (
      draft.kind ===
        "employee_advance" ||
      draft.kind ===
        "employee_payable"
    ) {
      return {
        kind:
          draft.kind,
        employeeId:
          id,
      };
    }

    if (
      draft.kind ===
        "supplier"
    ) {
      return {
        kind: "supplier",
        supplierId:
          id,
      };
    }

    if (
      draft.kind ===
        "delivery_company"
    ) {
      return {
        kind:
          "delivery_company",
        deliveryCompanyId:
          id,
      };
    }

    if (
      draft.kind ===
        "finance_account"
    ) {
      return {
        kind:
          "finance_account",
        financeAccountId:
          id,
      };
    }

    return {
      kind: "expense",
      expenseCategoryId:
        id,
    };
  }

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
      (from.kind === "cash" ||
        to.kind === "cash") &&
      !session
    ) {
      setError(
        "يجب فتح الصندوق أولًا لأن القيد يؤثر على الصندوق.",
      );
      return;
    }

    setSaving(true);

    try {
      const result =
        await createPosUnifiedJournalVoucher(
          token,
          {
            from:
              toApiRef(from),
            to:
              toApiRef(to),
            amount:
              normalizedAmount,
            notes:
              notes.trim() ||
              undefined,
            idempotencyKey:
              idempotencyKey(),
          },
        );

      await refreshSession();

      setMessage(
        `تم حفظ سند القيد ${result.voucher.publicId} بنجاح.`,
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

  function accountSelector(
    label: string,
    value: DraftRef,
    onChange: (
      value: DraftRef,
    ) => void,
  ) {
    const options =
      value.kind === "cash"
        ? []
        : optionsByKind[
            value.kind
          ] ?? [];

    return (
      <div
        style={{
          display: "grid",
          gap: 8,
        }}
      >
        <strong>{label}</strong>

        <select
          value={value.kind}
          disabled={
            saving ||
            loading
          }
          onChange={(event) =>
            onChange({
              kind:
                event.target
                  .value as RefKind,
              id: "",
            })
          }
        >
          <option value="cash">
            الصندوق الرئيسي
          </option>
          <option value="bank">
            حساب بنكي
          </option>
          <option value="customer">
            ذمة زبون
          </option>
          <option value="employee_advance">
            سلفة موظف
          </option>
          <option value="employee_payable">
            مستحقات موظف
          </option>
          <option value="supplier">
            ذمة مورد
          </option>
          <option value="delivery_company">
            ذمة شركة توصيل
          </option>
          <option value="expense">
            حساب مصروف
          </option>
          <option value="finance_account">
            حساب محاسبي
          </option>
        </select>

        {value.kind !==
          "cash" && (
          <select
            value={value.id}
            disabled={
              saving ||
              loading
            }
            onChange={(event) =>
              onChange({
                ...value,
                id:
                  event.target
                    .value,
              })
            }
          >
            <option value="">
              اختر الحساب / الطرف
            </option>

            {options.map(
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
        )}
      </div>
    );
  }

  return (
    <section
      className="work-panel lk-finance-refresh lk-finance-journal-voucher"
      dir="rtl"
    >
      <div
        className="panel-heading lk-finance-header"
        style={{
          marginBottom: 18,
        }}
      >
        <div>
          <h2>📒 سند قيد</h2>
          <p>
            نقل قيمة من حساب إلى حساب
            بقيد مزدوج متوازن. الحساب
            «من» يكون دائنًا والحساب
            «إلى» يكون مدينًا.
          </p>
        </div>
      </div>

      <div
        className="lk-finance-guidance"
        style={{
          padding: 14,
          marginBottom: 18,
          borderRadius: 12,
          background:
            "rgba(59,130,246,.10)",
        }}
      >
        مثال: زبون أخذ 50 ₪ كاش
        على حسابه → <strong>من:
        الصندوق</strong>،{" "}
        <strong>إلى: ذمة الزبون</strong>.
        نقل دين من أحمد إلى محمد →
        من ذمة أحمد، إلى ذمة محمد.
      </div>

      <form
        className="lk-finance-form"
        onSubmit={submit}
        style={{
          display: "grid",
          gap: 18,
          maxWidth: 920,
        }}
      >
        <div
          className="lk-finance-account-grid"
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(280px,1fr))",
            gap: 16,
          }}
        >
          {accountSelector(
            "من حساب (دائن)",
            from,
            setFrom,
          )}

          {accountSelector(
            "إلى حساب (مدين)",
            to,
            setTo,
          )}
        </div>

        <label>
          <span>المبلغ ₪</span>
          <input
            dir="ltr"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
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
            البيان / سبب القيد
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
            placeholder="مثال: زبون أخذ 50 شيكل كاش على حسابه"
          />
        </label>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {message && (
          <div
            className="lk-finance-success"
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
              : "حفظ سند القيد"}
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
