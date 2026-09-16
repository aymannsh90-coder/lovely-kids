import {
  cashSessionsTable,
  deliveryCompaniesTable,
  deliveryCompanySettlementItemsTable,
  deliveryCompanySettlementsTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  ordersTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class DeliverySettlementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return {
      ok: false as const,
      response: json(
        { error: "يجب تسجيل الدخول" },
        401,
      ),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false as const,
      response: json(
        { error: "غير مصرح بإدارة تسويات شركة التوصيل" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

function getBusinessDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseOrderIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DeliverySettlementError(
      "اختر طلبًا واحدًا على الأقل للتسوية",
    );
  }

  const ids = [...new Set(
    value.map((item) => Number(item)),
  )];

  if (
    ids.some(
      (id) =>
        !Number.isSafeInteger(id) ||
        id <= 0,
    )
  ) {
    throw new DeliverySettlementError(
      "قائمة الطلبات غير صالحة",
    );
  }

  return ids;
}

async function loadUnsettledOrders(
  db: Db,
  companyId: number,
) {
  const orderRows = await db
    .select({
      id: ordersTable.id,
      customerName: ordersTable.customerName,
      customerPhone: ordersTable.customerPhone,
      shippingZone: ordersTable.shippingZone,
      totalPrice: ordersTable.totalPrice,
      shippingCost: ordersTable.shippingCost,
      deliveryCompanyCost:
        ordersTable.deliveryCompanyCost,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(
      and(
        eq(
          ordersTable.deliveryCompanyId,
          companyId,
        ),
        eq(ordersTable.status, "done"),
        eq(
          ordersTable.fulfillmentMethod,
          "delivery",
        ),
        eq(ordersTable.paymentMethod, "cod"),
      ),
    );

  if (orderRows.length === 0) {
    return [];
  }

  const orderIds = orderRows.map(
    (order) => order.id,
  );

  const settledRows = await db
    .select({
      orderId:
        deliveryCompanySettlementItemsTable.orderId,
    })
    .from(deliveryCompanySettlementItemsTable)
    .where(
      and(
        inArray(
          deliveryCompanySettlementItemsTable.orderId,
          orderIds,
        ),
        eq(
          deliveryCompanySettlementItemsTable.status,
          "posted",
        ),
      ),
    );

  const settledIds = new Set(
    settledRows.map((row) => row.orderId),
  );

  const candidates = orderRows.filter(
    (order) => !settledIds.has(order.id),
  );

  if (candidates.length === 0) {
    return [];
  }

  const candidateIds = candidates.map(
    (order) => String(order.id),
  );

  const financeRows = await db
    .select({
      id: financeTransactionsTable.id,
      sourceId: financeTransactionsTable.sourceId,
    })
    .from(financeTransactionsTable)
    .where(
      and(
        eq(
          financeTransactionsTable.sourceType,
          "web_order",
        ),
        eq(
          financeTransactionsTable.sourceEvent,
          "done",
        ),
        eq(
          financeTransactionsTable.status,
          "posted",
        ),
        inArray(
          financeTransactionsTable.sourceId,
          candidateIds,
        ),
      ),
    );

  if (financeRows.length === 0) {
    return [];
  }

  const sourceIdByTransactionId =
    new Map<number, number>();

  for (const finance of financeRows) {
    const orderId = Number(finance.sourceId);

    if (Number.isSafeInteger(orderId)) {
      sourceIdByTransactionId.set(
        finance.id,
        orderId,
      );
    }
  }

  const financeIds = [
    ...sourceIdByTransactionId.keys(),
  ];

  if (financeIds.length === 0) {
    return [];
  }

  const lineRows = await db
    .select({
      transactionId:
        financeTransactionLinesTable.transactionId,
      debitMinor:
        financeTransactionLinesTable.debitMinor,
      creditMinor:
        financeTransactionLinesTable.creditMinor,
    })
    .from(financeTransactionLinesTable)
    .innerJoin(
      financeAccountsTable,
      eq(
        financeAccountsTable.id,
        financeTransactionLinesTable.accountId,
      ),
    )
    .where(
      and(
        inArray(
          financeTransactionLinesTable.transactionId,
          financeIds,
        ),
        eq(
          financeAccountsTable.linkedEntityType,
          "delivery_company_receivable",
        ),
        eq(
          financeAccountsTable.linkedEntityId,
          companyId,
        ),
      ),
    );

  const amountByOrderId = new Map<
    number,
    number
  >();

  for (const line of lineRows) {
    const orderId =
      sourceIdByTransactionId.get(
        line.transactionId,
      );

    if (!orderId) continue;

    const amount =
      line.debitMinor - line.creditMinor;

    amountByOrderId.set(
      orderId,
      (amountByOrderId.get(orderId) ?? 0) +
        amount,
    );
  }

  return candidates
    .map((order) => {
      const amountMinor =
        amountByOrderId.get(order.id) ?? 0;

      return {
        ...order,
        amountMinor,
        amount: amountMinor / 100,
      };
    })
    .filter(
      (order) => order.amountMinor > 0,
    )
    .sort((left, right) =>
      left.id - right.id
    );
}

async function handleSummary(
  request: Request,
  db: Db,
  env: Env,
  companyId: number,
) {
  const auth = await requireAdmin(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const companyRows = await db
    .select()
    .from(deliveryCompaniesTable)
    .where(
      eq(
        deliveryCompaniesTable.id,
        companyId,
      ),
    )
    .limit(1);

  const company = companyRows[0];

  if (!company) {
    return json(
      { error: "شركة التوصيل غير موجودة" },
      404,
    );
  }

  const unsettledOrders =
    await loadUnsettledOrders(
      db,
      companyId,
    );

  const outstandingMinor =
    unsettledOrders.reduce(
      (sum, order) =>
        sum + order.amountMinor,
      0,
    );

  const settlements = await db
    .select()
    .from(deliveryCompanySettlementsTable)
    .where(
      eq(
        deliveryCompanySettlementsTable.deliveryCompanyId,
        companyId,
      ),
    )
    .orderBy(
      desc(
        deliveryCompanySettlementsTable.id,
      ),
    )
    .limit(50);

  const settlementIds = settlements.map(
    (settlement) => settlement.id,
  );

  const itemRows =
    settlementIds.length > 0
      ? await db
          .select({
            settlementId:
              deliveryCompanySettlementItemsTable.settlementId,
            orderId:
              deliveryCompanySettlementItemsTable.orderId,
            amountMinor:
              deliveryCompanySettlementItemsTable.amountMinor,
            status:
              deliveryCompanySettlementItemsTable.status,
          })
          .from(
            deliveryCompanySettlementItemsTable,
          )
          .where(
            inArray(
              deliveryCompanySettlementItemsTable.settlementId,
              settlementIds,
            ),
          )
      : [];

  const itemsBySettlement =
    new Map<number, typeof itemRows>();

  for (const item of itemRows) {
    const list =
      itemsBySettlement.get(
        item.settlementId,
      ) ?? [];

    list.push(item);

    itemsBySettlement.set(
      item.settlementId,
      list,
    );
  }

  return json({
    company: {
      id: company.id,
      code: company.code,
      name: company.name,
      status: company.status,
    },

    outstandingMinor,
    outstanding:
      outstandingMinor / 100,

    unsettledOrders,

    settlements: settlements.map(
      (settlement) => {
        const items =
          itemsBySettlement.get(
            settlement.id,
          ) ?? [];

        return {
          id: settlement.id,
          publicId: settlement.publicId,
          businessDate:
            settlement.businessDate,
          receiptMethod:
            settlement.receiptMethod,
          totalMinor:
            settlement.totalMinor,
          total:
            settlement.totalMinor / 100,
          status: settlement.status,
          notes: settlement.notes,
          createdAt:
            settlement.createdAt.toISOString(),
          orders: items.map((item) => ({
            orderId: item.orderId,
            amountMinor: item.amountMinor,
            amount:
              item.amountMinor / 100,
            status: item.status,
          })),
        };
      },
    ),
  });
}

async function handleCreateSettlement(
  request: Request,
  db: Db,
  env: Env,
  companyId: number,
) {
  const auth = await requireAdmin(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request
    .json()
    .catch(() => null) as
    | Record<string, unknown>
    | null;

  if (!body || Array.isArray(body)) {
    return json(
      { error: "البيانات غير صالحة" },
      400,
    );
  }

  try {
    const orderIds =
      parseOrderIds(body.orderIds);

    const receiptMethod =
      body.receiptMethod;

    if (
      receiptMethod !== "cash" &&
      receiptMethod !== "bank"
    ) {
      throw new DeliverySettlementError(
        "اختر طريقة استلام المبلغ: نقدي أو بنك",
      );
    }

    const notes =
      typeof body.notes === "string"
        ? body.notes.trim().slice(0, 1000) ||
          null
        : null;

    const businessDate =
      getBusinessDate();

    const result = await db.transaction(
      async (tx) => {
        const companyRows = await tx
          .select()
          .from(deliveryCompaniesTable)
          .where(
            eq(
              deliveryCompaniesTable.id,
              companyId,
            ),
          )
          .for("update");

        const company = companyRows[0];

        if (!company) {
          throw new DeliverySettlementError(
            "شركة التوصيل غير موجودة",
            404,
          );
        }

        const orderRows = await tx
          .select({
            id: ordersTable.id,
            customerName:
              ordersTable.customerName,
            status: ordersTable.status,
            fulfillmentMethod:
              ordersTable.fulfillmentMethod,
            paymentMethod:
              ordersTable.paymentMethod,
            deliveryCompanyId:
              ordersTable.deliveryCompanyId,
          })
          .from(ordersTable)
          .where(
            inArray(
              ordersTable.id,
              orderIds,
            ),
          )
          .for("update");

        if (
          orderRows.length !==
          orderIds.length
        ) {
          throw new DeliverySettlementError(
            "أحد الطلبات المحددة غير موجود",
            404,
          );
        }

        for (const order of orderRows) {
          if (
            order.status !== "done" ||
            order.fulfillmentMethod !==
              "delivery" ||
            order.paymentMethod !== "cod" ||
            order.deliveryCompanyId !==
              companyId
          ) {
            throw new DeliverySettlementError(
              `الطلب #${order.id} غير مؤهل لتسوية شركة التوصيل`,
              409,
            );
          }
        }

        const alreadySettled =
          await tx
            .select({
              orderId:
                deliveryCompanySettlementItemsTable.orderId,
            })
            .from(
              deliveryCompanySettlementItemsTable,
            )
            .where(
              and(
                inArray(
                  deliveryCompanySettlementItemsTable.orderId,
                  orderIds,
                ),
                eq(
                  deliveryCompanySettlementItemsTable.status,
                  "posted",
                ),
              ),
            )
            .for("update");

        if (alreadySettled[0]) {
          throw new DeliverySettlementError(
            `الطلب #${alreadySettled[0].orderId} تمت تسويته مسبقًا`,
            409,
          );
        }

        const financeRows = await tx
          .select({
            id:
              financeTransactionsTable.id,
            sourceId:
              financeTransactionsTable.sourceId,
          })
          .from(financeTransactionsTable)
          .where(
            and(
              eq(
                financeTransactionsTable.sourceType,
                "web_order",
              ),
              eq(
                financeTransactionsTable.sourceEvent,
                "done",
              ),
              eq(
                financeTransactionsTable.status,
                "posted",
              ),
              inArray(
                financeTransactionsTable.sourceId,
                orderIds.map(String),
              ),
            ),
          )
          .for("update");

        const sourceByFinanceId =
          new Map<number, number>();

        for (const finance of financeRows) {
          const orderId =
            Number(finance.sourceId);

          if (
            Number.isSafeInteger(orderId)
          ) {
            sourceByFinanceId.set(
              finance.id,
              orderId,
            );
          }
        }

        if (
          sourceByFinanceId.size !==
          orderIds.length
        ) {
          throw new DeliverySettlementError(
            "بعض الطلبات لا تحتوي قيد تسليم مالي صالح",
            409,
          );
        }

        const financeIds = [
          ...sourceByFinanceId.keys(),
        ];

        const receivableLines =
          await tx
            .select({
              transactionId:
                financeTransactionLinesTable.transactionId,
              accountId:
                financeTransactionLinesTable.accountId,
              debitMinor:
                financeTransactionLinesTable.debitMinor,
              creditMinor:
                financeTransactionLinesTable.creditMinor,
            })
            .from(
              financeTransactionLinesTable,
            )
            .innerJoin(
              financeAccountsTable,
              eq(
                financeAccountsTable.id,
                financeTransactionLinesTable.accountId,
              ),
            )
            .where(
              and(
                inArray(
                  financeTransactionLinesTable.transactionId,
                  financeIds,
                ),
                eq(
                  financeAccountsTable.linkedEntityType,
                  "delivery_company_receivable",
                ),
                eq(
                  financeAccountsTable.linkedEntityId,
                  companyId,
                ),
              ),
            )
            .for("update");

        const amountByOrderId =
          new Map<number, number>();

        let receivableAccountId:
          | number
          | null = null;

        for (
          const line of receivableLines
        ) {
          const orderId =
            sourceByFinanceId.get(
              line.transactionId,
            );

          if (!orderId) continue;

          const amount =
            line.debitMinor -
            line.creditMinor;

          amountByOrderId.set(
            orderId,
            (amountByOrderId.get(
              orderId,
            ) ?? 0) + amount,
          );

          receivableAccountId =
            line.accountId;
        }

        for (const orderId of orderIds) {
          const amount =
            amountByOrderId.get(
              orderId,
            ) ?? 0;

          if (amount <= 0) {
            throw new DeliverySettlementError(
              `الطلب #${orderId} لا يحتوي مبلغًا مستحقًا على شركة التوصيل`,
              409,
            );
          }
        }

        if (
          receivableAccountId === null
        ) {
          throw new DeliverySettlementError(
            "حساب ذمم شركة التوصيل غير موجود",
            409,
          );
        }

        const totalMinor =
          orderIds.reduce(
            (sum, orderId) =>
              sum +
              (amountByOrderId.get(
                orderId,
              ) ?? 0),
            0,
          );

        if (
          !Number.isSafeInteger(
            totalMinor,
          ) ||
          totalMinor <= 0
        ) {
          throw new DeliverySettlementError(
            "إجمالي التسوية غير صالح",
            409,
          );
        }

        let cashSession:
          | typeof cashSessionsTable.$inferSelect
          | null = null;

        let expectedCashAfter:
          | number
          | null = null;

        if (receiptMethod === "cash") {
          const sessionRows = await tx
            .select()
            .from(cashSessionsTable)
            .where(
              and(
                eq(
                  cashSessionsTable.registerKey,
                  "main",
                ),
                eq(
                  cashSessionsTable.status,
                  "open",
                ),
              ),
            )
            .for("update");

          cashSession =
            sessionRows[0] ?? null;

          if (!cashSession) {
            throw new DeliverySettlementError(
              "يجب فتح يوم الصندوق قبل تسجيل تحصيل نقدي من شركة التوصيل",
              409,
            );
          }

          if (
            cashSession.businessDate !==
            businessDate
          ) {
            throw new DeliverySettlementError(
              "جلسة الصندوق المفتوحة تخص يومًا مختلفًا",
              409,
            );
          }

          const expectedBefore =
            cashSession.expectedBalanceMinor ??
            cashSession.openingBalanceMinor;

          expectedCashAfter =
            expectedBefore +
            totalMinor;

          if (
            !Number.isSafeInteger(
              expectedCashAfter,
            )
          ) {
            throw new DeliverySettlementError(
              "رصيد الصندوق بعد التحصيل غير صالح",
              409,
            );
          }
        }

        const ensureAccount =
          async (input: {
            code: string;
            name: string;
            accountType:
              | "asset"
              | "liability"
              | "income"
              | "expense"
              | "equity";
          }) => {
            const existing =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  eq(
                    financeAccountsTable.code,
                    input.code,
                  ),
                )
                .limit(1);

            if (existing[0]) {
              return existing[0];
            }

            const inserted =
              await tx
                .insert(
                  financeAccountsTable,
                )
                .values({
                  code: input.code,
                  name: input.name,
                  accountType:
                    input.accountType,
                  linkedEntityType: null,
                  linkedEntityId: null,
                  currencyCode: "ILS",
                  status: "active",
                })
                .onConflictDoNothing()
                .returning();

            if (inserted[0]) {
              return inserted[0];
            }

            const retry =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  eq(
                    financeAccountsTable.code,
                    input.code,
                  ),
                )
                .limit(1);

            if (!retry[0]) {
              throw new Error(
                "DELIVERY_SETTLEMENT_ACCOUNT_CREATE_FAILED",
              );
            }

            return retry[0];
          };

        const destinationAccount =
          receiptMethod === "cash"
            ? await ensureAccount({
                code: "CASH_MAIN",
                name: "الصندوق الرئيسي",
                accountType: "asset",
              })
            : await ensureAccount({
                code: "BANK_TRANSFER",
                name:
                  "البنك / التحويلات البنكية",
                accountType: "asset",
              });

        const settlementPublicId =
          `DCS-${businessDate.replaceAll("-", "")}-` +
          randomUUID()
            .slice(0, 8)
            .toUpperCase();

        const settlementRows =
          await tx
            .insert(
              deliveryCompanySettlementsTable,
            )
            .values({
              publicId:
                settlementPublicId,
              deliveryCompanyId:
                companyId,
              businessDate,
              receiptMethod,
              totalMinor,
              cashSessionId:
                cashSession?.id ?? null,
              financeTransactionId:
                null,
              status: "posted",
              notes,
              createdByUserId:
                auth.user.id,
            })
            .returning();

        const settlement =
          settlementRows[0];

        if (!settlement) {
          throw new Error(
            "DELIVERY_SETTLEMENT_INSERT_FAILED",
          );
        }

        const financeTransactionRows =
          await tx
            .insert(
              financeTransactionsTable,
            )
            .values({
              publicId:
                `FIN-${businessDate.replaceAll("-", "")}-` +
                randomUUID()
                  .slice(0, 8)
                  .toUpperCase(),
              idempotencyKey:
                `delivery-settlement:${settlement.id}:posted`,
              businessDate,
              transactionType:
                "receipt",
              sourceType:
                "delivery_company_settlement",
              sourceId:
                String(settlement.id),
              sourceEvent: "posted",
              cashSessionId:
                cashSession?.id ?? null,
              status: "posted",
              notes:
                `تحصيل مجمع من ${company.name} - ` +
                `${orderIds.length} طلب`,
              createdByUserId:
                auth.user.id,
            })
            .returning();

        const financeTransaction =
          financeTransactionRows[0];

        if (!financeTransaction) {
          throw new Error(
            "DELIVERY_SETTLEMENT_FINANCE_INSERT_FAILED",
          );
        }

        await tx
          .insert(
            financeTransactionLinesTable,
          )
          .values([
            {
              transactionId:
                financeTransaction.id,
              lineNumber: 1,
              accountId:
                destinationAccount.id,
              debitMinor: totalMinor,
              creditMinor: 0,
              memo:
                receiptMethod === "cash"
                  ? `تحصيل نقدي مجمع من ${company.name}`
                  : `تحصيل بنكي مجمع من ${company.name}`,
            },
            {
              transactionId:
                financeTransaction.id,
              lineNumber: 2,
              accountId:
                receivableAccountId,
              debitMinor: 0,
              creditMinor: totalMinor,
              memo:
                `تسوية ذمم ${company.name} ` +
                `لـ ${orderIds.length} طلب`,
            },
          ]);

        await tx
          .insert(
            deliveryCompanySettlementItemsTable,
          )
          .values(
            orderIds.map((orderId) => ({
              settlementId:
                settlement.id,
              orderId,
              amountMinor:
                amountByOrderId.get(
                  orderId,
                )!,
              status: "posted",
            })),
          );

        const linkedSettlementRows =
          await tx
            .update(
              deliveryCompanySettlementsTable,
            )
            .set({
              financeTransactionId:
                financeTransaction.id,
              updatedAt: new Date(),
            })
            .where(
              eq(
                deliveryCompanySettlementsTable.id,
                settlement.id,
              ),
            )
            .returning();

        if (!linkedSettlementRows[0]) {
          throw new Error(
            "DELIVERY_SETTLEMENT_LINK_FAILED",
          );
        }

        if (
          cashSession &&
          expectedCashAfter !== null
        ) {
          const cashRows = await tx
            .update(cashSessionsTable)
            .set({
              expectedBalanceMinor:
                expectedCashAfter,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  cashSessionsTable.id,
                  cashSession.id,
                ),
                eq(
                  cashSessionsTable.status,
                  "open",
                ),
              ),
            )
            .returning({
              id: cashSessionsTable.id,
            });

          if (!cashRows[0]) {
            throw new DeliverySettlementError(
              "تم إغلاق الصندوق قبل إتمام التحصيل",
              409,
            );
          }
        }

        return {
          settlement:
            linkedSettlementRows[0],
          financeTransaction,
          orderIds,
          totalMinor,
          total: totalMinor / 100,
        };
      },
    );

    return json(result, 201);
  } catch (error) {
    if (
      error instanceof
      DeliverySettlementError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (
      pgError.code === "23505" &&
      pgError.constraint ===
        "delivery_company_settlement_items_active_order_idx"
    ) {
      return json(
        {
          error:
            "أحد الطلبات المحددة تمت تسويته مسبقًا",
        },
        409,
      );
    }

    console.error(
      "DELIVERY_SETTLEMENT_CREATE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر تسجيل تسوية شركة التوصيل",
      },
      500,
    );
  }
}


async function handleReverseSettlement(
  request: Request,
  db: Db,
  env: Env,
  companyId: number,
  settlementId: number,
) {
  const auth = await requireAdmin(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request
    .json()
    .catch(() => null) as
    | Record<string, unknown>
    | null;

  const reason =
    typeof body?.reason === "string"
      ? body.reason.trim().slice(0, 1000)
      : "";

  if (!reason) {
    return json(
      { error: "أدخل سبب عكس التسوية" },
      400,
    );
  }

  try {
    const result = await db.transaction(
      async (tx) => {
        const settlementRows = await tx
          .select()
          .from(
            deliveryCompanySettlementsTable,
          )
          .where(
            and(
              eq(
                deliveryCompanySettlementsTable.id,
                settlementId,
              ),
              eq(
                deliveryCompanySettlementsTable.deliveryCompanyId,
                companyId,
              ),
            ),
          )
          .for("update");

        const settlement =
          settlementRows[0];

        if (!settlement) {
          throw new DeliverySettlementError(
            "التسوية غير موجودة",
            404,
          );
        }

        if (settlement.status !== "posted") {
          throw new DeliverySettlementError(
            "هذه التسوية معكوسة مسبقًا",
            409,
          );
        }

        if (
          !settlement.financeTransactionId
        ) {
          throw new DeliverySettlementError(
            "التسوية لا تحتوي حركة مالية مرتبطة",
            409,
          );
        }

        const companyRows = await tx
          .select()
          .from(deliveryCompaniesTable)
          .where(
            eq(
              deliveryCompaniesTable.id,
              companyId,
            ),
          )
          .limit(1);

        const company =
          companyRows[0];

        if (!company) {
          throw new DeliverySettlementError(
            "شركة التوصيل غير موجودة",
            404,
          );
        }

        const originalFinanceRows =
          await tx
            .select()
            .from(
              financeTransactionsTable,
            )
            .where(
              eq(
                financeTransactionsTable.id,
                settlement.financeTransactionId,
              ),
            )
            .for("update");

        const originalFinance =
          originalFinanceRows[0];

        if (!originalFinance) {
          throw new DeliverySettlementError(
            "الحركة المالية الأصلية غير موجودة",
            409,
          );
        }

        if (
          originalFinance.status !==
          "posted"
        ) {
          throw new DeliverySettlementError(
            "الحركة المالية الأصلية معكوسة مسبقًا",
            409,
          );
        }

        if (
          originalFinance.sourceType !==
            "delivery_company_settlement" ||
          originalFinance.sourceId !==
            String(settlement.id) ||
          originalFinance.sourceEvent !==
            "posted"
        ) {
          throw new DeliverySettlementError(
            "الحركة المالية لا تطابق التسوية",
            409,
          );
        }

        const originalLines =
          await tx
            .select()
            .from(
              financeTransactionLinesTable,
            )
            .where(
              eq(
                financeTransactionLinesTable.transactionId,
                originalFinance.id,
              ),
            )
            .orderBy(
              asc(
                financeTransactionLinesTable.lineNumber,
              ),
            )
            .for("update");

        if (
          originalLines.length === 0
        ) {
          throw new DeliverySettlementError(
            "الحركة المالية الأصلية لا تحتوي بنودًا",
            409,
          );
        }

        const itemRows = await tx
          .select()
          .from(
            deliveryCompanySettlementItemsTable,
          )
          .where(
            and(
              eq(
                deliveryCompanySettlementItemsTable.settlementId,
                settlement.id,
              ),
              eq(
                deliveryCompanySettlementItemsTable.status,
                "posted",
              ),
            ),
          )
          .for("update");

        if (itemRows.length === 0) {
          throw new DeliverySettlementError(
            "لا توجد طلبات فعالة داخل هذه التسوية",
            409,
          );
        }

        let cashSession:
          | typeof cashSessionsTable.$inferSelect
          | null = null;

        let expectedCashAfter:
          | number
          | null = null;

        if (
          settlement.receiptMethod ===
          "cash"
        ) {
          if (!settlement.cashSessionId) {
            throw new DeliverySettlementError(
              "لا يمكن عكس التسوية النقدية لعدم وجود جلسة صندوق مرتبطة",
              409,
            );
          }

          const cashRows = await tx
            .select()
            .from(cashSessionsTable)
            .where(
              and(
                eq(
                  cashSessionsTable.id,
                  settlement.cashSessionId,
                ),
                eq(
                  cashSessionsTable.status,
                  "open",
                ),
              ),
            )
            .for("update");

          cashSession =
            cashRows[0] ?? null;

          if (!cashSession) {
            throw new DeliverySettlementError(
              "لا يمكن عكس تسوية نقدية بعد إغلاق جلسة الصندوق التي سُجلت عليها",
              409,
            );
          }

          const expectedBefore =
            cashSession.expectedBalanceMinor ??
            cashSession.openingBalanceMinor;

          expectedCashAfter =
            expectedBefore -
            settlement.totalMinor;

          if (
            !Number.isSafeInteger(
              expectedCashAfter,
            )
          ) {
            throw new DeliverySettlementError(
              "رصيد الصندوق بعد عكس التسوية غير صالح",
              409,
            );
          }
        }

        const reversalRows = await tx
          .insert(
            financeTransactionsTable,
          )
          .values({
            publicId:
              `FIN-${settlement.businessDate.replaceAll("-", "")}-` +
              randomUUID()
                .slice(0, 8)
                .toUpperCase(),

            idempotencyKey:
              `delivery-settlement:${settlement.id}:reversed`,

            businessDate:
              settlement.businessDate,

            transactionType:
              "reversal",

            sourceType:
              "delivery_company_settlement",

            sourceId:
              String(settlement.id),

            sourceEvent:
              "reversed",

            cashSessionId:
              cashSession?.id ??
              originalFinance.cashSessionId ??
              null,

            status: "posted",

            notes:
              `عكس تسوية ${settlement.publicId} - ${company.name}: ${reason}`,

            createdByUserId:
              auth.user.id,
          })
          .returning();

        const reversal =
          reversalRows[0];

        if (!reversal) {
          throw new Error(
            "DELIVERY_SETTLEMENT_REVERSAL_INSERT_FAILED",
          );
        }

        await tx
          .insert(
            financeTransactionLinesTable,
          )
          .values(
            originalLines.map(
              (line, index) => ({
                transactionId:
                  reversal.id,
                lineNumber:
                  index + 1,
                accountId:
                  line.accountId,
                debitMinor:
                  line.creditMinor,
                creditMinor:
                  line.debitMinor,
                memo:
                  `عكس: ${
                    line.memo ??
                    settlement.publicId
                  }`,
              }),
            ),
          );

        const originalFinanceUpdate =
          await tx
            .update(
              financeTransactionsTable,
            )
            .set({
              status: "reversed",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  financeTransactionsTable.id,
                  originalFinance.id,
                ),
                eq(
                  financeTransactionsTable.status,
                  "posted",
                ),
              ),
            )
            .returning({
              id:
                financeTransactionsTable.id,
            });

        if (
          !originalFinanceUpdate[0]
        ) {
          throw new DeliverySettlementError(
            "تم تغيير الحركة المالية قبل إتمام العكس",
            409,
          );
        }

        const reversedItemRows =
          await tx
            .update(
              deliveryCompanySettlementItemsTable,
            )
            .set({
              status: "reversed",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  deliveryCompanySettlementItemsTable.settlementId,
                  settlement.id,
                ),
                eq(
                  deliveryCompanySettlementItemsTable.status,
                  "posted",
                ),
              ),
            )
            .returning({
              orderId:
                deliveryCompanySettlementItemsTable.orderId,
            });

        if (
          reversedItemRows.length !==
          itemRows.length
        ) {
          throw new DeliverySettlementError(
            "تم تغيير بنود التسوية قبل إتمام العكس",
            409,
          );
        }

        const reversedSettlementRows =
          await tx
            .update(
              deliveryCompanySettlementsTable,
            )
            .set({
              status: "reversed",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  deliveryCompanySettlementsTable.id,
                  settlement.id,
                ),
                eq(
                  deliveryCompanySettlementsTable.status,
                  "posted",
                ),
              ),
            )
            .returning();

        if (
          !reversedSettlementRows[0]
        ) {
          throw new DeliverySettlementError(
            "تم تغيير التسوية قبل إتمام العكس",
            409,
          );
        }

        if (
          cashSession &&
          expectedCashAfter !== null
        ) {
          const cashRows = await tx
            .update(
              cashSessionsTable,
            )
            .set({
              expectedBalanceMinor:
                expectedCashAfter,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  cashSessionsTable.id,
                  cashSession.id,
                ),
                eq(
                  cashSessionsTable.status,
                  "open",
                ),
              ),
            )
            .returning({
              id:
                cashSessionsTable.id,
            });

          if (!cashRows[0]) {
            throw new DeliverySettlementError(
              "تم إغلاق الصندوق قبل إتمام عكس التسوية",
              409,
            );
          }
        }

        return {
          settlement:
            reversedSettlementRows[0],

          reversalTransaction:
            reversal,

          orderIds:
            reversedItemRows.map(
              (item) => item.orderId,
            ),

          totalMinor:
            settlement.totalMinor,

          total:
            settlement.totalMinor /
            100,
        };
      },
    );

    return json(result);
  } catch (error) {
    if (
      error instanceof
      DeliverySettlementError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (pgError.code === "23505") {
      return json(
        {
          error:
            "تم عكس هذه التسوية مسبقًا أو توجد عملية عكس قيد التنفيذ",
        },
        409,
      );
    }

    console.error(
      "DELIVERY_SETTLEMENT_REVERSE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر عكس تسوية شركة التوصيل",
      },
      500,
    );
  }
}

export async function handleDeliverySettlementRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(request.url).pathname;

  const summaryMatch = path.match(
    /^\/api\/delivery-companies\/(\d+)\/settlement-summary$/,
  );

  if (
    request.method === "GET" &&
    summaryMatch
  ) {
    return handleSummary(
      request,
      db,
      env,
      Number(summaryMatch[1]),
    );
  }

  const reverseMatch = path.match(
    /^\/api\/delivery-companies\/(\d+)\/settlements\/(\d+)\/reverse$/,
  );

  if (
    request.method === "POST" &&
    reverseMatch
  ) {
    return handleReverseSettlement(
      request,
      db,
      env,
      Number(reverseMatch[1]),
      Number(reverseMatch[2]),
    );
  }

  const createMatch = path.match(
    /^\/api\/delivery-companies\/(\d+)\/settlements$/,
  );

  if (
    request.method === "POST" &&
    createMatch
  ) {
    return handleCreateSettlement(
      request,
      db,
      env,
      Number(createMatch[1]),
    );
  }

  return null;
}
