import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosBankAccount,
  createPosFinanceCashAccount,
  createPosFinanceTransfer,
  getPosBankAccounts,
  getPosFinanceBankingReference,
  getPosFinanceCashAccounts,
  getPosFinanceTransfers,
  reversePosFinanceTransfer,
  savePosExchangeRate,
  type PosBank,
  type PosBankAccount,
  type PosFinanceCashAccount,
  type PosFinanceCurrency,
  type PosFinanceTransfer,
} from "../../lib/api";

interface TransferAccountOption {
  id: number;
  name: string;
  detail: string;
  currencyCode: string;
  balanceMinor: number;
  kind: "cash" | "bank";
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function formatMinor(
  minor: number,
  symbol: string,
) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100) + " " + symbol;
}

function newTransferIdempotencyKey() {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    (Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(2));

  return (
    "finance-transfer:" +
    randomPart
  );
}

export default function BankingPage() {
  const {
    token,
    user,
    clearAuthentication,
  } = usePosRuntime();

  const [
    currencies,
    setCurrencies,
  ] = useState<PosFinanceCurrency[]>([]);

  const [banks, setBanks] =
    useState<PosBank[]>([]);

  const [
    accounts,
    setAccounts,
  ] = useState<PosBankAccount[]>([]);

  const [
    cashAccounts,
    setCashAccounts,
  ] = useState<
    PosFinanceCashAccount[]
  >([]);

  const [
    transfers,
    setTransfers,
  ] = useState<
    PosFinanceTransfer[]
  >([]);

  const [
    rateInputs,
    setRateInputs,
  ] = useState<Record<string, string>>({});

  const [
    selectedBankId,
    setSelectedBankId,
  ] = useState<number | null>(null);

  const [
    selectedCurrency,
    setSelectedCurrency,
  ] = useState("ILS");

  const [
    accountName,
    setAccountName,
  ] = useState("");

  const [
    accountNumber,
    setAccountNumber,
  ] = useState("");

  const [iban, setIban] =
    useState("");

  const [
    accountNotes,
    setAccountNotes,
  ] = useState("");

  const [
    cashAccountName,
    setCashAccountName,
  ] = useState(
    "الصندوق الفرعي",
  );

  const [
    cashAccountCurrency,
    setCashAccountCurrency,
  ] = useState("ILS");

  const [
    cashAccountNotes,
    setCashAccountNotes,
  ] = useState("");

  const [
    fromAccountId,
    setFromAccountId,
  ] = useState<number | null>(null);

  const [
    toAccountId,
    setToAccountId,
  ] = useState<number | null>(null);

  const [
    transferAmount,
    setTransferAmount,
  ] = useState("");

  const [
    transferNotes,
    setTransferNotes,
  ] = useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [
    cashAccountSaving,
    setCashAccountSaving,
  ] = useState(false);

  const [
    transferSaving,
    setTransferSaving,
  ] = useState(false);

  const [
    reversingTransferId,
    setReversingTransferId,
  ] = useState<string | null>(
    null,
  );

  const [
    rateSaving,
    setRateSaving,
  ] = useState<string | null>(null);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const cashPromise =
        user?.isOwner
          ? getPosFinanceCashAccounts(
              token,
            )
          : Promise.resolve({
              results:
                [] as PosFinanceCashAccount[],
            });

      const transferPromise =
        user?.isOwner
          ? getPosFinanceTransfers(
              token,
            )
          : Promise.resolve({
              results:
                [] as PosFinanceTransfer[],
            });

      const [
        reference,
        accountResult,
        cashResult,
        transferResult,
      ] =
        await Promise.all([
          getPosFinanceBankingReference(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
          cashPromise,
          transferPromise,
        ]);

      setCurrencies(
        reference.currencies,
      );
      setBanks(
        reference.banks,
      );
      setAccounts(
        accountResult.results,
      );
      setCashAccounts(
        cashResult.results,
      );
      setTransfers(
        transferResult.results,
      );

      setRateInputs(
        Object.fromEntries(
          reference.currencies.map(
            (currency) => [
              currency.code,
              currency.latestRate
                ? String(
                    currency.latestRate
                      .ilsPerUnit,
                  )
                : "",
            ],
          ),
        ),
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
  }, [
    token,
    user?.isOwner,
  ]);

  const currencyByCode =
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

  const transferAccounts =
    useMemo<
      TransferAccountOption[]
    >(
      () => [
        ...cashAccounts.map(
          (account) => ({
            id: account.id,
            name: account.name,
            detail:
              account.code ===
              "CASH_MAIN"
                ? "الصندوق الرئيسي"
                : "صندوق فرعي",
            currencyCode:
              account.currencyCode,
            balanceMinor:
              account
                .operationalBalanceMinor,
            kind:
              "cash" as const,
          }),
        ),
        ...accounts
          .filter(
            (account) =>
              account.status ===
              "active",
          )
          .map(
            (account) => ({
              id:
                account
                  .financeAccountId,
              name:
                account.bank
                  .nameAr +
                " - " +
                account.name,
              detail:
                "حساب بنكي",
              currencyCode:
                account.currencyCode,
              balanceMinor:
                account
                  .currencyBalanceMinor,
              kind:
                "bank" as const,
            }),
          ),
      ],
      [
        cashAccounts,
        accounts,
      ],
    );

  const fromAccount =
    useMemo(
      () =>
        transferAccounts.find(
          (account) =>
            account.id ===
            fromAccountId,
        ) ?? null,
      [
        transferAccounts,
        fromAccountId,
      ],
    );

  const destinationOptions =
    useMemo(
      () =>
        fromAccount
          ? transferAccounts.filter(
              (account) =>
                account.id !==
                  fromAccount.id &&
                account.currencyCode ===
                  fromAccount.currencyCode,
            )
          : [],
      [
        transferAccounts,
        fromAccount,
      ],
    );

  const toAccount =
    useMemo(
      () =>
        destinationOptions.find(
          (account) =>
            account.id ===
            toAccountId,
        ) ?? null,
      [
        destinationOptions,
        toAccountId,
      ],
    );

  useEffect(() => {
    if (
      !user?.isOwner ||
      transferAccounts.length ===
        0
    ) {
      setFromAccountId(null);
      setToAccountId(null);
      return;
    }

    const currentFrom =
      transferAccounts.find(
        (account) =>
          account.id ===
          fromAccountId,
      ) ??
      transferAccounts[0];

    if (
      fromAccountId !==
      currentFrom.id
    ) {
      setFromAccountId(
        currentFrom.id,
      );
    }

    const destinations =
      transferAccounts.filter(
        (account) =>
          account.id !==
            currentFrom.id &&
          account.currencyCode ===
            currentFrom.currencyCode,
      );

    const currentTo =
      destinations.find(
        (account) =>
          account.id ===
          toAccountId,
      );

    if (!currentTo) {
      setToAccountId(
        destinations[0]?.id ??
          null,
      );
    }
  }, [
    user?.isOwner,
    transferAccounts,
    fromAccountId,
    toAccountId,
  ]);

  function currencySymbol(
    code: string,
  ) {
    return (
      currencyByCode.get(code)
        ?.symbol ??
      code
    );
  }

  async function saveRate(
    currencyCode: string,
  ) {
    if (
      !user?.isOwner ||
      rateSaving
    ) {
      return;
    }

    const value =
      rateInputs[
        currencyCode
      ]?.trim();

    if (!value) {
      setError(
        "أدخل سعر الصرف.",
      );
      return;
    }

    setRateSaving(
      currencyCode,
    );
    setError("");
    setMessage("");

    try {
      await savePosExchangeRate(
        token,
        {
          currencyCode,
          ilsPerUnit:
            value,
          source:
            "manual",
        },
      );

      setMessage(
        "تم حفظ سعر " +
          currencyCode +
          ".",
      );

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
      setRateSaving(null);
    }
  }

  async function createAccount(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !user?.isOwner ||
      saving
    ) {
      return;
    }

    if (!selectedBankId) {
      setError(
        "اختر البنك.",
      );
      return;
    }

    if (
      !accountName.trim()
    ) {
      setError(
        "أدخل اسم الحساب.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await createPosBankAccount(
        token,
        {
          bankId:
            selectedBankId,
          name:
            accountName.trim(),
          accountNumber:
            accountNumber.trim() ||
            undefined,
          iban:
            iban.trim() ||
            undefined,
          currencyCode:
            selectedCurrency,
          notes:
            accountNotes.trim() ||
            undefined,
        },
      );

      setAccountName("");
      setAccountNumber("");
      setIban("");
      setAccountNotes("");

      setMessage(
        "تمت إضافة الحساب البنكي.",
      );

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

  async function createCashAccount(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !user?.isOwner ||
      cashAccountSaving
    ) {
      return;
    }

    if (
      !cashAccountName.trim()
    ) {
      setError(
        "أدخل اسم الصندوق.",
      );
      return;
    }

    setCashAccountSaving(true);
    setError("");
    setMessage("");

    try {
      await createPosFinanceCashAccount(
        token,
        {
          name:
            cashAccountName.trim(),
          currencyCode:
            cashAccountCurrency,
          notes:
            cashAccountNotes.trim() ||
            undefined,
        },
      );

      setCashAccountName(
        "الصندوق الفرعي",
      );
      setCashAccountNotes("");

      setMessage(
        "تمت إضافة الصندوق الفرعي.",
      );

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
      setCashAccountSaving(
        false,
      );
    }
  }

  async function createTransfer(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !user?.isOwner ||
      transferSaving
    ) {
      return;
    }

    if (
      !fromAccount ||
      !toAccount
    ) {
      setError(
        "اختر الحساب المصدر والحساب الوجهة.",
      );
      return;
    }

    const numericAmount =
      Number(
        transferAmount
          .trim()
          .replace(",", "."),
      );

    if (
      !Number.isFinite(
        numericAmount,
      ) ||
      numericAmount <= 0
    ) {
      setError(
        "أدخل مبلغ تحويل صحيح.",
      );
      return;
    }

    const amountMinor =
      Math.round(
        numericAmount * 100,
      );

    if (
      amountMinor >
      fromAccount.balanceMinor
    ) {
      setError(
        "المبلغ أكبر من الرصيد المتاح في الحساب المصدر.",
      );
      return;
    }

    const confirmed =
      window.confirm(
        [
          "تأكيد التحويل المالي؟",
          "",
          "من: " +
            fromAccount.name,
          "إلى: " +
            toAccount.name,
          "المبلغ: " +
            transferAmount +
            " " +
            fromAccount.currencyCode,
          "",
          "هذه الحركة ليست مصروفًا أو إيرادًا؛ سيتم تسجيلها كتحويل بين حسابين.",
        ].join("\n"),
      );

    if (!confirmed) {
      return;
    }

    setTransferSaving(true);
    setError("");
    setMessage("");

    try {
      await createPosFinanceTransfer(
        token,
        {
          idempotencyKey:
            newTransferIdempotencyKey(),
          fromAccountId:
            fromAccount.id,
          toAccountId:
            toAccount.id,
          amount:
            transferAmount
              .trim()
              .replace(
                ",",
                ".",
              ),
          notes:
            transferNotes.trim() ||
            undefined,
        },
      );

      setTransferAmount("");
      setTransferNotes("");

      setMessage(
        "تم تسجيل التحويل المالي بنجاح.",
      );

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
      setTransferSaving(
        false,
      );
    }
  }

  async function reverseTransfer(
    transfer:
      PosFinanceTransfer,
  ) {
    if (
      !user?.isOwner ||
      reversingTransferId
    ) {
      return;
    }

    const reason =
      window.prompt(
        "اكتب سبب عكس التحويل " +
          transfer.transaction
            .publicId +
          ":",
      );

    if (
      reason === null ||
      !reason.trim()
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "سيتم إنشاء قيد عكسي ولن يتم حذف الحركة الأصلية. متابعة؟",
      );

    if (!confirmed) {
      return;
    }

    setReversingTransferId(
      transfer.transaction.publicId,
    );
    setError("");
    setMessage("");

    try {
      await reversePosFinanceTransfer(
        token,
        {
          publicId:
            transfer.transaction
              .publicId,
          reason:
            reason.trim(),
        },
      );

      setMessage(
        "تم عكس التحويل بقيد محاسبي معاكس.",
      );

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
      setReversingTransferId(
        null,
      );
    }
  }

  return (
    <section className="banking-page">
      <div className="banking-heading">
        <div>
          <span className="banking-eyebrow">
            المالية
          </span>
          <h2>
            البنوك والصناديق والتحويلات
          </h2>
          <p>
            إدارة الحسابات البنكية والصناديق وأسعار العملات والتحويلات الداخلية.
          </p>
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

      {user?.isOwner && (
        <>
          <section className="banking-section banking-transfer-section">
            <div className="banking-section-title">
              <div>
                <h3>
                  تحويل بين الصندوق والبنوك
                </h3>
                <p>
                  التحويل ينقل أصلًا ماليًا من حساب إلى آخر، ولا يُسجل كمصروف أو إيراد.
                </p>
              </div>
              <span>
                {
                  transferAccounts.length
                }{" "}
                حساب متاح
              </span>
            </div>

            {transferAccounts.length <
            2 ? (
              <div className="banking-empty">
                أضف حسابًا بنكيًا أو صندوقًا فرعيًا حتى تتمكن من تنفيذ التحويلات.
              </div>
            ) : (
              <form
                className="banking-transfer-form"
                onSubmit={
                  createTransfer
                }
              >
                <label>
                  <span>
                    من الحساب
                  </span>
                  <select
                    value={
                      fromAccountId ??
                      ""
                    }
                    onChange={(
                      event,
                    ) =>
                      setFromAccountId(
                        Number(
                          event
                            .target
                            .value,
                        ) ||
                          null,
                      )
                    }
                    disabled={
                      transferSaving
                    }
                  >
                    {transferAccounts.map(
                      (account) => (
                        <option
                          key={
                            account.id
                          }
                          value={
                            account.id
                          }
                        >
                          {
                            account.name
                          }{" "}
                          —{" "}
                          {formatMinor(
                            account.balanceMinor,
                            currencySymbol(
                              account.currencyCode,
                            ),
                          )}
                        </option>
                      ),
                    )}
                  </select>

                  {fromAccount && (
                    <small>
                      الرصيد المتاح:{" "}
                      <b>
                        {formatMinor(
                          fromAccount.balanceMinor,
                          currencySymbol(
                            fromAccount.currencyCode,
                          ),
                        )}
                      </b>
                    </small>
                  )}
                </label>

                <label>
                  <span>
                    إلى الحساب
                  </span>
                  <select
                    value={
                      toAccountId ??
                      ""
                    }
                    onChange={(
                      event,
                    ) =>
                      setToAccountId(
                        Number(
                          event
                            .target
                            .value,
                        ) ||
                          null,
                      )
                    }
                    disabled={
                      transferSaving ||
                      destinationOptions.length ===
                        0
                    }
                  >
                    {destinationOptions.map(
                      (account) => (
                        <option
                          key={
                            account.id
                          }
                          value={
                            account.id
                          }
                        >
                          {
                            account.name
                          }{" "}
                          —{" "}
                          {
                            account.currencyCode
                          }
                        </option>
                      ),
                    )}
                  </select>

                  {fromAccount &&
                    destinationOptions.length ===
                      0 && (
                      <small className="banking-form-warning">
                        لا يوجد حساب وجهة آخر بنفس العملة.
                      </small>
                    )}
                </label>

                <label>
                  <span>
                    المبلغ
                  </span>
                  <input
                    dir="ltr"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={
                      transferAmount
                    }
                    onChange={(
                      event,
                    ) =>
                      setTransferAmount(
                        event
                          .target
                          .value,
                      )
                    }
                    placeholder="0.00"
                    disabled={
                      transferSaving
                    }
                  />
                </label>

                <label className="banking-transfer-notes">
                  <span>
                    ملاحظات
                    <small>
                      {" "}
                      اختياري
                    </small>
                  </span>
                  <input
                    value={
                      transferNotes
                    }
                    onChange={(
                      event,
                    ) =>
                      setTransferNotes(
                        event
                          .target
                          .value,
                      )
                    }
                    placeholder="مثال: إيداع نقدية اليوم في البنك"
                    disabled={
                      transferSaving
                    }
                  />
                </label>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    transferSaving ||
                    !fromAccount ||
                    !toAccount ||
                    !transferAmount
                  }
                >
                  {transferSaving
                    ? "جاري التحويل…"
                    : "تنفيذ التحويل"}
                </button>
              </form>
            )}
          </section>

          <section className="banking-section">
            <div className="banking-section-title">
              <div>
                <h3>
                  الصناديق النقدية
                </h3>
                <p>
                  الصندوق الرئيسي يتبع جلسة نقطة البيع، أما الصندوق الفرعي فله رصيد مستقل.
                </p>
              </div>
              <span>
                {
                  cashAccounts.length
                }{" "}
                صندوق
              </span>
            </div>

            {loading ? (
              <div className="banking-empty">
                جاري التحميل…
              </div>
            ) : cashAccounts.length ===
              0 ? (
              <div className="banking-empty">
                لا توجد حسابات صندوق متاحة.
              </div>
            ) : (
              <div className="banking-cash-grid">
                {cashAccounts.map(
                  (account) => (
                    <article
                      key={
                        account.id
                      }
                      className={
                        account.code ===
                        "CASH_MAIN"
                          ? "banking-cash-card is-main"
                          : "banking-cash-card"
                      }
                    >
                      <div className="banking-account-head">
                        <div>
                          <span>
                            {account.code ===
                            "CASH_MAIN"
                              ? "💵"
                              : "🧰"}
                          </span>
                          <div>
                            <strong>
                              {
                                account.name
                              }
                            </strong>
                            <small>
                              {account.code ===
                              "CASH_MAIN"
                                ? "الصندوق الرئيسي"
                                : "صندوق فرعي"}
                            </small>
                          </div>
                        </div>

                        <b>
                          {
                            account.currencyCode
                          }
                        </b>
                      </div>

                      <div className="banking-account-balance">
                        <span>
                          {account.balanceSource ===
                          "cash_session"
                            ? "الرصيد التشغيلي"
                            : "الرصيد الدفتري"}
                        </span>
                        <strong>
                          {formatMinor(
                            account.operationalBalanceMinor,
                            currencySymbol(
                              account.currencyCode,
                            ),
                          )}
                        </strong>

                        {account.balanceSource ===
                          "cash_session" && (
                          <small>
                            الدفتري:{" "}
                            {formatMinor(
                              account.bookBalanceMinor,
                              currencySymbol(
                                account.currencyCode,
                              ),
                            )}
                          </small>
                        )}
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}

            <form
              className="banking-cash-create-form"
              onSubmit={
                createCashAccount
              }
            >
              <label>
                <span>
                  اسم الصندوق الفرعي
                </span>
                <input
                  value={
                    cashAccountName
                  }
                  onChange={(
                    event,
                  ) =>
                    setCashAccountName(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    cashAccountSaving
                  }
                />
              </label>

              <label>
                <span>
                  العملة
                </span>
                <select
                  value={
                    cashAccountCurrency
                  }
                  onChange={(
                    event,
                  ) =>
                    setCashAccountCurrency(
                      event
                        .target
                        .value,
                    )
                  }
                  disabled={
                    cashAccountSaving
                  }
                >
                  {currencies
                    .filter(
                      (currency) =>
                        currency.status ===
                        "active",
                    )
                    .map(
                      (currency) => (
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

              <label className="banking-cash-notes">
                <span>
                  ملاحظة
                  <small>
                    {" "}
                    اختياري
                  </small>
                </span>
                <input
                  value={
                    cashAccountNotes
                  }
                  onChange={(
                    event,
                  ) =>
                    setCashAccountNotes(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="مثال: صندوق للمشتريات اليومية"
                  disabled={
                    cashAccountSaving
                  }
                />
              </label>

              <button
                type="submit"
                className="secondary-button"
                disabled={
                  cashAccountSaving ||
                  !cashAccountName.trim()
                }
              >
                {cashAccountSaving
                  ? "جاري الإضافة…"
                  : "إضافة صندوق فرعي"}
              </button>
            </form>
          </section>

          <section className="banking-section">
            <div className="banking-section-title">
              <div>
                <h3>
                  سجل التحويلات
                </h3>
                <p>
                  كل تحويل يبقى محفوظًا. الإلغاء يتم بقيد عكسي ولا يحذف الحركة الأصلية.
                </p>
              </div>
              <span>
                {
                  transfers.length
                }{" "}
                حركة
              </span>
            </div>

            {loading ? (
              <div className="banking-empty">
                جاري التحميل…
              </div>
            ) : transfers.length ===
              0 ? (
              <div className="banking-empty">
                لا توجد تحويلات مالية بعد.
              </div>
            ) : (
              <div className="banking-transfer-table-wrap">
                <table className="banking-transfer-table">
                  <thead>
                    <tr>
                      <th>
                        التحويل
                      </th>
                      <th>
                        التاريخ
                      </th>
                      <th>
                        من
                      </th>
                      <th>
                        إلى
                      </th>
                      <th>
                        المبلغ
                      </th>
                      <th>
                        الحالة
                      </th>
                      <th>
                        إجراء
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map(
                      (transfer) => {
                        const currencyCode =
                          transfer
                            .source
                            ?.currencyCode ??
                          transfer
                            .destination
                            ?.currencyCode ??
                          "ILS";

                        const isReversed =
                          transfer
                            .transaction
                            .status ===
                          "reversed";

                        return (
                          <tr
                            key={
                              transfer
                                .transaction
                                .id
                            }
                          >
                            <td>
                              <strong dir="ltr">
                                {
                                  transfer
                                    .transaction
                                    .publicId
                                }
                              </strong>
                              {transfer
                                .transaction
                                .notes && (
                                <small>
                                  {
                                    transfer
                                      .transaction
                                      .notes
                                  }
                                </small>
                              )}
                            </td>
                            <td>
                              {
                                transfer
                                  .transaction
                                  .businessDate
                              }
                            </td>
                            <td>
                              {transfer
                                .source
                                ?.name ??
                                "—"}
                            </td>
                            <td>
                              {transfer
                                .destination
                                ?.name ??
                                "—"}
                            </td>
                            <td>
                              <strong>
                                {formatMinor(
                                  transfer.amountMinor,
                                  currencySymbol(
                                    currencyCode,
                                  ),
                                )}
                              </strong>
                            </td>
                            <td>
                              <span
                                className={
                                  isReversed
                                    ? "banking-transfer-status is-reversed"
                                    : "banking-transfer-status is-posted"
                                }
                              >
                                {isReversed
                                  ? "معكوس"
                                  : "مرحّل"}
                              </span>
                            </td>
                            <td>
                              {isReversed ? (
                                <span className="banking-transfer-locked">
                                  محفوظ
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="secondary-button banking-reverse-button"
                                  disabled={
                                    reversingTransferId !==
                                    null
                                  }
                                  onClick={() =>
                                    void reverseTransfer(
                                      transfer,
                                    )
                                  }
                                >
                                  {reversingTransferId ===
                                  transfer
                                    .transaction
                                    .publicId
                                    ? "جاري العكس…"
                                    : "عكس"}
                                </button>
                              )}
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
        </>
      )}

      <section className="banking-currency-grid">
        {currencies.map(
          (currency) => (
            <article
              key={
                currency.code
              }
              className={
                currency.isBase
                  ? "banking-currency-card is-base"
                  : "banking-currency-card"
              }
            >
              <div className="banking-currency-title">
                <span>
                  {currency.symbol}
                </span>
                <div>
                  <strong>
                    {
                      currency.nameAr
                    }
                  </strong>
                  <small>
                    {
                      currency.code
                    }
                  </small>
                </div>
              </div>

              {currency.isBase ? (
                <div className="banking-base-rate">
                  <span>
                    العملة الأساسية
                  </span>
                  <strong>
                    1.000000
                  </strong>
                </div>
              ) : (
                <>
                  <label>
                    <span>
                      1 {currency.code} = كم ₪
                    </span>
                    <input
                      dir="ltr"
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      inputMode="decimal"
                      value={
                        rateInputs[
                          currency.code
                        ] ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        setRateInputs(
                          (
                            current,
                          ) => ({
                            ...current,
                            [currency.code]:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      disabled={
                        !user?.isOwner ||
                        rateSaving !==
                          null
                      }
                    />
                  </label>

                  <div className="banking-rate-footer">
                    <small>
                      {currency.latestRate
                        ? "آخر تحديث: " +
                          currency
                            .latestRate
                            .rateDate
                        : "لم يتم تحديد سعر بعد"}
                    </small>

                    {user?.isOwner && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          void saveRate(
                            currency.code,
                          )
                        }
                        disabled={
                          rateSaving !==
                          null
                        }
                      >
                        {rateSaving ===
                        currency.code
                          ? "حفظ…"
                          : "حفظ السعر"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>
          ),
        )}
      </section>

      <section className="banking-section">
        <div className="banking-section-title">
          <div>
            <h3>
              البنوك المعتمدة
            </h3>
            <p>
              البنوك المضافة كأساس للنظام.
            </p>
          </div>
        </div>

        <div className="banking-bank-grid">
          {banks.map(
            (bank) => (
              <article
                key={bank.id}
              >
                <span>
                  🏦
                </span>
                <div>
                  <strong>
                    {bank.nameAr}
                  </strong>
                  <small>
                    {bank.nameEn ??
                      bank.code}
                  </small>
                </div>
              </article>
            ),
          )}
        </div>
      </section>

      {user?.isOwner && (
        <section className="banking-section">
          <div className="banking-section-title">
            <div>
              <h3>
                إضافة حساب بنكي
              </h3>
              <p>
                لكل حساب عملة مستقلة وحساب محاسبي منفصل.
              </p>
            </div>
          </div>

          <form
            className="banking-account-form"
            onSubmit={
              createAccount
            }
          >
            <label>
              <span>
                البنك
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
                اسم الحساب
              </span>
              <input
                value={
                  accountName
                }
                onChange={(
                  event,
                ) =>
                  setAccountName(
                    event
                      .target
                      .value,
                  )
                }
                placeholder="مثال: الحساب الجاري"
                disabled={
                  saving
                }
              />
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
                ) =>
                  setSelectedCurrency(
                    event
                      .target
                      .value,
                  )
                }
                disabled={
                  saving
                }
              >
                {currencies
                  .filter(
                    (currency) =>
                      currency.status ===
                      "active",
                  )
                  .map(
                    (currency) => (
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

            <label>
              <span>
                رقم الحساب
                <small>
                  {" "}
                  اختياري
                </small>
              </span>
              <input
                dir="ltr"
                value={
                  accountNumber
                }
                onChange={(
                  event,
                ) =>
                  setAccountNumber(
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
                IBAN
                <small>
                  {" "}
                  اختياري
                </small>
              </span>
              <input
                dir="ltr"
                value={iban}
                onChange={(
                  event,
                ) =>
                  setIban(
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

            <label className="banking-form-notes">
              <span>
                ملاحظة
                <small>
                  {" "}
                  اختياري
                </small>
              </span>
              <input
                value={
                  accountNotes
                }
                onChange={(
                  event,
                ) =>
                  setAccountNotes(
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

            <button
              type="submit"
              className="primary-button"
              disabled={
                saving ||
                banks.length ===
                  0
              }
            >
              {saving
                ? "جاري الإضافة…"
                : "إضافة الحساب"}
            </button>
          </form>
        </section>
      )}

      <section className="banking-section">
        <div className="banking-section-title">
          <div>
            <h3>
              الحسابات البنكية
            </h3>
            <p>
              الرصيد الأصلي حسب عملة الحساب، مع قيمته الدفترية بالشيكل.
            </p>
          </div>
          <span>
            {accounts.length}
            {" "}
            حساب
          </span>
        </div>

        {loading ? (
          <div className="banking-empty">
            جاري التحميل…
          </div>
        ) : accounts.length ===
          0 ? (
          <div className="banking-empty">
            لا توجد حسابات بنكية بعد.
          </div>
        ) : (
          <div className="banking-account-grid">
            {accounts.map(
              (account) => {
                const currency =
                  currencyByCode.get(
                    account.currencyCode,
                  );

                return (
                  <article
                    key={
                      account.id
                    }
                    className="banking-account-card"
                  >
                    <div className="banking-account-head">
                      <div>
                        <span>
                          🏦
                        </span>
                        <div>
                          <strong>
                            {
                              account
                                .bank
                                .nameAr
                            }
                          </strong>
                          <small>
                            {
                              account.name
                            }
                          </small>
                        </div>
                      </div>

                      <b>
                        {
                          account.currencyCode
                        }
                      </b>
                    </div>

                    <div className="banking-account-balance">
                      <span>
                        رصيد الحساب
                      </span>
                      <strong>
                        {formatMinor(
                          account.currencyBalanceMinor,
                          currency
                            ?.symbol ??
                            account.currencyCode,
                        )}
                      </strong>
                      <small>
                        قيمة دفترية:{" "}
                        {formatMinor(
                          account.baseBalanceMinor,
                          "₪",
                        )}
                      </small>
                    </div>

                    {(account.accountNumber ||
                      account.iban) && (
                      <div className="banking-account-meta">
                        {account.accountNumber && (
                          <span>
                            رقم الحساب:{" "}
                            <b dir="ltr">
                              {
                                account.accountNumber
                              }
                            </b>
                          </span>
                        )}

                        {account.iban && (
                          <span>
                            IBAN:{" "}
                            <b dir="ltr">
                              {
                                account.iban
                              }
                            </b>
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
    </section>
  );
}
