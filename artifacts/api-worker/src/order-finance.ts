import {
  cashSessionsTable,
  deliveryCompaniesTable,
  exchangeDocumentsTable,
  financeAccountsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { openDb } from "./db";
import { postFinanceTransaction } from "./finance-posting";
import { STORE_PICKUP_LABEL, LOCAL_NABLUS_DELIVERY_LABEL } from "./order-service";
import { getLocalCourierCashReceipt, LOCAL_COURIER_ADVANCE_ACCOUNT } from "./order-local-courier";
import {
  CARD_PROCESSOR_CONFIG,
  type PosCardProcessor,
} from "./pos-sale-routes";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export type OrderFulfillmentSnapshot = {
  fulfillmentMethod: "delivery" | "pickup";
  deliveryCompanyId: number | null;
  deliveryCompanyCost: number | null;
};

export type PickupSettlementInput =
  | {
      method: "cash";
      cardProcessor?: never;
    }
  | {
      method: "card";
      cardProcessor: PosCardProcessor;
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
  pickupSettlement: PickupSettlementInput | null = null,
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

    const pickupByOrder =
      order.shippingZone === STORE_PICKUP_LABEL ||
      order.fulfillmentMethod === "pickup";

    if (
      pickupByOrder
        ? (
            order.status !== "confirmed" &&
            order.status !== "delivering"
          )
        : order.status !== "delivering"
    ) {
      throw new OrderFinanceError(
        pickupByOrder
          ? "يجب تأكيد طلب الاستلام من المحل قبل تسجيله كمستلم"
          : "يجب أن يكون الطلب قيد التوصيل قبل تسجيله كمُسلّم",
        409,
      );
    }

    const linkedExchangeRows =
      await tx
        .select()
        .from(exchangeDocumentsTable)
        .where(
          and(
            eq(
              exchangeDocumentsTable.sourceType,
              "online_order",
            ),
            eq(
              exchangeDocumentsTable.replacementOrderId,
              order.id,
            ),
            eq(
              exchangeDocumentsTable.status,
              "completed",
            ),
          ),
        )
        .for("update");

    if (linkedExchangeRows.length > 1) {
      throw new OrderFinanceError(
        "الطلب مرتبط بأكثر من عملية تبديل فعّالة",
        409,
      );
    }

    const linkedOnlineExchange =
      linkedExchangeRows[0] ?? null;

    if (
      linkedOnlineExchange &&
      linkedOnlineExchange.financialCompletedAt !== null
    ) {
      throw new OrderFinanceError(
        "تم تسجيل محاسبة عملية التبديل مسبقًا",
        409,
      );
    }

    if (
      linkedOnlineExchange &&
      linkedOnlineExchange.returnReceivedAt !== null
    ) {
      throw new OrderFinanceError(
        "حالة استلام مرتجع التبديل غير متطابقة",
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

    const isLocalDelivery = order.shippingZone === LOCAL_NABLUS_DELIVERY_LABEL;
    const isPickup =
      order.shippingZone === STORE_PICKUP_LABEL ||
      (!isLocalDelivery && fulfillmentMethod === "pickup");

    if (isLocalDelivery && linkedOnlineExchange) {
      throw new OrderFinanceError("تبديل الطلب لا يستخدم الديلفري المحلي", 409);
    }

    if (isPickup) {
      fulfillmentMethod = "pickup";
      deliveryCompanyId = null;
      deliveryCompanyCost = 0;
    } else {
      fulfillmentMethod = "delivery";

      if (
        (!isLocalDelivery && deliveryCompanyId === null) ||
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

    // The courier pays the store for the GOODS at handover. Cash is already
    // posted to the main register and held as a customer advance until delivery.
    const localCashHandover =
      isLocalDelivery &&
      (order.paymentMethod === "cod" || order.paymentMethod === "local_store_cash")
        ? await getLocalCourierCashReceipt(tx, order.id)
        : null;

    if (
      isLocalDelivery &&
      (order.paymentMethod === "cod" || order.paymentMethod === "local_store_cash") &&
      !localCashHandover
    ) {
      throw new OrderFinanceError(
        "سجّل قبض قيمة البضاعة نقداً من مندوب ديلفري نابلس قبل إتمام التسليم",
        409,
      );
    }

    let onlineExchangeDifferenceMinor:
      number | null = null;

    let onlineExchangeSettlementAmountMinor:
      number | null = null;

    if (linkedOnlineExchange) {
      if (isPickup) {
        throw new OrderFinanceError(
          "طلب التبديل المرتبط يجب أن يكون طلب توصيل",
          409,
        );
      }

      if (order.paymentMethod !== "cod") {
        throw new OrderFinanceError(
          "طلب التبديل يجب أن يكون دفع عند الاستلام",
          409,
        );
      }

      if (
        linkedOnlineExchange.settlementType !==
        "delivery_company"
      ) {
        throw new OrderFinanceError(
          "طريقة تسوية عملية التبديل غير صالحة",
          409,
        );
      }

      if (
        linkedOnlineExchange.newNetMinor !==
        productSalesMinor
      ) {
        throw new OrderFinanceError(
          "قيمة الطلب البديل تغيّرت دون تحديث عملية التبديل",
          409,
        );
      }

      if (
        linkedOnlineExchange.deliveryChargeMinor !==
        shippingMinor
      ) {
        throw new OrderFinanceError(
          "رسوم توصيل الطلب البديل لا تطابق عملية التبديل",
          409,
        );
      }

      const returnNetMinor =
        linkedOnlineExchange.returnNetMinor;

      if (
        !Number.isSafeInteger(returnNetMinor) ||
        returnNetMinor < 0
      ) {
        throw new OrderFinanceError(
          "قيمة مرتجع عملية التبديل غير صالحة",
          409,
        );
      }

      onlineExchangeDifferenceMinor =
        productSalesMinor -
        returnNetMinor;

      onlineExchangeSettlementAmountMinor =
        onlineExchangeDifferenceMinor +
        shippingMinor;

      if (
        !Number.isSafeInteger(
          onlineExchangeDifferenceMinor,
        ) ||
        !Number.isSafeInteger(
          onlineExchangeSettlementAmountMinor,
        )
      ) {
        throw new OrderFinanceError(
          "قيمة تسوية عملية التبديل غير صالحة",
          409,
        );
      }
    }

    if (
      order.paymentMethod !== "cod" &&
      order.paymentMethod !== "bank_transfer" &&
      !(isLocalDelivery && order.paymentMethod === "local_store_cash")
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

    if (!isPickup && pickupSettlement) {
      throw new OrderFinanceError(
        "طريقة استلام الدفع من المحل متاحة فقط لطلبات الاستلام من المحل",
        409,
      );
    }

    if (
      isPickup &&
      order.paymentMethod === "cod" &&
      totalMinor > 0 &&
      !pickupSettlement
    ) {
      throw new OrderFinanceError(
        "اختر طريقة الدفع عند استلام الطلب من المحل: نقدي أو فيزا",
        409,
      );
    }

    if (
      isPickup &&
      order.paymentMethod === "bank_transfer" &&
      pickupSettlement
    ) {
      throw new OrderFinanceError(
        "هذا الطلب مسدد بتحويل بنكي ولا يحتاج طريقة دفع إضافية عند الاستلام",
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
      (isPickup &&
        order.paymentMethod === "cod" &&
        pickupSettlement?.method === "cash") &&
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

    const localCourierAdvanceAccount =
      localCashHandover && productSalesMinor > 0
        ? await ensureAccount({
            code: LOCAL_COURIER_ADVANCE_ACCOUNT,
            name: "مبالغ مندوب ديلفري نابلس المقبوضة مقدماً",
            accountType: "liability",
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
      (isPickup &&
        order.paymentMethod === "cod" &&
        pickupSettlement?.method === "cash") &&
      totalMinor > 0
        ? await ensureAccount({
            code: "CASH_MAIN",
            name: "الصندوق الرئيسي",
            accountType: "asset",
          })
        : null;

    const cardProcessor =
      isPickup &&
      order.paymentMethod === "cod" &&
      pickupSettlement?.method === "card"
        ? pickupSettlement.cardProcessor
        : null;

    const cardClearingAccount =
      cardProcessor && totalMinor > 0
        ? await ensureAccount({
            code:
              CARD_PROCESSOR_CONFIG[
                cardProcessor
              ].clearingCode,
            name:
              CARD_PROCESSOR_CONFIG[
                cardProcessor
              ].clearingName,
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

    if (linkedOnlineExchange) {
      if (
        !deliveryCompany ||
        deliveryCompanyId === null ||
        onlineExchangeDifferenceMinor === null ||
        onlineExchangeSettlementAmountMinor === null
      ) {
        throw new OrderFinanceError(
          "بيانات تسوية شركة التوصيل لعملية التبديل غير مكتملة",
          409,
        );
      }

      const netCompanyMinor =
        onlineExchangeSettlementAmountMinor -
        deliveryCostMinor;

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
            linkedEntityId:
              deliveryCompany.id,
          });

        financeLines.push({
          accountId:
            receivableAccount.id,
          debitMinor:
            netCompanyMinor,
          creditMinor:
            0,
          memo:
            `صافي تبديل مستحق على ${deliveryCompanyName} ` +
            `للطلب #${order.id}`,
        });
      } else if (netCompanyMinor < 0) {
        const payableAccount =
          await ensureAccount({
            code:
              `DELIVERY_COMPANY_AP_${deliveryCompany.id}`,
            name:
              `ذمم دائنة - شركة التوصيل: ${deliveryCompany.name}`,
            accountType:
              "liability",
            linkedEntityType:
              "delivery_company_payable",
            linkedEntityId:
              deliveryCompany.id,
          });

        financeLines.push({
          accountId:
            payableAccount.id,
          debitMinor:
            0,
          creditMinor:
            -netCompanyMinor,
          memo:
            `صافي تبديل مستحق لـ ${deliveryCompanyName} ` +
            `للطلب #${order.id}`,
        });
      }

      if (
        linkedOnlineExchange.returnNetMinor >
        0
      ) {
        const salesReturnsAccount =
          await ensureAccount({
            code:
              "SALES_RETURNS",
            name:
              "مردودات المبيعات",
            accountType:
              "income",
          });

        financeLines.push({
          accountId:
            salesReturnsAccount.id,
          debitMinor:
            linkedOnlineExchange.returnNetMinor,
          creditMinor:
            0,
          memo:
            `مرتجع عملية التبديل ${linkedOnlineExchange.publicId}`,
        });
      }

      if (
        deliveryExpenseAccount &&
        deliveryCostMinor > 0
      ) {
        financeLines.push({
          accountId:
            deliveryExpenseAccount.id,
          debitMinor:
            deliveryCostMinor,
          creditMinor:
            0,
          memo:
            `تكلفة توصيل طلب التبديل #${order.id}`,
        });
      }
    }

    // الطلبات العادية تبقى على نفس منطق التحصيل السابق.
    if (!linkedOnlineExchange) {
      // الطرف المدين حسب طريقة التحصيل.
      if (isPickup) {
        if (
          order.paymentMethod === "cod" &&
          pickupSettlement?.method === "cash" &&
          cashAccount &&
          totalMinor > 0
        ) {
          financeLines.push({
            accountId: cashAccount.id,
            debitMinor: totalMinor,
            creditMinor: 0,
            memo:
              `تحصيل نقدي لاستلام الطلب #${order.id} من المحل`,
          });
        }

        if (
          order.paymentMethod === "cod" &&
          pickupSettlement?.method === "card" &&
          cardProcessor &&
          cardClearingAccount &&
          totalMinor > 0
        ) {
          financeLines.push({
            accountId:
              cardClearingAccount.id,
            debitMinor:
              totalMinor,
            creditMinor:
              0,
            memo:
              `تحصيل ${CARD_PROCESSOR_CONFIG[cardProcessor].label} لاستلام الطلب #${order.id} من المحل`,
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
      } else if (isLocalDelivery) {
        // Courier collects goods + delivery from customer and keeps delivery fee.
        // CASH for goods was already posted at physical courier handover.
        // At delivery, clear that advance; never debit the cash register again.
        if (localCourierAdvanceAccount && productSalesMinor > 0) {
          financeLines.push({
            accountId: localCourierAdvanceAccount.id,
            debitMinor: productSalesMinor,
            creditMinor: 0,
            memo: `تسوية القبض المقدم من المندوب للطلب #${order.id}`,
          });
        } else if (order.paymentMethod === "bank_transfer" && bankAccount && totalMinor > 0) {
          financeLines.push({
            accountId: bankAccount.id,
            debitMinor: totalMinor,
            creditMinor: 0,
            memo: `تحويل بنكي لطلب ديلفري نابلس #${order.id}`,
          });
        }

        if (localCourierAdvanceAccount) {
          // Any agreed courier fee above/below the customer charge is handled
          // as a receivable/payable, not fictitious money in the cash drawer.
          const courierDifference = shippingMinor - deliveryCostMinor;
          if (courierDifference !== 0) {
            const differenceAccount = await ensureAccount({
              code: courierDifference > 0
                ? "LOCAL_NABLUS_DELIVERY_AR"
                : "LOCAL_NABLUS_DELIVERY_AP",
              name: courierDifference > 0
                ? "ذمم مدينة - مندوبي ديلفري نابلس"
                : "ذمم دائنة - مندوبي ديلفري نابلس",
              accountType: courierDifference > 0 ? "asset" : "liability",
            });
            financeLines.push({
              accountId: differenceAccount.id,
              debitMinor: courierDifference > 0 ? courierDifference : 0,
              creditMinor: courierDifference < 0 ? -courierDifference : 0,
              memo: `فرق أجرة ديلفري نابلس للطلب #${order.id}`,
            });
          }
        } else if (deliveryCostMinor > 0) {
          // Store received bank payment directly; it still owes courier fees.
          const payable = await ensureAccount({
            code: "LOCAL_NABLUS_DELIVERY_AP",
            name: "ذمم دائنة - مندوبي ديلفري نابلس",
            accountType: "liability",
          });
          financeLines.push({
            accountId: payable.id,
            debitMinor: 0,
            creditMinor: deliveryCostMinor,
            memo: `أجرة مندوب ديلفري نابلس للطلب #${order.id}`,
          });
        }

        if (deliveryExpenseAccount && deliveryCostMinor > 0) {
          financeLines.push({
            accountId: deliveryExpenseAccount.id,
            debitMinor: deliveryCostMinor,
            creditMinor: 0,
            memo: `مصروف ديلفري نابلس للطلب #${order.id}`,
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
      await postFinanceTransaction(
        tx,
        {
          publicId:
            `FIN-${businessDate.replaceAll("-", "")}-` +
            randomUUID().slice(0, 8).toUpperCase(),
          idempotencyKey:
            `order:${order.id}:done`,
          businessDate,
          transactionType: "sale",
          sourceType: "web_order",
          sourceId:
            String(order.id),
          sourceEvent: "done",
          cashSessionId:
            cashSession?.id ?? null,
          notes:
            isPickup
              ? pickupSettlement?.method === "card" &&
                cardProcessor
                ? `استلام طلب المتجر #${order.id} من المحل - ${CARD_PROCESSOR_CONFIG[cardProcessor].label}`
                : pickupSettlement?.method === "cash"
                  ? `استلام طلب المتجر #${order.id} من المحل - نقدي`
                  : `استلام طلب المتجر #${order.id} من المحل`
              : `تسليم طلب المتجر #${order.id}`,
          createdByUserId:
            userId,
          lines: financeLines,
        },
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

    if (linkedOnlineExchange) {
      if (
        deliveryCompanyId === null ||
        onlineExchangeDifferenceMinor === null ||
        onlineExchangeSettlementAmountMinor === null
      ) {
        throw new OrderFinanceError(
          "تعذر تثبيت محاسبة عملية التبديل",
          409,
        );
      }

      const completedAt =
        new Date();

      const updatedExchangeRows =
        await tx
          .update(
            exchangeDocumentsTable,
          )
          .set({
            settlementType:
              "delivery_company",

            settlementPartyId:
              deliveryCompanyId,

            newNetMinor:
              productSalesMinor,

            differenceMinor:
              onlineExchangeDifferenceMinor,

            deliveryChargeMinor:
              shippingMinor,

            deliveryCompanyCostMinor:
              deliveryCostMinor,

            settlementAmountMinor:
              onlineExchangeSettlementAmountMinor,

            financialBusinessDate:
              businessDate,

            financialCompletedAt:
              completedAt,

            financialCompletedByUserId:
              userId,

            updatedAt:
              completedAt,
          })
          .where(
            and(
              eq(
                exchangeDocumentsTable.id,
                linkedOnlineExchange.id,
              ),
              eq(
                exchangeDocumentsTable.status,
                "completed",
              ),
            ),
          )
          .returning({
            id:
              exchangeDocumentsTable.id,
          });

      if (!updatedExchangeRows[0]) {
        throw new Error(
          "ONLINE_EXCHANGE_FINANCE_UPDATE_FAILED",
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
        ...(
          ((isPickup && order.paymentMethod === "cod") ||
           (isLocalDelivery && localCashHandover !== null))
            ? {
                paymentStatus:
                  "confirmed",
              }
            : {}
        ),
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
