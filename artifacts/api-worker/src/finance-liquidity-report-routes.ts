import {
  bankAccountsTable,
  banksTable,
  cashSessionsTable,
  customersTable,
  financeAccountsTable,
  financeChecksTable,
  financeExchangeRatesTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  suppliersTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  CUSTOMER_RECEIVABLE_CONTROL_CODE,
} from "./finance-customer-ledger";
import {
  SUPPLIER_PAYABLE_CONTROL_CODE,
} from "./finance-supplier-ledger";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

const DAY_MS =
  24 * 60 * 60 * 1000;

const json = (
  data: unknown,
  status = 200,
) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

async function requireOwner(
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
            "غير مصرح",
        },
        401,
      ),
    };
  }

  if (!user.isOwner) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذا التقرير متاح للمالك فقط",
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

function currentPalestineDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function dateMs(
  value: string,
) {
  return new Date(
    `${value}T00:00:00Z`,
  ).getTime();
}

function daysBetween(
  from: string,
  to: string,
) {
  return Math.max(
    0,
    Math.floor(
      (
        dateMs(to) -
        dateMs(from)
      ) /
        DAY_MS,
    ),
  );
}

function daysUntil(
  from: string,
  to: string,
) {
  return Math.floor(
    (
      dateMs(to) -
      dateMs(from)
    ) /
      DAY_MS,
  );
}

function convertToBaseMinor(
  amountMinor: number,
  rateMicros: number,
) {
  const value =
    (
      BigInt(amountMinor) *
        BigInt(rateMicros) +
      500_000n
    ) /
    1_000_000n;

  if (
    value >
      BigInt(
        Number.MAX_SAFE_INTEGER,
      ) ||
    value <
      BigInt(
        Number.MIN_SAFE_INTEGER,
      )
  ) {
    throw new Error(
      "FINANCE_LIQUIDITY_CONVERSION_OVERFLOW",
    );
  }

  return Number(value);
}

type AgingKind =
  | "customer"
  | "supplier";

type AgingSourceMovement = {
  kind: AgingKind;
  partyId: number;
  sourceType: string;
  sourceId: string;
  businessDate: string;
  firstTransactionId: number;
  amountMinor: number;
};

type AgingLot = {
  businessDate: string;
  amountMinor: number;
};

type AgingPartyResult = {
  currentMinor: number;
  days31To60Minor: number;
  days61To90Minor: number;
  daysOver90Minor: number;
  balanceMinor: number;
  oppositeBalanceMinor: number;
};

function emptyAgingParty():
  AgingPartyResult {
  return {
    currentMinor: 0,
    days31To60Minor: 0,
    days61To90Minor: 0,
    daysOver90Minor: 0,
    balanceMinor: 0,
    oppositeBalanceMinor: 0,
  };
}

function agePartyMovements(
  movements:
    AgingSourceMovement[],
  asOf: string,
):
  AgingPartyResult {
  const lots:
    AgingLot[] = [];

  let oppositeBalanceMinor =
    0;

  const sorted =
    [...movements].sort(
      (
        left,
        right,
      ) =>
        left.businessDate.localeCompare(
          right.businessDate,
        ) ||
        left.firstTransactionId -
          right.firstTransactionId,
    );

  for (
    const movement of sorted
  ) {
    if (
      movement.amountMinor >
      0
    ) {
      let remaining =
        movement.amountMinor;

      if (
        oppositeBalanceMinor >
        0
      ) {
        const applied =
          Math.min(
            remaining,
            oppositeBalanceMinor,
          );

        remaining -=
          applied;

        oppositeBalanceMinor -=
          applied;
      }

      if (
        remaining >
        0
      ) {
        lots.push({
          businessDate:
            movement.businessDate,
          amountMinor:
            remaining,
        });
      }

      continue;
    }

    if (
      movement.amountMinor ===
      0
    ) {
      continue;
    }

    let reduction =
      -movement.amountMinor;

    while (
      reduction >
        0 &&
      lots.length >
        0
    ) {
      const lot =
        lots[0];

      const applied =
        Math.min(
          reduction,
          lot.amountMinor,
        );

      reduction -=
        applied;

      lot.amountMinor -=
        applied;

      if (
        lot.amountMinor ===
        0
      ) {
        lots.shift();
      }
    }

    if (
      reduction >
      0
    ) {
      oppositeBalanceMinor +=
        reduction;
    }
  }

  const result =
    emptyAgingParty();

  result.oppositeBalanceMinor =
    oppositeBalanceMinor;

  for (
    const lot of lots
  ) {
    const age =
      daysBetween(
        lot.businessDate,
        asOf,
      );

    result.balanceMinor +=
      lot.amountMinor;

    if (
      age <= 30
    ) {
      result.currentMinor +=
        lot.amountMinor;
    } else if (
      age <= 60
    ) {
      result.days31To60Minor +=
        lot.amountMinor;
    } else if (
      age <= 90
    ) {
      result.days61To90Minor +=
        lot.amountMinor;
    } else {
      result.daysOver90Minor +=
        lot.amountMinor;
    }
  }

  return result;
}

function dueBucket(
  daysUntilDue: number,
) {
  if (
    daysUntilDue < 0
  ) {
    return "overdue";
  }

  if (
    daysUntilDue <= 7
  ) {
    return "next_7";
  }

  if (
    daysUntilDue <= 30
  ) {
    return "next_30";
  }

  return "later";
}

async function handleLiquidityReport(
  request: Request,
  db: Db,
  env: Env,
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

  const asOf =
    currentPalestineDate();

  const [
    customers,
    suppliers,
    agingLines,
    cashAccounts,
    bankAccounts,
    ledgerBalanceRows,
    openCashSessions,
    exchangeRates,
    pendingChecks,
  ] =
    await Promise.all([
      db
        .select({
          id:
            customersTable.id,
          code:
            customersTable.code,
          name:
            customersTable.name,
          status:
            customersTable.status,
        })
        .from(
          customersTable,
        ),

      db
        .select({
          id:
            suppliersTable.id,
          code:
            suppliersTable.code,
          name:
            suppliersTable.name,
          status:
            suppliersTable.status,
        })
        .from(
          suppliersTable,
        ),

      db
        .select({
          lineId:
            financeTransactionLinesTable.id,
          lineNumber:
            financeTransactionLinesTable.lineNumber,
          transactionId:
            financeTransactionsTable.id,
          businessDate:
            financeTransactionsTable.businessDate,
          sourceType:
            financeTransactionsTable.sourceType,
          sourceId:
            financeTransactionsTable.sourceId,
          accountCode:
            financeAccountsTable.code,
          linkedEntityType:
            financeAccountsTable.linkedEntityType,
          linkedEntityId:
            financeAccountsTable.linkedEntityId,
          customerId:
            financeTransactionLinesTable.customerId,
          supplierId:
            financeTransactionLinesTable.supplierId,
          debitMinor:
            financeTransactionLinesTable.debitMinor,
          creditMinor:
            financeTransactionLinesTable.creditMinor,
        })
        .from(
          financeTransactionLinesTable,
        )
        .innerJoin(
          financeTransactionsTable,
          eq(
            financeTransactionLinesTable.transactionId,
            financeTransactionsTable.id,
          ),
        )
        .innerJoin(
          financeAccountsTable,
          eq(
            financeTransactionLinesTable.accountId,
            financeAccountsTable.id,
          ),
        )
        .where(
          and(
            lte(
              financeTransactionsTable.businessDate,
              asOf,
            ),
            or(
              eq(
                financeAccountsTable.code,
                CUSTOMER_RECEIVABLE_CONTROL_CODE,
              ),
              eq(
                financeAccountsTable.linkedEntityType,
                "customer_receivable",
              ),
              eq(
                financeAccountsTable.code,
                SUPPLIER_PAYABLE_CONTROL_CODE,
              ),
              eq(
                financeAccountsTable.linkedEntityType,
                "supplier",
              ),
            ),
          ),
        )
        .orderBy(
          asc(
            financeTransactionsTable.businessDate,
          ),
          asc(
            financeTransactionsTable.id,
          ),
          asc(
            financeTransactionLinesTable.lineNumber,
          ),
        ),

      db
        .select({
          id:
            financeAccountsTable.id,
          code:
            financeAccountsTable.code,
          name:
            financeAccountsTable.name,
          currencyCode:
            financeAccountsTable.currencyCode,
        })
        .from(
          financeAccountsTable,
        )
        .where(
          and(
            eq(
              financeAccountsTable.status,
              "active",
            ),
            eq(
              financeAccountsTable.accountType,
              "asset",
            ),
            sql`${financeAccountsTable.code} like 'CASH_%'`,
          ),
        )
        .orderBy(
          asc(
            financeAccountsTable.name,
          ),
        ),

      db
        .select({
          id:
            bankAccountsTable.id,
          name:
            bankAccountsTable.name,
          code:
            bankAccountsTable.code,
          currencyCode:
            bankAccountsTable.currencyCode,
          financeAccountId:
            bankAccountsTable.financeAccountId,
          bankName:
            banksTable.nameAr,
        })
        .from(
          bankAccountsTable,
        )
        .innerJoin(
          banksTable,
          eq(
            bankAccountsTable.bankId,
            banksTable.id,
          ),
        )
        .where(
          eq(
            bankAccountsTable.status,
            "active",
          ),
        )
        .orderBy(
          asc(
            banksTable.nameAr,
          ),
          asc(
            bankAccountsTable.name,
          ),
        ),

      db
        .select({
          accountId:
            financeTransactionLinesTable.accountId,
          baseBalanceMinor:
            sql<number>`
              coalesce(
                sum(
                  ${financeTransactionLinesTable.debitMinor}
                  -
                  ${financeTransactionLinesTable.creditMinor}
                ),
                0
              )
            `.mapWith(
              Number,
            ),
          currencyBalanceMinor:
            sql<number>`
              coalesce(
                sum(
                  case
                    when ${financeTransactionLinesTable.currencyAmountMinor} is null
                      then 0
                    when ${financeTransactionLinesTable.debitMinor} > 0
                      then ${financeTransactionLinesTable.currencyAmountMinor}
                    else -${financeTransactionLinesTable.currencyAmountMinor}
                  end
                ),
                0
              )
            `.mapWith(
              Number,
            ),
        })
        .from(
          financeTransactionLinesTable,
        )
        .groupBy(
          financeTransactionLinesTable.accountId,
        ),

      db
        .select({
          id:
            cashSessionsTable.id,
          registerKey:
            cashSessionsTable.registerKey,
          currencyCode:
            cashSessionsTable.currencyCode,
          expectedBalanceMinor:
            cashSessionsTable.expectedBalanceMinor,
          openedAt:
            cashSessionsTable.openedAt,
        })
        .from(
          cashSessionsTable,
        )
        .where(
          eq(
            cashSessionsTable.status,
            "open",
          ),
        )
        .orderBy(
          desc(
            cashSessionsTable.openedAt,
          ),
        ),

      db
        .select({
          id:
            financeExchangeRatesTable.id,
          currencyCode:
            financeExchangeRatesTable.currencyCode,
          rateDate:
            financeExchangeRatesTable.rateDate,
          ilsPerUnitMicros:
            financeExchangeRatesTable.ilsPerUnitMicros,
        })
        .from(
          financeExchangeRatesTable,
        )
        .where(
          lte(
            financeExchangeRatesTable.rateDate,
            asOf,
          ),
        )
        .orderBy(
          desc(
            financeExchangeRatesTable.rateDate,
          ),
          desc(
            financeExchangeRatesTable.id,
          ),
        ),

      db
        .select()
        .from(
          financeChecksTable,
        )
        .where(
          inArray(
            financeChecksTable.status,
            [
              "on_hand",
              "deposited",
              "issued",
            ],
          ),
        )
        .orderBy(
          asc(
            financeChecksTable.dueDate,
          ),
          asc(
            financeChecksTable.id,
          ),
        ),
    ]);

  const customerMap =
    new Map(
      customers.map(
        (customer) => [
          customer.id,
          customer,
        ],
      ),
    );

  const supplierMap =
    new Map(
      suppliers.map(
        (supplier) => [
          supplier.id,
          supplier,
        ],
      ),
    );

  const sourceMovementMap =
    new Map<
      string,
      AgingSourceMovement
    >();

  let missingCustomerPartyMinor =
    0;

  let missingSupplierPartyMinor =
    0;

  for (
    const line of agingLines
  ) {
    let kind:
      AgingKind | null =
      null;

    let partyId:
      number | null =
      null;

    let amountMinor =
      0;

    if (
      line.accountCode ===
        CUSTOMER_RECEIVABLE_CONTROL_CODE ||
      line.linkedEntityType ===
        "customer_receivable"
    ) {
      kind =
        "customer";

      partyId =
        line.accountCode ===
          CUSTOMER_RECEIVABLE_CONTROL_CODE
          ? line.customerId
          : line.linkedEntityId;

      amountMinor =
        line.debitMinor -
        line.creditMinor;

      if (
        !partyId
      ) {
        missingCustomerPartyMinor +=
          amountMinor;
        continue;
      }
    } else if (
      line.accountCode ===
        SUPPLIER_PAYABLE_CONTROL_CODE ||
      line.linkedEntityType ===
        "supplier"
    ) {
      kind =
        "supplier";

      partyId =
        line.accountCode ===
          SUPPLIER_PAYABLE_CONTROL_CODE
          ? line.supplierId
          : line.linkedEntityId;

      amountMinor =
        line.creditMinor -
        line.debitMinor;

      if (
        !partyId
      ) {
        missingSupplierPartyMinor +=
          amountMinor;
        continue;
      }
    }

    if (
      !kind ||
      !partyId
    ) {
      continue;
    }

    const key =
      [
        kind,
        partyId,
        line.sourceType,
        line.sourceId,
      ].join(":");

    const existing =
      sourceMovementMap.get(
        key,
      );

    if (existing) {
      existing.amountMinor +=
        amountMinor;

      if (
        line.businessDate <
        existing.businessDate
      ) {
        existing.businessDate =
          line.businessDate;
      }

      existing.firstTransactionId =
        Math.min(
          existing.firstTransactionId,
          line.transactionId,
        );

      continue;
    }

    sourceMovementMap.set(
      key,
      {
        kind,
        partyId,
        sourceType:
          line.sourceType,
        sourceId:
          line.sourceId,
        businessDate:
          line.businessDate,
        firstTransactionId:
          line.transactionId,
        amountMinor,
      },
    );
  }

  const customerMovements =
    new Map<
      number,
      AgingSourceMovement[]
    >();

  const supplierMovements =
    new Map<
      number,
      AgingSourceMovement[]
    >();

  for (
    const movement of
    sourceMovementMap.values()
  ) {
    if (
      movement.amountMinor ===
      0
    ) {
      continue;
    }

    const target =
      movement.kind ===
        "customer"
        ? customerMovements
        : supplierMovements;

    const rows =
      target.get(
        movement.partyId,
      ) ?? [];

    rows.push(
      movement,
    );

    target.set(
      movement.partyId,
      rows,
    );
  }

  const customerIds =
    new Set([
      ...customerMap.keys(),
      ...customerMovements.keys(),
    ]);

  const supplierIds =
    new Set([
      ...supplierMap.keys(),
      ...supplierMovements.keys(),
    ]);

  const customerAging =
    [...customerIds]
      .map(
        (customerId) => {
          const customer =
            customerMap.get(
              customerId,
            );

          const aging =
            agePartyMovements(
              customerMovements.get(
                customerId,
              ) ?? [],
              asOf,
            );

          return {
            id:
              customerId,
            code:
              customer?.code ??
              `CUSTOMER-${customerId}`,
            name:
              customer?.name ??
              `زبون #${customerId}`,
            status:
              customer?.status ??
              "unknown",
            ...aging,
          };
        },
      )
      .filter(
        (row) =>
          row.balanceMinor !==
            0 ||
          row.oppositeBalanceMinor !==
            0,
      )
      .sort(
        (
          left,
          right,
        ) =>
          right.balanceMinor -
            left.balanceMinor ||
          right.oppositeBalanceMinor -
            left.oppositeBalanceMinor ||
          left.name.localeCompare(
            right.name,
            "ar",
          ),
      );

  const supplierAging =
    [...supplierIds]
      .map(
        (supplierId) => {
          const supplier =
            supplierMap.get(
              supplierId,
            );

          const aging =
            agePartyMovements(
              supplierMovements.get(
                supplierId,
              ) ?? [],
              asOf,
            );

          return {
            id:
              supplierId,
            code:
              supplier?.code ??
              `SUPPLIER-${supplierId}`,
            name:
              supplier?.name ??
              `مورد #${supplierId}`,
            status:
              supplier?.status ??
              "unknown",
            ...aging,
          };
        },
      )
      .filter(
        (row) =>
          row.balanceMinor !==
            0 ||
          row.oppositeBalanceMinor !==
            0,
      )
      .sort(
        (
          left,
          right,
        ) =>
          right.balanceMinor -
            left.balanceMinor ||
          right.oppositeBalanceMinor -
            left.oppositeBalanceMinor ||
          left.name.localeCompare(
            right.name,
            "ar",
          ),
      );

  const sumAging =
    (
      rows:
        typeof customerAging,
    ) => {
      const totals =
        emptyAgingParty();

      for (
        const row of rows
      ) {
        totals.currentMinor +=
          row.currentMinor;

        totals.days31To60Minor +=
          row.days31To60Minor;

        totals.days61To90Minor +=
          row.days61To90Minor;

        totals.daysOver90Minor +=
          row.daysOver90Minor;

        totals.balanceMinor +=
          row.balanceMinor;

        totals.oppositeBalanceMinor +=
          row.oppositeBalanceMinor;
      }

      return totals;
    };

  const customerTotals =
    sumAging(
      customerAging,
    );

  const supplierTotals =
    sumAging(
      supplierAging,
    );

  const ledgerBalanceByAccount =
    new Map(
      ledgerBalanceRows.map(
        (row) => [
          row.accountId,
          row,
        ],
      ),
    );

  const openSessionByRegister =
    new Map<
      string,
      (
        typeof openCashSessions
      )[number]
    >();

  for (
    const session of
    openCashSessions
  ) {
    if (
      !openSessionByRegister.has(
        session.registerKey,
      )
    ) {
      openSessionByRegister.set(
        session.registerKey,
        session,
      );
    }
  }

  const latestRateByCurrency =
    new Map<
      string,
      (
        typeof exchangeRates
      )[number]
    >();

  for (
    const rate of
    exchangeRates
  ) {
    if (
      !latestRateByCurrency.has(
        rate.currencyCode,
      )
    ) {
      latestRateByCurrency.set(
        rate.currencyCode,
        rate,
      );
    }
  }

  let cashOperationalBaseMinor =
    0;

  let cashBaseComplete =
    true;

  const cash =
    cashAccounts.map(
      (account) => {
        const registerKey =
          account.code
            .slice(
              "CASH_".length,
            )
            .toLowerCase();

        const session =
          openSessionByRegister.get(
            registerKey,
          ) ?? null;

        const ledgerBalance =
          ledgerBalanceByAccount.get(
            account.id,
          );

        const bookBaseMinor =
          ledgerBalance
            ?.baseBalanceMinor ??
          0;

        const bookCurrencyMinor =
          account.currencyCode ===
            "ILS"
            ? bookBaseMinor
            : ledgerBalance
                ?.currencyBalanceMinor ??
              0;

        const operationalMinor =
          session
            ?.expectedBalanceMinor ??
          bookCurrencyMinor;

        let operationalBaseMinor:
          number | null =
          null;

        let rateMicros:
          number | null =
          null;

        if (
          account.currencyCode ===
          "ILS"
        ) {
          rateMicros =
            1_000_000;

          operationalBaseMinor =
            operationalMinor;
        } else if (
          session
        ) {
          const rate =
            latestRateByCurrency.get(
              account.currencyCode,
            );

          if (rate) {
            rateMicros =
              rate.ilsPerUnitMicros;

            operationalBaseMinor =
              convertToBaseMinor(
                operationalMinor,
                rateMicros,
              );
          }
        } else {
          operationalBaseMinor =
            bookBaseMinor;

          rateMicros =
            latestRateByCurrency.get(
              account.currencyCode,
            )
              ?.ilsPerUnitMicros ??
            null;
        }

        if (
          operationalBaseMinor ===
          null
        ) {
          cashBaseComplete =
            false;
        } else {
          cashOperationalBaseMinor +=
            operationalBaseMinor;
        }

        return {
          id:
            account.id,
          code:
            account.code,
          name:
            account.name,
          currencyCode:
            account.currencyCode,
          bookBaseMinor,
          bookCurrencyMinor,
          operationalMinor,
          operationalBaseMinor,
          rateMicros,
          balanceSource:
            session
              ? "cash_session"
              : "ledger",
          cashSessionId:
            session?.id ??
            null,
        };
      },
    );

  let bankBaseMinor =
    0;

  const banks =
    bankAccounts.map(
      (account) => {
        const balance =
          ledgerBalanceByAccount.get(
            account.financeAccountId,
          );

        const baseBalanceMinor =
          balance
            ?.baseBalanceMinor ??
          0;

        const currencyBalanceMinor =
          account.currencyCode ===
            "ILS"
            ? baseBalanceMinor
            : balance
                ?.currencyBalanceMinor ??
              0;

        bankBaseMinor +=
          baseBalanceMinor;

        return {
          id:
            account.id,
          code:
            account.code,
          name:
            account.name,
          bankName:
            account.bankName,
          currencyCode:
            account.currencyCode,
          financeAccountId:
            account.financeAccountId,
          baseBalanceMinor,
          currencyBalanceMinor,
        };
      },
    );

  const checks =
    pendingChecks
      .filter(
        (check) =>
          (
            check.direction ===
              "received" &&
            (
              check.status ===
                "on_hand" ||
              check.status ===
                "deposited"
            )
          ) ||
          (
            check.direction ===
              "issued" &&
            check.status ===
              "issued"
          ),
      )
      .map(
        (check) => {
          const daysUntilDue =
            daysUntil(
              asOf,
              check.dueDate,
            );

          const partyName =
            check.customerId
              ? customerMap.get(
                  check.customerId,
                )?.name ??
                check.drawerName ??
                `زبون #${check.customerId}`
              : check.supplierId
                ? supplierMap.get(
                    check.supplierId,
                  )?.name ??
                  check.payeeName ??
                  `مورد #${check.supplierId}`
                : check.drawerName ??
                  check.payeeName ??
                  "بدون طرف";

          return {
            id:
              check.id,
            publicId:
              check.publicId,
            checkNumber:
              check.checkNumber,
            direction:
              check.direction,
            status:
              check.status,
            dueDate:
              check.dueDate,
            daysUntilDue,
            dueBucket:
              dueBucket(
                daysUntilDue,
              ),
            currencyCode:
              check.currencyCode,
            amountMinor:
              check.amountMinor,
            baseAmountMinor:
              check.baseAmountMinor,
            partyName,
          };
        },
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.dueDate.localeCompare(
            right.dueDate,
          ) ||
          left.id -
            right.id,
      );

  const checkTotals = {
    incomingMinor: 0,
    outgoingMinor: 0,
    incomingOverdueMinor: 0,
    outgoingOverdueMinor: 0,
    incomingNext7Minor: 0,
    outgoingNext7Minor: 0,
    incomingNext30Minor: 0,
    outgoingNext30Minor: 0,
  };

  for (
    const check of checks
  ) {
    const incoming =
      check.direction ===
      "received";

    if (incoming) {
      checkTotals.incomingMinor +=
        check.baseAmountMinor;
    } else {
      checkTotals.outgoingMinor +=
        check.baseAmountMinor;
    }

    if (
      check.dueBucket ===
      "overdue"
    ) {
      if (incoming) {
        checkTotals.incomingOverdueMinor +=
          check.baseAmountMinor;
      } else {
        checkTotals.outgoingOverdueMinor +=
          check.baseAmountMinor;
      }
    } else if (
      check.dueBucket ===
      "next_7"
    ) {
      if (incoming) {
        checkTotals.incomingNext7Minor +=
          check.baseAmountMinor;
      } else {
        checkTotals.outgoingNext7Minor +=
          check.baseAmountMinor;
      }
    } else if (
      check.dueBucket ===
      "next_30"
    ) {
      if (incoming) {
        checkTotals.incomingNext30Minor +=
          check.baseAmountMinor;
      } else {
        checkTotals.outgoingNext30Minor +=
          check.baseAmountMinor;
      }
    }
  }

  const currentLiquidityMinor =
    cashOperationalBaseMinor +
    bankBaseMinor;

  const expectedCollectionsMinor =
    customerTotals.balanceMinor +
    supplierTotals.oppositeBalanceMinor +
    checkTotals.incomingMinor;

  const expectedPaymentsMinor =
    supplierTotals.balanceMinor +
    customerTotals.oppositeBalanceMinor +
    checkTotals.outgoingMinor;

  const projectedLiquidityMinor =
    currentLiquidityMinor +
    expectedCollectionsMinor -
    expectedPaymentsMinor;

  return json({
    asOf,

    summary: {
      cashOperationalBaseMinor,
      bankBaseMinor,
      currentLiquidityMinor,
      customerReceivableMinor:
        customerTotals.balanceMinor,
      customerCreditMinor:
        customerTotals.oppositeBalanceMinor,
      supplierPayableMinor:
        supplierTotals.balanceMinor,
      supplierDebitMinor:
        supplierTotals.oppositeBalanceMinor,
      incomingChecksMinor:
        checkTotals.incomingMinor,
      outgoingChecksMinor:
        checkTotals.outgoingMinor,
      expectedCollectionsMinor,
      expectedPaymentsMinor,
      projectedLiquidityMinor,
      cashBaseComplete,
    },

    customerAging: {
      totals:
        customerTotals,
      rows:
        customerAging,
    },

    supplierAging: {
      totals:
        supplierTotals,
      rows:
        supplierAging,
    },

    checks: {
      totals:
        checkTotals,
      rows:
        checks,
    },

    liquidity: {
      cash,
      banks,
    },

    diagnostics: {
      missingCustomerPartyMinor,
      missingSupplierPartyMinor,
      agingSourceMovements:
        sourceMovementMap.size,
      cashBaseComplete,
    },
  });
}

export async function handleFinanceLiquidityReportRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/reports/liquidity"
  ) {
    return handleLiquidityReport(
      request,
      db,
      env,
    );
  }

  return null;
}
