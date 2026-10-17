import {
  employeesTable,
  expenseCategoriesTable,
} from "@workspace/db/schema";
import {
  assistantDraftsTable,
} from "../../../lib/db/src/schema/assistant-drafts";
import {
  and,
  desc,
  eq,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { handlePartyFinanceRequest } from "./party-finance-routes";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type DraftIntent =
  | "expense"
  | "employee_advance"
  | "owner_withdrawal";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (
  data: unknown,
  status = 200,
) =>
  new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );

class AssistantDraftError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
) {
  const user =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!user) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "يجب تسجيل الدخول أولًا",
        },
        401,
      ),
    };
  }

  if (
    !user.isAdmin &&
    !user.isOwner
  ) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذا الحساب لا يملك صلاحية استخدام نقطة البيع",
        },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth;
  }

  if (!auth.user.isOwner) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذه العملية متاحة للمالك فقط",
        },
        403,
      ),
    };
  }

  return auth;
}

function normalizeDigits(
  value: string,
) {
  const arabic =
    "٠١٢٣٤٥٦٧٨٩";
  const persian =
    "۰۱۲۳۴۵۶۷۸۹";

  return value
    .replace(
      /[٠-٩]/g,
      (digit) =>
        String(
          arabic.indexOf(
            digit,
          ),
        ),
    )
    .replace(
      /[۰-۹]/g,
      (digit) =>
        String(
          persian.indexOf(
            digit,
          ),
        ),
    );
}

function normalizeArabic(
  value: string,
) {
  return normalizeDigits(
    value,
  )
    .toLowerCase()
    .replace(
      /[\u064B-\u065F\u0670]/g,
      "",
    )
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyMinor(
  value: unknown,
) {
  const normalized =
    normalizeDigits(
      String(
        value ?? "",
      ),
    )
      .trim()
      .replace(",", ".");

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(
      amount,
    ) ||
    amount <= 0 ||
    amount >
      21_474_836.47
  ) {
    throw new AssistantDraftError(
      "أدخل مبلغًا صحيحًا أكبر من صفر",
    );
  }

  return Math.round(
    amount * 100,
  );
}

function amountFromText(
  text: string,
) {
  const normalized =
    normalizeDigits(
      text,
    ).replace(",", ".");

  const matches =
    normalized.match(
      /\d+(?:\.\d{1,2})?/g,
    ) ?? [];

  for (
    const match of matches
  ) {
    const amount =
      Number(match);

    if (
      Number.isFinite(
        amount,
      ) &&
      amount > 0 &&
      amount <=
        21_474_836.47
    ) {
      return Math.round(
        amount * 100,
      );
    }
  }

  return null;
}

function positiveId(
  value: unknown,
  label: string,
) {
  const id =
    Number(value);

  if (
    !Number.isSafeInteger(
      id,
    ) ||
    id <= 0
  ) {
    throw new AssistantDraftError(
      `${label} غير صالح`,
    );
  }

  return id;
}

function textValue(
  value: unknown,
  maxLength: number,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  if (
    text.length >
    maxLength
  ) {
    throw new AssistantDraftError(
      "النص أطول من الحد المسموح",
    );
  }

  return text;
}

function normalizeRegisterKey(
  value: unknown,
) {
  const key =
    String(
      value ?? "main",
    )
      .trim()
      .toLowerCase();

  if (
    !/^[a-z0-9_-]{1,50}$/.test(
      key,
    )
  ) {
    throw new AssistantDraftError(
      "معرّف الصندوق غير صالح",
    );
  }

  return key;
}

function uniqueFirstNameMatch(
  normalizedText: string,
  employees:
    Array<
      typeof employeesTable.$inferSelect
    >,
) {
  const exact =
    employees
      .map(
        (employee) => ({
          employee,
          normalized:
            normalizeArabic(
              employee.name,
            ),
        }),
      )
      .filter(
        ({ normalized }) =>
          normalized &&
          normalizedText.includes(
            normalized,
          ),
      )
      .sort(
        (left, right) =>
          right.normalized.length -
          left.normalized.length,
      );

  if (exact[0]) {
    return exact[0]
      .employee;
  }

  const tokens =
    new Set(
      normalizedText.split(
        " ",
      ),
    );

  const firstNameMatches =
    employees.filter(
      (employee) => {
        const first =
          normalizeArabic(
            employee.name,
          ).split(" ")[0];

        return (
          first.length >= 2 &&
          tokens.has(first)
        );
      },
    );

  return firstNameMatches.length ===
    1
    ? firstNameMatches[0]
    : null;
}

function categoryMatch(
  normalizedText: string,
  categories:
    Array<
      typeof expenseCategoriesTable.$inferSelect
    >,
) {
  const direct =
    categories
      .map(
        (category) => ({
          category,
          normalized:
            normalizeArabic(
              category.name,
            ),
        }),
      )
      .filter(
        ({ normalized }) =>
          normalized &&
          normalizedText.includes(
            normalized,
          ),
      )
      .sort(
        (left, right) =>
          right.normalized.length -
          left.normalized.length,
      )[0];

  if (direct) {
    return direct.category;
  }

  const aliases: Array<{
    patterns: RegExp[];
    codes: string[];
  }> = [
    {
      patterns: [
        /كهرب/,
        /مياه/,
        /ميه/,
        /ماء/,
        /اتصال/,
        /هاتف/,
      ],
      codes: [
        "utilities",
      ],
    },
    {
      patterns: [
        /اعلان/,
        /فيس/,
        /انستا/,
        /تسويق/,
      ],
      codes: [
        "ads",
      ],
    },
    {
      patterns: [
        /مواصل/,
        /توصيل/,
        /نقل/,
      ],
      codes: [
        "transport",
      ],
    },
    {
      patterns: [
        /صيان/,
        /تصليح/,
      ],
      codes: [
        "maintenance",
      ],
    },
    {
      patterns: [
        /ايجار/,
      ],
      codes: [
        "rent",
      ],
    },
    {
      patterns: [
        /ضياف/,
        /قهوه/,
        /شاي/,
      ],
      codes: [
        "hospitality",
      ],
    },
    {
      patterns: [
        /تنظيف/,
        /منظف/,
        /نظاف/,
      ],
      codes: [
        "cleaning",
      ],
    },
    {
      patterns: [
        /بنزين/,
        /سولار/,
        /ديزل/,
        /وقود/,
        /محروقات/,
      ],
      codes: [
        "fuel",
        "transport",
      ],
    },
  ];

  for (
    const alias of aliases
  ) {
    if (
      !alias.patterns.some(
        (pattern) =>
          pattern.test(
            normalizedText,
          ),
      )
    ) {
      continue;
    }

    const byCode =
      categories.find(
        (category) =>
          alias.codes.includes(
            category.code
              .toLowerCase(),
          ),
      );

    if (byCode) {
      return byCode;
    }

    const byName =
      categories.find(
        (category) =>
          alias.patterns.some(
            (pattern) =>
              pattern.test(
                normalizeArabic(
                  category.name,
                ),
              ),
          ),
      );

    if (byName) {
      return byName;
    }
  }

  return null;
}

function parseDraft(
  rawText: string,
  employees:
    Array<
      typeof employeesTable.$inferSelect
    >,
  categories:
    Array<
      typeof expenseCategoriesTable.$inferSelect
    >,
) {
  const normalized =
    normalizeArabic(
      rawText,
    );

  const amountMinor =
    amountFromText(
      rawText,
    );

  const employee =
    uniqueFirstNameMatch(
      normalized,
      employees,
    );

  const category =
    categoryMatch(
      normalized,
      categories,
    );

  const employeeAdvanceWords =
    /(سحب|مسحوب|سلف|سلفه|اخذ|اخد)/;

  const ownerWords =
    /(سحب المالك|مسحوب المالك|سحب شخصي|مسحوب شخصي|انا سحبت|انا اخذت|انا اخدت)/;

  const expenseWords =
    /(دفعت|دفعنا|مصروف|صرفنا|اشتريت|اشترينا)/;

  let intent:
    | DraftIntent
    | null =
    null;

  if (
    ownerWords.test(
      normalized,
    )
  ) {
    intent =
      "owner_withdrawal";
  } else if (
    employeeAdvanceWords.test(
      normalized,
    ) &&
    (
      employee ||
      /موظف/.test(
        normalized,
      )
    )
  ) {
    intent =
      "employee_advance";
  } else if (
    category ||
    expenseWords.test(
      normalized,
    )
  ) {
    intent =
      "expense";
  }

  const missing:
    string[] =
    [];

  if (!intent) {
    missing.push(
      "نوع الحركة",
    );
  }

  if (!amountMinor) {
    missing.push(
      "المبلغ",
    );
  }

  if (
    intent ===
      "employee_advance" &&
    !employee
  ) {
    missing.push(
      "الموظف",
    );
  }

  if (
    intent ===
      "expense" &&
    !category
  ) {
    missing.push(
      "تصنيف المصروف",
    );
  }

  const complete =
    missing.length === 0;

  const resolvedParts =
    [
      intent ? 1 : 0,
      amountMinor ? 1 : 0,
      intent ===
        "employee_advance"
        ? employee
          ? 1
          : 0
        : intent ===
            "expense"
          ? category
            ? 1
            : 0
          : intent ===
              "owner_withdrawal"
            ? 1
            : 0,
    ];

  const confidence =
    Math.round(
      resolvedParts.reduce(
        (sum, value) =>
          sum +
          Number(Boolean(value)),
        0,
      ) /
        resolvedParts.length *
        100,
    );

  return {
    intent,
    amountMinor,
    employeeId:
      intent ===
        "employee_advance"
        ? employee?.id ??
          null
        : null,
    expenseCategoryId:
      intent ===
        "expense"
        ? category?.id ??
          null
        : null,
    confidence,
    parseMessage:
      complete
        ? "فهمت الحركة. راجعها على الكمبيوتر قبل الاعتماد."
        : `المسودة محفوظة وتحتاج مراجعة: ${missing.join("، ")}.`,
  };
}

async function loadReferences(
  db: Db,
) {
  const [
    employees,
    categories,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          employeesTable,
        )
        .where(
          eq(
            employeesTable.status,
            "active",
          ),
        ),
      db
        .select()
        .from(
          expenseCategoriesTable,
        )
        .where(
          eq(
            expenseCategoriesTable.status,
            "active",
          ),
        ),
    ]);

  return {
    employees,
    categories,
  };
}

async function presentDrafts(
  db: Db,
  whereClause: any,
) {
  const selection = {
    draft:
      assistantDraftsTable,
    employeeName:
      employeesTable.name,
    expenseCategoryName:
      expenseCategoriesTable.name,
  };

  const rows =
    whereClause
      ? await db
          .select(selection)
          .from(
            assistantDraftsTable,
          )
          .leftJoin(
            employeesTable,
            eq(
              assistantDraftsTable.employeeId,
              employeesTable.id,
            ),
          )
          .leftJoin(
            expenseCategoriesTable,
            eq(
              assistantDraftsTable.expenseCategoryId,
              expenseCategoriesTable.id,
            ),
          )
          .where(
            whereClause,
          )
          .orderBy(
            desc(
              assistantDraftsTable.createdAt,
            ),
          )
      : await db
          .select(selection)
          .from(
            assistantDraftsTable,
          )
          .leftJoin(
            employeesTable,
            eq(
              assistantDraftsTable.employeeId,
              employeesTable.id,
            ),
          )
          .leftJoin(
            expenseCategoriesTable,
            eq(
              assistantDraftsTable.expenseCategoryId,
              expenseCategoriesTable.id,
            ),
          )
          .orderBy(
            desc(
              assistantDraftsTable.createdAt,
            ),
          );

  return rows.map(
    (row) => ({
      ...row.draft,
      employeeName:
        row.employeeName ??
        null,
      expenseCategoryName:
        row.expenseCategoryName ??
        null,
    }),
  );
}

async function handleCreateDraft(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<
          string,
          unknown
        >
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات المسودة غير صالحة",
      },
      400,
    );
  }

  try {
    const originalText =
      textValue(
        body.text,
        2000,
      );

    if (!originalText) {
      throw new AssistantDraftError(
        "اكتب الحركة أولًا",
      );
    }

    const source =
      body.source ===
        "voice"
        ? "voice"
        : "text";

    const registerKey =
      normalizeRegisterKey(
        body.registerKey,
      );

    const {
      employees,
      categories,
    } =
      await loadReferences(
        db,
      );

    const parsed =
      parseDraft(
        originalText,
        employees,
        categories,
      );

    const publicId =
      `AST-${randomUUID().slice(0, 8).toUpperCase()}`;

    const rows =
      await db
        .insert(
          assistantDraftsTable,
        )
        .values({
          publicId,
          originalText,
          source,
          intent:
            parsed.intent,
          amountMinor:
            parsed.amountMinor,
          employeeId:
            parsed.employeeId,
          expenseCategoryId:
            parsed.expenseCategoryId,
          paymentMethod:
            "cash",
          registerKey,
          confidence:
            parsed.confidence,
          parseMessage:
            parsed.parseMessage,
          notes: null,
          status:
            "pending",
          financeVoucherId:
            null,
          createdByUserId:
            Number(
              auth.user.id,
            ),
          reviewedByUserId:
            null,
          reviewedAt:
            null,
        })
        .returning();

    return json(
      {
        draft:
          rows[0],
        parsed: {
          ...parsed,
          employeeName:
            employees.find(
              (employee) =>
                employee.id ===
                parsed.employeeId,
            )?.name ??
            null,
          expenseCategoryName:
            categories.find(
              (category) =>
                category.id ===
                parsed.expenseCategoryId,
            )?.name ??
            null,
        },
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      AssistantDraftError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "ASSISTANT_DRAFT_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر حفظ مسودة المساعد",
      },
      500,
    );
  }
}

async function handleListDrafts(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const url =
    new URL(
      request.url,
    );

  const status =
    url.searchParams.get(
      "status",
    );

  if (
    status &&
    status !== "all" &&
    status !== "pending" &&
    status !== "approved" &&
    status !== "rejected"
  ) {
    return json(
      {
        error:
          "حالة المسودة غير صالحة",
      },
      400,
    );
  }

  const userId =
    Number(
      auth.user.id,
    );

  let whereClause:
    | ReturnType<typeof eq>
    | ReturnType<typeof and>
    | undefined;

  if (
    auth.user.isOwner
  ) {
    if (
      status &&
      status !== "all"
    ) {
      whereClause =
        eq(
          assistantDraftsTable.status,
          status,
        );
    }
  } else {
    const mine =
      eq(
        assistantDraftsTable.createdByUserId,
        userId,
      );

    whereClause =
      status &&
      status !== "all"
        ? and(
            mine,
            eq(
              assistantDraftsTable.status,
              status,
            ),
          )
        : mine;
  }

  const results =
    await presentDrafts(
      db,
      whereClause,
    );

  return json({
    results,
  });
}

async function handleUpdateDraft(
  request: Request,
  db: Db,
  env: Env,
  draftId: number,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<
          string,
          unknown
        >
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات التعديل غير صالحة",
      },
      400,
    );
  }

  try {
    const currentRows =
      await db
        .select()
        .from(
          assistantDraftsTable,
        )
        .where(
          eq(
            assistantDraftsTable.id,
            draftId,
          ),
        )
        .limit(1);

    const current =
      currentRows[0];

    if (!current) {
      throw new AssistantDraftError(
        "المسودة غير موجودة",
        404,
      );
    }

    if (
      current.status !==
      "pending"
    ) {
      throw new AssistantDraftError(
        "لا يمكن تعديل مسودة تمت مراجعتها",
        409,
      );
    }

    const intentRaw =
      body.intent ===
        undefined
        ? current.intent
        : body.intent;

    const intent:
      | DraftIntent
      | null =
      intentRaw === null ||
      intentRaw === ""
        ? null
        : intentRaw ===
              "expense" ||
            intentRaw ===
              "employee_advance" ||
            intentRaw ===
              "owner_withdrawal"
          ? intentRaw
          : (() => {
              throw new AssistantDraftError(
                "نوع الحركة غير صالح",
              );
            })();

    const amountMinor =
      body.amount ===
        undefined
        ? current.amountMinor
        : body.amount ===
              null ||
            body.amount === ""
          ? null
          : moneyMinor(
              body.amount,
            );

    let employeeId:
      | number
      | null =
      intent ===
        "employee_advance"
        ? current.employeeId
        : null;

    let expenseCategoryId:
      | number
      | null =
      intent ===
        "expense"
        ? current.expenseCategoryId
        : null;

    if (
      intent ===
        "employee_advance" &&
      body.employeeId !==
        undefined
    ) {
      employeeId =
        body.employeeId ===
            null ||
          body.employeeId ===
            ""
          ? null
          : positiveId(
              body.employeeId,
              "الموظف",
            );
    }

    if (
      intent ===
        "expense" &&
      body.expenseCategoryId !==
        undefined
    ) {
      expenseCategoryId =
        body.expenseCategoryId ===
            null ||
          body.expenseCategoryId ===
            ""
          ? null
          : positiveId(
              body.expenseCategoryId,
              "تصنيف المصروف",
            );
    }

    const notes =
      body.notes ===
        undefined
        ? current.notes
        : textValue(
            body.notes,
            1000,
          );

    const registerKey =
      body.registerKey ===
        undefined
        ? current.registerKey
        : normalizeRegisterKey(
            body.registerKey,
          );

    const rows =
      await db
        .update(
          assistantDraftsTable,
        )
        .set({
          intent,
          amountMinor,
          employeeId,
          expenseCategoryId,
          registerKey,
          notes,
          parseMessage:
            "تم تعديل المسودة يدويًا وهي جاهزة للمراجعة.",
          confidence: 100,
          updatedAt:
            new Date(),
        })
        .where(
          and(
            eq(
              assistantDraftsTable.id,
              draftId,
            ),
            eq(
              assistantDraftsTable.status,
              "pending",
            ),
          ),
        )
        .returning();

    if (!rows[0]) {
      throw new AssistantDraftError(
        "تعذر تعديل المسودة لأنها تغيرت أثناء المراجعة",
        409,
      );
    }

    return json({
      draft:
        rows[0],
    });
  } catch (caught) {
    if (
      caught instanceof
      AssistantDraftError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "ASSISTANT_DRAFT_UPDATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تعديل المسودة",
      },
      500,
    );
  }
}

async function handleRejectDraft(
  request: Request,
  db: Db,
  env: Env,
  draftId: number,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const rows =
    await db
      .update(
        assistantDraftsTable,
      )
      .set({
        status:
          "rejected",
        reviewedByUserId:
          Number(
            auth.user.id,
          ),
        reviewedAt:
          new Date(),
        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            assistantDraftsTable.id,
            draftId,
          ),
          eq(
            assistantDraftsTable.status,
            "pending",
          ),
        ),
      )
      .returning();

  if (!rows[0]) {
    return json(
      {
        error:
          "المسودة غير موجودة أو تمت مراجعتها مسبقًا",
      },
      409,
    );
  }

  return json({
    draft:
      rows[0],
  });
}

function minorToAmount(
  value: number,
) {
  return (
    value / 100
  ).toFixed(2);
}

async function handleApproveDraft(
  request: Request,
  db: Db,
  env: Env,
  draftId: number,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const draftRows =
      await db
        .select()
        .from(
          assistantDraftsTable,
        )
        .where(
          eq(
            assistantDraftsTable.id,
            draftId,
          ),
        )
        .limit(1);

    const draft =
      draftRows[0];

    if (!draft) {
      throw new AssistantDraftError(
        "المسودة غير موجودة",
        404,
      );
    }

    if (
      draft.status ===
        "approved"
    ) {
      return json({
        alreadyApproved:
          true,
        draft,
      });
    }

    if (
      draft.status !==
        "pending"
    ) {
      throw new AssistantDraftError(
        "المسودة مرفوضة ولا يمكن اعتمادها",
        409,
      );
    }

    if (
      !draft.intent ||
      !draft.amountMinor
    ) {
      throw new AssistantDraftError(
        "أكمل نوع الحركة والمبلغ قبل الاعتماد",
        409,
      );
    }

    if (
      draft.intent ===
        "employee_advance" &&
      !draft.employeeId
    ) {
      throw new AssistantDraftError(
        "اختر الموظف قبل الاعتماد",
        409,
      );
    }

    if (
      draft.intent ===
        "expense" &&
      !draft.expenseCategoryId
    ) {
      throw new AssistantDraftError(
        "اختر تصنيف المصروف قبل الاعتماد",
        409,
      );
    }

    let route:
      string;

    let payload:
      Record<
        string,
        unknown
      >;

    const common = {
      amount:
        minorToAmount(
          draft.amountMinor,
        ),
      paymentMethod:
        "cash",
      registerKey:
        draft.registerKey,
      notes:
        draft.notes ??
        `اعتماد مسودة المساعد ${draft.publicId}: ${draft.originalText}`,
      idempotencyKey:
        `assistant-draft:${draft.id}:approve`,
    };

    if (
      draft.intent ===
      "expense"
    ) {
      route =
        "/api/pos/finance/expenses";

      payload = {
        ...common,
        expenseCategoryId:
          draft.expenseCategoryId,
      };
    } else if (
      draft.intent ===
      "employee_advance"
    ) {
      route =
        `/api/pos/employees/${draft.employeeId}/advance`;

      payload =
        common;
    } else {
      route =
        "/api/pos/finance/owner-withdrawals";

      payload =
        common;
    }

    const url =
      new URL(
        request.url,
      );

    url.pathname =
      route;

    url.search = "";

    const internalRequest =
      new Request(
        url.toString(),
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              request.headers.get(
                "Authorization",
              ) ?? "",
          },
          body:
            JSON.stringify(
              payload,
            ),
        },
      );

    const financeResponse =
      await handlePartyFinanceRequest(
        internalRequest,
        db,
        env,
      );

    if (!financeResponse) {
      throw new Error(
        "ASSISTANT_FINANCE_ROUTE_NOT_FOUND",
      );
    }

    const financeBody =
      (await financeResponse
        .clone()
        .json()
        .catch(() => null)) as
        | Record<
            string,
            any
          >
        | null;

    if (
      !financeResponse.ok
    ) {
      return json(
        {
          error:
            financeBody?.error ??
            "تعذر اعتماد الحركة المحاسبية",
        },
        financeResponse.status,
      );
    }

    const voucher =
      financeBody?.voucher;

    if (
      !voucher ||
      !Number.isSafeInteger(
        Number(
          voucher.id,
        ),
      )
    ) {
      throw new Error(
        "ASSISTANT_APPROVAL_VOUCHER_MISSING",
      );
    }

    const updatedRows =
      await db
        .update(
          assistantDraftsTable,
        )
        .set({
          status:
            "approved",
          financeVoucherId:
            Number(
              voucher.id,
            ),
          reviewedByUserId:
            Number(
              auth.user.id,
            ),
          reviewedAt:
            new Date(),
          updatedAt:
            new Date(),
        })
        .where(
          and(
            eq(
              assistantDraftsTable.id,
              draft.id,
            ),
            eq(
              assistantDraftsTable.status,
              "pending",
            ),
          ),
        )
        .returning();

    const updated =
      updatedRows[0];

    if (!updated) {
      const retryRows =
        await db
          .select()
          .from(
            assistantDraftsTable,
          )
          .where(
            eq(
              assistantDraftsTable.id,
              draft.id,
            ),
          )
          .limit(1);

      const retry =
        retryRows[0];

      if (
        retry?.status ===
          "approved" &&
        retry.financeVoucherId ===
          Number(
            voucher.id,
          )
      ) {
        return json({
          alreadyApproved:
            true,
          draft:
            retry,
          voucher,
        });
      }

      throw new AssistantDraftError(
        "تم إنشاء الحركة لكن تعذر تثبيت حالة المسودة. لا تعاود إنشاء الحركة يدويًا؛ أعد محاولة الاعتماد من نفس المسودة.",
        409,
      );
    }

    return json({
      alreadyApproved:
        false,
      draft:
        updated,
      voucher,
    });
  } catch (caught) {
    if (
      caught instanceof
      AssistantDraftError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "ASSISTANT_DRAFT_APPROVE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر اعتماد مسودة المساعد",
      },
      500,
    );
  }
}

export async function handleAssistantDraftRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    path ===
      "/api/pos/assistant/drafts" &&
    request.method ===
      "POST"
  ) {
    return handleCreateDraft(
      request,
      db,
      env,
    );
  }

  if (
    path ===
      "/api/pos/assistant/drafts" &&
    request.method ===
      "GET"
  ) {
    return handleListDrafts(
      request,
      db,
      env,
    );
  }

  const draftMatch =
    path.match(
      /^\/api\/pos\/assistant\/drafts\/(\d+)$/,
    );

  if (
    draftMatch &&
    request.method ===
      "PATCH"
  ) {
    return handleUpdateDraft(
      request,
      db,
      env,
      positiveId(
        draftMatch[1],
        "المسودة",
      ),
    );
  }

  const rejectMatch =
    path.match(
      /^\/api\/pos\/assistant\/drafts\/(\d+)\/reject$/,
    );

  if (
    rejectMatch &&
    request.method ===
      "POST"
  ) {
    return handleRejectDraft(
      request,
      db,
      env,
      positiveId(
        rejectMatch[1],
        "المسودة",
      ),
    );
  }

  const approveMatch =
    path.match(
      /^\/api\/pos\/assistant\/drafts\/(\d+)\/approve$/,
    );

  if (
    approveMatch &&
    request.method ===
      "POST"
  ) {
    return handleApproveDraft(
      request,
      db,
      env,
      positiveId(
        approveMatch[1],
        "المسودة",
      ),
    );
  }

  return null;
}
