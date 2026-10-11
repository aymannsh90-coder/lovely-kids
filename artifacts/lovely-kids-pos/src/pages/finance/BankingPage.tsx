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
  getPosBankAccounts,
  getPosFinanceBankingReference,
  savePosExchangeRate,
  type PosBank,
  type PosBankAccount,
  type PosFinanceCurrency,
} from "../../lib/api";

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
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

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

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
      const [
        reference,
        accountResult,
      ] =
        await Promise.all([
          getPosFinanceBankingReference(
            token,
          ),
          getPosBankAccounts(
            token,
          ),
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
  }, [token]);

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
        `تم حفظ سعر ${currencyCode}.`,
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

  return (
    <section className="banking-page">
      <div className="banking-heading">
        <div>
          <span className="banking-eyebrow">
            المالية
          </span>
          <h2>
            البنوك والعملات
          </h2>
          <p>
            إدارة الحسابات البنكية وأسعار الدولار والدينار مقابل الشيكل.
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
                        ? `آخر تحديث: ${currency.latestRate.rateDate}`
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
