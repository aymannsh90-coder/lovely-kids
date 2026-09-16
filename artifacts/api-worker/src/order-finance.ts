import {
  cashSessionsTable,
  deliveryCompaniesTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { openDb } from "./db";
import { STORE_PICKUP_LABEL } from "./order-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export type OrderFulfillmentSnapshot = {
  fulfillmentMethod: "delivery" | "pickup";
  deliveryCompanyId: number | null;
  deliveryCompanyCost: number | null;
};

export class OrderFinanceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function getOrderBusinessDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toMinor(
  value: number | null | undefined,
  field: string,
): number {
  const amount = value ?? 0;

  if (
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new OrderFinanceError(
      `${field} غير صالح`,
      409,
    );
  }

  const minor = amount * 100;

  if (!Number.isSafeInteger(minor)) {
    throw new OrderFinanceError(
      `${field} أكبر من الحد المسموح`,
      409,
    );
  }

  return minor;
}

export async function completeOrderWithFinance(
  db: Db,
  orderId: number,
  userId: number,
  fulfillmentUpdate: OrderFulfillmentSnapshot | null,
) {
  return db.transaction(async (tx) => {
    const orderRows = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update");

    const order = orderRows[0];

    if (!order) {
      throw new OrderFinanceError(
        "الطلب غير موجود",
        404,
      );
    }

    // إعادة نفس الطلب لا تنشئ قيداً آخر.
    if (order.status === "done") {
      return order;
    }

    if (order.status !== "delivering") {
      throw new OrderFinanceError(
        "يجب أن يكون الطلب قيد التوصيل قبل تسجيله كمُسلّم",
        409,
      );
    }

    let fulfillmentMethod =
      fulfillmentUpdate?.fulfillmentMethod ??
      order.fulfillmentMethod;

    let deliveryCompanyId =
      fulfillmentUpdate?.deliveryCompanyId ??
      order.deliveryCompanyId;

    let deliveryCompanyCost =
      fulfillmentUpdate?.deliveryCompanyCost ??
      order.deliveryCompanyCost;

    const isPickup =
      order.shippingZone === STORE_PICKUP_LABEL ||
      fulfillmentMethod === "pickup";

    if (isPickup) {
      fulfillmentMethod = "pickup";
      deliveryCompanyId = null;
      deliveryCompanyCost = 0;
    } else {
      fulfillmentMethod = "delivery";

      if (
        deliveryCompanyId === null ||
        deliveryCompanyCost === null
      ) {
        throw new OrderFinanceError(
          "بيانات شركة التوصيل غير مكتملة",
          409,
        );
      }
    }

    const totalMinor = toMinor(
      order.totalPrice,
      "إجمالي الطلب",
    );

    const shippingMinor = toMinor(
      order.shippingCost,
      "رسوم التوصيل على الزبون",
    );

    const deliveryCostMinor = isPickup
      ? 0
      : toMinor(
          deliveryCompanyCost,
          "تكلفة شركة التوصيل",
        );

    if (shippingMinor > totalMinor) {
      throw new OrderFinanceError(
        "رسوم التوصيل أكبر من إجمالي الطلب",
        409,
      );
    }

    const productSalesMinor =
      totalMinor - shippingMinor;

    if (
      order.paymentMethod !== "cod" &&
      order.paymentMethod !== "bank_transfer"
    ) {
      throw new OrderFinanceError(
        "طريقة دفع الطلب غير مدعومة محاسبيًا",
        409,
      );
    }

    if (
      order.paymentMethod === "bank_transfer" &&
      order.paymentStatus !== "confirmed"
    ) {
      throw new OrderFinanceError(
        "يجب تأكيد التحويل البنكي قبل تسجيل الطلب كمُسلّم",
        409,
      );
    }

    const businessDate = getOrderBusinessDate();

    let cashSession:
      | typeof cashSessionsTable.$inferSelect
      | null = null;

    let expectedCashAfter: number | null = null;

    // الاستلام من المحل + الدفع عند الاستلام = نقد داخل الصندوق.
    if (
      isPickup &&
      order.paymentMethod === "cod" &&
      totalMinor > 0
    ) {
      const sessionRows = await tx
        .select()
        .from(cashSessionsTable)
        .where(
          and(
            eq(cashSessionsTable.registerKey, "main"),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .for("update");

      cashSession = sessionRows[0] ?? null;

      if (!cashSession) {
        throw new OrderFinanceError(
          "يجب فتح يوم الصندوق قبل تسجيل استلام نقدي من المحل",
          409,
        );
      }

      if (cashSession.businessDate !== businessDate) {
        throw new OrderFinanceError(
          "جلسة الصندوق المفتوحة تخص يومًا مختلفًا. أغلقها وافتح يوم الصندوق الحالي",
          409,
        );
      }

      const expectedBefore =
        cashSession.expectedBalanceMinor ??
        cashSession.openingBalanceMinor;

      expectedCashAfter =
        expectedBefore + totalMinor;

      if (!Number.isSafeInteger(expectedCashAfter)) {
        throw new OrderFinanceError(
          "رصيد الصندوق بعد استلام الطلب غير صالح",
          409,
        );
      }
    }

    const ensureAccount = async (input: {
      code: string;
      name: string;
      accountType:
        | "asset"
        | "liability"
        | "income"
        | "expense"
        | "equity";
      linkedEntityType?: string;
      linkedEntityId?: number;
    }) => {
      if (
        input.linkedEntityType &&
        input.linkedEntityId !== undefined
      ) {
        const linkedRows = await tx
          .select()
          .from(financeAccountsTable)
          .where(
            and(
              eq(
                financeAccountsTable.linkedEntityType,
                input.linkedEntityType,
              ),
              eq(
                financeAccountsTable.linkedEntityId,
                input.linkedEntityId,
              ),
            ),
          )
          .limit(1);

        if (linkedRows[0]) {
          return linkedRows[0];
        }
      }

      const existingRows = await tx
        .select()
        .from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, input.code))
        .limit(1);

      if (existingRows[0]) {
        return existingRows[0];
      }

      const insertedRows = await tx
        .insert(financeAccountsTable)
        .values({
          code: input.code,
          name: input.name,
          accountType: input.accountType,
          linkedEntityType:
            input.linkedEntityType ?? null,
          linkedEntityId:
            input.linkedEntityId ?? null,
          currencyCode: "ILS",
          status: "active",
        })
        .onConflictDoNothing()
        .returning();

      if (insertedRows[0]) {
        return insertedRows[0];
      }

      const retryRows = await tx
        .select()
        .from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, input.code))
        .limit(1);

      if (!retryRows[0]) {
        throw new Error(
          "ORDER_FINANCE_ACCOUNT_CREATE_FAILED",
        );
      }

      return retryRows[0];
    };

    const financeLines: Array<{
      accountId: number;
      debitMinor: number;
      creditMinor: number;
      memo: string;
    }> = [];

    const productSalesAccount =
      productSalesMinor > 0
        ? await ensureAccount({
            code: "PRODUCT_SALES",
            name: "مبيعات المنتجات",
            accountType: "income",
          })
        : null;

    const shippingIncomeAccount =
      shippingMinor > 0
        ? await ensureAccount({
            code: "SHIPPING_INCOME",
            name: "إيراد التوصيل من الزبائن",
            accountType: "income",
          })
        : null;

    const deliveryExpenseAccount =
      deliveryCostMinor > 0
        ? await ensureAccount({
            code: "DELIVERY_EXPENSE",
            name: "مصروف شركات التوصيل",
            accountType: "expense",
          })
        : null;

    const bankAccount =
      order.paymentMethod === "bank_transfer" &&
      totalMinor > 0
        ? await ensureAccount({
            code: "BANK_TRANSFER",
            name: "البنك / التحويلات البنكية",
            accountType: "asset",
          })
        : null;

    const cashAccount =
      isPickup &&
      order.paymentMethod === "cod" &&
      totalMinor > 0
        ? await ensureAccount({
            code: "CASH_MAIN",
            name: "الصندوق الرئيسي",
            accountType: "asset",
          })
        : null;

    let deliveryCompany:
      | { id: number; name: string }
      | null = null;

    let deliveryCompanyName = "";

    if (
      !isPickup &&
      deliveryCompanyId !== null
    ) {
      const companyRows = await tx
        .select({
          id: deliveryCompaniesTable.id,
          name: deliveryCompaniesTable.name,
        })
        .from(deliveryCompaniesTable)
        .where(
          eq(
            deliveryCompaniesTable.id,
            deliveryCompanyId,
          ),
        )
        .limit(1);

      const company = companyRows[0];

      if (!company) {
        throw new OrderFinanceError(
          "شركة التوصيل المرتبطة بالطلب غير موجودة",
          409,
        );
      }

      deliveryCompanyName = company.name;
      deliveryCompany = company;
    }

    // الطرف المدين حسب طريقة التحصيل.
    if (isPickup) {
      if (
        order.paymentMethod === "cod" &&
        cashAccount &&
        totalMinor > 0
      ) {
        financeLines.push({
          accountId: cashAccount.id,
          debitMinor: totalMinor,
          creditMinor: 0,
          memo: `تحصيل نقدي للطلب #${order.id}`,
        });
      }

      if (
        order.paymentMethod === "bank_transfer" &&
        bankAccount &&
        totalMinor > 0
      ) {
        financeLines.push({
          accountId: bankAccount.id,
          debitMinor: totalMinor,
          creditMinor: 0,
          memo: `تحويل بنكي للطلب #${order.id}`,
        });
      }
    } else {
      if (!deliveryCompany) {
        throw new OrderFinanceError(
          "تعذر تحديد شركة التوصيل",
          409,
        );
      }

      if (order.paymentMethod === "cod") {
        // شركة التوصيل تجمع كامل المبلغ من الزبون،
        // تخصم أجرتها، والباقي يصبح مستحقاً لنا عليها.
        const netCompanyMinor =
          totalMinor - deliveryCostMinor;

        if (netCompanyMinor > 0) {
          const receivableAccount =
            await ensureAccount({
              code:
                `DELIVERY_COMPANY_AR_${deliveryCompany.id}`,
              name:
                `ذمم مدينة - شركة التوصيل: ${deliveryCompany.name}`,
              accountType: "asset",
              linkedEntityType:
                "delivery_company_receivable",
              linkedEntityId: deliveryCompany.id,
            });

          financeLines.push({
            accountId: receivableAccount.id,
            debitMinor: netCompanyMinor,
            creditMinor: 0,
            memo:
              `صافي مستحق على ${deliveryCompanyName} ` +
              `للطلب #${order.id}`,
          });
        } else if (netCompanyMinor < 0) {
          // إذا أجرة الشركة أكبر من قيمة الطلب
          // يصبح الفرق ذمة دائنة للشركة علينا.
          const payableAccount =
            await ensureAccount({
              code:
                `DELIVERY_COMPANY_AP_${deliveryCompany.id}`,
              name:
                `ذمم دائنة - شركة التوصيل: ${deliveryCompany.name}`,
              accountType: "liability",
              linkedEntityType:
                "delivery_company_payable",
              linkedEntityId: deliveryCompany.id,
            });

          financeLines.push({
            accountId: payableAccount.id,
            debitMinor: 0,
            creditMinor: -netCompanyMinor,
            memo:
              `صافي مستحق لـ ${deliveryCompanyName} ` +
              `للطلب #${order.id}`,
          });
        }
      } else {
        // التحويل البنكي يصل مباشرة للمحل.
        if (
          bankAccount &&
          totalMinor > 0
        ) {
          financeLines.push({
            accountId: bankAccount.id,
            debitMinor: totalMinor,
            creditMinor: 0,
            memo: `تحويل بنكي للطلب #${order.id}`,
          });
        }

        // أجرة التوصيل في هذه الحالة ذمة دائنة للشركة علينا.
        if (deliveryCostMinor > 0) {
          const payableAccount =
            await ensureAccount({
              code:
                `DELIVERY_COMPANY_AP_${deliveryCompany.id}`,
              name:
                `ذمم دائنة - شركة التوصيل: ${deliveryCompany.name}`,
              accountType: "liability",
              linkedEntityType:
                "delivery_company_payable",
              linkedEntityId: deliveryCompany.id,
            });

          financeLines.push({
            accountId: payableAccount.id,
            debitMinor: 0,
            creditMinor: deliveryCostMinor,
            memo:
              `أجرة مستحقة لـ ${deliveryCompanyName} ` +
              `للطلب #${order.id}`,
          });
        }
      }

      if (
        deliveryExpenseAccount &&
        deliveryCostMinor > 0
      ) {
        financeLines.push({
          accountId: deliveryExpenseAccount.id,
          debitMinor: deliveryCostMinor,
          creditMinor: 0,
          memo: `تكلفة توصيل الطلب #${order.id}`,
        });
      }
    }

    if (
      productSalesAccount &&
      productSalesMinor > 0
    ) {
      financeLines.push({
        accountId: productSalesAccount.id,
        debitMinor: 0,
        creditMinor: productSalesMinor,
        memo: `مبيعات منتجات الطلب #${order.id}`,
      });
    }

    if (
      shippingIncomeAccount &&
      shippingMinor > 0
    ) {
      financeLines.push({
        accountId: shippingIncomeAccount.id,
        debitMinor: 0,
        creditMinor: shippingMinor,
        memo: `رسوم توصيل الزبون للطلب #${order.id}`,
      });
    }

    if (financeLines.length > 0) {
      const debitTotal = financeLines.reduce(
        (sum, line) =>
          sum + line.debitMinor,
        0,
      );

      const creditTotal = financeLines.reduce(
        (sum, line) =>
          sum + line.creditMinor,
        0,
      );

      if (debitTotal !== creditTotal) {
        throw new Error(
          `ORDER_FINANCE_NOT_BALANCED:${debitTotal}:${creditTotal}`,
        );
      }

      const financeRows = await tx
        .insert(financeTransactionsTable)
        .values({
          publicId:
            `FIN-${businessDate.replaceAll("-", "")}-` +
            randomUUID().slice(0, 8).toUpperCase(),
          idempotencyKey: `order:${order.id}:done`,
          businessDate,
          transactionType: "sale",
          sourceType: "web_order",
          sourceId: String(order.id),
          sourceEvent: "done",
          cashSessionId: cashSession?.id ?? null,
          status: "posted",
          notes: `تسليم طلب المتجر #${order.id}`,
          createdByUserId: userId,
        })
        .returning();

      const financeTransaction = financeRows[0];

      if (!financeTransaction) {
        throw new Error(
          "ORDER_FINANCE_INSERT_FAILED",
        );
      }

      await tx
        .insert(financeTransactionLinesTable)
        .values(
          financeLines.map((line, index) => ({
            transactionId: financeTransaction.id,
            lineNumber: index + 1,
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            memo: line.memo,
          })),
        );
    }

    if (
      cashSession &&
      expectedCashAfter !== null
    ) {
      const updatedSessionRows = await tx
        .update(cashSessionsTable)
        .set({
          expectedBalanceMinor: expectedCashAfter,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cashSessionsTable.id, cashSession.id),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .returning({
          id: cashSessionsTable.id,
        });

      if (!updatedSessionRows[0]) {
        throw new OrderFinanceError(
          "تم إغلاق الصندوق قبل إتمام استلام الطلب",
          409,
        );
      }
    }

    const updatedRows = await tx
      .update(ordersTable)
      .set({
        status: "done",
        fulfillmentMethod,
        deliveryCompanyId,
        deliveryCompanyCost,
      })
      .where(eq(ordersTable.id, order.id))
      .returning();

    const updated = updatedRows[0];

    if (!updated) {
      throw new Error(
        "ORDER_DONE_UPDATE_FAILED",
      );
    }

    return updated;
  });
}
