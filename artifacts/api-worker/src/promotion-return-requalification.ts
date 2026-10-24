import {
  calculatePromotions,
  type PromotionChannel,
  type PromotionDefinition,
} from "./promotion-engine";

export interface PromotionReturnSourceLine {
  key: string;
  productId: number;
  unitPriceMinor: number;
  quantity: number;
  lineDiscountMinor: number;
  rewardForPromotionId?: number | null;
}

export interface PromotionReturnRequalificationResult {
  originalGrossMinor: number;
  originalItemDiscountMinor: number;
  originalPromotionDiscountMinor: number;
  originalInvoiceDiscountMinor: number;
  originalNetMinor: number;

  remainingGrossMinor: number;
  remainingItemDiscountMinor: number;
  remainingPromotionDiscountMinor: number;
  remainingInvoiceDiscountMinor: number;
  remainingNetMinor: number;

  targetReturnedGrossMinor: number;
  targetReturnedItemDiscountMinor: number;
  targetReturnedPromotionDiscountMinor: number;
  targetReturnedInvoiceDiscountMinor: number;
  targetCumulativeRefundMinor: number;

  targetReturnedLineDiscountByKey: Map<string, number>;
}

function assertMoney(
  value: number,
  name: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `PROMOTION_RETURN_INVALID_${name}`,
    );
  }
}

function proportionalReturnedDiscount(
  originalDiscountMinor: number,
  originalQuantity: number,
  returnedQuantity: number,
) {
  if (returnedQuantity <= 0) {
    return 0;
  }

  if (
    returnedQuantity >=
    originalQuantity
  ) {
    return originalDiscountMinor;
  }

  return Number(
    (
      BigInt(originalDiscountMinor) *
      BigInt(returnedQuantity)
    ) /
      BigInt(originalQuantity),
  );
}

export function calculatePromotionReturnRequalification(
  input: {
    lines: PromotionReturnSourceLine[];
    returnedQuantityByKey: ReadonlyMap<string, number>;
    promotions: PromotionDefinition[];
    channel: PromotionChannel;
    originalPromotionDiscountMinor: number;
    originalInvoiceDiscountMinor: number;
    roundingIncrementMinor?: number;
  },
): PromotionReturnRequalificationResult {
  const {
    lines,
    returnedQuantityByKey,
    promotions,
    channel,
    originalPromotionDiscountMinor,
    originalInvoiceDiscountMinor,
  } = input;

  assertMoney(
    originalPromotionDiscountMinor,
    "ORIGINAL_PROMOTION",
  );
  assertMoney(
    originalInvoiceDiscountMinor,
    "ORIGINAL_INVOICE",
  );

  let originalGrossMinor = 0;
  let originalItemDiscountMinor = 0;
  let remainingGrossMinor = 0;
  let remainingItemDiscountMinor = 0;

  const targetReturnedLineDiscountByKey =
    new Map<string, number>();

  const remainingLines: Array<{
    key: string;
    productId: number;
    unitPriceMinor: number;
    quantity: number;
    rewardForPromotionId?: number | null;
  }> = [];

  for (const line of lines) {
    if (
      !line.key ||
      !Number.isSafeInteger(
        line.productId,
      ) ||
      line.productId <= 0 ||
      !Number.isSafeInteger(
        line.unitPriceMinor,
      ) ||
      line.unitPriceMinor < 0 ||
      !Number.isSafeInteger(
        line.quantity,
      ) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(
        line.lineDiscountMinor,
      ) ||
      line.lineDiscountMinor < 0
    ) {
      throw new Error(
        "PROMOTION_RETURN_INVALID_LINE",
      );
    }

    const lineGrossMinor =
      line.unitPriceMinor *
      line.quantity;

    if (
      !Number.isSafeInteger(
        lineGrossMinor,
      ) ||
      line.lineDiscountMinor >
        lineGrossMinor
    ) {
      throw new Error(
        "PROMOTION_RETURN_INVALID_LINE_AMOUNT",
      );
    }

    const returnedQuantity =
      returnedQuantityByKey.get(
        line.key,
      ) ?? 0;

    if (
      !Number.isSafeInteger(
        returnedQuantity,
      ) ||
      returnedQuantity < 0 ||
      returnedQuantity >
        line.quantity
    ) {
      throw new Error(
        "PROMOTION_RETURN_INVALID_QUANTITY",
      );
    }

    const returnedLineDiscountMinor =
      proportionalReturnedDiscount(
        line.lineDiscountMinor,
        line.quantity,
        returnedQuantity,
      );

    const remainingQuantity =
      line.quantity -
      returnedQuantity;

    const retainedLineDiscountMinor =
      line.lineDiscountMinor -
      returnedLineDiscountMinor;

    originalGrossMinor +=
      lineGrossMinor;
    originalItemDiscountMinor +=
      line.lineDiscountMinor;

    targetReturnedLineDiscountByKey.set(
      line.key,
      returnedLineDiscountMinor,
    );

    if (
      remainingQuantity >
      0
    ) {
      const gross =
        line.unitPriceMinor *
        remainingQuantity;

      remainingGrossMinor += gross;
      remainingItemDiscountMinor +=
        retainedLineDiscountMinor;

      remainingLines.push({
        key: line.key,
        productId:
          line.productId,
        unitPriceMinor:
          line.unitPriceMinor,
        quantity:
          remainingQuantity,
        rewardForPromotionId:
          line.rewardForPromotionId,
      });
    }
  }

  for (const [
    name,
    value,
  ] of [
    [
      "ORIGINAL_GROSS",
      originalGrossMinor,
    ],
    [
      "ORIGINAL_ITEM_DISCOUNT",
      originalItemDiscountMinor,
    ],
    [
      "REMAINING_GROSS",
      remainingGrossMinor,
    ],
    [
      "REMAINING_ITEM_DISCOUNT",
      remainingItemDiscountMinor,
    ],
  ] as const) {
    assertMoney(
      value,
      name,
    );
  }

  const remainingPromotionCalculation =
    calculatePromotions({
      lines:
        remainingLines,
      promotions,
      channel,
      roundingIncrementMinor:
        input.roundingIncrementMinor ??
        1,
    });

  const remainingPromotionDiscountMinor =
    remainingPromotionCalculation.totalDiscountMinor;

  if (
    remainingPromotionDiscountMinor >
    originalPromotionDiscountMinor
  ) {
    throw new Error(
      "PROMOTION_RETURN_REMAINING_PROMO_GREATER_THAN_ORIGINAL",
    );
  }

  const originalInvoiceBaseMinor =
    originalGrossMinor -
    originalItemDiscountMinor -
    originalPromotionDiscountMinor;

  const remainingInvoiceBaseMinor =
    remainingGrossMinor -
    remainingItemDiscountMinor -
    remainingPromotionDiscountMinor;

  if (
    originalInvoiceBaseMinor < 0 ||
    remainingInvoiceBaseMinor < 0 ||
    originalInvoiceDiscountMinor >
      originalInvoiceBaseMinor
  ) {
    throw new Error(
      "PROMOTION_RETURN_INVALID_INVOICE_BASE",
    );
  }

  let remainingInvoiceDiscountMinor = 0;

  if (
    originalInvoiceDiscountMinor >
      0 &&
    remainingInvoiceBaseMinor >
      0
  ) {
    remainingInvoiceDiscountMinor =
      remainingInvoiceBaseMinor >=
      originalInvoiceBaseMinor
        ? originalInvoiceDiscountMinor
        : Number(
            (
              BigInt(
                originalInvoiceDiscountMinor,
              ) *
              BigInt(
                remainingInvoiceBaseMinor,
              )
            ) /
              BigInt(
                originalInvoiceBaseMinor,
              ),
          );
  }

  const originalNetMinor =
    originalInvoiceBaseMinor -
    originalInvoiceDiscountMinor;

  const remainingNetMinor =
    remainingInvoiceBaseMinor -
    remainingInvoiceDiscountMinor;

  if (
    originalNetMinor < 0 ||
    remainingNetMinor < 0
  ) {
    throw new Error(
      "PROMOTION_RETURN_INVALID_NET",
    );
  }

  const targetCumulativeRefundMinor =
    Math.max(
      0,
      originalNetMinor -
        remainingNetMinor,
    );

  const targetReturnedGrossMinor =
    originalGrossMinor -
    remainingGrossMinor;

  const targetReturnedItemDiscountMinor =
    originalItemDiscountMinor -
    remainingItemDiscountMinor;

  const targetReturnedPromotionDiscountMinor =
    originalPromotionDiscountMinor -
    remainingPromotionDiscountMinor;

  const targetReturnedInvoiceDiscountMinor =
    originalInvoiceDiscountMinor -
    remainingInvoiceDiscountMinor;

  const expectedRefundMinor =
    targetReturnedGrossMinor -
    targetReturnedItemDiscountMinor -
    targetReturnedPromotionDiscountMinor -
    targetReturnedInvoiceDiscountMinor;

  if (
    expectedRefundMinor !==
    targetCumulativeRefundMinor
  ) {
    throw new Error(
      "PROMOTION_RETURN_REQUALIFICATION_MISMATCH",
    );
  }

  return {
    originalGrossMinor,
    originalItemDiscountMinor,
    originalPromotionDiscountMinor,
    originalInvoiceDiscountMinor,
    originalNetMinor,

    remainingGrossMinor,
    remainingItemDiscountMinor,
    remainingPromotionDiscountMinor,
    remainingInvoiceDiscountMinor,
    remainingNetMinor,

    targetReturnedGrossMinor,
    targetReturnedItemDiscountMinor,
    targetReturnedPromotionDiscountMinor,
    targetReturnedInvoiceDiscountMinor,
    targetCumulativeRefundMinor,

    targetReturnedLineDiscountByKey,
  };
}

export function allocateReturnDiscountMinor(
  totalDiscountMinor: number,
  lines: Array<{
    grossAmountMinor: number;
    alreadyAllocatedMinor: number;
    weightMinor: number;
  }>,
): number[] {
  assertMoney(
    totalDiscountMinor,
    "ALLOCATE_TOTAL",
  );

  if (
    totalDiscountMinor === 0
  ) {
    return lines.map(
      () => 0,
    );
  }

  const capacities =
    lines.map(
      (line) => {
        const capacity =
          line.grossAmountMinor -
          line.alreadyAllocatedMinor;

        if (
          !Number.isSafeInteger(
            line.grossAmountMinor,
          ) ||
          !Number.isSafeInteger(
            line.alreadyAllocatedMinor,
          ) ||
          !Number.isSafeInteger(
            line.weightMinor,
          ) ||
          capacity < 0 ||
          line.weightMinor < 0
        ) {
          throw new Error(
            "PROMOTION_RETURN_ALLOCATE_INVALID_LINE",
          );
        }

        return capacity;
      },
    );

  const capacityTotal =
    capacities.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  if (
    totalDiscountMinor >
    capacityTotal
  ) {
    throw new Error(
      "PROMOTION_RETURN_ALLOCATE_EXCEEDS_CAPACITY",
    );
  }

  const weights =
    lines.map(
      (line, index) =>
        Math.min(
          capacities[index]!,
          line.weightMinor,
        ),
    );

  let denominator =
    weights.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  if (
    denominator <= 0
  ) {
    denominator =
      capacityTotal;

    for (
      let index = 0;
      index < weights.length;
      index += 1
    ) {
      weights[index] =
        capacities[index]!;
    }
  }

  const rows =
    lines.map(
      (_line, index) => {
        const weight =
          weights[index] ??
          0;

        const numerator =
          BigInt(
            totalDiscountMinor,
          ) *
          BigInt(weight);

        return {
          index,
          amount:
            denominator > 0
              ? Number(
                  numerator /
                    BigInt(
                      denominator,
                    ),
                )
              : 0,
          remainder:
            denominator > 0
              ? numerator %
                BigInt(
                  denominator,
                )
              : 0n,
        };
      },
    );

  for (const row of rows) {
    row.amount =
      Math.min(
        row.amount,
        capacities[
          row.index
        ]!,
      );
  }

  let remaining =
    totalDiscountMinor -
    rows.reduce(
      (sum, row) =>
        sum + row.amount,
      0,
    );

  const ranked =
    [...rows].sort(
      (left, right) => {
        if (
          left.remainder ===
          right.remainder
        ) {
          return (
            left.index -
            right.index
          );
        }

        return left.remainder >
          right.remainder
          ? -1
          : 1;
      },
    );

  while (
    remaining > 0
  ) {
    let progressed =
      false;

    for (const row of ranked) {
      if (
        remaining <= 0
      ) {
        break;
      }

      if (
        row.amount <
        capacities[
          row.index
        ]!
      ) {
        row.amount += 1;
        remaining -= 1;
        progressed =
          true;
      }
    }

    if (!progressed) {
      throw new Error(
        "PROMOTION_RETURN_ALLOCATE_STALLED",
      );
    }
  }

  return rows
    .sort(
      (left, right) =>
        left.index -
        right.index,
    )
    .map(
      (row) =>
        row.amount,
    );
}
