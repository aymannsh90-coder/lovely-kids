export type PromotionChannel = "web" | "pos";

export type PromotionKind =
  | "buy_x_get_y"
  | "percent_off"
  | "bundle_price";

export type PromotionRewardMode =
  | "free"
  | "percent_off"
  | "fixed_price";

export interface PromotionDefinition {
  id: number;
  name: string;
  publicLabel: string;
  description?: string | null;

  kind: PromotionKind;
  scope: "all_products" | "selected_products";
  channel: "web" | "pos" | "both";

  buyQuantity?: number | null;
  rewardQuantity?: number | null;
  rewardMode?: PromotionRewardMode | null;
  rewardPercent?: number | null;
  rewardPriceMinor?: number | null;
  rewardSelectionMode: "cheapest" | "customer_choice";

  percentOff?: number | null;

  bundleQuantity?: number | null;
  bundlePriceMinor?: number | null;

  repeatable: boolean;
  maxApplicationsPerOrder?: number | null;

  stackWithOtherPromotions: boolean;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;

  priority: number;

  qualifyingProductIds: number[];
  rewardProductIds: number[];
  excludedProductIds: number[];
}

export interface PromotionCartLine {
  key: string;
  productId: number;
  unitPriceMinor: number;
  quantity: number;

  // Future-proof explicit reward selection. When present, the whole logical
  // line is treated as a chosen reward for this promotion. The storefront can
  // split a cart line when only part of its quantity is selected as reward.
  rewardForPromotionId?: number | null;
}

export interface PromotionAllocation {
  promotionId: number;
  promotionName: string;
  groupKey: string;
  discountMinor: number;
}

export interface PromotionLineResult {
  key: string;
  promotionDiscountMinor: number;
  allocations: PromotionAllocation[];
}

export interface PromotionGroupResult {
  groupKey: string;
  discountMinor: number;
  lineKeys: string[];
}

export interface AppliedPromotionResult {
  promotionId: number;
  promotionName: string;
  publicLabel: string;
  kind: PromotionKind;
  discountMinor: number;
  applicationCount: number;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;
  groups: PromotionGroupResult[];
}

export interface PromotionEntitlement {
  promotionId: number;
  promotionName: string;
  earnedRewardQuantity: number;
  selectedRewardQuantity: number;
  remainingRewardQuantity: number;
}

export interface PromotionCalculationResult {
  totalDiscountMinor: number;
  lines: PromotionLineResult[];
  promotions: AppliedPromotionResult[];
  entitlements: PromotionEntitlement[];
}

interface UnitAllocation extends PromotionAllocation {}

interface Unit {
  id: string;
  lineKey: string;
  lineIndex: number;
  unitIndex: number;
  productId: number;
  priceMinor: number;
  rewardForPromotionId: number | null;
  allocations: UnitAllocation[];
  exclusivePromotionId: number | null;
}

function validPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function promotionSupportsChannel(
  promotion: PromotionDefinition,
  channel: PromotionChannel,
) {
  return promotion.channel === "both" || promotion.channel === channel;
}

function inScope(
  unit: Unit,
  promotion: PromotionDefinition,
  role: "qualifying" | "reward",
) {
  if (promotion.excludedProductIds.includes(unit.productId)) {
    return false;
  }

  if (promotion.scope === "all_products") {
    return true;
  }

  const ids =
    role === "reward" && promotion.rewardProductIds.length > 0
      ? promotion.rewardProductIds
      : promotion.qualifyingProductIds;

  return ids.includes(unit.productId);
}

function roundDiscount(
  valueMinor: number,
  incrementMinor: number,
) {
  if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0) {
    return 0;
  }

  const increment =
    validPositiveInteger(incrementMinor)
      ? incrementMinor
      : 1;

  return Math.floor(valueMinor / increment) * increment;
}

function currentNetMinor(unit: Unit) {
  return Math.max(
    0,
    unit.priceMinor -
      unit.allocations.reduce(
        (total, allocation) => total + allocation.discountMinor,
        0,
      ),
  );
}

function allocateByWeight(
  totalDiscountMinor: number,
  units: Unit[],
  weight: (unit: Unit) => number,
): number[] {
  if (totalDiscountMinor <= 0 || units.length === 0) {
    return units.map(() => 0);
  }

  const weights = units.map((unit) => Math.max(0, weight(unit)));
  const denominator = weights.reduce((total, value) => total + value, 0);

  if (denominator <= 0) {
    return units.map(() => 0);
  }

  const rows = weights.map((value, index) => {
    const numerator = BigInt(totalDiscountMinor) * BigInt(value);

    return {
      index,
      amount: Number(numerator / BigInt(denominator)),
      remainder: numerator % BigInt(denominator),
    };
  });

  let remaining =
    totalDiscountMinor -
    rows.reduce((total, row) => total + row.amount, 0);

  const ranked = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.index - right.index;
    }

    return left.remainder > right.remainder ? -1 : 1;
  });

  for (const row of ranked) {
    if (remaining <= 0) break;

    const capacity = currentNetMinor(units[row.index]!) - row.amount;

    if (capacity <= 0) continue;

    row.amount += 1;
    remaining -= 1;
  }

  if (remaining !== 0) {
    throw new Error("PROMOTION_ALLOCATION_FAILED");
  }

  return rows
    .sort((left, right) => left.index - right.index)
    .map((row) => row.amount);
}

function addGroupAllocation(
  promotion: PromotionDefinition,
  groupKey: string,
  units: Unit[],
  totalDiscountMinor: number,
  weight: (unit: Unit) => number,
) {
  const safeDiscount = Math.min(
    totalDiscountMinor,
    units.reduce((total, unit) => total + currentNetMinor(unit), 0),
  );

  if (safeDiscount <= 0) {
    return 0;
  }

  const allocation = allocateByWeight(
    safeDiscount,
    units,
    weight,
  );

  allocation.forEach((discountMinor, index) => {
    if (discountMinor <= 0) return;

    units[index]!.allocations.push({
      promotionId: promotion.id,
      promotionName: promotion.name,
      groupKey,
      discountMinor,
    });
  });

  return allocation.reduce((total, value) => total + value, 0);
}

function maxApplications(
  promotion: PromotionDefinition,
  available: number,
) {
  let count = Math.max(0, Math.trunc(available));

  if (!promotion.repeatable) {
    count = Math.min(count, 1);
  }

  if (
    validPositiveInteger(promotion.maxApplicationsPerOrder)
  ) {
    count = Math.min(
      count,
      promotion.maxApplicationsPerOrder!,
    );
  }

  return count;
}

function rewardDiscountMinor(
  promotion: PromotionDefinition,
  rewardUnit: Unit,
  roundingIncrementMinor: number,
) {
  const price = currentNetMinor(rewardUnit);

  if (promotion.rewardMode === "free") {
    return price;
  }

  if (promotion.rewardMode === "percent_off") {
    const percent = promotion.rewardPercent ?? 0;

    if (!validPositiveInteger(percent) || percent > 100) {
      return 0;
    }

    return roundDiscount(
      Math.floor((price * percent) / 100),
      roundingIncrementMinor,
    );
  }

  if (promotion.rewardMode === "fixed_price") {
    const finalPrice = promotion.rewardPriceMinor ?? 0;

    if (!Number.isSafeInteger(finalPrice) || finalPrice < 0) {
      return 0;
    }

    return Math.max(0, price - finalPrice);
  }

  return 0;
}

function applyBuyXGetY(
  promotion: PromotionDefinition,
  units: Unit[],
  roundingIncrementMinor: number,
) {
  const buyQuantity = promotion.buyQuantity ?? 0;
  const rewardQuantity = promotion.rewardQuantity ?? 0;

  if (
    !validPositiveInteger(buyQuantity) ||
    !validPositiveInteger(rewardQuantity)
  ) {
    return {
      applied: null as AppliedPromotionResult | null,
      entitlement: null as PromotionEntitlement | null,
    };
  }

  const qualifying = units.filter(
    (unit) =>
      inScope(unit, promotion, "qualifying") &&
      unit.exclusivePromotionId === null,
  );

  const explicitRewards = units.filter(
    (unit) =>
      unit.rewardForPromotionId === promotion.id &&
      inScope(unit, promotion, "reward") &&
      unit.exclusivePromotionId === null,
  );

  const samePool =
    promotion.scope === "all_products" ||
    (
      promotion.rewardProductIds.length === 0 ||
      (
        promotion.qualifyingProductIds.length ===
          promotion.rewardProductIds.length &&
        promotion.qualifyingProductIds.every((id) =>
          promotion.rewardProductIds.includes(id),
        )
      )
    );

  let applicationCount = 0;
  let rewardUnits: Unit[] = [];
  let qualifierUnits: Unit[] = [];

  if (promotion.rewardSelectionMode === "customer_choice") {
    const selectedIds = new Set(explicitRewards.map((unit) => unit.id));

    qualifierUnits = qualifying.filter((unit) => !selectedIds.has(unit.id));

    const earnedApplications = maxApplications(
      promotion,
      Math.floor(qualifierUnits.length / buyQuantity),
    );

    const selectedApplications = Math.floor(
      explicitRewards.length / rewardQuantity,
    );

    applicationCount = Math.min(
      earnedApplications,
      selectedApplications,
    );

    rewardUnits = explicitRewards.slice(
      0,
      applicationCount * rewardQuantity,
    );

    qualifierUnits = qualifierUnits.slice(
      0,
      applicationCount * buyQuantity,
    );

    const earnedRewardQuantity =
      earnedApplications * rewardQuantity;

    const selectedRewardQuantity =
      Math.min(
        explicitRewards.length,
        earnedRewardQuantity,
      );

    const entitlement: PromotionEntitlement = {
      promotionId: promotion.id,
      promotionName: promotion.name,
      earnedRewardQuantity,
      selectedRewardQuantity,
      remainingRewardQuantity: Math.max(
        0,
        earnedRewardQuantity - selectedRewardQuantity,
      ),
    };

    if (applicationCount <= 0) {
      return {
        applied: null,
        entitlement,
      };
    }

    return {
      applied: buildBuyXGetYResult(
        promotion,
        qualifierUnits,
        rewardUnits,
        buyQuantity,
        rewardQuantity,
        roundingIncrementMinor,
      ),
      entitlement,
    };
  }

  if (samePool) {
    const eligible = qualifying;

    applicationCount = maxApplications(
      promotion,
      Math.floor(
        eligible.length /
          (buyQuantity + rewardQuantity),
      ),
    );

    if (applicationCount <= 0) {
      return {
        applied: null,
        entitlement: {
          promotionId: promotion.id,
          promotionName: promotion.name,
          earnedRewardQuantity:
            maxApplications(
              promotion,
              Math.floor(eligible.length / buyQuantity),
            ) * rewardQuantity,
          selectedRewardQuantity: 0,
          remainingRewardQuantity:
            maxApplications(
              promotion,
              Math.floor(eligible.length / buyQuantity),
            ) * rewardQuantity,
        },
      };
    }

    const neededRewards = applicationCount * rewardQuantity;

    rewardUnits = [...eligible]
      .sort((left, right) => {
        if (left.priceMinor === right.priceMinor) {
          return left.id.localeCompare(right.id);
        }
        return left.priceMinor - right.priceMinor;
      })
      .slice(0, neededRewards);

    const rewardIds = new Set(rewardUnits.map((unit) => unit.id));

    qualifierUnits = eligible
      .filter((unit) => !rewardIds.has(unit.id))
      .slice(0, applicationCount * buyQuantity);
  } else {
    const rewardCandidates = units.filter(
      (unit) =>
        inScope(unit, promotion, "reward") &&
        unit.exclusivePromotionId === null,
    );

    applicationCount = maxApplications(
      promotion,
      Math.min(
        Math.floor(qualifying.length / buyQuantity),
        Math.floor(rewardCandidates.length / rewardQuantity),
      ),
    );

    if (applicationCount <= 0) {
      return {
        applied: null,
        entitlement: {
          promotionId: promotion.id,
          promotionName: promotion.name,
          earnedRewardQuantity:
            maxApplications(
              promotion,
              Math.floor(qualifying.length / buyQuantity),
            ) * rewardQuantity,
          selectedRewardQuantity: 0,
          remainingRewardQuantity:
            maxApplications(
              promotion,
              Math.floor(qualifying.length / buyQuantity),
            ) * rewardQuantity,
        },
      };
    }

    qualifierUnits = qualifying.slice(
      0,
      applicationCount * buyQuantity,
    );

    rewardUnits = [...rewardCandidates]
      .sort((left, right) => {
        if (left.priceMinor === right.priceMinor) {
          return left.id.localeCompare(right.id);
        }
        return left.priceMinor - right.priceMinor;
      })
      .slice(0, applicationCount * rewardQuantity);
  }

  return {
    applied: buildBuyXGetYResult(
      promotion,
      qualifierUnits,
      rewardUnits,
      buyQuantity,
      rewardQuantity,
      roundingIncrementMinor,
    ),
    entitlement: null,
  };
}

function buildBuyXGetYResult(
  promotion: PromotionDefinition,
  qualifierUnits: Unit[],
  rewardUnits: Unit[],
  buyQuantity: number,
  rewardQuantity: number,
  roundingIncrementMinor: number,
): AppliedPromotionResult | null {
  const applicationCount = Math.min(
    Math.floor(qualifierUnits.length / buyQuantity),
    Math.floor(rewardUnits.length / rewardQuantity),
  );

  if (applicationCount <= 0) {
    return null;
  }

  const groups: PromotionGroupResult[] = [];

  for (let index = 0; index < applicationCount; index += 1) {
    const qualifiers = qualifierUnits.slice(
      index * buyQuantity,
      (index + 1) * buyQuantity,
    );

    const rewards = rewardUnits.slice(
      index * rewardQuantity,
      (index + 1) * rewardQuantity,
    );

    const groupUnits = [...qualifiers, ...rewards];
    const groupKey = `promotion:${promotion.id}:group:${index + 1}`;

    const rawDiscount = rewards.reduce(
      (total, unit) =>
        total +
        rewardDiscountMinor(
          promotion,
          unit,
          roundingIncrementMinor,
        ),
      0,
    );

    const groupDiscount = roundDiscount(
      rawDiscount,
      roundingIncrementMinor,
    );

    const allocated = addGroupAllocation(
      promotion,
      groupKey,
      groupUnits,
      groupDiscount,
      (unit) => unit.priceMinor,
    );

    if (allocated <= 0) {
      continue;
    }

    groupUnits.forEach((unit) => {
      unit.exclusivePromotionId = promotion.id;
    });

    groups.push({
      groupKey,
      discountMinor: allocated,
      lineKeys: [...new Set(groupUnits.map((unit) => unit.lineKey))],
    });
  }

  if (groups.length === 0) {
    return null;
  }

  return {
    promotionId: promotion.id,
    promotionName: promotion.name,
    publicLabel: promotion.publicLabel,
    kind: promotion.kind,
    discountMinor: groups.reduce(
      (total, group) => total + group.discountMinor,
      0,
    ),
    applicationCount: groups.length,
    stackWithDiscountCodes: promotion.stackWithDiscountCodes,
    stackWithShippingPromotion: promotion.stackWithShippingPromotion,
    groups,
  };
}

function applyPercentOff(
  promotion: PromotionDefinition,
  units: Unit[],
  roundingIncrementMinor: number,
): AppliedPromotionResult | null {
  const percent = promotion.percentOff ?? 0;

  if (!validPositiveInteger(percent) || percent > 100) {
    return null;
  }

  const eligible = units.filter((unit) => {
    if (!inScope(unit, promotion, "qualifying")) {
      return false;
    }

    if (
      !promotion.stackWithOtherPromotions &&
      unit.allocations.length > 0
    ) {
      return false;
    }

    return currentNetMinor(unit) > 0;
  });

  if (eligible.length === 0) {
    return null;
  }

  const baseMinor = eligible.reduce(
    (total, unit) => total + currentNetMinor(unit),
    0,
  );

  const discountMinor = roundDiscount(
    Math.floor((baseMinor * percent) / 100),
    roundingIncrementMinor,
  );

  if (discountMinor <= 0) {
    return null;
  }

  const groupKey = `promotion:${promotion.id}:group:1`;

  const allocated = addGroupAllocation(
    promotion,
    groupKey,
    eligible,
    discountMinor,
    currentNetMinor,
  );

  if (allocated <= 0) {
    return null;
  }

  return {
    promotionId: promotion.id,
    promotionName: promotion.name,
    publicLabel: promotion.publicLabel,
    kind: promotion.kind,
    discountMinor: allocated,
    applicationCount: 1,
    stackWithDiscountCodes: promotion.stackWithDiscountCodes,
    stackWithShippingPromotion: promotion.stackWithShippingPromotion,
    groups: [
      {
        groupKey,
        discountMinor: allocated,
        lineKeys: [...new Set(eligible.map((unit) => unit.lineKey))],
      },
    ],
  };
}

function applyBundlePrice(
  promotion: PromotionDefinition,
  units: Unit[],
  roundingIncrementMinor: number,
): AppliedPromotionResult | null {
  const quantity = promotion.bundleQuantity ?? 0;
  const priceMinor = promotion.bundlePriceMinor ?? -1;

  if (
    !validPositiveInteger(quantity) ||
    !Number.isSafeInteger(priceMinor) ||
    priceMinor < 0
  ) {
    return null;
  }

  const eligible = units
    .filter(
      (unit) =>
        inScope(unit, promotion, "qualifying") &&
        unit.exclusivePromotionId === null,
    )
    .sort((left, right) => {
      if (left.priceMinor === right.priceMinor) {
        return left.id.localeCompare(right.id);
      }
      return right.priceMinor - left.priceMinor;
    });

  const applicationCount = maxApplications(
    promotion,
    Math.floor(eligible.length / quantity),
  );

  const groups: PromotionGroupResult[] = [];

  for (let index = 0; index < applicationCount; index += 1) {
    const groupUnits = eligible.slice(
      index * quantity,
      (index + 1) * quantity,
    );

    const grossMinor = groupUnits.reduce(
      (total, unit) => total + currentNetMinor(unit),
      0,
    );

    const discountMinor = roundDiscount(
      Math.max(0, grossMinor - priceMinor),
      roundingIncrementMinor,
    );

    if (discountMinor <= 0) {
      continue;
    }

    const groupKey = `promotion:${promotion.id}:group:${index + 1}`;

    const allocated = addGroupAllocation(
      promotion,
      groupKey,
      groupUnits,
      discountMinor,
      currentNetMinor,
    );

    if (allocated <= 0) {
      continue;
    }

    groupUnits.forEach((unit) => {
      unit.exclusivePromotionId = promotion.id;
    });

    groups.push({
      groupKey,
      discountMinor: allocated,
      lineKeys: [...new Set(groupUnits.map((unit) => unit.lineKey))],
    });
  }

  if (groups.length === 0) {
    return null;
  }

  return {
    promotionId: promotion.id,
    promotionName: promotion.name,
    publicLabel: promotion.publicLabel,
    kind: promotion.kind,
    discountMinor: groups.reduce(
      (total, group) => total + group.discountMinor,
      0,
    ),
    applicationCount: groups.length,
    stackWithDiscountCodes: promotion.stackWithDiscountCodes,
    stackWithShippingPromotion: promotion.stackWithShippingPromotion,
    groups,
  };
}

export function calculatePromotions(input: {
  lines: PromotionCartLine[];
  promotions: PromotionDefinition[];
  channel: PromotionChannel;
  roundingIncrementMinor?: number;
}): PromotionCalculationResult {
  const roundingIncrementMinor =
    input.roundingIncrementMinor ?? 1;

  const units: Unit[] = [];

  input.lines.forEach((line, lineIndex) => {
    if (
      !Number.isSafeInteger(line.productId) ||
      line.productId <= 0 ||
      !Number.isSafeInteger(line.unitPriceMinor) ||
      line.unitPriceMinor < 0 ||
      !validPositiveInteger(line.quantity)
    ) {
      throw new Error("PROMOTION_CART_LINE_INVALID");
    }

    for (let unitIndex = 0; unitIndex < line.quantity; unitIndex += 1) {
      units.push({
        id: `${lineIndex}:${unitIndex}`,
        lineKey: line.key,
        lineIndex,
        unitIndex,
        productId: line.productId,
        priceMinor: line.unitPriceMinor,
        rewardForPromotionId:
          line.rewardForPromotionId ?? null,
        allocations: [],
        exclusivePromotionId: null,
      });
    }
  });

  const promotions = input.promotions
    .filter((promotion) =>
      promotionSupportsChannel(promotion, input.channel),
    )
    .map((promotion) =>
      input.channel === "pos" &&
      promotion.rewardSelectionMode === "customer_choice"
        ? {
            ...promotion,
            // Store POS has no concept of a customer-side reward picker.
            // It deterministically applies the eligible reward using the
            // automatic cheapest-item rule while web keeps explicit choice.
            rewardSelectionMode: "cheapest" as const,
          }
        : promotion,
    )
    .sort((left, right) => {
      if (left.priority === right.priority) {
        return left.id - right.id;
      }

      return right.priority - left.priority;
    });

  const applied: AppliedPromotionResult[] = [];
  const entitlements: PromotionEntitlement[] = [];

  for (const promotion of promotions) {
    if (promotion.kind === "buy_x_get_y") {
      const result = applyBuyXGetY(
        promotion,
        units,
        roundingIncrementMinor,
      );

      if (result.applied) {
        applied.push(result.applied);
      }

      if (
        result.entitlement &&
        result.entitlement.earnedRewardQuantity > 0
      ) {
        entitlements.push(result.entitlement);
      }

      continue;
    }

    if (promotion.kind === "bundle_price") {
      const result = applyBundlePrice(
        promotion,
        units,
        roundingIncrementMinor,
      );

      if (result) {
        applied.push(result);
      }

      continue;
    }

    if (promotion.kind === "percent_off") {
      const result = applyPercentOff(
        promotion,
        units,
        roundingIncrementMinor,
      );

      if (result) {
        applied.push(result);
      }
    }
  }

  const lineMap = new Map<string, PromotionLineResult>();

  for (const line of input.lines) {
    lineMap.set(line.key, {
      key: line.key,
      promotionDiscountMinor: 0,
      allocations: [],
    });
  }

  for (const unit of units) {
    const line = lineMap.get(unit.lineKey);

    if (!line) continue;

    for (const allocation of unit.allocations) {
      line.promotionDiscountMinor += allocation.discountMinor;

      const current = line.allocations.find(
        (entry) =>
          entry.promotionId === allocation.promotionId &&
          entry.groupKey === allocation.groupKey,
      );

      if (current) {
        current.discountMinor += allocation.discountMinor;
      } else {
        line.allocations.push({ ...allocation });
      }
    }
  }

  const lines = [...lineMap.values()];

  return {
    totalDiscountMinor: lines.reduce(
      (total, line) => total + line.promotionDiscountMinor,
      0,
    ),
    lines,
    promotions: applied,
    entitlements,
  };
}
