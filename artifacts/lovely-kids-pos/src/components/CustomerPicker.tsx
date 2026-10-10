import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PosCustomer,
} from "../lib/api";

interface CustomerPickerProps {
  customers: PosCustomer[];

  value?:
    | number
    | string
    | null;

  fallbackName?: string;

  onChange: (
    customer: PosCustomer | null,
  ) => void;

  label?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowClear?: boolean;
  error?: string;
}

function money(
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

function balanceLabel(
  value: number,
) {
  if (value > 0) {
    return `عليه ${money(value)}`;
  }

  if (value < 0) {
    return `له ${money(value)}`;
  }

  return "الحساب مسدد";
}

export default function CustomerPicker({
  customers,
  value = null,
  fallbackName = "",
  onChange,
  label = "اسم الزبون",
  placeholder = "اختر الزبون",
  disabled = false,
  loading = false,
  allowClear = true,
  error = "",
}: CustomerPickerProps) {
  const [open, setOpen] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const searchRef =
    useRef<HTMLInputElement>(
      null,
    );

  const numericValue =
    value === null ||
    value === undefined ||
    value === ""
      ? null
      : Number(value);

  const selectedCustomer =
    customers.find(
      (customer) =>
        customer.id ===
        numericValue,
    ) ?? null;

  const displayName =
    selectedCustomer?.name ??
    fallbackName ??
    "";

  const visibleCustomers =
    useMemo(() => {
      const normalized =
        query
          .trim()
          .toLowerCase();

      const source =
        normalized
          ? customers.filter(
              (customer) =>
                [
                  customer.name,
                  customer.code,
                  customer.phone ??
                    "",
                  customer.address ??
                    "",
                ].some(
                  (field) =>
                    field
                      .toLowerCase()
                      .includes(
                        normalized,
                      ),
                ),
            )
          : customers;

      return [...source].sort(
        (left, right) =>
          left.name.localeCompare(
            right.name,
            "ar",
          ),
      );
    }, [
      customers,
      query,
    ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame =
      window.requestAnimationFrame(
        () => {
          searchRef.current?.focus();
        },
      );

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setOpen(false);
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.cancelAnimationFrame(
        frame,
      );

      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [open]);

  function openPicker() {
    if (disabled) {
      return;
    }

    setQuery("");
    setOpen(true);
  }

  function choose(
    customer: PosCustomer,
  ) {
    onChange(customer);
    setOpen(false);
  }

  return (
    <div
      className="customer-picker"
      dir="rtl"
    >
      <span className="customer-picker-label">
        {label}
      </span>

      <div className="customer-picker-control">
        <input
          value={displayName}
          readOnly
          placeholder={
            loading
              ? "جاري تحميل الزبائن..."
              : placeholder
          }
          onClick={openPicker}
        />

        <button
          type="button"
          className="customer-picker-search-button"
          disabled={
            disabled ||
            loading
          }
          aria-label="بحث عن زبون"
          title="بحث عن زبون"
          onClick={openPicker}
        >
          🔍
        </button>

        {allowClear &&
          (
            numericValue !==
              null ||
            displayName
          ) && (
            <button
              type="button"
              className="customer-picker-clear-button"
              disabled={disabled}
              aria-label="إزالة الزبون"
              title="إزالة الزبون"
              onClick={() =>
                onChange(null)
              }
            >
              ×
            </button>
          )}
      </div>

      {selectedCustomer && (
        <div className="customer-picker-selected-meta">
          <span>
            {selectedCustomer.phone ||
              "بدون هاتف"}
          </span>

          <strong>
            {balanceLabel(
              selectedCustomer
                .balanceMinor,
            )}
          </strong>
        </div>
      )}

      {error && (
        <small className="error-message customer-picker-error">
          {error}
        </small>
      )}

      {open && (
        <div
          className="customer-picker-overlay"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setOpen(false);
            }
          }}
        >
          <section
            className="customer-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="اختيار الزبون"
          >
            <header className="customer-picker-header">
              <div>
                <h3>
                  🔍 اختيار الزبون
                </h3>

                <p>
                  ابحث بجزء من الاسم
                  أو الاسم الكامل أو
                  رقم الهاتف.
                </p>
              </div>

              <button
                type="button"
                className="customer-picker-close"
                aria-label="إغلاق"
                onClick={() =>
                  setOpen(false)
                }
              >
                ×
              </button>
            </header>

            <div className="customer-picker-search">
              <span>🔎</span>

              <input
                ref={searchRef}
                value={query}
                autoComplete="off"
                placeholder="اكتب الاسم أو جزءًا منه أو رقم الهاتف..."
                onChange={(
                  event,
                ) =>
                  setQuery(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="customer-picker-results">
              {visibleCustomers.length ===
              0 ? (
                <div className="customer-picker-empty">
                  لا يوجد زبون
                  مطابق للبحث.
                </div>
              ) : (
                visibleCustomers.map(
                  (customer) => (
                    <button
                      type="button"
                      key={customer.id}
                      className={
                        customer.id ===
                        numericValue
                          ? "customer-picker-row is-selected"
                          : "customer-picker-row"
                      }
                      onClick={() =>
                        choose(
                          customer,
                        )
                      }
                    >
                      <div className="customer-picker-row-main">
                        <strong>
                          {
                            customer.name
                          }
                        </strong>

                        <span>
                          {customer.phone ||
                            "بدون هاتف"}
                        </span>
                      </div>

                      <div className="customer-picker-row-side">
                        <span>
                          {
                            customer.code
                          }
                        </span>

                        <b>
                          {balanceLabel(
                            customer
                              .balanceMinor,
                          )}
                        </b>
                      </div>
                    </button>
                  ),
                )
              )}
            </div>

            <footer className="customer-picker-footer">
              <span>
                النتائج:
                {" "}
                {
                  visibleCustomers.length
                }
              </span>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setOpen(false)
                }
              >
                إغلاق
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
