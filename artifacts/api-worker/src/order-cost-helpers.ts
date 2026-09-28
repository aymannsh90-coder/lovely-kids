import {
  orderItemCostsTable,
} from "@workspace/db/schema";

import {
  allocateProportionalCostMinor,
  deriveUnitCostMinor,
  type CostQuality,
} from "./inventory-cost-engine";

export interface OrderCostLine {
  lineNumber: number;
  productId: number;
  quantity: number;
  color?: string | null;
  size?: string | null;
}

export function combineOrderCostQualities(
  qualities: CostQuality[],
): CostQuality {
  if (qualities.length < 1) {
    throw new Error(
      "ORDER_COST_QUALITY_EMPTY",
    );
  }

  if (qualities.includes("mixed")) {
    return "mixed";
  }

  const first = qualities[0]!;

  return qualities.every(
    (quality) => quality === first,
  )
    ? first
    : "mixed";
}

export function allocateOrderCostAcrossLines(
  orderId: number,
  lines: OrderCostLine[],
  costTotalMinor: number,
  costQuality: CostQuality,
): Array<typeof orderItemCostsTable.$inferInsert> {
  const sortedLines =
    [...lines].sort(
      (left, right) =>
        left.lineNumber -
        right.lineNumber,
    );

  const quantityTotal =
    sortedLines.reduce(
      (total, line) =>
        total + line.quantity,
      0,
    );

  if (
    !Number.isSafeInteger(quantityTotal) ||
    quantityTotal <= 0
  ) {
    throw new Error(
      "ORDER_COST_ALLOCATION_QUANTITY_INVALID",
    );
  }

  let runningQuantity = 0;
  let allocatedBeforeMinor = 0;

  return sortedLines.map((line) => {
    runningQuantity +=
      line.quantity;

    const allocatedThroughLineMinor =
      runningQuantity === quantityTotal
        ? costTotalMinor
        : allocateProportionalCostMinor(
            costTotalMinor,
            runningQuantity,
            quantityTotal,
          );

    const lineCostTotalMinor =
      allocatedThroughLineMinor -
      allocatedBeforeMinor;

    if (
      !Number.isSafeInteger(
        lineCostTotalMinor,
      ) ||
      lineCostTotalMinor < 0
    ) {
      throw new Error(
        "ORDER_COST_ALLOCATION_INVALID",
      );
    }

    allocatedBeforeMinor =
      allocatedThroughLineMinor;

    return {
      orderId,
      lineNumber:
        line.lineNumber,
      productId:
        line.productId,
      color:
        line.color ?? null,
      size:
        line.size ?? null,
      quantity:
        line.quantity,
      unitCostMinor:
        deriveUnitCostMinor(
          lineCostTotalMinor,
          line.quantity,
        ),
      costTotalMinor:
        lineCostTotalMinor,
      costQuality,
    };
  });
}
