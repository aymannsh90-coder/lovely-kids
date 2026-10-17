import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  createPosEmployee,
  createPosEmployeeAdvance,
  createPosEmployeePayment,
  createPosEmployeeRepayment,
  createPosEmployeeSalaryAccrual,
  getPosBankAccounts,
  getPosEmployeeLedger,
  getPosEmployees,
  type PosBankAccount,
  type PosEmployee,
  type PosEmployeeLedgerResult,
  updatePosEmployee,
} from "../../lib/api";

type StatusFilter =
  | "all"
  | "active"
  | "inactive";

type EmployeeAction =
  | "advance"
  | "repayment"
  | "salary"
  | "payment";

function formatMinor(
  value: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(
    Math.abs(value) / 100,
  )} ₪`;
}

function signedMinor(
  value: number,
) {
  if (value === 0) {
    return "0.00 ₪";
  }

  return `${value > 0 ? "+" : "-"}${formatMinor(
    value,
  )}`;
}

function actionLabel(
  action: EmployeeAction,
) {
  if (action === "advance") {
    return "سلفة / مسحوب";
  }

  if (action === "repayment") {
    return "تسديد سلفة";
  }

  if (action === "salary") {
    return "استحقاق راتب";
  }

  return "دفع مستحقات";
}

function eventLabel(
  sourceEvent: string | null,
) {
  if (
    sourceEvent ===
    "employee_advance"
  ) {
    return "سلفة / مسحوب";
  }

  if (
    sourceEvent ===
    "employee_repayment"
  ) {
    return "تسديد سلفة";
  }

  if (
    sourceEvent ===
    "salary_accrual"
  ) {
    return "استحقاق راتب";
  }

  if (
    sourceEvent ===
    "employee_payment"
  ) {
    return "دفع مستحقات";
  }

  return sourceEvent ?? "حركة";
}

function errorText(
  error: unknown,
) {
  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع";
}

function idempotencyKey(
  prefix: string,
) {
  const value =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`;

  return `${prefix}_${value}`;
}

function amountInput(
  minor: number,
) {
  return (
    minor / 100
  ).toFixed(2);
}

export default function EmployeesPage() {
  const {
    token,
    session,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    employees,
    setEmployees,
  ] =
    useState<
      PosEmployee[]
    >([]);

  const [
    bankAccounts,
    setBankAccounts,
  ] =
    useState<
      PosBankAccount[]
    >([]);

  const [
    selectedId,
    setSelectedId,
  ] =
    useState<
      number | null
    >(null);

  const [
    ledger,
    setLedger,
  ] =
    useState<
      PosEmployeeLedgerResult | null
    >(null);

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<StatusFilter>(
      "active",
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    ledgerBusy,
    setLedgerBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    showNew,
    setShowNew,
  ] =
    useState(false);

  const [
    editing,
    setEditing,
  ] =
    useState(false);

  const [
    newName,
    setNewName,
  ] =
    useState("");

  const [
    newPhone,
    setNewPhone,
  ] =
    useState("");

  const [
    newSalary,
    setNewSalary,
  ] =
    useState("");

  const [
    newHireDate,
    setNewHireDate,
  ] =
    useState("");

  const [
    newNotes,
    setNewNotes,
  ] =
    useState("");

  const [
    editName,
    setEditName,
  ] =
    useState("");

  const [
    editPhone,
    setEditPhone,
  ] =
    useState("");

  const [
    editSalary,
    setEditSalary,
  ] =
    useState("");

  const [
    editHireDate,
    setEditHireDate,
  ] =
    useState("");

  const [
    editStatus,
    setEditStatus,
  ] =
    useState<
      "active" | "inactive"
    >("active");

  const [
    editNotes,
    setEditNotes,
  ] =
    useState("");

  const [
    action,
    setAction,
  ] =
    useState<EmployeeAction>(
      "advance",
    );

  const [
    actionAmount,
    setActionAmount,
  ] =
    useState("");

  const [
    actionMethod,
    setActionMethod,
  ] =
    useState<
      | "cash"
      | "card"
      | "bank"
    >("cash");

  const [
    actionCardProcessor,
    setActionCardProcessor,
  ] =
    useState<
      | "arab"
      | "bop"
      | null
    >(null);

  const [
    actionBankAccountId,
    setActionBankAccountId,
  ] =
    useState("");

  const [
    actionExchangeRate,
    setActionExchangeRate,
  ] =
    useState("");

  const [
    referencePeriod,
    setReferencePeriod,
  ] =
    useState("");

  const [
    actionNotes,
    setActionNotes,
  ] =
    useState("");

  const [
    actionBusy,
    setActionBusy,
  ] =
    useState(false);

  const selected =
    useMemo(
      () =>
        employees.find(
          (employee) =>
            employee.id ===
            selectedId,
        ) ?? null,
      [
        employees,
        selectedId,
      ],
    );

  const selectedBankAccount =
    useMemo(
      () =>
        bankAccounts.find(
          (account) =>
            account.id ===
            Number(
              actionBankAccountId,
            ),
        ) ?? null,
      [
        bankAccounts,
        actionBankAccountId,
      ],
    );

  const visibleEmployees =
    useMemo(
      () => {
        const normalized =
          query
            .trim()
            .toLowerCase();

        return employees.filter(
          (employee) => {
            if (
              statusFilter !==
                "all" &&
              employee.status !==
                statusFilter
            ) {
              return false;
            }

            if (!normalized) {
              return true;
            }

            return [
              employee.name,
              employee.code,
              employee.phone ??
                "",
            ].some(
              (value) =>
                value
                  .toLowerCase()
                  .includes(
                    normalized,
                  ),
            );
          },
        );
      },
      [
        employees,
        query,
        statusFilter,
      ],
    );

  async function loadEmployees(
    keepSelected = true,
  ) {
    setBusy(true);
    setError("");

    try {
      const [
        response,
        bankResponse,
      ] =
        await Promise.all([
          getPosEmployees(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
        ]);

      setEmployees(
        response.results,
      );

      setBankAccounts(
        bankResponse.results.filter(
          (account) =>
            account.status ===
            "active",
        ),
      );

      if (
        keepSelected &&
        selectedId !== null &&
        response.results.some(
          (employee) =>
            employee.id ===
            selectedId,
        )
      ) {
        return;
      }

      const firstActive =
        response.results.find(
          (employee) =>
            employee.status ===
            "active",
        );

      setSelectedId(
        firstActive?.id ??
          response.results[0]
            ?.id ??
          null,
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
      setBusy(false);
    }
  }

  async function loadLedger(
    employeeId: number,
  ) {
    setLedgerBusy(true);
    setError("");

    try {
      const result =
        await getPosEmployeeLedger(
          token,
          employeeId,
        );

      setLedger(
        result,
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
      setLedgerBusy(false);
    }
  }

  useEffect(() => {
    void loadEmployees(
      false,
    );
  }, []);

  useEffect(() => {
    if (
      selectedId === null
    ) {
      setLedger(null);
      return;
    }

    void loadLedger(
      selectedId,
    );
  }, [selectedId]);

  useEffect(() => {
    if (!selected) {
      setEditing(false);
      return;
    }

    setEditName(
      selected.name,
    );

    setEditPhone(
      selected.phone ?? "",
    );

    setEditSalary(
      amountInput(
        selected.baseSalaryMinor,
      ),
    );

    setEditHireDate(
      selected.hireDate ?? "",
    );

    setEditStatus(
      selected.status,
    );

    setEditNotes(
      selected.notes ?? "",
    );

    setEditing(false);
  }, [selectedId]);

  useEffect(() => {
    if (
      action === "salary" &&
      selected &&
      !actionAmount.trim() &&
      selected.baseSalaryMinor >
        0
    ) {
      setActionAmount(
        amountInput(
          selected.baseSalaryMinor,
        ),
      );
    }
  }, [
    action,
    selectedId,
  ]);

  async function handleCreate(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!newName.trim()) {
      setError(
        "أدخل اسم الموظف",
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosEmployee(
          token,
          {
            name:
              newName.trim(),
            phone:
              newPhone.trim() ||
              undefined,
            baseSalary:
              newSalary.trim() ||
              "0",
            hireDate:
              newHireDate ||
              undefined,
            notes:
              newNotes.trim() ||
              undefined,
          },
        );

      setShowNew(false);
      setNewName("");
      setNewPhone("");
      setNewSalary("");
      setNewHireDate("");
      setNewNotes("");

      await loadEmployees(
        false,
      );

      setSelectedId(
        result.employee.id,
      );

      setMessage(
        `تمت إضافة الموظف ${result.employee.name}`,
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
      setBusy(false);
    }
  }

  async function handleUpdate(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    if (!editName.trim()) {
      setError(
        "أدخل اسم الموظف",
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await updatePosEmployee(
        token,
        selected.id,
        {
          name:
            editName.trim(),
          phone:
            editPhone.trim() ||
            null,
          baseSalary:
            editSalary.trim() ||
            "0",
          hireDate:
            editHireDate ||
            null,
          status:
            editStatus,
          notes:
            editNotes.trim() ||
            null,
        },
      );

      await Promise.all([
        loadEmployees(true),
        loadLedger(
          selected.id,
        ),
      ]);

      setEditing(false);
      setMessage(
        "تم حفظ بيانات الموظف",
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
      setBusy(false);
    }
  }

  async function handleAction(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    if (
      selected.status !==
        "active" &&
      (
        action ===
          "advance" ||
        action ===
          "salary"
      )
    ) {
      setError(
        action ===
          "salary"
          ? "لا يمكن تسجيل استحقاق راتب جديد لموظف غير فعال."
          : "لا يمكن تسجيل سلفة جديدة لموظف غير فعال.",
      );
      return;
    }

    if (
      action === "salary" &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(
        referencePeriod.trim(),
      )
    ) {
      setError(
        "اختر شهر استحقاق الراتب.",
      );
      return;
    }

    const numeric =
      Number(
        actionAmount
          .trim()
          .replace(
            ",",
            ".",
          ),
      );

    if (
      !Number.isFinite(
        numeric,
      ) ||
      numeric <= 0
    ) {
      setError(
        "أدخل مبلغًا صحيحًا",
      );
      return;
    }

    if (
      action !== "salary" &&
      actionMethod ===
        "cash" &&
      !session
    ) {
      setError(
        "يجب فتح الصندوق أولًا للحركة النقدية",
      );
      return;
    }

    if (
      action === "repayment" &&
      actionMethod === "card" &&
      !actionCardProcessor
    ) {
      setError(
        "اختر ماكينة الفيزا لتسديد السلفة: البنك العربي أو بنك فلسطين",
      );
      return;
    }

    if (
      action !== "salary" &&
      actionMethod === "bank" &&
      !selectedBankAccount
    ) {
      setError(
        "اختر الحساب البنكي",
      );
      return;
    }

    if (
      action !== "salary" &&
      actionMethod === "bank" &&
      selectedBankAccount &&
      selectedBankAccount.currencyCode !==
        "ILS"
    ) {
      const rate =
        Number(
          actionExchangeRate
            .trim()
            .replace(
              ",",
              ".",
            ),
        );

      if (
        !Number.isFinite(
          rate,
        ) ||
        rate <= 0
      ) {
        setError(
          "أدخل سعر صرف صحيح للحساب البنكي",
        );
        return;
      }
    }

    setActionBusy(true);
    setError("");
    setMessage("");

    try {
      const base = {
        amount:
          numeric.toFixed(2),
        registerKey:
          session
            ?.registerKey ??
          "main",
        referencePeriod:
          referencePeriod.trim() ||
          undefined,
        notes:
          actionNotes.trim() ||
          undefined,
        idempotencyKey:
          idempotencyKey(
            `employee_${action}`,
          ),
      };

      let publicId =
        "";

      if (
        action === "advance"
      ) {
        const result =
          await createPosEmployeeAdvance(
            token,
            selected.id,
            {
              ...base,
              paymentMethod:
                actionMethod,
              bankAccountId:
                actionMethod ===
                  "bank"
                  ? selectedBankAccount!.id
                  : undefined,
              exchangeRate:
                actionMethod ===
                  "bank" &&
                selectedBankAccount?.currencyCode !==
                  "ILS"
                  ? actionExchangeRate.trim()
                  : undefined,
            },
          );

        publicId =
          result.voucher.publicId;
      } else if (
        action === "repayment"
      ) {
        const result =
          await createPosEmployeeRepayment(
            token,
            selected.id,
            {
              ...base,
              paymentMethod:
                actionMethod,
              cardProcessor:
                actionMethod ===
                  "card"
                  ? actionCardProcessor ??
                    undefined
                  : undefined,
              bankAccountId:
                actionMethod ===
                  "bank"
                  ? selectedBankAccount!.id
                  : undefined,
              exchangeRate:
                actionMethod ===
                  "bank" &&
                selectedBankAccount?.currencyCode !==
                  "ILS"
                  ? actionExchangeRate.trim()
                  : undefined,
            },
          );

        publicId =
          result.voucher.publicId;
      } else if (
        action === "salary"
      ) {
        const result =
          await createPosEmployeeSalaryAccrual(
            token,
            selected.id,
            base,
          );

        publicId =
          result.voucher.publicId;
      } else {
        const result =
          await createPosEmployeePayment(
            token,
            selected.id,
            {
              ...base,
              paymentMethod:
                actionMethod,
              bankAccountId:
                actionMethod ===
                  "bank"
                  ? selectedBankAccount!.id
                  : undefined,
              exchangeRate:
                actionMethod ===
                  "bank" &&
                selectedBankAccount?.currencyCode !==
                  "ILS"
                  ? actionExchangeRate.trim()
                  : undefined,
            },
          );

        publicId =
          result.voucher.publicId;
      }

      setActionAmount("");
      setActionCardProcessor(
        null,
      );
      setActionBankAccountId("");
      setActionExchangeRate("");
      setReferencePeriod("");
      setActionNotes("");

      await Promise.all([
        loadEmployees(true),
        loadLedger(
          selected.id,
        ),
      ]);

      setMessage(
        `تم تسجيل الحركة ${publicId}`,
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
      setActionBusy(false);
    }
  }

  return (
    <section
      className="employees-page"
      dir="rtl"
    >
      <div className="employees-page-head">
        <div>
          <span className="employees-eyebrow">
            الأطراف والحسابات
          </span>
          <h1>
            إدارة الموظفين
          </h1>
          <p>
            بيانات الموظفين، السلف، الرواتب، المستحقات وكشف الحركة من مكان واحد.
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
          + موظف جديد
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {message && (
        <div className="employees-success">
          {message}
        </div>
      )}

      {showNew && (
        <form
          className="employees-form-card"
          onSubmit={
            handleCreate
          }
        >
          <div className="employees-form-title">
            <div>
              <h2>
                إضافة موظف جديد
              </h2>
              <p>
                الراتب الأساسي اختياري ويمكن تعديله لاحقًا.
              </p>
            </div>
          </div>

          <div className="employees-form-grid">
            <label>
              <span>
                اسم الموظف *
              </span>
              <input
                value={newName}
                onChange={(
                  event,
                ) =>
                  setNewName(
                    event.target.value,
                  )
                }
                placeholder="مثال: محمد أحمد"
              />
            </label>

            <label>
              <span>
                الهاتف
              </span>
              <input
                value={newPhone}
                onChange={(
                  event,
                ) =>
                  setNewPhone(
                    event.target.value,
                  )
                }
                placeholder="05..."
              />
            </label>

            <label>
              <span>
                الراتب الأساسي
              </span>
              <input
                inputMode="decimal"
                value={newSalary}
                onChange={(
                  event,
                ) =>
                  setNewSalary(
                    event.target.value,
                  )
                }
                placeholder="0.00"
              />
            </label>

            <label>
              <span>
                تاريخ التعيين
              </span>
              <input
                type="date"
                value={newHireDate}
                onChange={(
                  event,
                ) =>
                  setNewHireDate(
                    event.target.value,
                  )
                }
              />
            </label>

            <label className="employees-form-wide">
              <span>
                ملاحظات
              </span>
              <textarea
                value={newNotes}
                onChange={(
                  event,
                ) =>
                  setNewNotes(
                    event.target.value,
                  )
                }
                rows={3}
              />
            </label>
          </div>

          <div className="employees-form-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {busy
                ? "جاري الحفظ…"
                : "حفظ الموظف"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setShowNew(false)
              }
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      <div className="employees-layout">
        <aside className="employees-list-card">
          <div className="employees-list-tools">
            <input
              value={query}
              onChange={(
                event,
              ) =>
                setQuery(
                  event.target.value,
                )
              }
              placeholder="بحث بالاسم أو الكود أو الهاتف"
            />

            <select
              value={
                statusFilter
              }
              onChange={(
                event,
              ) =>
                setStatusFilter(
                  event.target.value as StatusFilter,
                )
              }
            >
              <option value="active">
                الفعالون
              </option>
              <option value="inactive">
                غير الفعالين
              </option>
              <option value="all">
                الكل
              </option>
            </select>
          </div>

          <div className="employees-list-count">
            {busy
              ? "جاري التحميل…"
              : `${visibleEmployees.length} موظف`}
          </div>

          <div className="employees-list">
            {visibleEmployees.length ===
            0 ? (
              <div className="employees-empty">
                لا يوجد موظفون مطابقون.
              </div>
            ) : (
              visibleEmployees.map(
                (employee) => (
                  <button
                    key={
                      employee.id
                    }
                    type="button"
                    className={
                      employee.id ===
                      selectedId
                        ? "employees-list-item is-selected"
                        : "employees-list-item"
                    }
                    onClick={() =>
                      setSelectedId(
                        employee.id,
                      )
                    }
                  >
                    <div>
                      <strong>
                        {employee.name}
                      </strong>
                      <small>
                        {employee.code}
                        {employee.phone
                          ? ` • ${employee.phone}`
                          : ""}
                      </small>
                    </div>

                    <div className="employees-list-balance">
                      <span
                        className={
                          employee.status ===
                          "active"
                            ? "is-active"
                            : "is-inactive"
                        }
                      >
                        {employee.status ===
                        "active"
                          ? "فعال"
                          : "موقوف"}
                      </span>

                      <small>
                        صافي:{" "}
                        {employee.netDueToEmployeeMinor >
                        0
                          ? `له ${formatMinor(employee.netDueToEmployeeMinor)}`
                          : employee.netDueToEmployeeMinor <
                              0
                            ? `عليه ${formatMinor(employee.netDueToEmployeeMinor)}`
                            : "مسدد"}
                      </small>
                    </div>
                  </button>
                ),
              )
            )}
          </div>
        </aside>

        <main className="employees-detail">
          {!selected ? (
            <div className="employees-empty-card">
              اختر موظفًا لعرض التفاصيل.
            </div>
          ) : (
            <>
              <section className="employees-profile-card">
                <div className="employees-profile-head">
                  <div>
                    <span>
                      {selected.code}
                    </span>
                    <h2>
                      {selected.name}
                    </h2>
                    <p>
                      {selected.phone ??
                        "بدون رقم هاتف"}
                      {selected.hireDate
                        ? ` • تاريخ التعيين ${selected.hireDate}`
                        : ""}
                    </p>
                  </div>

                  <div className="employees-profile-actions">
                    <span
                      className={
                        selected.status ===
                        "active"
                          ? "employees-status is-active"
                          : "employees-status is-inactive"
                      }
                    >
                      {selected.status ===
                      "active"
                        ? "فعال"
                        : "غير فعال"}
                    </span>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setEditing(
                          (current) =>
                            !current,
                        )
                      }
                    >
                      {editing
                        ? "إغلاق التعديل"
                        : "تعديل البيانات"}
                    </button>
                  </div>
                </div>

                <div className="employees-balance-grid">
                  <article>
                    <span>
                      سلف ومسحوبات
                    </span>
                    <strong className="is-danger">
                      {formatMinor(
                        selected.advanceMinor,
                      )}
                    </strong>
                    <small>
                      مبلغ على الموظف
                    </small>
                  </article>

                  <article>
                    <span>
                      مستحقات الموظف
                    </span>
                    <strong className="is-success">
                      {formatMinor(
                        selected.payableMinor,
                      )}
                    </strong>
                    <small>
                      مبلغ للمـوظف عند المحل
                    </small>
                  </article>

                  <article>
                    <span>
                      صافي الحساب
                    </span>
                    <strong>
                      {selected.netDueToEmployeeMinor >
                      0
                        ? `له ${formatMinor(selected.netDueToEmployeeMinor)}`
                        : selected.netDueToEmployeeMinor <
                            0
                          ? `عليه ${formatMinor(selected.netDueToEmployeeMinor)}`
                          : "مسدد"}
                    </strong>
                    <small>
                      المستحقات ناقص السلف
                    </small>
                  </article>

                  <article>
                    <span>
                      الراتب الأساسي
                    </span>
                    <strong>
                      {formatMinor(
                        selected.baseSalaryMinor,
                      )}
                    </strong>
                    <small>
                      مرجع للاستحقاق الشهري
                    </small>
                  </article>
                </div>

                {editing && (
                  <form
                    className="employees-edit-form"
                    onSubmit={
                      handleUpdate
                    }
                  >
                    <label>
                      <span>
                        الاسم
                      </span>
                      <input
                        value={
                          editName
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditName(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        الهاتف
                      </span>
                      <input
                        value={
                          editPhone
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditPhone(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        الراتب الأساسي
                      </span>
                      <input
                        inputMode="decimal"
                        value={
                          editSalary
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditSalary(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        تاريخ التعيين
                      </span>
                      <input
                        type="date"
                        value={
                          editHireDate
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditHireDate(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        الحالة
                      </span>
                      <select
                        value={
                          editStatus
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditStatus(
                            event.target.value as
                              | "active"
                              | "inactive",
                          )
                        }
                      >
                        <option value="active">
                          فعال
                        </option>
                        <option value="inactive">
                          غير فعال
                        </option>
                      </select>
                    </label>

                    <label className="employees-form-wide">
                      <span>
                        ملاحظات
                      </span>
                      <textarea
                        rows={3}
                        value={
                          editNotes
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditNotes(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <div className="employees-form-wide employees-form-actions">
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={busy}
                      >
                        حفظ التعديلات
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <section className="employees-action-card">
                <div className="employees-section-heading">
                  <div>
                    <h2>
                      حركة مالية للموظف
                    </h2>
                    <p>
                      كل حركة تُسجل محاسبيًا وتظهر في كشف الموظف.
                    </p>
                  </div>
                </div>

                <div className="employees-action-tabs">
                  {(
                    [
                      "advance",
                      "repayment",
                      "salary",
                      "payment",
                    ] as EmployeeAction[]
                  ).map(
                    (item) => (
                      <button
                        key={item}
                        type="button"
                        className={
                          item ===
                          action
                            ? "is-selected"
                            : ""
                        }
                        disabled={
                          selected.status !==
                            "active" &&
                          (
                            item ===
                              "advance" ||
                            item ===
                              "salary"
                          )
                        }
                        title={
                          selected.status !==
                            "active" &&
                          (
                            item ===
                              "advance" ||
                            item ===
                              "salary"
                          )
                            ? "الموظف غير فعال؛ يمكن فقط تسديد السلفة أو دفع المستحقات."
                            : undefined
                        }
                        onClick={() => {
                          setAction(
                            item,
                          );
                          if (
                            item !==
                            "repayment"
                          ) {
                            setActionCardProcessor(
                              null,
                            );
                          }

                          setActionAmount(
                            item ===
                              "salary" &&
                              selected.baseSalaryMinor >
                                0
                              ? amountInput(
                                  selected.baseSalaryMinor,
                                )
                              : "",
                          );
                        }}
                      >
                        {actionLabel(
                          item,
                        )}
                      </button>
                    ),
                  )}
                </div>

                <form
                  className="employees-action-form"
                  onSubmit={
                    handleAction
                  }
                >
                  <label>
                    <span>
                      المبلغ
                    </span>
                    <input
                      inputMode="decimal"
                      value={
                        actionAmount
                      }
                      onChange={(
                        event,
                      ) =>
                        setActionAmount(
                          event.target.value,
                        )
                      }
                      placeholder="0.00"
                    />
                  </label>

                  {action !==
                    "salary" && (
                    <label>
                      <span>
                        طريقة الدفع
                      </span>
                      <select
                        value={
                          actionMethod
                        }
                        onChange={(
                          event,
                        ) => {
                          const value =
                            event.target.value as
                              | "cash"
                              | "card"
                              | "bank";

                          setActionMethod(
                            value,
                          );

                          if (
                            value !==
                            "card"
                          ) {
                            setActionCardProcessor(
                              null,
                            );
                          }

                          if (
                            value !==
                            "bank"
                          ) {
                            setActionBankAccountId(
                              "",
                            );
                            setActionExchangeRate(
                              "",
                            );
                          }
                        }}
                      >
                        <option value="cash">
                          نقدي
                        </option>
                        <option value="card">
                          بطاقة
                        </option>
                        <option value="bank">
                          بنك
                        </option>
                      </select>
                    </label>
                  )}

                  {action ===
                    "repayment" &&
                    actionMethod ===
                      "card" && (
                      <label>
                        <span>
                          ماكينة الفيزا
                        </span>
                        <select
                          value={
                            actionCardProcessor ??
                            ""
                          }
                          onChange={(
                            event,
                          ) =>
                            setActionCardProcessor(
                              event.target.value ===
                                "arab" ||
                              event.target.value ===
                                "bop"
                                ? event.target.value
                                : null,
                            )
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

                  {action !==
                    "salary" &&
                    actionMethod ===
                      "bank" && (
                      <label>
                        <span>
                          الحساب البنكي
                        </span>
                        <select
                          value={
                            actionBankAccountId
                          }
                          onChange={(
                            event,
                          ) => {
                            setActionBankAccountId(
                              event.target.value,
                            );
                            setActionExchangeRate(
                              "",
                            );
                          }}
                        >
                          <option value="">
                            اختر الحساب
                          </option>
                          {bankAccounts.map(
                            (
                              account,
                            ) => (
                              <option
                                key={
                                  account.id
                                }
                                value={
                                  account.id
                                }
                              >
                                {account.name} — {account.currencyCode}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}

                  {action !==
                    "salary" &&
                    actionMethod ===
                      "bank" &&
                    selectedBankAccount &&
                    selectedBankAccount.currencyCode !==
                      "ILS" && (
                      <label>
                        <span>
                          سعر الصرف إلى شيكل
                        </span>
                        <input
                          inputMode="decimal"
                          value={
                            actionExchangeRate
                          }
                          onChange={(
                            event,
                          ) =>
                            setActionExchangeRate(
                              event.target.value,
                            )
                          }
                          placeholder="مثال: 3.10"
                        />
                      </label>
                    )}

                  <label>
                    <span>
                      الفترة / الشهر
                      {action ===
                        "salary" &&
                        " *"}
                    </span>
                    <input
                      type={
                        action ===
                        "salary"
                          ? "month"
                          : "text"
                      }
                      required={
                        action ===
                        "salary"
                      }
                      value={
                        referencePeriod
                      }
                      onChange={(
                        event,
                      ) =>
                        setReferencePeriod(
                          event.target.value,
                        )
                      }
                      placeholder={
                        action ===
                          "salary"
                          ? undefined
                          : "مثال: 2026-10"
                      }
                    />
                    {action ===
                      "salary" && (
                      <small>
                        لا يمكن تسجيل راتبين مرحّلين لنفس الموظف ولنفس الشهر.
                      </small>
                    )}
                  </label>

                  <label className="employees-form-wide">
                    <span>
                      ملاحظات
                    </span>
                    <input
                      value={
                        actionNotes
                      }
                      onChange={(
                        event,
                      ) =>
                        setActionNotes(
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <div className="employees-form-wide employees-form-actions">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={
                        actionBusy ||
                        (
                          selected.status !==
                            "active" &&
                          (
                            action ===
                              "advance" ||
                            action ===
                              "salary"
                          )
                        ) ||
                        (
                          action ===
                            "salary" &&
                          !/^\d{4}-(0[1-9]|1[0-2])$/.test(
                            referencePeriod.trim(),
                          )
                        )
                      }
                    >
                      {actionBusy
                        ? "جاري التسجيل…"
                        : `تسجيل ${actionLabel(action)}`}
                    </button>
                  </div>
                </form>
              </section>

              <section className="employees-ledger-card">
                <div className="employees-section-heading">
                  <div>
                    <h2>
                      كشف حركة الموظف
                    </h2>
                    <p>
                      السلف والمستحقات والرواتب والدفعات المسجلة.
                    </p>
                  </div>

                  <span>
                    {ledgerBusy
                      ? "جاري التحميل…"
                      : `${ledger?.entries.length ?? 0} حركة`}
                  </span>
                </div>

                <div className="employees-ledger-wrap">
                  <table className="employees-ledger-table">
                    <thead>
                      <tr>
                        <th>
                          التاريخ
                        </th>
                        <th>
                          الحركة
                        </th>
                        <th>
                          البيان
                        </th>
                        <th>
                          السلفة
                        </th>
                        <th>
                          المستحقات
                        </th>
                        <th>
                          الفترة
                        </th>
                        <th>
                          المرجع
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {!ledger ||
                      ledger.entries.length ===
                        0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="employees-empty"
                          >
                            لا توجد حركات مسجلة لهذا الموظف.
                          </td>
                        </tr>
                      ) : (
                        [...ledger.entries]
                          .reverse()
                          .map(
                            (
                              entry,
                            ) => {
                              const advanceDelta =
                                entry.accountKind ===
                                "employee_advance"
                                  ? entry.debitMinor -
                                    entry.creditMinor
                                  : 0;

                              const payableDelta =
                                entry.accountKind ===
                                "employee_payable"
                                  ? entry.creditMinor -
                                    entry.debitMinor
                                  : 0;

                              return (
                                <tr
                                  key={
                                    entry.lineId
                                  }
                                >
                                  <td>
                                    {entry.businessDate ??
                                      entry.createdAt.slice(
                                        0,
                                        10,
                                      )}
                                  </td>
                                  <td>
                                    <strong>
                                      {eventLabel(
                                        entry.sourceEvent,
                                      )}
                                    </strong>
                                  </td>
                                  <td>
                                    {entry.memo ??
                                      "—"}
                                  </td>
                                  <td
                                    className={
                                      advanceDelta >
                                      0
                                        ? "is-danger"
                                        : advanceDelta <
                                            0
                                          ? "is-success"
                                          : ""
                                    }
                                  >
                                    {advanceDelta ===
                                    0
                                      ? "—"
                                      : signedMinor(
                                          advanceDelta,
                                        )}
                                  </td>
                                  <td
                                    className={
                                      payableDelta >
                                      0
                                        ? "is-success"
                                        : payableDelta <
                                            0
                                          ? "is-danger"
                                          : ""
                                    }
                                  >
                                    {payableDelta ===
                                    0
                                      ? "—"
                                      : signedMinor(
                                          payableDelta,
                                        )}
                                  </td>
                                  <td>
                                    {entry.referencePeriod ??
                                      "—"}
                                  </td>
                                  <td>
                                    <small>
                                      {entry.publicId ??
                                        "—"}
                                    </small>
                                  </td>
                                </tr>
                              );
                            },
                          )
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
