import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  cancelPosFinanceCheck,
  clearPosFinanceCheck,
  createPosIssuedCheck,
  createPosReceivedCheck,
  depositPosFinanceCheck,
  getPosBankAccounts,
  getPosFinanceBankingReference,
  getPosFinanceCheckReference,
  getPosFinanceChecks,
  returnPosFinanceCheck,
  type PosBank,
  type PosBankAccount,
  type PosFinanceCheck,
  type PosFinanceCheckPartyReference,
  type PosFinanceCheckStatus,
  type PosFinanceCurrency,
} from "../../lib/api";
import {
  exportReportAsExcel,
  printA4Report,
  type A4ReportOptions,
} from "../../lib/reportOutput";

type CreateMode =
  | "received"
  | "issued";

type ActionMode =
  | "deposit"
  | "clear";

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function idempotencyKey(
  prefix: string,
) {
  const suffix =
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}`;

  return `${prefix}:${suffix}`;
}

function today() {
  const now = new Date();
  const year =
    now.getFullYear();
  const month =
    String(
      now.getMonth() + 1,
    ).padStart(2, "0");
  const day =
    String(
      now.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function statusLabel(
  status: PosFinanceCheckStatus,
) {
  switch (status) {
    case "on_hand":
      return "باليد";
    case "deposited":
      return "مودع";
    case "issued":
      return "صادر";
    case "cleared":
      return "محصل";
    case "returned":
      return "راجع";
    case "cancelled":
      return "ملغى";
  }
}

function formatMinor(
  minor: number,
  symbol: string,
) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)} ${symbol}`;
}

export default function ChecksPage() {
  const {
    token,
    user,
    clearAuthentication,
  } = usePosRuntime();

  const [
    checks,
    setChecks,
  ] = useState<
    PosFinanceCheck[]
  >([]);

  const [banks, setBanks] =
    useState<PosBank[]>([]);

  const [
    bankAccounts,
    setBankAccounts,
  ] = useState<
    PosBankAccount[]
  >([]);

  const [
    currencies,
    setCurrencies,
  ] = useState<
    PosFinanceCurrency[]
  >([]);

  const [
    customers,
    setCustomers,
  ] = useState<
    PosFinanceCheckPartyReference[]
  >([]);

  const [
    suppliers,
    setSuppliers,
  ] = useState<
    PosFinanceCheckPartyReference[]
  >([]);

  const [
    directionFilter,
    setDirectionFilter,
  ] = useState<
    "all" |
    "received" |
    "issued"
  >("all");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState<
    "all" |
    PosFinanceCheckStatus
  >("all");

  const [
    createMode,
    setCreateMode,
  ] = useState<
    CreateMode | null
  >(null);

  const [
    checkNumber,
    setCheckNumber,
  ] = useState("");

  const [
    amount,
    setAmount,
  ] = useState("");

  const [
    dueDate,
    setDueDate,
  ] = useState(
    today(),
  );

  const [
    selectedBankId,
    setSelectedBankId,
  ] = useState<
    number | null
  >(null);

  const [
    selectedBankAccountId,
    setSelectedBankAccountId,
  ] = useState<
    number | null
  >(null);

  const [
    selectedCustomerId,
    setSelectedCustomerId,
  ] = useState<
    number | null
  >(null);

  const [
    selectedSupplierId,
    setSelectedSupplierId,
  ] = useState<
    number | null
  >(null);

  const [
    selectedCurrency,
    setSelectedCurrency,
  ] = useState("ILS");

  const [
    exchangeRate,
    setExchangeRate,
  ] = useState("1");

  const [
    partyName,
    setPartyName,
  ] = useState("");

  const [notes, setNotes] =
    useState("");

  const [
    actionCheck,
    setActionCheck,
  ] = useState<
    PosFinanceCheck | null
  >(null);

  const [
    actionMode,
    setActionMode,
  ] = useState<
    ActionMode | null
  >(null);

  const [
    actionBankAccountId,
    setActionBankAccountId,
  ] = useState<
    number | null
  >(null);

  const [
    actionRate,
    setActionRate,
  ] = useState("1");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [
        reference,
        accountsResult,
        partyReference,
        checksResult,
      ] =
        await Promise.all([
          getPosFinanceBankingReference(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
          getPosFinanceCheckReference(
            token,
          ),
          getPosFinanceChecks(
            token,
          ),
        ]);

      setBanks(
        reference.banks,
      );
      setCurrencies(
        reference.currencies,
      );
      setBankAccounts(
        accountsResult.results,
      );
      setCustomers(
        partyReference.customers,
      );
      setSuppliers(
        partyReference.suppliers,
      );
      setChecks(
        checksResult.results,
      );

      if (
        selectedBankId ===
          null &&
        reference.banks[0]
      ) {
        setSelectedBankId(
          reference.banks[0]
            .id,
        );
      }

      if (
        selectedCustomerId ===
          null &&
        partyReference
          .customers[0]
      ) {
        setSelectedCustomerId(
          partyReference
            .customers[0]
            .id,
        );
      }

      if (
        selectedSupplierId ===
          null &&
        partyReference
          .suppliers[0]
      ) {
        setSelectedSupplierId(
          partyReference
            .suppliers[0]
            .id,
        );
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
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [token]);

  const currencyMap =
    useMemo(
      () =>
        new Map(
          currencies.map(
            (currency) => [
              currency.code,
              currency,
            ],
          ),
        ),
      [currencies],
    );

  const visibleChecks =
    useMemo(
      () =>
        checks.filter(
          (check) =>
            (directionFilter ===
              "all" ||
              check.direction ===
                directionFilter) &&
            (statusFilter ===
              "all" ||
              check.status ===
                statusFilter),
        ),
      [
        checks,
        directionFilter,
        statusFilter,
      ],
    );

  const receivedOpen =
    useMemo(
      () =>
        checks.filter(
          (check) =>
            check.direction ===
              "received" &&
            [
              "on_hand",
              "deposited",
            ].includes(
              check.status,
            ),
        ),
      [checks],
    );

  const issuedOpen =
    useMemo(
      () =>
        checks.filter(
          (check) =>
            check.direction ===
              "issued" &&
            check.status ===
              "issued",
        ),
      [checks],
    );

  const dueSoon =
    useMemo(
      () =>
        checks.filter(
          (check) =>
            [
              "on_hand",
              "deposited",
              "issued",
            ].includes(
              check.status,
            ) &&
            check.dueDate <=
              today(),
        ).length,
      [checks],
    );

  function rateForCurrency(
    code: string,
  ) {
    if (code === "ILS") {
      return "1";
    }

    const rate =
      currencyMap.get(
        code,
      )?.latestRate
        ?.ilsPerUnit;

    return rate
      ? String(rate)
      : "";
  }

  function openCreate(
    mode: CreateMode,
  ) {
    setCreateMode(mode);
    setCheckNumber("");
    setAmount("");
    setDueDate(today());
    setNotes("");
    setPartyName("");
    setError("");

    if (
      mode === "received"
    ) {
      const code = "ILS";
      setSelectedCurrency(
        code,
      );
      setExchangeRate(
        rateForCurrency(
          code,
        ),
      );
    } else {
      const account =
        bankAccounts[0];

      setSelectedBankAccountId(
        account?.id ??
        null,
      );

      const code =
        account
          ?.currencyCode ??
        "ILS";

      setSelectedCurrency(
        code,
      );
      setExchangeRate(
        rateForCurrency(
          code,
        ),
      );
    }
  }

  function closeCreate() {
    if (!saving) {
      setCreateMode(null);
    }
  }

  async function handleCreate(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !createMode ||
      saving
    ) {
      return;
    }

    if (
      !checkNumber.trim()
    ) {
      setError(
        "أدخل رقم الشيك.",
      );
      return;
    }

    if (
      !amount.trim() ||
      Number(
        amount.replace(
          ",",
          ".",
        ),
      ) <= 0
    ) {
      setError(
        "أدخل مبلغًا صحيحًا.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (
        createMode ===
        "received"
      ) {
        if (
          !selectedBankId ||
          !selectedCustomerId
        ) {
          throw new Error(
            "اختر البنك والزبون.",
          );
        }

        await createPosReceivedCheck(
          token,
          {
            idempotencyKey:
              idempotencyKey(
                "received-check-ui",
              ),
            checkNumber:
              checkNumber.trim(),
            bankId:
              selectedBankId,
            customerId:
              selectedCustomerId,
            currencyCode:
              selectedCurrency,
            amount:
              amount.trim(),
            exchangeRate:
              selectedCurrency ===
              "ILS"
                ? undefined
                : exchangeRate.trim(),
            dueDate,
            drawerName:
              partyName.trim() ||
              undefined,
            notes:
              notes.trim() ||
              undefined,
          },
        );

        setMessage(
          "تم تسجيل الشيك المستلم.",
        );
      } else {
        if (
          !selectedBankAccountId ||
          !selectedSupplierId
        ) {
          throw new Error(
            "اختر الحساب البنكي والمورد.",
          );
        }

        await createPosIssuedCheck(
          token,
          {
            idempotencyKey:
              idempotencyKey(
                "issued-check-ui",
              ),
            checkNumber:
              checkNumber.trim(),
            bankAccountId:
              selectedBankAccountId,
            supplierId:
              selectedSupplierId,
            amount:
              amount.trim(),
            exchangeRate:
              selectedCurrency ===
              "ILS"
                ? undefined
                : exchangeRate.trim(),
            dueDate,
            payeeName:
              partyName.trim() ||
              undefined,
            notes:
              notes.trim() ||
              undefined,
          },
        );

        setMessage(
          "تم تسجيل الشيك الصادر.",
        );
      }

      setCreateMode(null);
      await loadData();
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
      setSaving(false);
    }
  }

  function openAction(
    check: PosFinanceCheck,
    mode: ActionMode,
  ) {
    setActionCheck(check);
    setActionMode(mode);
    setError("");

    const existingAccountId =
      check.direction ===
        "received"
        ? check
            .depositedToBankAccountId
        : check.bankAccountId;

    const firstMatching =
      bankAccounts.find(
        (account) =>
          account.currencyCode ===
          check.currencyCode,
      );

    setActionBankAccountId(
      existingAccountId ??
        firstMatching?.id ??
        null,
    );

    setActionRate(
      rateForCurrency(
        check.currencyCode,
      ),
    );
  }

  async function handleAction(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !actionCheck ||
      !actionMode ||
      saving
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (
        actionMode ===
        "deposit"
      ) {
        if (
          !actionBankAccountId
        ) {
          throw new Error(
            "اختر الحساب البنكي.",
          );
        }

        await depositPosFinanceCheck(
          token,
          actionCheck.id,
          actionBankAccountId,
        );

        setMessage(
          "تم إيداع الشيك في الحساب البنكي.",
        );
      } else {
        if (
          actionCheck.direction ===
            "received" &&
          !actionBankAccountId
        ) {
          throw new Error(
            "اختر الحساب البنكي.",
          );
        }

        await clearPosFinanceCheck(
          token,
          actionCheck.id,
          {
            bankAccountId:
              actionCheck.direction ===
              "received"
                ? actionBankAccountId ??
                  undefined
                : undefined,
            exchangeRate:
              actionCheck.currencyCode ===
              "ILS"
                ? undefined
                : actionRate.trim(),
          },
        );

        setMessage(
          "تم تحصيل الشيك وتسجيل الحركة البنكية.",
        );
      }

      setActionCheck(null);
      setActionMode(null);
      await loadData();
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
      setSaving(false);
    }
  }

  async function returnCheck(
    check: PosFinanceCheck,
  ) {
    const reason =
      window.prompt(
        `سبب إرجاع الشيك ${check.checkNumber} (اختياري):`,
        "",
      );

    if (
      reason === null ||
      !window.confirm(
        "سيتم عكس أثر الشيك وإعادة الذمة للطرف. متابعة؟",
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await returnPosFinanceCheck(
        token,
        check.id,
        reason.trim() ||
          undefined,
      );

      setMessage(
        "تم إرجاع الشيك وعكس أثره المالي.",
      );

      await loadData();
    } catch (caught) {
      setError(
        errorText(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelCheck(
    check: PosFinanceCheck,
  ) {
    const reason =
      window.prompt(
        `سبب إلغاء الشيك ${check.checkNumber}:`,
        "",
      );

    if (
      reason === null ||
      !reason.trim()
    ) {
      return;
    }

    if (
      !window.confirm(
        "سيتم إنشاء قيد عكسي ولن يُحذف الشيك الأصلي. متابعة؟",
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await cancelPosFinanceCheck(
        token,
        check.id,
        reason.trim(),
      );

      setMessage(
        "تم إلغاء الشيك بقيد عكسي.",
      );

      await loadData();
    } catch (caught) {
      setError(
        errorText(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  function buildChecksReport(): A4ReportOptions {
    const visibleBaseTotal = visibleChecks.reduce(
      (sum, check) => sum + check.baseAmountMinor,
      0,
    );
    const directionLabel =
      directionFilter === "received"
        ? "شيكات مستلمة"
        : directionFilter === "issued"
          ? "شيكات صادرة"
          : "كل الشيكات";
    const statusText =
      statusFilter === "all"
        ? "كل الحالات"
        : statusLabel(statusFilter);

    return {
      title: "سجل الشيكات",
      subtitle: `${directionLabel} · ${statusText}`,
      period: "حسب الفلاتر الحالية في الشاشة",
      orientation: "landscape",
      summary: [
        { label: "عدد الشيكات الظاهرة", value: visibleChecks.length },
        { label: "إجماليها بالشيكل", value: formatMinor(visibleBaseTotal, "₪") },
        { label: "شيكات مستلمة مفتوحة", value: receivedOpen.length },
        { label: "شيكات صادرة مفتوحة", value: issuedOpen.length },
        { label: "مستحقة اليوم أو قبل", value: dueSoon },
      ],
      sections: [
        {
          title: "السجل",
          headers: ["النوع", "رقم الشيك", "الطرف", "البنك", "العملة", "المبلغ", "بالشيكل", "الاستحقاق", "الحالة", "ملاحظات"],
          rows: visibleChecks.map((check) => [
            check.direction === "received" ? "مستلم" : "صادر",
            check.checkNumber,
            check.party?.name ?? "—",
            check.bank?.nameAr ?? "—",
            check.currencyCode,
            formatMinor(
              check.amountMinor,
              currencyMap.get(check.currencyCode)?.symbol ?? check.currencyCode,
            ),
            formatMinor(check.baseAmountMinor, "₪"),
            check.dueDate,
            statusLabel(check.status),
            check.notes ?? "",
          ]),
        },
      ],
    };
  }

  function printChecksReport() {
    printA4Report(buildChecksReport());
  }

  function exportChecksReport() {
    exportReportAsExcel("checks-register.xls", buildChecksReport());
  }

  return (
    <section className="checks-page">
      <div className="checks-heading">
        <div>
          <span className="checks-eyebrow">
            المالية
          </span>
          <h2>
            الشيكات
          </h2>
          <p>
            شيكات الزبائن الواردة والشيكات الصادرة للموردين مع دورة التحصيل كاملة.
          </p>
        </div>

        <div className="checks-heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={printChecksReport}
            disabled={loading}
          >
            🖨️ طباعة A4
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={exportChecksReport}
            disabled={loading}
          >
            📊 Excel
          </button>

          {user?.isOwner && (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => openCreate("received")}
              >
                + شيك مستلم
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() => openCreate("issued")}
              >
                + شيك صادر
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {message && (
        <div className="alert success-alert">
          {message}
        </div>
      )}

      <div className="checks-summary-grid">
        <article>
          <span>
            شيكات مستلمة مفتوحة
          </span>
          <strong>
            {
              receivedOpen.length
            }
          </strong>
        </article>

        <article>
          <span>
            شيكات صادرة مفتوحة
          </span>
          <strong>
            {
              issuedOpen.length
            }
          </strong>
        </article>

        <article className={
          dueSoon > 0
            ? "has-warning"
            : ""
        }>
          <span>
            مستحقة اليوم أو قبل
          </span>
          <strong>
            {dueSoon}
          </strong>
        </article>

        <article>
          <span>
            إجمالي السجل
          </span>
          <strong>
            {checks.length}
          </strong>
        </article>
      </div>

      <section className="checks-list-section">
        <div className="checks-toolbar">
          <div>
            <select
              value={
                directionFilter
              }
              onChange={(
                event,
              ) =>
                setDirectionFilter(
                  event.target
                    .value as
                    | "all"
                    | "received"
                    | "issued",
                )
              }
            >
              <option value="all">
                كل الشيكات
              </option>
              <option value="received">
                مستلمة
              </option>
              <option value="issued">
                صادرة
              </option>
            </select>

            <select
              value={
                statusFilter
              }
              onChange={(
                event,
              ) =>
                setStatusFilter(
                  event.target
                    .value as
                    | "all"
                    | PosFinanceCheckStatus,
                )
              }
            >
              <option value="all">
                كل الحالات
              </option>
              <option value="on_hand">
                باليد
              </option>
              <option value="deposited">
                مودع
              </option>
              <option value="issued">
                صادر
              </option>
              <option value="cleared">
                محصل
              </option>
              <option value="returned">
                راجع
              </option>
              <option value="cancelled">
                ملغى
              </option>
            </select>
          </div>

          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() =>
              void loadData()
            }
          >
            تحديث
          </button>
        </div>

        {loading ? (
          <div className="checks-empty">
            جاري تحميل الشيكات…
          </div>
        ) : visibleChecks.length ===
          0 ? (
          <div className="checks-empty">
            لا توجد شيكات مطابقة.
          </div>
        ) : (
          <div className="checks-table-wrap">
            <table className="checks-table">
              <thead>
                <tr>
                  <th>
                    النوع
                  </th>
                  <th>
                    رقم الشيك
                  </th>
                  <th>
                    الطرف
                  </th>
                  <th>
                    البنك
                  </th>
                  <th>
                    المبلغ
                  </th>
                  <th>
                    الاستحقاق
                  </th>
                  <th>
                    الحالة
                  </th>
                  <th>
                    الإجراءات
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleChecks.map(
                  (check) => {
                    const currency =
                      currencyMap.get(
                        check.currencyCode,
                      );

                    const canReverse =
                      check.direction ===
                        "received"
                        ? [
                            "on_hand",
                            "deposited",
                          ].includes(
                            check.status,
                          )
                        : check.status ===
                          "issued";

                    return (
                      <tr
                        key={
                          check.id
                        }
                      >
                        <td>
                          <span
                            className={
                              check.direction ===
                              "received"
                                ? "check-direction received"
                                : "check-direction issued"
                            }
                          >
                            {check.direction ===
                            "received"
                              ? "مستلم"
                              : "صادر"}
                          </span>
                        </td>

                        <td>
                          <strong dir="ltr">
                            {
                              check.checkNumber
                            }
                          </strong>
                          <small>
                            {
                              check.publicId
                            }
                          </small>
                        </td>

                        <td>
                          {
                            check.party
                              ?.name ??
                            "-"
                          }
                        </td>

                        <td>
                          {
                            check.bank
                              ?.nameAr ??
                            "-"
                          }
                        </td>

                        <td>
                          <strong>
                            {formatMinor(
                              check.amountMinor,
                              currency
                                ?.symbol ??
                                check.currencyCode,
                            )}
                          </strong>

                          {check.currencyCode !==
                            "ILS" && (
                            <small>
                              {formatMinor(
                                check.baseAmountMinor,
                                "₪",
                              )}
                            </small>
                          )}
                        </td>

                        <td>
                          <span
                            className={
                              check.dueDate <=
                                today() &&
                              [
                                "on_hand",
                                "deposited",
                                "issued",
                              ].includes(
                                check.status,
                              )
                                ? "check-due is-due"
                                : "check-due"
                            }
                          >
                            {
                              check.dueDate
                            }
                          </span>
                        </td>

                        <td>
                          <span
                            className={`check-status status-${check.status}`}
                          >
                            {statusLabel(
                              check.status,
                            )}
                          </span>
                        </td>

                        <td>
                          <div className="check-actions">
                            {check.direction ===
                              "received" &&
                              check.status ===
                                "on_hand" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAction(
                                      check,
                                      "deposit",
                                    )
                                  }
                                  disabled={
                                    saving
                                  }
                                >
                                  إيداع
                                </button>
                              )}

                            {(
                              check.direction ===
                                "received"
                                ? [
                                    "on_hand",
                                    "deposited",
                                  ].includes(
                                    check.status,
                                  )
                                : check.status ===
                                  "issued"
                            ) && (
                              <button
                                type="button"
                                className="is-primary"
                                onClick={() =>
                                  openAction(
                                    check,
                                    "clear",
                                  )
                                }
                                disabled={
                                  saving
                                }
                              >
                                تحصيل
                              </button>
                            )}

                            {canReverse &&
                              user?.isOwner && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void returnCheck(
                                        check,
                                      )
                                    }
                                    disabled={
                                      saving
                                    }
                                  >
                                    إرجاع
                                  </button>

                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() =>
                                      void cancelCheck(
                                        check,
                                      )
                                    }
                                    disabled={
                                      saving
                                    }
                                  >
                                    إلغاء
                                  </button>
                                </>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {createMode && (
        <div
          className="checks-modal-overlay"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeCreate();
            }
          }}
        >
          <form
            className="checks-modal"
            onSubmit={
              handleCreate
            }
          >
            <div className="checks-modal-header">
              <div>
                <h3>
                  {createMode ===
                  "received"
                    ? "تسجيل شيك مستلم"
                    : "تسجيل شيك صادر"}
                </h3>
                <p>
                  {createMode ===
                  "received"
                    ? "يخفض ذمة الزبون ويثبت الشيك برسم التحصيل."
                    : "يخفض ذمة المورد ويثبت الشيك ضمن الشيكات الصادرة."}
                </p>
              </div>

              <button
                type="button"
                onClick={
                  closeCreate
                }
              >
                ×
              </button>
            </div>

            <div className="checks-form-grid">
              <label>
                <span>
                  رقم الشيك
                </span>
                <input
                  dir="ltr"
                  value={
                    checkNumber
                  }
                  onChange={(
                    event,
                  ) =>
                    setCheckNumber(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    saving
                  }
                />
              </label>

              {createMode ===
              "received" ? (
                <>
                  <label>
                    <span>
                      الزبون
                    </span>
                    <select
                      value={
                        selectedCustomerId ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        setSelectedCustomerId(
                          Number(
                            event
                              .target
                              .value,
                          ) ||
                            null,
                        )
                      }
                      disabled={
                        saving
                      }
                    >
                      <option value="">
                        اختر الزبون
                      </option>
                      {customers.map(
                        (
                          customer,
                        ) => (
                          <option
                            key={
                              customer.id
                            }
                            value={
                              customer.id
                            }
                          >
                            {
                              customer.name
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label>
                    <span>
                      البنك المسحوب عليه
                    </span>
                    <select
                      value={
                        selectedBankId ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        setSelectedBankId(
                          Number(
                            event
                              .target
                              .value,
                          ) ||
                            null,
                        )
                      }
                      disabled={
                        saving
                      }
                    >
                      {banks.map(
                        (bank) => (
                          <option
                            key={
                              bank.id
                            }
                            value={
                              bank.id
                            }
                          >
                            {
                              bank.nameAr
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label>
                    <span>
                      العملة
                    </span>
                    <select
                      value={
                        selectedCurrency
                      }
                      onChange={(
                        event,
                      ) => {
                        const code =
                          event
                            .target
                            .value;
                        setSelectedCurrency(
                          code,
                        );
                        setExchangeRate(
                          rateForCurrency(
                            code,
                          ),
                        );
                      }}
                      disabled={
                        saving
                      }
                    >
                      {currencies
                        .filter(
                          (
                            currency,
                          ) =>
                            currency.status ===
                            "active",
                        )
                        .map(
                          (
                            currency,
                          ) => (
                            <option
                              key={
                                currency.code
                              }
                              value={
                                currency.code
                              }
                            >
                              {
                                currency.nameAr
                              }{" "}
                              (
                              {
                                currency.code
                              }
                              )
                            </option>
                          ),
                        )}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>
                      المورد
                    </span>
                    <select
                      value={
                        selectedSupplierId ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        setSelectedSupplierId(
                          Number(
                            event
                              .target
                              .value,
                          ) ||
                            null,
                        )
                      }
                      disabled={
                        saving
                      }
                    >
                      <option value="">
                        اختر المورد
                      </option>
                      {suppliers.map(
                        (
                          supplier,
                        ) => (
                          <option
                            key={
                              supplier.id
                            }
                            value={
                              supplier.id
                            }
                          >
                            {
                              supplier.name
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label>
                    <span>
                      الحساب البنكي
                    </span>
                    <select
                      value={
                        selectedBankAccountId ??
                        ""
                      }
                      onChange={(
                        event,
                      ) => {
                        const id =
                          Number(
                            event
                              .target
                              .value,
                          ) ||
                          null;

                        setSelectedBankAccountId(
                          id,
                        );

                        const account =
                          bankAccounts.find(
                            (
                              item,
                            ) =>
                              item.id ===
                              id,
                          );

                        const code =
                          account
                            ?.currencyCode ??
                          "ILS";

                        setSelectedCurrency(
                          code,
                        );
                        setExchangeRate(
                          rateForCurrency(
                            code,
                          ),
                        );
                      }}
                      disabled={
                        saving
                      }
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
                            {
                              account
                                .bank
                                .nameAr
                            }{" "}
                            -{" "}
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

                  <label>
                    <span>
                      عملة الشيك
                    </span>
                    <input
                      value={
                        selectedCurrency
                      }
                      disabled
                    />
                  </label>
                </>
              )}

              <label>
                <span>
                  المبلغ
                </span>
                <input
                  dir="ltr"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(
                    event,
                  ) =>
                    setAmount(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    saving
                  }
                />
              </label>

              {selectedCurrency !==
                "ILS" && (
                <label>
                  <span>
                    سعر الصرف
                    <small>
                      {" "}
                      1 {selectedCurrency} = كم ₪
                    </small>
                  </span>
                  <input
                    dir="ltr"
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={
                      exchangeRate
                    }
                    onChange={(
                      event,
                    ) =>
                      setExchangeRate(
                        event
                          .target
                          .value,
                      )
                    }
                    disabled={
                      saving
                    }
                  />
                </label>
              )}

              <label>
                <span>
                  تاريخ الاستحقاق
                </span>
                <input
                  dir="ltr"
                  type="date"
                  value={
                    dueDate
                  }
                  onChange={(
                    event,
                  ) =>
                    setDueDate(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    saving
                  }
                />
              </label>

              <label>
                <span>
                  {createMode ===
                  "received"
                    ? "اسم الساحب"
                    : "اسم المستفيد"}
                  <small>
                    {" "}
                    اختياري
                  </small>
                </span>
                <input
                  value={
                    partyName
                  }
                  onChange={(
                    event,
                  ) =>
                    setPartyName(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    saving
                  }
                />
              </label>

              <label className="checks-notes-field">
                <span>
                  ملاحظات
                  <small>
                    {" "}
                    اختياري
                  </small>
                </span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(
                    event,
                  ) =>
                    setNotes(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    saving
                  }
                />
              </label>
            </div>

            {error && (
              <div className="alert error-alert checks-modal-alert">
                {error}
              </div>
            )}

            <div className="checks-modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={
                  closeCreate
                }
                disabled={
                  saving
                }
              >
                إلغاء
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={
                  saving
                }
              >
                {saving
                  ? "جاري الحفظ…"
                  : "حفظ الشيك"}
              </button>
            </div>
          </form>
        </div>
      )}

      {actionCheck &&
        actionMode && (
          <div
            className="checks-modal-overlay"
            onMouseDown={(
              event,
            ) => {
              if (
                event.target ===
                  event.currentTarget &&
                !saving
              ) {
                setActionCheck(
                  null,
                );
                setActionMode(
                  null,
                );
              }
            }}
          >
            <form
              className="checks-modal checks-action-modal"
              onSubmit={
                handleAction
              }
            >
              <div className="checks-modal-header">
                <div>
                  <h3>
                    {actionMode ===
                    "deposit"
                      ? "إيداع الشيك"
                      : "تحصيل الشيك"}
                  </h3>
                  <p>
                    شيك رقم{" "}
                    {
                      actionCheck.checkNumber
                    }{" "}
                    —{" "}
                    {formatMinor(
                      actionCheck.amountMinor,
                      currencyMap.get(
                        actionCheck.currencyCode,
                      )?.symbol ??
                        actionCheck.currencyCode,
                    )}
                  </p>
                </div>
              </div>

              <div className="checks-form-grid">
                {actionCheck.direction ===
                  "received" && (
                  <label>
                    <span>
                      الحساب البنكي
                    </span>
                    <select
                      value={
                        actionBankAccountId ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        setActionBankAccountId(
                          Number(
                            event
                              .target
                              .value,
                          ) ||
                            null,
                        )
                      }
                      disabled={
                        saving ||
                        (actionMode ===
                          "clear" &&
                          actionCheck
                            .depositedToBankAccountId !==
                            null)
                      }
                    >
                      <option value="">
                        اختر الحساب
                      </option>
                      {bankAccounts
                        .filter(
                          (
                            account,
                          ) =>
                            account.currencyCode ===
                            actionCheck.currencyCode,
                        )
                        .map(
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
                              {
                                account
                                  .bank
                                  .nameAr
                              }{" "}
                              -{" "}
                              {
                                account.name
                              }
                            </option>
                          ),
                        )}
                    </select>
                  </label>
                )}

                {actionMode ===
                  "clear" &&
                  actionCheck.currencyCode !==
                    "ILS" && (
                    <label>
                      <span>
                        سعر الصرف عند التحصيل
                      </span>
                      <input
                        dir="ltr"
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        value={
                          actionRate
                        }
                        onChange={(
                          event,
                        ) =>
                          setActionRate(
                            event
                              .target
                              .value,
                          )
                        }
                        disabled={
                          saving
                        }
                      />
                    </label>
                  )}
              </div>

              {error && (
                <div className="alert error-alert checks-modal-alert">
                  {error}
                </div>
              )}

              <div className="checks-modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (!saving) {
                      setActionCheck(
                        null,
                      );
                      setActionMode(
                        null,
                      );
                    }
                  }}
                  disabled={
                    saving
                  }
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    saving
                  }
                >
                  {saving
                    ? "جاري التنفيذ…"
                    : actionMode ===
                        "deposit"
                      ? "تأكيد الإيداع"
                      : "تأكيد التحصيل"}
                </button>
              </div>
            </form>
          </div>
        )}
    </section>
  );
}
