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
  getPosEmployees,
  getPosExpenseCategories,
  rejectPosAssistantDraft,
  updatePosAssistantDraft,
  type PosAssistantDraft,
  type PosAssistantDraftIntent,
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

    if (!session) {
      setError(
        "يجب فتح الصندوق قبل اعتماد حركة نقدية. يمكنك حفظ المسودة الآن واعتمادها لاحقًا.",
      );
      return;
    }

    if (
      !window.confirm(
        "اعتماد هذه المسودة سينشئ الحركة المحاسبية فعليًا ويؤثر على الصندوق. متابعة؟",
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

      await load(false);

      setMessage(
        result.voucher?.publicId
          ? `تم اعتماد المسودة وإنشاء الحركة ${result.voucher.publicId}.`
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
                      طريقة الدفع
                    </span>
                    <strong>
                      نقدي — الصندوق{" "}
                      {session?.registerKey ??
                        selected.registerKey}
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
                          !session
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
                        ? `✅ معتمدة — السند #${selected.financeVoucherId ?? "—"}`
                        : "⛔ مرفوضة"}
                    </div>
                  )}

                  {!session &&
                    selected.status ===
                      "pending" && (
                    <div className="assistant-review-warning">
                      الصندوق مغلق الآن. يمكنك تعديل أو رفض المسودة، لكن الاعتماد النقدي يحتاج جلسة صندوق مفتوحة.
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
