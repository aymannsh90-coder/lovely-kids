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
  approvePosAssistantDraft,
  getCurrentCashSession,
  getPosAssistantDrafts,
  getPosBankAccounts,
  getPosEmployees,
  getPosExpenseCategories,
  rejectPosAssistantDraft,
  updatePosAssistantDraft,
  type PosAssistantDraft,
  type PosAssistantDraftIntent,
  type PosAssistantTransferDirection,
  type PosBankAccount,
  type PosEmployee,
  type PosExpenseCategory,
} from "../../lib/api";

type DraftStatusFilter =
  | "pending"
  | "approved"
  | "rejected"
  | "all";

function errorText(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function amountInput(
  minor: number | null,
) {
  return minor === null
    ? ""
    : (
        minor / 100
      ).toFixed(2);
}

function formatMinor(
  minor: number | null,
) {
  return minor === null
    ? "—"
    : `${(
        minor / 100
      ).toFixed(2)} ₪`;
}

function intentLabel(
  intent:
    PosAssistantDraftIntent | null,
) {
  if (
    intent ===
    "employee_advance"
  ) {
    return "سحب / سلفة موظف";
  }

  if (
    intent ===
    "expense"
  ) {
    return "مصروف";
  }

  if (
    intent ===
    "owner_withdrawal"
  ) {
    return "سحب مالك";
  }

  if (
    intent ===
    "finance_transfer"
  ) {
    return "تحويل صندوق ↔ بنك";
  }

  return "غير محدد";
}

export default function AssistantInboxPage() {
  const {
    token,
    session,
    setSession,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    drafts,
    setDrafts,
  ] =
    useState<
      PosAssistantDraft[]
    >([]);

  const [
    employees,
    setEmployees,
  ] =
    useState<
      PosEmployee[]
    >([]);

  const [
    categories,
    setCategories,
  ] =
    useState<
      PosExpenseCategory[]
    >([]);

  const [
    bankAccounts,
    setBankAccounts,
  ] =
    useState<
      PosBankAccount[]
    >([]);

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<DraftStatusFilter>(
      "pending",
    );

  const [
    selectedId,
    setSelectedId,
  ] =
    useState<
      number | null
    >(null);

  const [
    editIntent,
    setEditIntent,
  ] =
    useState<
      PosAssistantDraftIntent | ""
    >("");

  const [
    editAmount,
    setEditAmount,
  ] =
    useState("");

  const [
    editEmployeeId,
    setEditEmployeeId,
  ] =
    useState("");

  const [
    editCategoryId,
    setEditCategoryId,
  ] =
    useState("");

  const [
    editPaymentMethod,
    setEditPaymentMethod,
  ] =
    useState<
      | "cash"
      | "bank"
    >("cash");

  const [
    editBankAccountId,
    setEditBankAccountId,
  ] =
    useState("");

  const [
    editTransferDirection,
    setEditTransferDirection,
  ] =
    useState<
      | PosAssistantTransferDirection
      | ""
    >("");

  const [
    editNotes,
    setEditNotes,
  ] =
    useState("");

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    actionBusy,
    setActionBusy,
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

  const selected =
    useMemo(
      () =>
        drafts.find(
          (draft) =>
            draft.id ===
            selectedId,
        ) ?? null,
      [
        drafts,
        selectedId,
      ],
    );

  async function load(
    keepSelection =
      true,
  ) {
    setBusy(true);
    setError("");

    try {
      const [
        draftResult,
        employeeResult,
        categoryResult,
        bankResult,
      ] =
        await Promise.all([
          getPosAssistantDrafts(
            token,
            statusFilter,
          ),
          getPosEmployees(
            token,
            {
              status:
                "active",
            },
          ),
          getPosExpenseCategories(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
        ]);

      setDrafts(
        draftResult.results,
      );

      setEmployees(
        employeeResult.results,
      );

      setCategories(
        categoryResult.results.filter(
          (category) =>
            category.status ===
            "active",
        ),
      );

      setBankAccounts(
        bankResult.results.filter(
          (account) =>
            account.status ===
            "active",
        ),
      );

      if (
        keepSelection &&
        selectedId !== null &&
        draftResult.results.some(
          (draft) =>
            draft.id ===
            selectedId,
        )
      ) {
        return;
      }

      setSelectedId(
        draftResult.results[0]
          ?.id ??
          null,
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
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

  useEffect(() => {
    void load(false);
  }, [statusFilter]);

  useEffect(() => {
    if (!selected) {
      setEditIntent("");
      setEditAmount("");
      setEditEmployeeId("");
      setEditCategoryId("");
      setEditPaymentMethod(
        "cash",
      );
      setEditBankAccountId("");
      setEditTransferDirection("");
      setEditNotes("");
      return;
    }

    setEditIntent(
      selected.intent ??
      "",
    );

    setEditAmount(
      amountInput(
        selected.amountMinor,
      ),
    );

    setEditEmployeeId(
      selected.employeeId
        ? String(
            selected.employeeId,
          )
        : "",
    );

    setEditCategoryId(
      selected.expenseCategoryId
        ? String(
            selected.expenseCategoryId,
          )
        : "",
    );

    setEditPaymentMethod(
      selected.paymentMethod,
    );

    setEditBankAccountId(
      selected.bankAccountId
        ? String(
            selected.bankAccountId,
          )
        : "",
    );

    setEditTransferDirection(
      selected.transferDirection ??
      "",
    );

    setEditNotes(
      selected.notes ??
      "",
    );
  }, [selectedId, selected?.updatedAt]);

  async function saveSelected() {
    if (
      !selected ||
      selected.status !==
        "pending"
    ) {
      return null;
    }

    const updated =
      await updatePosAssistantDraft(
        token,
        selected.id,
        {
          intent:
            editIntent ||
            null,
          amount:
            editAmount.trim() ||
            null,
          employeeId:
            editIntent ===
              "employee_advance" &&
            editEmployeeId
              ? Number(
                  editEmployeeId,
                )
              : null,
          expenseCategoryId:
            editIntent ===
              "expense" &&
            editCategoryId
              ? Number(
                  editCategoryId,
                )
              : null,
          paymentMethod:
            editIntent ===
              "finance_transfer"
              ? "bank"
              : editPaymentMethod,
          bankAccountId:
            (
              editIntent ===
                "finance_transfer" ||
              editPaymentMethod ===
                "bank"
            ) &&
            editBankAccountId
              ? Number(
                  editBankAccountId,
                )
              : null,
          transferDirection:
            editIntent ===
              "finance_transfer"
              ? editTransferDirection ||
                null
              : null,
          registerKey:
            session?.registerKey ??
            selected.registerKey ??
            "main",
          notes:
            editNotes.trim() ||
            null,
        },
      );

    return updated.draft;
  }

  async function handleSave(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    setActionBusy(true);
    setError("");
    setMessage("");

    try {
      await saveSelected();
      await load(true);
      setMessage(
        "تم حفظ تعديلات المسودة دون أي أثر محاسبي.",
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
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

  async function handleApprove() {
    if (
      !selected ||
      selected.status !==
        "pending"
    ) {
      return;
    }

    const isTransfer =
      editIntent ===
      "finance_transfer";

    if (
      (
        editPaymentMethod ===
          "cash" ||
        isTransfer
      ) &&
      !session
    ) {
      setError(
        isTransfer
          ? "يجب فتح الصندوق قبل اعتماد تحويل بين الصندوق والبنك."
          : "يجب فتح الصندوق قبل اعتماد حركة نقدية. يمكنك حفظ المسودة الآن واعتمادها لاحقًا.",
      );
      return;
    }

    if (
      isTransfer &&
      !editTransferDirection
    ) {
      setError(
        "اختر اتجاه التحويل قبل الاعتماد.",
      );
      return;
    }

    if (
      (
        editPaymentMethod ===
          "bank" ||
        isTransfer
      ) &&
      !editBankAccountId
    ) {
      setError(
        "اختر الحساب البنكي قبل الاعتماد.",
      );
      return;
    }

    const settlementLabel =
      isTransfer
        ? "الصندوق والحساب البنكي"
        : editPaymentMethod ===
            "bank"
          ? "الحساب البنكي"
          : "الصندوق";

    if (
      !window.confirm(
        `اعتماد هذه المسودة سينشئ الحركة المحاسبية فعليًا ويؤثر على ${settlementLabel}. متابعة؟`,
      )
    ) {
      return;
    }

    setActionBusy(true);
    setError("");
    setMessage("");

    try {
      await saveSelected();

      const result =
        await approvePosAssistantDraft(
          token,
          selected.id,
        );

      if (
        (
          editPaymentMethod ===
            "cash" ||
          editIntent ===
            "finance_transfer"
        ) &&
        session
      ) {
        const current =
          await getCurrentCashSession(
            token,
            session.registerKey,
          );

        if (
          current.session
        ) {
          setSession(
            current.session,
          );
        }
      }

      await load(false);

      setMessage(
        result.voucher?.publicId
          ? `تم اعتماد المسودة وإنشاء الحركة ${result.voucher.publicId}.`
          : result.transaction?.publicId
            ? `تم اعتماد المسودة وإنشاء التحويل ${result.transaction.publicId}.`
            : "المسودة كانت معتمدة مسبقًا.",
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
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

  async function handleReject() {
    if (
      !selected ||
      selected.status !==
        "pending"
    ) {
      return;
    }

    if (
      !window.confirm(
        "رفض المسودة؟ لن يتم إنشاء أي حركة محاسبية.",
      )
    ) {
      return;
    }

    setActionBusy(true);
    setError("");
    setMessage("");

    try {
      await rejectPosAssistantDraft(
        token,
        selected.id,
      );

      await load(false);

      setMessage(
        "تم رفض المسودة دون أي أثر محاسبي.",
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
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
      className="assistant-inbox-page"
      dir="rtl"
    >
      <div className="assistant-inbox-head">
        <div>
          <span>
            المساعد الذكي
          </span>
          <h1>
            صندوق مراجعة المسودات
          </h1>
          <p>
            راجع ما تم تسجيله من الهاتف. لا يحدث أي أثر محاسبي إلا عند الضغط على اعتماد.
          </p>
        </div>

        <div className="assistant-inbox-filter">
          <select
            value={
              statusFilter
            }
            onChange={(
              event,
            ) =>
              setStatusFilter(
                event.target.value as
                  DraftStatusFilter,
              )
            }
          >
            <option value="pending">
              بانتظار المراجعة
            </option>
            <option value="approved">
              المعتمدة
            </option>
            <option value="rejected">
              المرفوضة
            </option>
            <option value="all">
              الكل
            </option>
          </select>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void load(true)
            }
            disabled={busy}
          >
            تحديث
          </button>
        </div>
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

      <div className="assistant-inbox-layout">
        <aside className="assistant-inbox-list">
          <div className="assistant-inbox-count">
            {busy
              ? "جاري التحميل…"
              : `${drafts.length} مسودة`}
          </div>

          {drafts.length ===
          0 ? (
            <div className="assistant-inbox-empty">
              لا توجد مسودات في هذه الحالة.
            </div>
          ) : (
            drafts.map(
              (draft) => (
                <button
                  key={
                    draft.id
                  }
                  type="button"
                  className={
                    draft.id ===
                    selectedId
                      ? "assistant-inbox-item is-selected"
                      : "assistant-inbox-item"
                  }
                  onClick={() =>
                    setSelectedId(
                      draft.id,
                    )
                  }
                >
                  <div>
                    <strong>
                      {
                        draft.originalText
                      }
                    </strong>
                    <small>
                      {draft.publicId} •{" "}
                      {intentLabel(
                        draft.intent,
                      )}
                    </small>
                  </div>

                  <span>
                    {formatMinor(
                      draft.amountMinor,
                    )}
                  </span>
                </button>
              ),
            )
          )}
        </aside>

        <main className="assistant-inbox-detail">
          {!selected ? (
            <div className="assistant-inbox-empty-card">
              اختر مسودة لمراجعتها.
            </div>
          ) : (
            <>
              <section className="assistant-review-card">
                <div className="assistant-review-original">
                  <span>
                    النص الأصلي
                  </span>
                  <strong>
                    {
                      selected.originalText
                    }
                  </strong>
                  <small>
                    {selected.source ===
                    "voice"
                      ? "🎙️ صوت"
                      : "⌨️ كتابة"}{" "}
                    • ثقة الفهم{" "}
                    {selected.confidence ??
                      0}
                    %
                  </small>
                </div>

                {selected.parseMessage && (
                  <div className="assistant-review-parse">
                    {
                      selected.parseMessage
                    }
                  </div>
                )}

                <form
                  className="assistant-review-form"
                  onSubmit={
                    handleSave
                  }
                >
                  <label>
                    <span>
                      نوع الحركة
                    </span>
                    <select
                      value={
                        editIntent
                      }
                      onChange={(
                        event,
                      ) => {
                        const value =
                          event.target.value as
                            | PosAssistantDraftIntent
                            | "";

                        setEditIntent(
                          value,
                        );

                        if (
                          value ===
                          "finance_transfer"
                        ) {
                          setEditPaymentMethod(
                            "bank",
                          );
                        } else {
                          setEditTransferDirection(
                            "",
                          );
                        }

                        if (
                          value !==
                          "employee_advance"
                        ) {
                          setEditEmployeeId(
                            "",
                          );
                        }

                        if (
                          value !==
                          "expense"
                        ) {
                          setEditCategoryId(
                            "",
                          );
                        }
                      }}
                      disabled={
                        selected.status !==
                          "pending"
                      }
                    >
                      <option value="">
                        اختر الحركة
                      </option>
                      <option value="employee_advance">
                        سحب / سلفة موظف
                      </option>
                      <option value="expense">
                        مصروف
                      </option>
                      <option value="owner_withdrawal">
                        سحب مالك
                      </option>
                      <option value="finance_transfer">
                        تحويل صندوق ↔ بنك
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>
                      المبلغ
                    </span>
                    <input
                      inputMode="decimal"
                      value={
                        editAmount
                      }
                      onFocus={(
                        event,
                      ) =>
                        event.currentTarget.select()
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditAmount(
                          event.target.value,
                        )
                      }
                      placeholder="0.00"
                      disabled={
                        selected.status !==
                          "pending"
                      }
                    />
                  </label>

                  {editIntent ===
                    "employee_advance" && (
                    <label>
                      <span>
                        الموظف
                      </span>
                      <select
                        value={
                          editEmployeeId
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditEmployeeId(
                            event.target.value,
                          )
                        }
                        disabled={
                          selected.status !==
                            "pending"
                        }
                      >
                        <option value="">
                          اختر الموظف
                        </option>
                        {employees.map(
                          (employee) => (
                            <option
                              key={
                                employee.id
                              }
                              value={
                                employee.id
                              }
                            >
                              {
                                employee.name
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}

                  {editIntent ===
                    "expense" && (
                    <label>
                      <span>
                        تصنيف المصروف
                      </span>
                      <select
                        value={
                          editCategoryId
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditCategoryId(
                            event.target.value,
                          )
                        }
                        disabled={
                          selected.status !==
                            "pending"
                        }
                      >
                        <option value="">
                          اختر التصنيف
                        </option>
                        {categories.map(
                          (category) => (
                            <option
                              key={
                                category.id
                              }
                              value={
                                category.id
                              }
                            >
                              {
                                category.name
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}

                  {editIntent ===
                    "finance_transfer" && (
                    <label>
                      <span>
                        اتجاه التحويل
                      </span>
                      <select
                        value={
                          editTransferDirection
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditTransferDirection(
                            event.target.value as
                              | PosAssistantTransferDirection
                              | "",
                          )
                        }
                        disabled={
                          selected.status !==
                            "pending"
                        }
                      >
                        <option value="">
                          اختر الاتجاه
                        </option>
                        <option value="cash_to_bank">
                          من الصندوق إلى البنك
                        </option>
                        <option value="bank_to_cash">
                          من البنك إلى الصندوق
                        </option>
                      </select>
                    </label>
                  )}

                  {editIntent !==
                    "finance_transfer" && (
                  <label>
                    <span>
                      طريقة الدفع
                    </span>
                    <select
                      value={
                        editPaymentMethod
                      }
                      onChange={(
                        event,
                      ) => {
                        const value =
                          event.target.value as
                            | "cash"
                            | "bank";

                        setEditPaymentMethod(
                          value,
                        );

                        if (
                          value ===
                          "cash"
                        ) {
                          setEditBankAccountId(
                            "",
                          );
                        }
                      }}
                      disabled={
                        selected.status !==
                          "pending"
                      }
                    >
                      <option value="cash">
                        نقدي
                      </option>
                      <option value="bank">
                        بنك
                      </option>
                    </select>
                  </label>
                  )}

                  {(
                    editPaymentMethod ===
                      "bank" ||
                    editIntent ===
                      "finance_transfer"
                  ) && (
                    <label>
                      <span>
                        الحساب البنكي
                      </span>
                      <select
                        value={
                          editBankAccountId
                        }
                        onChange={(
                          event,
                        ) =>
                          setEditBankAccountId(
                            event.target.value,
                          )
                        }
                        disabled={
                          selected.status !==
                            "pending"
                        }
                      >
                        <option value="">
                          اختر الحساب البنكي
                        </option>
                        {bankAccounts.map(
                          (account) => (
                            <option
                              key={
                                account.id
                              }
                              value={
                                account.id
                              }
                              disabled={
                                account.currencyCode !==
                                "ILS"
                              }
                            >
                              {
                                account.bank.nameAr
                              }{" "}
                              —{" "}
                              {
                                account.name
                              }{" "}
                              (
                              {
                                account.currencyCode
                              }
                              )
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}

                  <label className="assistant-review-wide">
                    <span>
                      ملاحظات
                    </span>
                    <input
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
                      disabled={
                        selected.status !==
                          "pending"
                      }
                    />
                  </label>

                  <div className="assistant-review-summary">
                    <span>
                      {editIntent ===
                      "finance_transfer"
                        ? "التحويل"
                        : "التسوية"}
                    </span>
                    <strong>
                      {editIntent ===
                      "finance_transfer"
                        ? (() => {
                            const account =
                              bankAccounts.find(
                                (entry) =>
                                  String(
                                    entry.id,
                                  ) ===
                                  editBankAccountId,
                              );

                            const bankLabel =
                              account
                                ? `${account.bank.nameAr} / ${account.name}`
                                : "اختر الحساب البنكي";

                            if (
                              editTransferDirection ===
                              "cash_to_bank"
                            ) {
                              return `الصندوق ${session?.registerKey ?? selected.registerKey} ← ${bankLabel}`;
                            }

                            if (
                              editTransferDirection ===
                              "bank_to_cash"
                            ) {
                              return `${bankLabel} ← الصندوق ${session?.registerKey ?? selected.registerKey}`;
                            }

                            return `اختر اتجاه التحويل — ${bankLabel}`;
                          })()
                        : editPaymentMethod ===
                            "bank"
                          ? (() => {
                              const account =
                                bankAccounts.find(
                                  (entry) =>
                                    String(
                                      entry.id,
                                    ) ===
                                    editBankAccountId,
                                );

                              return account
                                ? `بنك — ${account.bank.nameAr} / ${account.name}`
                                : "بنك — اختر الحساب";
                            })()
                          : `نقدي — الصندوق ${session?.registerKey ?? selected.registerKey}`}
                    </strong>
                  </div>

                  {selected.status ===
                    "pending" ? (
                    <div className="assistant-review-actions">
                      <button
                        type="submit"
                        className="secondary-button"
                        disabled={
                          actionBusy
                        }
                      >
                        حفظ التعديل
                      </button>

                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          void handleApprove()
                        }
                        disabled={
                          actionBusy ||
                          (
                            editIntent ===
                              "finance_transfer"
                              ? (
                                  !session ||
                                  !editTransferDirection ||
                                  !editBankAccountId ||
                                  bankAccounts.find(
                                    (account) =>
                                      String(
                                        account.id,
                                      ) ===
                                      editBankAccountId,
                                  )?.currencyCode !==
                                    "ILS"
                                )
                              : (
                                  (
                                    editPaymentMethod ===
                                      "cash" &&
                                    !session
                                  ) ||
                                  (
                                    editPaymentMethod ===
                                      "bank" &&
                                    (
                                      !editBankAccountId ||
                                      bankAccounts.find(
                                        (account) =>
                                          String(
                                            account.id,
                                          ) ===
                                          editBankAccountId,
                                      )?.currencyCode !==
                                        "ILS"
                                    )
                                  )
                                )
                          )
                        }
                      >
                        اعتماد وترحيل
                      </button>

                      <button
                        type="button"
                        className="assistant-reject-button"
                        onClick={() =>
                          void handleReject()
                        }
                        disabled={
                          actionBusy
                        }
                      >
                        رفض
                      </button>
                    </div>
                  ) : (
                    <div className="assistant-reviewed-state">
                      {selected.status ===
                      "approved"
                        ? selected.financeTransactionId
                          ? `✅ معتمدة — التحويل المالي #${selected.financeTransactionId}`
                          : `✅ معتمدة — السند #${selected.financeVoucherId ?? "—"}`
                        : "⛔ مرفوضة"}
                    </div>
                  )}

                  {!session &&
                    (
                      editPaymentMethod ===
                        "cash" ||
                      editIntent ===
                        "finance_transfer"
                    ) &&
                    selected.status ===
                      "pending" && (
                    <div className="assistant-review-warning">
                      الصندوق مغلق الآن. يمكنك تعديل أو رفض المسودة، لكن الحركة التي تمس الصندوق تحتاج جلسة صندوق مفتوحة.
                    </div>
                  )}

                  {(
                    editPaymentMethod ===
                      "bank" ||
                    editIntent ===
                      "finance_transfer"
                  ) &&
                    editBankAccountId &&
                    bankAccounts.find(
                      (account) =>
                        String(
                          account.id,
                        ) ===
                        editBankAccountId,
                    )?.currencyCode !==
                      "ILS" &&
                    selected.status ===
                      "pending" && (
                    <div className="assistant-review-warning">
                      اعتماد المساعد البنكي يدعم حاليًا حسابات ILS فقط.
                    </div>
                  )}
                </form>
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
