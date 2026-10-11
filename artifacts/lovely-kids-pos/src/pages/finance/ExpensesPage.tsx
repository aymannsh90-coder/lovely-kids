import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosEmployeeAdvance,
  createPosExpense,
  createPosExpenseCategory,
  createPosOwnerWithdrawal,
  getCurrentCashSession,
  getPosEmployees,
  getPosExpenseCategories,
  getPosFinanceVouchers,
  voidPosFinanceVoucher,
  type PosEmployee,
  type PosExpenseCategory,
  type PosFinancePaymentMethod,
  type PosFinanceVoucher,
} from "../../lib/api";

type QuickTileKind =
  | "expense"
  | "expense_other"
  | "employee_advance"
  | "owner_withdrawal";

interface QuickTile {
  key: string;
  kind: QuickTileKind;
  title: string;
  subtitle: string;
  icon: string;
  categoryId?: number;
  ownerOnly?: boolean;
}

const PIN_STORAGE_KEY =
  "lovely-kids-pos.finance-expense-pins.v1";

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function moneyMinor(minor: number) {
  return `${new Intl.NumberFormat("ar", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minor / 100)} ₪`;
}

function moneyAmount(value: string) {
  const normalized =
    value.trim().replace(",", ".");

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

function idempotencyKey(prefix: string) {
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

function expenseIcon(name: string) {
  const value =
    name.trim().toLowerCase();

  if (
    /ضياف|قهو|قهوة|شاي|مياه ضيافة/.test(
      value,
    )
  ) {
    return "☕";
  }

  if (
    /تنظيف|منظف|نظافة/.test(value)
  ) {
    return "🧹";
  }

  if (/كهرب/.test(value)) {
    return "⚡";
  }

  if (
    /مياه|ميه|ماء/.test(value)
  ) {
    return "💧";
  }

  if (
    /توصيل|مواصل|نقل/.test(value)
  ) {
    return "🚚";
  }

  if (
    /صيان|تصليح/.test(value)
  ) {
    return "🛠️";
  }

  if (
    /قرطاس|مكتب|طباعة/.test(value)
  ) {
    return "✏️";
  }

  if (
    /انترنت|هاتف|اتصال/.test(value)
  ) {
    return "📶";
  }

  return "💸";
}

function categoryPriority(name: string) {
  const value =
    name.trim().toLowerCase();

  const rules = [
    /ضياف|قهو|شاي/,
    /تنظيف|نظافة/,
    /كهرب/,
    /مياه|ميه|ماء/,
    /توصيل|مواصل|نقل/,
    /صيان|تصليح/,
  ];

  const index =
    rules.findIndex((rule) =>
      rule.test(value),
    );

  return index === -1
    ? 100
    : index;
}

function voucherTitle(
  voucher: PosFinanceVoucher,
  categories:
    PosExpenseCategory[],
) {
  if (
    voucher.voucherType === "expense"
  ) {
    const category =
      categories.find(
        (item) =>
          item.id ===
          voucher.expenseCategoryId,
      );

    return category?.name ??
      "مصروف";
  }

  if (
    voucher.voucherType ===
    "employee_advance"
  ) {
    return "سحب / سلفة موظف";
  }

  if (
    voucher.voucherType ===
    "owner_withdrawal"
  ) {
    return "سحب المالك";
  }

  if (
    voucher.voucherType ===
    "employee_payment"
  ) {
    return "دفعة مستحقات موظف";
  }

  return "حركة مالية";
}

function paymentLabel(
  method:
    PosFinanceVoucher["paymentMethod"] |
    PosFinancePaymentMethod,
) {
  if (method === "cash") {
    return "نقدي";
  }

  if (method === "card") {
    return "بطاقة";
  }

  if (method === "bank") {
    return "بنك";
  }

  return "غير نقدي";
}

function employeeName(
  voucher: PosFinanceVoucher,
  employees: PosEmployee[],
) {
  if (
    voucher.partyType !==
      "employee" ||
    voucher.partyId === null
  ) {
    return "";
  }

  return (
    employees.find(
      (employee) =>
        employee.id ===
        voucher.partyId,
    )?.name ??
    `موظف #${voucher.partyId}`
  );
}

export default function ExpensesPage() {
  const {
    token,
    user,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [
    categories,
    setCategories,
  ] = useState<
    PosExpenseCategory[]
  >([]);

  const [
    employees,
    setEmployees,
  ] = useState<PosEmployee[]>([]);

  const [
    vouchers,
    setVouchers,
  ] = useState<
    PosFinanceVoucher[]
  >([]);

  const [
    pinOrder,
    setPinOrder,
  ] = useState<string[]>([]);

  const [
    activeTile,
    setActiveTile,
  ] = useState<
    QuickTile | null
  >(null);

  const [
    showManager,
    setShowManager,
  ] = useState(false);

  const [
    amount,
    setAmount,
  ] = useState("");

  const [
    paymentMethod,
    setPaymentMethod,
  ] =
    useState<PosFinancePaymentMethod>(
      "cash",
    );

  const [
    selectedCategoryId,
    setSelectedCategoryId,
  ] = useState<
    number | null
  >(null);

  const [
    selectedEmployeeId,
    setSelectedEmployeeId,
  ] = useState<
    number | null
  >(null);

  const [
    notes,
    setNotes,
  ] = useState("");

  const [
    newCategoryName,
    setNewCategoryName,
  ] = useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [
    categorySaving,
    setCategorySaving,
  ] = useState(false);

  const [
    voidingId,
    setVoidingId,
  ] = useState<
    number | null
  >(null);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const activeCategories =
    useMemo(
      () =>
        categories.filter(
          (category) =>
            category.status ===
            "active",
        ),
      [categories],
    );

  const allTiles =
    useMemo<QuickTile[]>(() => {
      const categoryTiles =
        activeCategories.map(
          (category) => ({
            key:
              `expense:${category.id}`,
            kind:
              "expense" as const,
            title:
              category.name,
            subtitle:
              "مصروف",
            icon:
              expenseIcon(
                category.name,
              ),
            categoryId:
              category.id,
          }),
        );

      const tiles:
        QuickTile[] = [
          ...categoryTiles,
          {
            key:
              "expense:other",
            kind:
              "expense_other",
            title:
              "مصروف آخر",
            subtitle:
              "اختيار التصنيف",
            icon:
              "➕",
          },
        ];

      if (user?.isOwner) {
        tiles.push(
          {
            key:
              "employee:advance",
            kind:
              "employee_advance",
            title:
              "سحب موظف",
            subtitle:
              "سلفة / مسحوب",
            icon:
              "👤",
            ownerOnly:
              true,
          },
          {
            key:
              "owner:withdrawal",
            kind:
              "owner_withdrawal",
            title:
              "سحب المالك",
            subtitle:
              "مسحوب شخصي",
            icon:
              "👑",
            ownerOnly:
              true,
          },
        );
      }

      return tiles;
    }, [
      activeCategories,
      user?.isOwner,
    ]);

  const tileMap =
    useMemo(
      () =>
        new Map(
          allTiles.map(
            (tile) => [
              tile.key,
              tile,
            ],
          ),
        ),
      [allTiles],
    );

  const pinnedTiles =
    useMemo(
      () =>
        pinOrder
          .map((key) =>
            tileMap.get(key),
          )
          .filter(
            (
              tile,
            ): tile is QuickTile =>
              Boolean(tile),
          ),
      [
        pinOrder,
        tileMap,
      ],
    );

  const relevantVouchers =
    useMemo(
      () =>
        vouchers.filter(
          (voucher) =>
            [
              "expense",
              "employee_advance",
              "employee_payment",
              "owner_withdrawal",
            ].includes(
              voucher.voucherType,
            ),
        ),
      [vouchers],
    );

  const postedRelevant =
    useMemo(
      () =>
        relevantVouchers.filter(
          (voucher) =>
            voucher.status ===
            "posted",
        ),
      [relevantVouchers],
    );

  const expenseTotal =
    useMemo(
      () =>
        postedRelevant
          .filter(
            (voucher) =>
              voucher.voucherType ===
              "expense",
          )
          .reduce(
            (sum, voucher) =>
              sum +
              voucher.amountMinor,
            0,
          ),
      [postedRelevant],
    );

  const employeeAdvanceTotal =
    useMemo(
      () =>
        postedRelevant
          .filter(
            (voucher) =>
              voucher.voucherType ===
              "employee_advance",
          )
          .reduce(
            (sum, voucher) =>
              sum +
              voucher.amountMinor,
            0,
          ),
      [postedRelevant],
    );

  const ownerWithdrawalTotal =
    useMemo(
      () =>
        postedRelevant
          .filter(
            (voucher) =>
              voucher.voucherType ===
              "owner_withdrawal",
          )
          .reduce(
            (sum, voucher) =>
              sum +
              voucher.amountMinor,
            0,
          ),
      [postedRelevant],
    );

  const outgoingTotal =
    useMemo(
      () =>
        postedRelevant.reduce(
          (sum, voucher) =>
            sum +
            voucher.amountMinor,
          0,
        ),
      [postedRelevant],
    );

  async function loadPageData() {
    setLoading(true);
    setError("");

    try {
      const [
        categoryResponse,
        voucherResponse,
        employeeResponse,
      ] =
        await Promise.all([
          getPosExpenseCategories(
            token,
          ),
          getPosFinanceVouchers(
            token,
            {
              date:
                session
                  ?.businessDate,
            },
          ),
          user?.isOwner
            ? getPosEmployees(
                token,
                {
                  status:
                    "active",
                },
              )
            : Promise.resolve({
                results:
                  [] as PosEmployee[],
              }),
        ]);

      setCategories(
        categoryResponse.results,
      );

      setVouchers(
        voucherResponse.results,
      );

      setEmployees(
        employeeResponse.results,
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

  useEffect(() => {
    void loadPageData();
  }, [
    token,
    session?.businessDate,
    user?.isOwner,
  ]);

  useEffect(() => {
    if (
      allTiles.length ===
      0
    ) {
      return;
    }

    const validKeys =
      new Set(
        allTiles.map(
          (tile) =>
            tile.key,
        ),
      );

    const raw =
      localStorage.getItem(
        PIN_STORAGE_KEY,
      );

    if (raw) {
      try {
        const parsed =
          JSON.parse(raw);

        if (
          Array.isArray(parsed)
        ) {
          const saved =
            parsed.filter(
              (
                value,
              ): value is string =>
                typeof value ===
                  "string" &&
                validKeys.has(
                  value,
                ),
            );

          if (
            saved.length >
            0
          ) {
            setPinOrder(
              saved,
            );
            return;
          }
        }
      } catch {
        // Use defaults below.
      }
    }

    const categoryDefaults =
      activeCategories
        .slice()
        .sort(
          (left, right) => {
            const score =
              categoryPriority(
                left.name,
              ) -
              categoryPriority(
                right.name,
              );

            if (score !== 0) {
              return score;
            }

            return left.name.localeCompare(
              right.name,
              "ar",
            );
          },
        )
        .slice(0, 6)
        .map(
          (category) =>
            `expense:${category.id}`,
        );

    const defaults = [
      ...categoryDefaults,
      "expense:other",
    ];

    if (user?.isOwner) {
      defaults.push(
        "employee:advance",
        "owner:withdrawal",
      );
    }

    setPinOrder(
      defaults.filter(
        (key) =>
          validKeys.has(
            key,
          ),
      ),
    );
  }, [
    allTiles.length,
    activeCategories,
    user?.isOwner,
  ]);

  useEffect(() => {
    if (
      pinOrder.length ===
      0
    ) {
      return;
    }

    localStorage.setItem(
      PIN_STORAGE_KEY,
      JSON.stringify(
        pinOrder,
      ),
    );
  }, [pinOrder]);

  function openTile(
    tile: QuickTile,
  ) {
    setActiveTile(tile);
    setAmount("");
    setNotes("");
    setPaymentMethod(
      "cash",
    );
    setSelectedCategoryId(
      tile.categoryId ??
        activeCategories[0]
          ?.id ??
        null,
    );
    setSelectedEmployeeId(
      null,
    );
    setError("");
    setMessage("");
  }

  function closeTile() {
    if (saving) {
      return;
    }

    setActiveTile(null);
  }

  function togglePinned(
    key: string,
  ) {
    setPinOrder(
      (current) =>
        current.includes(key)
          ? current.filter(
              (item) =>
                item !== key,
            )
          : [
              ...current,
              key,
            ],
    );
  }

  function movePinned(
    key: string,
    direction:
      | -1
      | 1,
  ) {
    setPinOrder(
      (current) => {
        const index =
          current.indexOf(
            key,
          );

        if (index < 0) {
          return current;
        }

        const nextIndex =
          index +
          direction;

        if (
          nextIndex < 0 ||
          nextIndex >=
            current.length
        ) {
          return current;
        }

        const next =
          [...current];

        [
          next[index],
          next[nextIndex],
        ] = [
          next[nextIndex],
          next[index],
        ];

        return next;
      },
    );
  }

  async function refreshSession() {
    if (!session) {
      return;
    }

    const response =
      await getCurrentCashSession(
        token,
        session.registerKey,
      );

    setSession(
      response.session,
    );
  }

  async function handleSave(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !activeTile ||
      saving
    ) {
      return;
    }

    const normalizedAmount =
      moneyAmount(amount);

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
        "يجب فتح الصندوق قبل تسجيل حركة نقدية.",
      );
      return;
    }

    const registerKey =
      session?.registerKey ??
      "main";

    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (
        activeTile.kind ===
          "expense" ||
        activeTile.kind ===
          "expense_other"
      ) {
        const categoryId =
          activeTile.categoryId ??
          selectedCategoryId;

        if (!categoryId) {
          throw new Error(
            "اختر تصنيف المصروف.",
          );
        }

        await createPosExpense(
          token,
          {
            expenseCategoryId:
              categoryId,
            amount:
              normalizedAmount,
            paymentMethod,
            registerKey,
            notes:
              notes.trim() ||
              undefined,
            idempotencyKey:
              idempotencyKey(
                "expense-ui",
              ),
          },
        );
      } else if (
        activeTile.kind ===
        "employee_advance"
      ) {
        if (
          !selectedEmployeeId
        ) {
          throw new Error(
            "اختر الموظف.",
          );
        }

        await createPosEmployeeAdvance(
          token,
          selectedEmployeeId,
          {
            amount:
              normalizedAmount,
            paymentMethod,
            registerKey,
            notes:
              notes.trim() ||
              undefined,
            idempotencyKey:
              idempotencyKey(
                "employee-advance-ui",
              ),
          },
        );
      } else {
        await createPosOwnerWithdrawal(
          token,
          {
            amount:
              normalizedAmount,
            paymentMethod,
            registerKey,
            notes:
              notes.trim() ||
              undefined,
            idempotencyKey:
              idempotencyKey(
                "owner-withdrawal-ui",
              ),
          },
        );
      }

      setActiveTile(null);
      setAmount("");
      setNotes("");

      setMessage(
        `تم تسجيل ${activeTile.title} بقيمة ${normalizedAmount} ₪.`,
      );

      await Promise.all([
        loadPageData(),
        refreshSession(),
      ]);
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

  async function handleCreateCategory(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const name =
      newCategoryName.trim();

    if (!name) {
      setError(
        "أدخل اسم تصنيف المصروف.",
      );
      return;
    }

    setCategorySaving(true);
    setError("");

    try {
      const result =
        await createPosExpenseCategory(
          token,
          name,
        );

      setCategories(
        (current) => [
          ...current,
          result.category,
        ],
      );

      setPinOrder(
        (current) => [
          ...current,
          `expense:${result.category.id}`,
        ],
      );

      setNewCategoryName(
        "",
      );

      setMessage(
        `تمت إضافة تصنيف ${result.category.name} وتثبيته.`,
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
      setCategorySaving(false);
    }
  }

  async function handleVoid(
    voucher: PosFinanceVoucher,
  ) {
    if (
      !user?.isOwner ||
      voucher.status !==
        "posted" ||
      voidingId !== null
    ) {
      return;
    }

    const reason =
      window.prompt(
        `سبب إلغاء ${voucher.publicId}:`,
        "",
      );

    if (reason === null) {
      return;
    }

    const cleanReason =
      reason.trim();

    if (!cleanReason) {
      setError(
        "سبب الإلغاء مطلوب.",
      );
      return;
    }

    if (
      !window.confirm(
        `تأكيد إلغاء ${voucher.publicId} بقيمة ${moneyMinor(voucher.amountMinor)}؟\nسيتم إنشاء قيد عكسي ولن يُحذف القيد الأصلي.`,
      )
    ) {
      return;
    }

    setVoidingId(
      voucher.id,
    );
    setError("");
    setMessage("");

    try {
      await voidPosFinanceVoucher(
        token,
        voucher.id,
        cleanReason,
      );

      setMessage(
        `تم إلغاء ${voucher.publicId} بقيد عكسي.`,
      );

      await Promise.all([
        loadPageData(),
        refreshSession(),
      ]);
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
      setVoidingId(null);
    }
  }

  return (
    <section className="expense-hub-page">
      <div className="expense-hub-heading">
        <div>
          <span className="expense-hub-eyebrow">
            المالية اليومية
          </span>

          <h2>
            المصاريف والسحوبات
          </h2>

          <p>
            اضغط على المربع لتسجيل الحركة بسرعة. المربعات المثبتة محفوظة على هذا الجهاز.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button expense-manage-button"
          onClick={() =>
            setShowManager(
              true,
            )
          }
        >
          ⚙️ إدارة المربعات
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

      <div className="expense-summary-grid">
        <article>
          <span>
            مصروفات اليوم
          </span>
          <strong>
            {moneyMinor(
              expenseTotal,
            )}
          </strong>
        </article>

        <article>
          <span>
            سلف الموظفين
          </span>
          <strong>
            {moneyMinor(
              employeeAdvanceTotal,
            )}
          </strong>
        </article>

        <article>
          <span>
            سحب المالك
          </span>
          <strong>
            {moneyMinor(
              ownerWithdrawalTotal,
            )}
          </strong>
        </article>

        <article>
          <span>
            إجمالي الخارج
          </span>
          <strong>
            {moneyMinor(
              outgoingTotal,
            )}
          </strong>
        </article>

        <article className="expense-summary-cash">
          <span>
            رصيد الصندوق الحالي
          </span>
          <strong>
            {session
              ? moneyMinor(
                  session.expectedBalanceMinor ??
                    session.openingBalanceMinor,
                )
              : "الصندوق مغلق"}
          </strong>
        </article>
      </div>

      <section className="expense-quick-section">
        <div className="expense-section-title">
          <div>
            <h3>
              الحركات السريعة
            </h3>
            <p>
              ثبت أكثر الحركات التي تستخدمها يوميًا.
            </p>
          </div>

          <span>
            {pinnedTiles.length}
            {" "}
            مثبت
          </span>
        </div>

        {loading ? (
          <div className="expense-empty-card">
            جاري تحميل الحركات…
          </div>
        ) : pinnedTiles.length ===
          0 ? (
          <div className="expense-empty-card">
            لا توجد مربعات مثبتة. استخدم “إدارة المربعات” لاختيار الحركات.
          </div>
        ) : (
          <div className="expense-tile-grid">
            {pinnedTiles.map(
              (tile) => (
                <button
                  key={
                    tile.key
                  }
                  type="button"
                  className="expense-quick-tile"
                  onClick={() =>
                    openTile(
                      tile,
                    )
                  }
                >
                  <span className="expense-tile-icon">
                    {tile.icon}
                  </span>

                  <strong>
                    {tile.title}
                  </strong>

                  <small>
                    {tile.subtitle}
                  </small>
                </button>
              ),
            )}
          </div>
        )}
      </section>

      <section className="expense-history-section">
        <div className="expense-section-title">
          <div>
            <h3>
              آخر الحركات
            </h3>
            <p>
              حركات يوم العمل الحالي، والإلغاء للمالك فقط.
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            disabled={
              loading
            }
            onClick={() =>
              void loadPageData()
            }
          >
            تحديث
          </button>
        </div>

        <div className="expense-history-list">
          {relevantVouchers.length ===
          0 ? (
            <div className="expense-empty-card">
              لا توجد حركات مالية مسجلة اليوم.
            </div>
          ) : (
            relevantVouchers
              .slice(0, 30)
              .map(
                (voucher) => {
                  const worker =
                    employeeName(
                      voucher,
                      employees,
                    );

                  return (
                    <article
                      key={
                        voucher.id
                      }
                      className={
                        voucher.status ===
                        "voided"
                          ? "expense-history-row is-voided"
                          : "expense-history-row"
                      }
                    >
                      <div className="expense-history-main">
                        <span className="expense-history-icon">
                          {voucher.voucherType ===
                          "expense"
                            ? expenseIcon(
                                voucherTitle(
                                  voucher,
                                  categories,
                                ),
                              )
                            : voucher.voucherType ===
                                "employee_advance"
                              ? "👤"
                              : voucher.voucherType ===
                                  "owner_withdrawal"
                                ? "👑"
                                : "💰"}
                        </span>

                        <div>
                          <strong>
                            {voucherTitle(
                              voucher,
                              categories,
                            )}
                          </strong>

                          <small>
                            {voucher.publicId}
                            {worker
                              ? ` • ${worker}`
                              : ""}
                            {" • "}
                            {paymentLabel(
                              voucher.paymentMethod,
                            )}
                          </small>

                          {voucher.notes && (
                            <p>
                              {voucher.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="expense-history-side">
                        <strong>
                          {moneyMinor(
                            voucher.amountMinor,
                          )}
                        </strong>

                        <span
                          className={
                            voucher.status ===
                            "posted"
                              ? "expense-status posted"
                              : "expense-status voided"
                          }
                        >
                          {voucher.status ===
                          "posted"
                            ? "مسجل"
                            : "ملغى"}
                        </span>

                        {user?.isOwner &&
                          voucher.status ===
                            "posted" && (
                            <button
                              type="button"
                              className="expense-void-button"
                              disabled={
                                voidingId !==
                                null
                              }
                              onClick={() =>
                                void handleVoid(
                                  voucher,
                                )
                              }
                            >
                              {voidingId ===
                              voucher.id
                                ? "جاري الإلغاء…"
                                : "إلغاء"}
                            </button>
                          )}
                      </div>
                    </article>
                  );
                },
              )
          )}
        </div>
      </section>

      {activeTile && (
        <div
          className="expense-modal-overlay"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeTile();
            }
          }}
        >
          <form
            className="expense-modal"
            onSubmit={
              handleSave
            }
          >
            <div className="expense-modal-header">
              <div className="expense-modal-title">
                <span>
                  {activeTile.icon}
                </span>

                <div>
                  <h3>
                    {activeTile.title}
                  </h3>
                  <p>
                    سجل الحركة ثم اضغط حفظ.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="expense-modal-close"
                onClick={
                  closeTile
                }
                disabled={
                  saving
                }
              >
                ×
              </button>
            </div>

            <div className="expense-modal-body">
              {activeTile.kind ===
                "expense_other" && (
                <label>
                  <span>
                    تصنيف المصروف
                  </span>

                  <select
                    value={
                      selectedCategoryId ??
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
                        );

                      setSelectedCategoryId(
                        Number.isSafeInteger(
                          id,
                        ) &&
                          id >
                            0
                          ? id
                          : null,
                      );
                    }}
                    disabled={
                      saving
                    }
                  >
                    <option value="">
                      اختر التصنيف
                    </option>

                    {activeCategories.map(
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

              {activeTile.kind ===
                "employee_advance" && (
                <label>
                  <span>
                    الموظف
                  </span>

                  <select
                    value={
                      selectedEmployeeId ??
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
                        );

                      setSelectedEmployeeId(
                        Number.isSafeInteger(
                          id,
                        ) &&
                          id >
                            0
                          ? id
                          : null,
                      );
                    }}
                    disabled={
                      saving
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

                  {employees.length ===
                    0 && (
                    <small>
                      لا يوجد موظفون فعالون حاليًا.
                    </small>
                  )}
                </label>
              )}

              <label>
                <span>
                  المبلغ
                </span>

                <div className="expense-money-input">
                  <input
                    autoFocus
                    dir="ltr"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={
                      amount
                    }
                    onChange={(
                      event,
                    ) =>
                      setAmount(
                        event
                          .target
                          .value,
                      )
                    }
                    placeholder="0.00"
                    disabled={
                      saving
                    }
                  />

                  <b>₪</b>
                </div>
              </label>

              <label>
                <span>
                  طريقة الدفع
                </span>

                <div className="expense-payment-options">
                  {(
                    [
                      [
                        "cash",
                        "💵 نقدي",
                      ],
                      [
                        "card",
                        "💳 بطاقة",
                      ],
                      [
                        "bank",
                        "🏦 بنك",
                      ],
                    ] as const
                  ).map(
                    ([
                      value,
                      label,
                    ]) => (
                      <button
                        key={
                          value
                        }
                        type="button"
                        className={
                          paymentMethod ===
                          value
                            ? "is-selected"
                            : ""
                        }
                        onClick={() =>
                          setPaymentMethod(
                            value,
                          )
                        }
                        disabled={
                          saving
                        }
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </label>

              <label>
                <span>
                  ملاحظة
                  <small>
                    {" "}
                    اختياري
                  </small>
                </span>

                <textarea
                  rows={3}
                  maxLength={
                    1000
                  }
                  value={
                    notes
                  }
                  onChange={(
                    event,
                  ) =>
                    setNotes(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="مثال: فاتورة شهر أكتوبر"
                  disabled={
                    saving
                  }
                />
              </label>

              {error && (
                <div className="alert error-alert">
                  {error}
                </div>
              )}
            </div>

            <div className="expense-modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={
                  closeTile
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
                  : "حفظ الحركة"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showManager && (
        <div
          className="expense-modal-overlay"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowManager(
                false,
              );
            }
          }}
        >
          <div className="expense-modal expense-manager-modal">
            <div className="expense-modal-header">
              <div className="expense-modal-title">
                <span>
                  ⚙️
                </span>

                <div>
                  <h3>
                    إدارة المربعات
                  </h3>
                  <p>
                    ثبت الحركات اليومية ورتبها كما تريد.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="expense-modal-close"
                onClick={() =>
                  setShowManager(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            <div className="expense-modal-body">
              <div className="expense-manager-list">
                {allTiles.map(
                  (tile) => {
                    const pinned =
                      pinOrder.includes(
                        tile.key,
                      );

                    const index =
                      pinOrder.indexOf(
                        tile.key,
                      );

                    return (
                      <div
                        key={
                          tile.key
                        }
                        className="expense-manager-row"
                      >
                        <span className="expense-manager-icon">
                          {tile.icon}
                        </span>

                        <div className="expense-manager-name">
                          <strong>
                            {
                              tile.title
                            }
                          </strong>
                          <small>
                            {
                              tile.subtitle
                            }
                          </small>
                        </div>

                        <button
                          type="button"
                          className={
                            pinned
                              ? "expense-pin-toggle is-pinned"
                              : "expense-pin-toggle"
                          }
                          onClick={() =>
                            togglePinned(
                              tile.key,
                            )
                          }
                        >
                          {pinned
                            ? "مثبت"
                            : "تثبيت"}
                        </button>

                        {pinned && (
                          <div className="expense-order-buttons">
                            <button
                              type="button"
                              disabled={
                                index <=
                                0
                              }
                              onClick={() =>
                                movePinned(
                                  tile.key,
                                  -1,
                                )
                              }
                            >
                              ↑
                            </button>

                            <button
                              type="button"
                              disabled={
                                index ===
                                pinOrder.length -
                                  1
                              }
                              onClick={() =>
                                movePinned(
                                  tile.key,
                                  1,
                                )
                              }
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>

              {user?.isOwner && (
                <form
                  className="expense-add-category"
                  onSubmit={
                    handleCreateCategory
                  }
                >
                  <div>
                    <strong>
                      إضافة تصنيف مصروف
                    </strong>
                    <small>
                      ينشئ حساب مصروف جديد ويضيفه للمربعات.
                    </small>
                  </div>

                  <input
                    value={
                      newCategoryName
                    }
                    onChange={(
                      event,
                    ) =>
                      setNewCategoryName(
                        event
                          .target
                          .value,
                      )
                    }
                    placeholder="مثال: ضيافة"
                    maxLength={
                      120
                    }
                    disabled={
                      categorySaving
                    }
                  />

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      categorySaving
                    }
                  >
                    {categorySaving
                      ? "جاري الإضافة…"
                      : "إضافة"}
                  </button>
                </form>
              )}

              {error && (
                <div className="alert error-alert">
                  {error}
                </div>
              )}
            </div>

            <div className="expense-modal-footer">
              <span>
                الترتيب يُحفظ تلقائيًا على هذا الجهاز.
              </span>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  setShowManager(
                    false,
                  )
                }
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
