import {
  productCostLedgerTable,
  productCostStateTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import type { openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<
  Parameters<Db["transaction"]>[0]
>[0];

const MAX_DB_INT = 2_147_483_647;

export type CostQuality =
  | "confirmed"
  | "estimated"
  | "mixed";

export type CostLedgerEventType =
  | "opening"
  | "purchase"
  | "purchase_void"
  | "pos_sale"
  | "pos_sale_void"
  | "pos_sale_edit_reverse"
  | "pos_return"
  | "pos_mobile_return"
  | "pos_return_void"
  | "online_order"
  | "online_order_cancel"
  | "online_order_edit_reverse"
  | "exchange_return"
  | "exchange_sale"
  | "exchange_return_void"
  | "exchange_sale_void"
  | "adjustment_in"
  | "adjustment_out"
  | "correction";

type LedgerMetadata = {
  eventType: CostLedgerEventType;
  sourceType?: string | null;
  sourceRef?: string | null;
  sourceItemRef?: string | null;
  businessDate?: string | null;
  note?: string | null;
  createdByUserId?: number | null;
};

type LockedCostState = {
  productId: number;
  quantityOnHand: number;
  inventoryValueMinor: number;
  referenceUnitCostMinor: number;
  costQuality: CostQuality;
};

export type UntrackedCostResult = {
  tracked: false;
  reason:
    | "uninitialized"
    | "insufficient_accounting_quantity"
    | "insufficient_accounting_value"
    | "exact_cost_mismatch"
    | "accounting_quantity_mismatch"
    | "opening_cost_required"
    | "owner_cost_confirmation_required"
    | "unknown_effective_quantity"
    | "cost_input_not_applicable";
};

export type TrackedCostResult = {
  tracked: true;

  productId: number;
  quantity: number;

  unitCostMinor: number;
  costTotalMinor: number;
  costQuality: CostQuality;

  quantityBefore: number;
  quantityAfter: number;

  inventoryValueBeforeMinor: number;
  inventoryValueAfterMinor: number;

  referenceUnitCostMinor: number;
};

export type CostMutationResult =
  | UntrackedCostResult
  | TrackedCostResult;

export class InventoryCostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryCostError";
  }
}

function assertPositiveInteger(
  value: number,
  label: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new InventoryCostError(
      `${label} must be a positive integer`,
    );
  }
}

function assertNonNegativeDbInteger(
  value: number,
  label: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_DB_INT
  ) {
    throw new InventoryCostError(
      `${label} is outside the supported integer range`,
    );
  }
}

function toSafeNumber(
  value: bigint,
  label: string,
) {
  const result = Number(value);

  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    result > MAX_DB_INT
  ) {
    throw new InventoryCostError(
      `${label} is outside the supported integer range`,
    );
  }

  return result;
}

/**
 * Proportional allocation in integer minor units.
 *
 * Uses half-up rounding for partial allocations.
 * When the full quantity is allocated, returns the exact total
 * so no residual inventory value can remain behind.
 */
export function allocateProportionalCostMinor(
  totalCostMinor: number,
  partQuantity: number,
  totalQuantity: number,
): number {
  assertNonNegativeDbInteger(
    totalCostMinor,
    "totalCostMinor",
  );

  assertPositiveInteger(
    partQuantity,
    "partQuantity",
  );

  assertPositiveInteger(
    totalQuantity,
    "totalQuantity",
  );

  if (partQuantity > totalQuantity) {
    throw new InventoryCostError(
      "partQuantity cannot exceed totalQuantity",
    );
  }

  if (partQuantity === totalQuantity) {
    return totalCostMinor;
  }

  const total =
    BigInt(totalCostMinor);

  const part =
    BigInt(partQuantity);

  const whole =
    BigInt(totalQuantity);

  const rounded =
    (total * part + whole / 2n) /
    whole;

  return toSafeNumber(
    rounded,
    "allocatedCostMinor",
  );
}

/**
 * Cost per unit is informative.
 * costTotalMinor remains the authoritative value.
 */
export function deriveUnitCostMinor(
  costTotalMinor: number,
  quantity: number,
): number {
  assertNonNegativeDbInteger(
    costTotalMinor,
    "costTotalMinor",
  );

  assertPositiveInteger(
    quantity,
    "quantity",
  );

  const total =
    BigInt(costTotalMinor);

  const qty =
    BigInt(quantity);

  const rounded =
    (total + qty / 2n) /
    qty;

  return toSafeNumber(
    rounded,
    "unitCostMinor",
  );
}

function mergeCostQuality(
  currentQuantity: number,
  currentQuality: CostQuality,
  incomingQuality: CostQuality,
): CostQuality {
  if (currentQuantity === 0) {
    return incomingQuality;
  }

  if (currentQuality === incomingQuality) {
    return currentQuality;
  }

  return "mixed";
}

function normalizeCostQuality(
  value: string,
): CostQuality {
  if (
    value === "confirmed" ||
    value === "estimated" ||
    value === "mixed"
  ) {
    return value;
  }

  throw new InventoryCostError(
    "Invalid inventory cost quality",
  );
}

async function lockCostState(
  tx: Tx,
  productId: number,
): Promise<LockedCostState | null> {
  assertPositiveInteger(
    productId,
    "productId",
  );

  const rows =
    await tx
      .select({
        productId:
          productCostStateTable.productId,

        quantityOnHand:
          productCostStateTable.quantityOnHand,

        inventoryValueMinor:
          productCostStateTable.inventoryValueMinor,

        referenceUnitCostMinor:
          productCostStateTable.referenceUnitCostMinor,

        costQuality:
          productCostStateTable.costQuality,
      })
      .from(productCostStateTable)
      .where(
        eq(
          productCostStateTable.productId,
          productId,
        ),
      )
      .for("update");

  const row = rows[0];

  if (!row) {
    return null;
  }

  assertNonNegativeDbInteger(
    row.quantityOnHand,
    "quantityOnHand",
  );

  assertNonNegativeDbInteger(
    row.inventoryValueMinor,
    "inventoryValueMinor",
  );

  assertNonNegativeDbInteger(
    row.referenceUnitCostMinor,
    "referenceUnitCostMinor",
  );

  return {
    productId: row.productId,

    quantityOnHand:
      row.quantityOnHand,

    inventoryValueMinor:
      row.inventoryValueMinor,

    referenceUnitCostMinor:
      row.referenceUnitCostMinor,

    costQuality:
      normalizeCostQuality(
        row.costQuality,
      ),
  };
}

async function writeLedger(
  tx: Tx,
  state: {
    productId: number;
    quantityDelta: number;
    inventoryValueDeltaMinor: number;
    quantityAfter: number;
    inventoryValueAfterMinor: number;
    costQuality: CostQuality;
  },
  metadata: LedgerMetadata,
) {
  await tx
    .insert(
      productCostLedgerTable,
    )
    .values({
      productId:
        state.productId,

      eventType:
        metadata.eventType,

      sourceType:
        metadata.sourceType ?? null,

      sourceRef:
        metadata.sourceRef ?? null,

      sourceItemRef:
        metadata.sourceItemRef ?? null,

      quantityDelta:
        state.quantityDelta,

      inventoryValueDeltaMinor:
        state.inventoryValueDeltaMinor,

      quantityAfter:
        state.quantityAfter,

      inventoryValueAfterMinor:
        state.inventoryValueAfterMinor,

      costQuality:
        state.costQuality,

      businessDate:
        metadata.businessDate ?? null,

      note:
        metadata.note ?? null,

      createdByUserId:
        metadata.createdByUserId ?? null,
    });
}

/**
 * Remove inventory at the current moving-average cost.
 *
 * Used by sales and other stock-out movements.
 *
 * If cost accounting has not been initialized for this product,
 * the business operation is NOT blocked. The caller receives
 * tracked=false and can continue without a cost snapshot.
 */
export async function consumeProductCost(
  tx: Tx,
  input: {
    productId: number;
    quantity: number;
  } & LedgerMetadata,
): Promise<CostMutationResult> {
  assertPositiveInteger(
    input.quantity,
    "quantity",
  );

  const state =
    await lockCostState(
      tx,
      input.productId,
    );

  if (!state) {
    return {
      tracked: false,
      reason: "uninitialized",
    };
  }

  if (
    input.quantity >
    state.quantityOnHand
  ) {
    return {
      tracked: false,
      reason:
        "insufficient_accounting_quantity",
    };
  }

  const costTotalMinor =
    allocateProportionalCostMinor(
      state.inventoryValueMinor,
      input.quantity,
      state.quantityOnHand,
    );

  const unitCostMinor =
    deriveUnitCostMinor(
      costTotalMinor,
      input.quantity,
    );

  const quantityAfter =
    state.quantityOnHand -
    input.quantity;

  const inventoryValueAfterMinor =
    state.inventoryValueMinor -
    costTotalMinor;

  assertNonNegativeDbInteger(
    quantityAfter,
    "quantityAfter",
  );

  assertNonNegativeDbInteger(
    inventoryValueAfterMinor,
    "inventoryValueAfterMinor",
  );

  await tx
    .update(
      productCostStateTable,
    )
    .set({
      quantityOnHand:
        quantityAfter,

      inventoryValueMinor:
        inventoryValueAfterMinor,

      // Preserve the last known average/reference cost
      // even when the remaining quantity becomes zero.
      referenceUnitCostMinor:
        state.referenceUnitCostMinor,

      updatedAt:
        new Date(),
    })
    .where(
      eq(
        productCostStateTable.productId,
        input.productId,
      ),
    );

  await writeLedger(
    tx,
    {
      productId:
        input.productId,

      quantityDelta:
        -input.quantity,

      inventoryValueDeltaMinor:
        -costTotalMinor,

      quantityAfter,

      inventoryValueAfterMinor,

      costQuality:
        state.costQuality,
    },
    input,
  );

  return {
    tracked: true,

    productId:
      input.productId,

    quantity:
      input.quantity,

    unitCostMinor,
    costTotalMinor,

    costQuality:
      state.costQuality,

    quantityBefore:
      state.quantityOnHand,

    quantityAfter,

    inventoryValueBeforeMinor:
      state.inventoryValueMinor,

    inventoryValueAfterMinor,

    referenceUnitCostMinor:
      state.referenceUnitCostMinor,
  };
}

/**
 * Remove an exact known historical cost from inventory.
 *
 * This is intentionally different from consumeProductCost():
 * consumeProductCost uses the CURRENT moving average, while this
 * function reverses a previously stored historical cost snapshot.
 *
 * Primary use:
 * - voiding a POS sale return
 *
 * The caller supplies the exact historical costTotalMinor.
 */
export async function consumeExactProductCost(
  tx: Tx,
  input: {
    productId: number;
    quantity: number;
    costTotalMinor: number;
  } & LedgerMetadata,
): Promise<CostMutationResult> {
  assertPositiveInteger(
    input.quantity,
    "quantity",
  );

  assertNonNegativeDbInteger(
    input.costTotalMinor,
    "costTotalMinor",
  );

  const state =
    await lockCostState(
      tx,
      input.productId,
    );

  if (!state) {
    return {
      tracked: false,
      reason: "uninitialized",
    };
  }

  if (
    input.quantity >
    state.quantityOnHand
  ) {
    return {
      tracked: false,
      reason:
        "insufficient_accounting_quantity",
    };
  }

  if (
    input.costTotalMinor >
    state.inventoryValueMinor
  ) {
    return {
      tracked: false,
      reason:
        "insufficient_accounting_value",
    };
  }

  const quantityAfter =
    state.quantityOnHand -
    input.quantity;

  const inventoryValueAfterMinor =
    state.inventoryValueMinor -
    input.costTotalMinor;

  assertNonNegativeDbInteger(
    quantityAfter,
    "quantityAfter",
  );

  assertNonNegativeDbInteger(
    inventoryValueAfterMinor,
    "inventoryValueAfterMinor",
  );

  // Zero physical/accounting quantity cannot retain inventory value.
  // Refuse the mutation rather than silently altering a historical
  // snapshot or inventing a balancing cost.
  if (
    quantityAfter === 0 &&
    inventoryValueAfterMinor !== 0
  ) {
    return {
      tracked: false,
      reason:
        "exact_cost_mismatch",
    };
  }

  const referenceUnitCostMinor =
    quantityAfter > 0
      ? deriveUnitCostMinor(
          inventoryValueAfterMinor,
          quantityAfter,
        )
      : state.referenceUnitCostMinor;

  // We cannot reliably "unmerge" confirmed/estimated/mixed quality
  // after later inventory movements, so preserve the current state's
  // aggregate quality.
  const costQuality =
    state.costQuality;

  await tx
    .update(
      productCostStateTable,
    )
    .set({
      quantityOnHand:
        quantityAfter,

      inventoryValueMinor:
        inventoryValueAfterMinor,

      referenceUnitCostMinor,

      costQuality,

      updatedAt:
        new Date(),
    })
    .where(
      eq(
        productCostStateTable.productId,
        input.productId,
      ),
    );

  await writeLedger(
    tx,
    {
      productId:
        input.productId,

      quantityDelta:
        -input.quantity,

      inventoryValueDeltaMinor:
        -input.costTotalMinor,

      quantityAfter,

      inventoryValueAfterMinor,

      costQuality,
    },
    input,
  );

  return {
    tracked: true,

    productId:
      input.productId,

    quantity:
      input.quantity,

    unitCostMinor:
      deriveUnitCostMinor(
        input.costTotalMinor,
        input.quantity,
      ),

    costTotalMinor:
      input.costTotalMinor,

    costQuality,

    quantityBefore:
      state.quantityOnHand,

    quantityAfter,

    inventoryValueBeforeMinor:
      state.inventoryValueMinor,

    inventoryValueAfterMinor,

    referenceUnitCostMinor,
  };
}

/**
 * Restore an exact known cost back into inventory.
 *
 * Examples:
 * - POS sale void
 * - normal return linked to the original sale
 * - reversing old lines during a sale edit
 *
 * The caller supplies the exact historical costTotalMinor.
 */
export async function restoreExactProductCost(
  tx: Tx,
  input: {
    productId: number;
    quantity: number;
    costTotalMinor: number;
    costQuality: CostQuality;
  } & LedgerMetadata,
): Promise<CostMutationResult> {
  assertPositiveInteger(
    input.quantity,
    "quantity",
  );

  assertNonNegativeDbInteger(
    input.costTotalMinor,
    "costTotalMinor",
  );

  const state =
    await lockCostState(
      tx,
      input.productId,
    );

  if (!state) {
    return {
      tracked: false,
      reason: "uninitialized",
    };
  }

  const quantityAfter =
    state.quantityOnHand +
    input.quantity;

  const inventoryValueAfterMinor =
    state.inventoryValueMinor +
    input.costTotalMinor;

  assertNonNegativeDbInteger(
    quantityAfter,
    "quantityAfter",
  );

  assertNonNegativeDbInteger(
    inventoryValueAfterMinor,
    "inventoryValueAfterMinor",
  );

  const costQuality =
    mergeCostQuality(
      state.quantityOnHand,
      state.costQuality,
      input.costQuality,
    );

  const referenceUnitCostMinor =
    deriveUnitCostMinor(
      inventoryValueAfterMinor,
      quantityAfter,
    );

  await tx
    .update(
      productCostStateTable,
    )
    .set({
      quantityOnHand:
        quantityAfter,

      inventoryValueMinor:
        inventoryValueAfterMinor,

      referenceUnitCostMinor,

      costQuality,

      updatedAt:
        new Date(),
    })
    .where(
      eq(
        productCostStateTable.productId,
        input.productId,
      ),
    );

  await writeLedger(
    tx,
    {
      productId:
        input.productId,

      quantityDelta:
        input.quantity,

      inventoryValueDeltaMinor:
        input.costTotalMinor,

      quantityAfter,

      inventoryValueAfterMinor,

      costQuality,
    },
    input,
  );

  return {
    tracked: true,

    productId:
      input.productId,

    quantity:
      input.quantity,

    unitCostMinor:
      deriveUnitCostMinor(
        input.costTotalMinor,
        input.quantity,
      ),

    costTotalMinor:
      input.costTotalMinor,

    costQuality,

    quantityBefore:
      state.quantityOnHand,

    quantityAfter,

    inventoryValueBeforeMinor:
      state.inventoryValueMinor,

    inventoryValueAfterMinor,

    referenceUnitCostMinor,
  };
}

/**
 * Add stock with no explicit acquisition cost.
 *
 * Uses the current average/reference product cost as an estimate.
 * This NEVER uses color/size as a cost dimension.
 *
 * If cost accounting is not initialized, it remains untracked
 * rather than inventing a zero cost.
 */
export async function addProductCostAtCurrentAverage(
  tx: Tx,
  input: {
    productId: number;
    quantity: number;
    addedCostQuality?: CostQuality;
  } & LedgerMetadata,
): Promise<CostMutationResult> {
  assertPositiveInteger(
    input.quantity,
    "quantity",
  );

  const state =
    await lockCostState(
      tx,
      input.productId,
    );

  if (!state) {
    return {
      tracked: false,
      reason: "uninitialized",
    };
  }

  const unitCostMinor =
    state.quantityOnHand > 0
      ? deriveUnitCostMinor(
          state.inventoryValueMinor,
          state.quantityOnHand,
        )
      : state.referenceUnitCostMinor;

  const addedCostBigInt =
    BigInt(unitCostMinor) *
    BigInt(input.quantity);

  const costTotalMinor =
    toSafeNumber(
      addedCostBigInt,
      "costTotalMinor",
    );

  const quantityAfter =
    state.quantityOnHand +
    input.quantity;

  const inventoryValueAfterMinor =
    state.inventoryValueMinor +
    costTotalMinor;

  assertNonNegativeDbInteger(
    quantityAfter,
    "quantityAfter",
  );

  assertNonNegativeDbInteger(
    inventoryValueAfterMinor,
    "inventoryValueAfterMinor",
  );

  const costQuality =
    mergeCostQuality(
      state.quantityOnHand,
      state.costQuality,
      input.addedCostQuality ??
        "estimated",
    );

  const referenceUnitCostMinor =
    deriveUnitCostMinor(
      inventoryValueAfterMinor,
      quantityAfter,
    );

  await tx
    .update(
      productCostStateTable,
    )
    .set({
      quantityOnHand:
        quantityAfter,

      inventoryValueMinor:
        inventoryValueAfterMinor,

      referenceUnitCostMinor,

      costQuality,

      updatedAt:
        new Date(),
    })
    .where(
      eq(
        productCostStateTable.productId,
        input.productId,
      ),
    );

  await writeLedger(
    tx,
    {
      productId:
        input.productId,

      quantityDelta:
        input.quantity,

      inventoryValueDeltaMinor:
        costTotalMinor,

      quantityAfter,

      inventoryValueAfterMinor,

      costQuality,
    },
    input,
  );

  return {
    tracked: true,

    productId:
      input.productId,

    quantity:
      input.quantity,

    unitCostMinor,
    costTotalMinor,

    costQuality,

    quantityBefore:
      state.quantityOnHand,

    quantityAfter,

    inventoryValueBeforeMinor:
      state.inventoryValueMinor,

    inventoryValueAfterMinor,

    referenceUnitCostMinor,
  };
}

/**
 * Add a new physical stock batch using an explicit unit cost.
 *
 * Used when the owner confirms that a newly added quantity has
 * a different acquisition cost.
 *
 * The new reference cost becomes the weighted moving average.
 */
export async function addProductCostAtExplicitUnitCost(
  tx: Tx,
  input: {
    productId: number;
    quantity: number;
    unitCostMinor: number;
    costQuality: CostQuality;
  } & LedgerMetadata,
): Promise<CostMutationResult> {
  assertPositiveInteger(
    input.quantity,
    "quantity",
  );

  assertNonNegativeDbInteger(
    input.unitCostMinor,
    "unitCostMinor",
  );

  const state =
    await lockCostState(
      tx,
      input.productId,
    );

  if (!state) {
    return {
      tracked: false,
      reason: "uninitialized",
    };
  }

  const addedCostBigInt =
    BigInt(input.unitCostMinor) *
    BigInt(input.quantity);

  const costTotalMinor =
    toSafeNumber(
      addedCostBigInt,
      "costTotalMinor",
    );

  const quantityAfter =
    state.quantityOnHand +
    input.quantity;

  const inventoryValueAfterMinor =
    state.inventoryValueMinor +
    costTotalMinor;

  assertNonNegativeDbInteger(
    quantityAfter,
    "quantityAfter",
  );

  assertNonNegativeDbInteger(
    inventoryValueAfterMinor,
    "inventoryValueAfterMinor",
  );

  const costQuality =
    mergeCostQuality(
      state.quantityOnHand,
      state.costQuality,
      input.costQuality,
    );

  const referenceUnitCostMinor =
    deriveUnitCostMinor(
      inventoryValueAfterMinor,
      quantityAfter,
    );

  await tx
    .update(productCostStateTable)
    .set({
      quantityOnHand:
        quantityAfter,

      inventoryValueMinor:
        inventoryValueAfterMinor,

      referenceUnitCostMinor,

      costQuality,

      updatedAt:
        new Date(),
    })
    .where(
      eq(
        productCostStateTable.productId,
        input.productId,
      ),
    );

  await writeLedger(
    tx,
    {
      productId:
        input.productId,

      quantityDelta:
        input.quantity,

      inventoryValueDeltaMinor:
        costTotalMinor,

      quantityAfter,

      inventoryValueAfterMinor,

      costQuality,
    },
    input,
  );

  return {
    tracked: true,

    productId:
      input.productId,

    quantity:
      input.quantity,

    unitCostMinor:
      input.unitCostMinor,

    costTotalMinor,

    costQuality,

    quantityBefore:
      state.quantityOnHand,

    quantityAfter,

    inventoryValueBeforeMinor:
      state.inventoryValueMinor,

    inventoryValueAfterMinor,

    referenceUnitCostMinor,
  };
}

/**
 * Synchronize cost accounting with one effective manual
 * physical-quantity change for a product/model.
 *
 * quantityBefore / quantityAfter are effective PRODUCT quantities,
 * not raw general-stock or variant deltas.
 */
export async function syncManualProductCostQuantity(
  tx: Tx,
  input: {
    productId: number;
    quantityBefore: number | null;
    quantityAfter: number | null;

    explicitUnitCostMinor?: number | null;

    sameCostConfirmed?: boolean;
    requireExplicitIncreaseCost?: boolean;
  } & Omit<LedgerMetadata, "eventType">,
): Promise<CostMutationResult | null> {
  if (input.quantityBefore !== null) {
    assertNonNegativeDbInteger(
      input.quantityBefore,
      "quantityBefore",
    );
  }

  if (input.quantityAfter !== null) {
    assertNonNegativeDbInteger(
      input.quantityAfter,
      "quantityAfter",
    );
  }

  const currentState =
    await lockCostState(
      tx,
      input.productId,
    );

  if (
    input.quantityBefore === null ||
    input.quantityAfter === null
  ) {
    return {
      tracked: false,
      reason: currentState
        ? "unknown_effective_quantity"
        : "uninitialized",
    };
  }

  const delta =
    input.quantityAfter -
    input.quantityBefore;

  const hasCostInput =
    input.sameCostConfirmed === true ||
    (
      input.explicitUnitCostMinor !== undefined &&
      input.explicitUnitCostMinor !== null
    );

  if (delta <= 0 && hasCostInput) {
    return {
      tracked: false,
      reason: "cost_input_not_applicable",
    };
  }

  if (delta === 0) {
    return null;
  }

  if (!currentState) {
    return {
      tracked: false,
      reason:
        delta > 0 &&
        input.requireExplicitIncreaseCost
          ? "opening_cost_required"
          : "uninitialized",
    };
  }

  if (
    delta > 0 &&
    input.requireExplicitIncreaseCost &&
    !hasCostInput
  ) {
    return {
      tracked: false,
      reason:
        "owner_cost_confirmation_required",
    };
  }

  if (
    currentState.quantityOnHand !==
    input.quantityBefore
  ) {
    return {
      tracked: false,
      reason:
        "accounting_quantity_mismatch",
    };
  }

  if (delta > 0) {
    if (
      input.explicitUnitCostMinor !== undefined &&
      input.explicitUnitCostMinor !== null
    ) {
      return addProductCostAtExplicitUnitCost(
        tx,
        {
          productId:
            input.productId,

          quantity:
            delta,

          unitCostMinor:
            input.explicitUnitCostMinor,

          costQuality:
            "confirmed",

          eventType:
            "adjustment_in",

          sourceType:
            input.sourceType,

          sourceRef:
            input.sourceRef,

          sourceItemRef:
            input.sourceItemRef,

          businessDate:
            input.businessDate,

          note:
            input.note,

          createdByUserId:
            input.createdByUserId,
        },
      );
    }

    return addProductCostAtCurrentAverage(
      tx,
      {
        productId:
          input.productId,

        quantity:
          delta,

        addedCostQuality:
          input.sameCostConfirmed
            ? "confirmed"
            : "estimated",

        eventType:
          "adjustment_in",

        sourceType:
          input.sourceType,

        sourceRef:
          input.sourceRef,

        sourceItemRef:
          input.sourceItemRef,

        businessDate:
          input.businessDate,

        note:
          input.note,

        createdByUserId:
          input.createdByUserId,
      },
    );
  }

  return consumeProductCost(
    tx,
    {
      productId:
        input.productId,

      quantity:
        Math.abs(delta),

      eventType:
        "adjustment_out",

      sourceType:
        input.sourceType,

      sourceRef:
        input.sourceRef,

      sourceItemRef:
        input.sourceItemRef,

      businessDate:
        input.businessDate,

      note:
        input.note,

      createdByUserId:
        input.createdByUserId,
    },
  );
}
