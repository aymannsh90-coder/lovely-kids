import "./ReportVisualRefresh.css";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getOwnerInventoryIntelligenceReport,
  type InventoryActionSignal,
  type InventoryCoverageSignal,
  type InventoryMovementClass,
  type InventoryRiskSignal,
  type InventoryStockState,
  type OwnerInventoryIntelligenceProduct,
  type OwnerInventoryIntelligenceReport,
  type OwnerInventoryIntelligenceVariant,
} from "../../lib/api";

type SortMode =
  | "attention"
  | "sold30"
  | "sold90"
  | "sell_through_30"
  | "velocity"
  | "days_of_supply"
  | "inventory_risk"
  | "reorder_quantity"
  | "excess_units"
  | "reorder_budget"
  | "excess_value"
  | "slow_dead_capital"
  | "oldest"
  | "last_sale";

type ProductPreview = {
  image: string;
  name: string;
};

type VariantFilter =
  | "attention"
  | "all"
  | "reorder"
  | "stockout"
  | "excess"
  | "slow";

type MetricFilterKey =
  | "fast_movers"
  | "slow_movers"
  | "dead_movers"
  | "fast_out_of_stock"
  | "never_sold_in_stock"
  | "in_stock"
  | "sell_through_30"
  | "sell_through_90"
  | "coverage_low"
  | "coverage_healthy"
  | "coverage_high"
  | "coverage_insufficient"
  | "stockout_now"
  | "stockout_high"
  | "stockout_watch"
  | "overstock_high"
  | "overstock_watch"
  | "risk_insufficient"
  | "reorder_products"
  | "reorder_units"
  | "excess_products"
  | "excess_units"
  | "no_demand_review"
  | "action_insufficient"
  | "reorder_budget_known"
  | "excess_value_known"
  | "slow_dead_capital_known"
  | "reorder_budget_missing"
  | "excess_value_missing"
  | "cost_quantity_mismatch"
  | "owner_buy"
  | "owner_stop_buying"
  | "owner_liquidate"
  | "owner_watch";

const metricFilterLabels: Record<
  MetricFilterKey,
  string
> = {
  fast_movers: "أصناف سريعة",
  slow_movers: "أصناف بطيئة",
  dead_movers: "مخزون ميت",
  fast_out_of_stock: "سريع ونفد",
  never_sold_in_stock: "لم يُبع بعد",
  in_stock: "أصناف متوفرة",
  sell_through_30: "تصريف 30 يوم",
  sell_through_90: "تصريف 90 يوم",
  coverage_low: "تغطية حتى 14 يوم",
  coverage_healthy: "تغطية 15–60 يوم",
  coverage_high: "تغطية فوق 60 يوم",
  coverage_insufficient:
    "بيانات تغطية غير كافية",
  stockout_now: "نفد مع طلب حديث",
  stockout_high: "خطر نفاد مرتفع",
  stockout_watch: "مراقبة نفاد",
  overstock_high: "فائض مرتفع",
  overstock_watch: "مراقبة فائض",
  risk_insufficient:
    "بيانات مخاطرة غير كافية",
  reorder_products: "أصناف شراء مقترح",
  reorder_units: "إجمالي وحدات شراء",
  excess_products: "أصناف فائض محتمل",
  excess_units: "إجمالي وحدات فائض",
  no_demand_review:
    "بلا طلب صافي للمراجعة",
  action_insufficient:
    "بيانات قرار غير كافية",
  reorder_budget_known:
    "ميزانية شراء تقديرية",
  excess_value_known:
    "قيمة فائض محتملة",
  slow_dead_capital_known:
    "رأس مال بطيء / ميت",
  reorder_budget_missing:
    "شراء ناقص التكلفة",
  excess_value_missing:
    "فائض ناقص القيمة",
  cost_quantity_mismatch:
    "فروق كمية التكلفة",
  owner_buy: "اشترِ الآن",
  owner_stop_buying: "أوقف / خفف الشراء",
  owner_liquidate: "ابدأ التصريف",
  owner_watch: "راقب اليوم",
};

function matchesMetricFilter(
  product:
    OwnerInventoryIntelligenceProduct,
  filter: MetricFilterKey,
) {
  switch (filter) {
    case "fast_movers":
      return (
        product.movementClass ===
        "fast"
      );
    case "slow_movers":
      return (
        product.movementClass ===
        "slow"
      );
    case "dead_movers":
      return (
        product.movementClass ===
        "dead"
      );
    case "fast_out_of_stock":
      return (
        product.movementClass ===
          "fast" &&
        product.currentQuantity === 0
      );
    case "never_sold_in_stock":
      return (
        product.neverSold &&
        product.currentQuantity !==
          null &&
        product.currentQuantity > 0
      );
    case "in_stock":
      return (
        product.currentQuantity !==
          null &&
        product.currentQuantity > 0
      );
    case "sell_through_30":
      return product.sellThrough30Reliable;
    case "sell_through_90":
      return product.sellThrough90Reliable;
    case "coverage_low":
      return (
        product.coverageSignal ===
        "low"
      );
    case "coverage_healthy":
      return (
        product.coverageSignal ===
        "healthy"
      );
    case "coverage_high":
      return (
        product.coverageSignal ===
        "high"
      );
    case "coverage_insufficient":
      return (
        product.coverageSignal ===
          "insufficient_history" ||
        product.coverageSignal ===
          "untracked"
      );
    case "stockout_now":
      return (
        product.inventoryRiskSignal ===
        "stockout_now"
      );
    case "stockout_high":
      return (
        product.inventoryRiskSignal ===
        "stockout_high"
      );
    case "stockout_watch":
      return (
        product.inventoryRiskSignal ===
        "stockout_watch"
      );
    case "overstock_high":
      return (
        product.inventoryRiskSignal ===
        "overstock_high"
      );
    case "overstock_watch":
      return (
        product.inventoryRiskSignal ===
        "overstock_watch"
      );
    case "risk_insufficient":
      return (
        product.inventoryRiskSignal ===
          "insufficient_history" ||
        product.inventoryRiskSignal ===
          "untracked"
      );
    case "reorder_products":
      return (
        product.inventoryActionSignal ===
        "reorder"
      );
    case "reorder_units":
      return (
        (
          product
            .suggestedReorderQuantity ??
          0
        ) > 0
      );
    case "excess_products":
      return (
        product.inventoryActionSignal ===
          "reduce" ||
        product.inventoryActionSignal ===
          "review_no_demand"
      );
    case "excess_units":
      return (
        (product.excessUnits ?? 0) > 0
      );
    case "no_demand_review":
      return (
        product.inventoryActionSignal ===
        "review_no_demand"
      );
    case "action_insufficient":
      return !product.actionPlanReliable;
    case "reorder_budget_known":
      return (
        (
          product
            .suggestedReorderQuantity ??
          0
        ) > 0 &&
        product
          .suggestedReorderBudgetMinor !==
          null
      );
    case "excess_value_known":
      return (
        (product.excessUnits ?? 0) > 0 &&
        product
          .excessInventoryValueMinor !==
          null
      );
    case "slow_dead_capital_known":
      return (
        (
          product.movementClass ===
            "slow" ||
          product.movementClass ===
            "dead"
        ) &&
        (product.currentQuantity ?? 0) >
          0 &&
        product.slowDeadCapitalMinor !==
          null
      );
    case "reorder_budget_missing":
      return (
        (
          product
            .suggestedReorderQuantity ??
          0
        ) > 0 &&
        product
          .suggestedReorderBudgetMinor ===
          null
      );
    case "excess_value_missing":
      return (
        (product.excessUnits ?? 0) > 0 &&
        product
          .excessInventoryValueMinor ===
          null
      );
    case "cost_quantity_mismatch":
      return (
        product.costInitialized &&
        !product
          .costStockMatchesAccounting
      );
    case "owner_buy":
      return (
        product.inventoryActionSignal ===
        "reorder"
      );
    case "owner_stop_buying":
      return (
        product.inventoryActionSignal ===
          "reduce" ||
        product.inventoryActionSignal ===
          "review_no_demand"
      );
    case "owner_liquidate":
      return (
        product.inventoryRiskSignal ===
          "overstock_high" ||
        product.movementClass ===
          "dead"
      );
    case "owner_watch":
      return (
        product.inventoryRiskSignal ===
          "stockout_watch" ||
        product.inventoryRiskSignal ===
          "overstock_watch"
      );
  }

  return false;
}

function metricFilterSortMode(
  filter: MetricFilterKey,
): SortMode {
  switch (filter) {
    case "sell_through_30":
      return "sell_through_30";
    case "sell_through_90":
      return "sold90";
    case "coverage_low":
    case "coverage_healthy":
    case "coverage_high":
      return "days_of_supply";
    case "stockout_now":
    case "stockout_high":
    case "stockout_watch":
    case "overstock_high":
    case "overstock_watch":
    case "risk_insufficient":
    case "owner_watch":
      return "inventory_risk";
    case "reorder_products":
    case "reorder_units":
    case "reorder_budget_missing":
    case "owner_buy":
      return "reorder_quantity";
    case "excess_products":
    case "excess_units":
    case "no_demand_review":
    case "excess_value_missing":
    case "owner_stop_buying":
    case "owner_liquidate":
      return "excess_units";
    case "reorder_budget_known":
      return "reorder_budget";
    case "excess_value_known":
      return "excess_value";
    case "slow_dead_capital_known":
    case "cost_quantity_mismatch":
      return "slow_dead_capital";
    default:
      return "attention";
  }
}

const movementLabels:
  Record<
    InventoryMovementClass,
    string
  > = {
    fast: "سريع",
    normal: "طبيعي",
    slow: "بطيء",
    dead: "ميت",
    new: "جديد",
  };

const stockLabels:
  Record<
    InventoryStockState,
    string
  > = {
    in_stock: "متوفر",
    out_of_stock: "نفد",
    untracked: "كمية غير مكتملة",
  };

const coverageLabels:
  Record<
    InventoryCoverageSignal,
    string
  > = {
    untracked: "مخزون غير متتبع",
    insufficient_history:
      "تاريخ غير كافٍ",
    no_net_demand:
      "لا يوجد طلب صافي",
    out_of_stock: "نفد",
    low: "نفد قريبًا",
    healthy: "تغطية جيدة",
    high: "تغطية عالية",
  };

const riskLabels:
  Record<
    InventoryRiskSignal,
    string
  > = {
    untracked: "غير متتبع",
    insufficient_history:
      "بيانات غير كافية",
    balanced: "لا خطر مؤكد",
    stockout_now: "نفد مع طلب حديث",
    stockout_high: "خطر نفاد مرتفع",
    stockout_watch: "مراقبة نفاد",
    overstock_high: "فائض مرتفع",
    overstock_watch: "مراقبة فائض",
  };

const actionLabels:
  Record<
    InventoryActionSignal,
    string
  > = {
    untracked: "مخزون غير متتبع",
    insufficient_history:
      "بيانات غير كافية",
    reorder: "شراء مقترح",
    reduce: "فائض قابل للتخفيف",
    review_no_demand:
      "فائض محتمل بلا طلب",
    balanced: "ضمن الخطة",
  };

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
  ).format(value);
}

function formatMoney(
  valueMinor: number | null,
) {
  if (valueMinor === null) {
    return "N/A";
  }

  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(valueMinor / 100)} ₪`;
}

function formatDecimal(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 1,
    },
  ).format(value);
}

function formatPercent(
  value: number | null,
) {
  return value === null
    ? "N/A"
    : `${formatDecimal(value)}%`;
}

function formatRate(
  value: number | null,
) {
  if (value === null) {
    return "N/A";
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    },
  ).format(value);
}

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "—";
  }

  return value;
}

function costStatusLabel(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  if (!product.costInitialized) {
    return "تكلفة غير مدخلة";
  }

  if (
    !product
      .costStockMatchesAccounting
  ) {
    return "فرق كمية بين المخزون والتكلفة";
  }

  if (
    product.costQuality ===
    "confirmed"
  ) {
    return "تكلفة مؤكدة";
  }

  if (
    product.costQuality ===
    "estimated"
  ) {
    return "تكلفة تقديرية";
  }

  if (
    product.costQuality ===
    "mixed"
  ) {
    return "تكلفة مختلطة";
  }

  return "تكلفة غير مكتملة";
}

const URGENT_REORDER_RECENCY_DAYS =
  14;

function isUrgentReorder(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  return (
    product.movementClass ===
      "fast" &&
    product.stockState ===
      "out_of_stock" &&
    product.daysSinceLastSale !==
      null &&
    product.daysSinceLastSale <=
      URGENT_REORDER_RECENCY_DAYS
  );
}

function movementHint(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  if (
    isUrgentReorder(product)
  ) {
    return "إعادة طلب عاجلة";
  }

  if (
    product.movementClass ===
      "fast" &&
    product.stockState ===
      "out_of_stock"
  ) {
    return "راجع إعادة الطلب";
  }

  if (
    product.movementClass ===
    "dead"
  ) {
    return "مرشح للتصريف";
  }

  if (
    product.movementClass ===
    "slow"
  ) {
    return "راجع السعر أو العرض";
  }

  if (
    product.movementClass ===
    "fast"
  ) {
    return "راقب إعادة الطلب";
  }

  if (
    product.movementClass ===
      "new" &&
    product.stockState ===
      "out_of_stock"
  ) {
    return "نفد مبكرًا — راقب الطلب";
  }

  if (
    product.movementClass ===
    "new"
  ) {
    return "أعطه وقتًا للحركة";
  }

  if (
    product.stockState ===
      "out_of_stock" &&
    product.sold30 > 0
  ) {
    return "نفد — راجع الحاجة";
  }

  return "حركة طبيعية";
}


function variantMatchesFilter(
  variant:
    OwnerInventoryIntelligenceVariant,
  filter: VariantFilter,
) {
  switch (filter) {
    case "all":
      return true;
    case "reorder":
      return (
        variant.inventoryActionSignal ===
        "reorder"
      );
    case "stockout":
      return (
        variant.inventoryRiskSignal ===
          "stockout_now" ||
        variant.inventoryRiskSignal ===
          "stockout_high" ||
        variant.inventoryRiskSignal ===
          "stockout_watch"
      );
    case "excess":
      return (
        variant.inventoryRiskSignal ===
          "overstock_high" ||
        variant.inventoryRiskSignal ===
          "overstock_watch" ||
        variant.inventoryActionSignal ===
          "reduce" ||
        variant.inventoryActionSignal ===
          "review_no_demand"
      );
    case "slow":
      return (
        variant.movementClass ===
          "slow" ||
        variant.movementClass ===
          "dead"
      );
    case "attention":
      return (
        variant.inventoryRiskSignal !==
          "balanced" ||
        variant.inventoryActionSignal !==
          "balanced"
      );
  }
}

function variantPriority(
  variant:
    OwnerInventoryIntelligenceVariant,
) {
  const risk =
    riskPriority(
      variant.inventoryRiskSignal,
    );

  if (risk < 5) {
    return risk;
  }

  if (
    variant.inventoryActionSignal ===
    "reorder"
  ) {
    return 2;
  }

  if (
    variant.inventoryActionSignal ===
      "reduce" ||
    variant.inventoryActionSignal ===
      "review_no_demand"
  ) {
    return 4;
  }

  if (
    variant.movementClass ===
      "slow" ||
    variant.movementClass ===
      "dead"
  ) {
    return 4;
  }

  if (
    !variant.actionPlanReliable
  ) {
    return 6;
  }

  return 5;
}

function variantDecision(
  variant:
    OwnerInventoryIntelligenceVariant,
) {
  if (
    variant.inventoryRiskSignal ===
    "stockout_now"
  ) {
    return "شراء عاجل";
  }

  if (
    variant.inventoryRiskSignal ===
    "stockout_high"
  ) {
    return "خطر نفاد مرتفع";
  }

  if (
    variant.inventoryActionSignal ===
    "reorder"
  ) {
    return "شراء مقترح";
  }

  if (
    variant.inventoryRiskSignal ===
      "overstock_high" ||
    variant.movementClass ===
      "dead"
  ) {
    return "خفف الشراء / صرّف";
  }

  if (
    variant.inventoryActionSignal ===
    "review_no_demand"
  ) {
    return "راجع الراكد";
  }

  if (
    variant.inventoryRiskSignal ===
      "stockout_watch" ||
    variant.inventoryRiskSignal ===
      "overstock_watch"
  ) {
    return "مراقبة";
  }

  if (
    !variant.actionPlanReliable
  ) {
    return "بيانات غير كافية";
  }

  return "متوازن";
}

function riskPriority(
  signal: InventoryRiskSignal,
) {
  switch (signal) {
    case "stockout_now":
      return 0;
    case "stockout_high":
      return 1;
    case "overstock_high":
      return 2;
    case "stockout_watch":
      return 3;
    case "overstock_watch":
      return 4;
    case "balanced":
      return 5;
    case "insufficient_history":
      return 6;
    case "untracked":
      return 7;
  }

  return 8;
}

function inventoryRiskAction(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  switch (
    product.inventoryRiskSignal
  ) {
    case "stockout_now":
      return "إعادة طلب عاجلة";
    case "stockout_high":
      return "راجع إعادة الطلب اليوم";
    case "stockout_watch":
      return "جهّز إعادة الطلب";
    case "overstock_high":
      return "خفف الشراء وابدأ تصريف";
    case "overstock_watch":
      return "خفف الشراء وراقب الحركة";
    case "untracked":
      return "أكمل تتبع المخزون";
    case "insufficient_history":
      return "انتظر بيانات حركة موثوقة";
    case "balanced":
      return product.stockState ===
        "out_of_stock"
        ? "لا طلب حديث — راقب الحاجة"
        : movementHint(
            product,
          );
  }

  return "راجع المخزون";
}

function attentionRank(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  const inventoryRiskRank =
    riskPriority(
      product.inventoryRiskSignal,
    );

  if (inventoryRiskRank < 5) {
    return inventoryRiskRank;
  }
  if (
    isUrgentReorder(product)
  ) {
    return 0;
  }

  if (
    product.movementClass ===
    "dead"
  ) {
    return 1;
  }

  if (
    product.movementClass ===
    "slow"
  ) {
    return 2;
  }

  if (
    product.movementClass ===
    "fast"
  ) {
    return 3;
  }

  if (
    product.movementClass ===
    "new"
  ) {
    return 4;
  }

  return 5;
}

function Metric({
  label,
  value,
  hint,
  emphasis = false,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const classNames = [
    "inventory-intelligence-metric",
  ];

  if (emphasis) {
    classNames.push("is-emphasis");
  }

  if (onClick) {
    classNames.push("is-clickable");
  }

  if (active) {
    classNames.push("is-active");
  }

  if (!onClick) {
    return (
      <article
        className={classNames.join(" ")}
      >
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </article>
    );
  }

  return (
    <button
      type="button"
      className={classNames.join(" ")}
      onClick={onClick}
      aria-pressed={active}
      title="اضغط لعرض الأصناف الداخلة في هذا المؤشر"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </button>
  );
} 

type OwnerPriorityItem = {
  product:
    OwnerInventoryIntelligenceProduct;
  rank: number;
  tone:
    | "buy"
    | "liquidate"
    | "watch"
    | "reduce";
  action: string;
  reason: string;
};

type OwnerExecutionStatus =
  | "new"
  | "in_progress"
  | "done"
  | "deferred";

type OwnerExecutionEntry = {
  status: OwnerExecutionStatus;
  updatedAt: string;
  action: string;
  reason: string;
};

type OwnerExecutionState = Record<
  string,
  OwnerExecutionEntry
>;

const OWNER_EXECUTION_STORAGE_KEY =
  "lovely_kids_inventory_action_execution_v1";

const INVENTORY_PURCHASE_HANDOFF_KEY =
  "lovely_kids_inventory_purchase_handoff_v1";

const INVENTORY_PURCHASE_HANDOFF_VERSION =
  2;

function createInventoryPurchaseHandoffId() {
  return typeof crypto.randomUUID ===
    "function"
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;
}

const ownerExecutionLabels: Record<
  OwnerExecutionStatus,
  string
> = {
  new: "جديد",
  in_progress: "قيد التنفيذ",
  done: "تم",
  deferred: "مؤجل",
};

function readOwnerExecutionState(): OwnerExecutionState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(
      OWNER_EXECUTION_STORAGE_KEY,
    );

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<
      string,
      Partial<OwnerExecutionEntry>
    >;

    const result: OwnerExecutionState = {};

    Object.entries(parsed).forEach(
      ([productId, entry]) => {
        if (
          entry.status === "new" ||
          entry.status === "in_progress" ||
          entry.status === "done" ||
          entry.status === "deferred"
        ) {
          result[productId] = {
            status: entry.status,
            updatedAt:
              typeof entry.updatedAt === "string"
                ? entry.updatedAt
                : new Date().toISOString(),
            action:
              typeof entry.action === "string"
                ? entry.action
                : "",
            reason:
              typeof entry.reason === "string"
                ? entry.reason
                : "",
          };
        }
      },
    );

    return result;
  } catch {
    return {};
  }
}

function ownerPriorityItem(
  product:
    OwnerInventoryIntelligenceProduct,
): OwnerPriorityItem | null {
  if (
    product.inventoryRiskSignal ===
    "stockout_now"
  ) {
    return {
      product,
      rank: 0,
      tone: "buy",
      action: "شراء عاجل",
      reason: "نفد مع طلب حديث",
    };
  }

  if (
    product.inventoryRiskSignal ===
    "stockout_high"
  ) {
    return {
      product,
      rank: 1,
      tone: "buy",
      action: "جهّز الشراء",
      reason: "خطر نفاد مرتفع",
    };
  }

  if (
    product.inventoryActionSignal ===
    "reorder"
  ) {
    return {
      product,
      rank: 2,
      tone: "buy",
      action: "شراء مقترح",
      reason: "تحت هدف التغطية",
    };
  }

  if (
    product.inventoryRiskSignal ===
      "overstock_high" ||
    product.movementClass === "dead"
  ) {
    return {
      product,
      rank: 3,
      tone: "liquidate",
      action: "ابدأ التصريف",
      reason:
        product.movementClass === "dead"
          ? "مخزون ميت"
          : "فائض مرتفع",
    };
  }

  if (
    product.inventoryRiskSignal ===
      "stockout_watch" ||
    product.inventoryRiskSignal ===
      "overstock_watch"
  ) {
    return {
      product,
      rank: 4,
      tone: "watch",
      action: "راقب اليوم",
      reason:
        product.inventoryRiskSignal ===
        "stockout_watch"
          ? "قريب من خطر النفاد"
          : "قريب من فائض أعلى",
    };
  }

  if (
    product.inventoryActionSignal ===
      "reduce" ||
    product.inventoryActionSignal ===
      "review_no_demand"
  ) {
    return {
      product,
      rank: 5,
      tone: "reduce",
      action: "خفف الشراء",
      reason:
        product.inventoryActionSignal ===
        "review_no_demand"
          ? "بلا طلب صافي"
          : "فوق الخطة",
    };
  }

  return null;
}

function ownerPriorityQuantity(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  if (
    (product.suggestedReorderQuantity ??
      0) > 0
  ) {
    return `شراء +${formatNumber(
      product.suggestedReorderQuantity ??
        0,
    )}`;
  }

  if (
    (product.excessUnits ?? 0) > 0
  ) {
    return `فائض ${formatNumber(
      product.excessUnits ?? 0,
    )}`;
  }

  return product.currentQuantity === null
    ? "كمية غير مكتملة"
    : `مخزون ${formatNumber(
        product.currentQuantity,
      )}`;
}

function ownerPriorityMoney(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  if (
    product.suggestedReorderBudgetMinor !==
    null
  ) {
    return `شراء ${formatMoney(
      product.suggestedReorderBudgetMinor,
    )}`;
  }

  if (
    product.excessInventoryValueMinor !==
    null
  ) {
    return `فائض ${formatMoney(
      product.excessInventoryValueMinor,
    )}`;
  }

  if (
    product.slowDeadCapitalMinor !==
    null
  ) {
    return `رأس مال ${formatMoney(
      product.slowDeadCapitalMinor,
    )}`;
  }

  return "الأثر المالي غير مكتمل";
}

function OwnerActionCard({
  label,
  count,
  primary,
  secondary,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  primary: string;
  secondary: string;
  tone:
    | "buy"
    | "stop"
    | "liquidate"
    | "watch";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inventory-owner-action-card tone-${tone}${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span>{label}</span>
      <strong>
        {formatNumber(count)} صنف
      </strong>
      <b>{primary}</b>
      <small>{secondary}</small>
    </button>
  );
}

export default function InventoryIntelligenceReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    preview,
    setPreview,
  ] =
    useState<
      ProductPreview | null
    >(null);

  const [
    report,
    setReport,
  ] =
    useState<
      OwnerInventoryIntelligenceReport | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    movementFilter,
    setMovementFilter,
  ] =
    useState<
      InventoryMovementClass | "all"
    >("all");

  const [
    stockFilter,
    setStockFilter,
  ] =
    useState<
      InventoryStockState | "all"
    >("all");

  const [
    categoryFilter,
    setCategoryFilter,
  ] =
    useState("all");

  const [
    coverageFilter,
    setCoverageFilter,
  ] =
    useState<
      InventoryCoverageSignal | "all"
    >("all");

  const [
    riskFilter,
    setRiskFilter,
  ] =
    useState<
      InventoryRiskSignal | "all"
    >("all");

  const [
    actionFilter,
    setActionFilter,
  ] =
    useState<
      InventoryActionSignal | "all"
    >("all");

  const [
    sortMode,
    setSortMode,
  ] =
    useState<SortMode>(
      "attention",
    );

  const [
    metricFilter,
    setMetricFilter,
  ] =
    useState<
      MetricFilterKey | null
    >(null);

  const [
    executionState,
    setExecutionState,
  ] = useState<OwnerExecutionState>(
    readOwnerExecutionState,
  );

  const [
    executionFilter,
    setExecutionFilter,
  ] = useState<
    OwnerExecutionStatus | "all"
  >("all");

  const [
    variantFilter,
    setVariantFilter,
  ] =
    useState<VariantFilter>(
      "attention",
    );

  const [
    variantQuery,
    setVariantQuery,
  ] =
    useState("");

  function resetManualFilters() {
    setQuery("");
    setMovementFilter("all");
    setStockFilter("all");
    setCategoryFilter("all");
    setCoverageFilter("all");
    setRiskFilter("all");
    setActionFilter("all");
  }

  function handleMetricFilter(
    filter: MetricFilterKey,
  ) {
    if (metricFilter === filter) {
      setMetricFilter(null);
      return;
    }

    resetManualFilters();
    setMetricFilter(filter);
    setSortMode(
      metricFilterSortMode(filter),
    );

    window.setTimeout(() => {
      document
        .getElementById(
          "inventory-intelligence-products",
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 0);
  }

  function metricProps(
    filter: MetricFilterKey,
  ) {
    return {
      active:
        metricFilter === filter,
      onClick: () =>
        handleMetricFilter(filter),
    };
  }

  function handlePriorityProduct(
    product:
      OwnerInventoryIntelligenceProduct,
  ) {
    resetManualFilters();
    setMetricFilter(null);
    setSortMode("attention");
    setQuery(
      product.productCode ||
        product.productId,
    );

    window.setTimeout(() => {
      document
        .getElementById(
          "inventory-intelligence-products",
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 0);
  }

  function updateExecutionStatus(
    item: OwnerPriorityItem,
    status: OwnerExecutionStatus,
  ) {
    setExecutionState((current) => ({
      ...current,
      [item.product.productId]: {
        status,
        updatedAt: new Date().toISOString(),
        action: item.action,
        reason: item.reason,
      },
    }));
  }

  function preparePurchase(
    item: OwnerPriorityItem,
  ) {
    const quantity = Math.max(
      1,
      item.product
        .suggestedReorderQuantity ?? 1,
    );

    updateExecutionStatus(
      item,
      "in_progress",
    );

    const unitCost =
      item.product.referenceUnitCostMinor !==
      null
        ? (
            item.product
              .referenceUnitCostMinor / 100
          ).toFixed(2)
        : "";

    const handoff = {
      version:
        INVENTORY_PURCHASE_HANDOFF_VERSION,
      handoffId:
        createInventoryPurchaseHandoffId(),
      createdAt:
        new Date().toISOString(),
      mode: "product" as const,
      productId:
        item.product.productId,
      productCode:
        item.product.productCode ?? "",
      barcode:
        item.product.barcode ?? "",
      color: "",
      size: "",
      quantity,
      unitCost,
    };

    try {
      window.sessionStorage.setItem(
        INVENTORY_PURCHASE_HANDOFF_KEY,
        JSON.stringify(handoff),
      );
    } catch {
      // URL parameters remain as a fallback.
    }

    const params = new URLSearchParams({
      source: "inventory-intelligence",
      handoffVersion:
        String(handoff.version),
      handoffId:
        handoff.handoffId,
      handoffMode:
        handoff.mode,
      productId:
        handoff.productId,
      quantity: String(quantity),
    });

    if (handoff.productCode) {
      params.set(
        "productCode",
        handoff.productCode,
      );
    }

    if (handoff.barcode) {
      params.set(
        "barcode",
        handoff.barcode,
      );
    }

    if (unitCost) {
      params.set(
        "unitCost",
        unitCost,
      );
    }

    window.location.assign(
      `/purchases/new?${params.toString()}`,
    );
  }


  function prepareVariantPurchase(
    variant:
      OwnerInventoryIntelligenceVariant,
  ) {
    const quantity =
      Math.max(
        1,
        variant
          .suggestedReorderQuantity ??
          1,
      );

    if (!variant.barcode) {
      return;
    }

    const unitCost =
      variant.referenceUnitCostMinor !==
      null
        ? (
            variant
              .referenceUnitCostMinor /
            100
          ).toFixed(2)
        : "";

    const handoff = {
      version:
        INVENTORY_PURCHASE_HANDOFF_VERSION,
      handoffId:
        createInventoryPurchaseHandoffId(),
      createdAt:
        new Date().toISOString(),
      mode: "variant" as const,
      productId:
        variant.productId,
      productCode:
        variant.productCode ?? "",
      barcode:
        variant.barcode,
      color:
        variant.color,
      size:
        variant.size,
      quantity,
      unitCost,
    };

    try {
      window.sessionStorage.setItem(
        INVENTORY_PURCHASE_HANDOFF_KEY,
        JSON.stringify(handoff),
      );
    } catch {
      // URL parameters remain as a fallback.
    }

    const params =
      new URLSearchParams({
        source:
          "inventory-intelligence",
        handoffVersion:
          String(handoff.version),
        handoffId:
          handoff.handoffId,
        handoffMode:
          handoff.mode,
        productId:
          handoff.productId,
        barcode:
          handoff.barcode,
        color:
          handoff.color,
        size:
          handoff.size,
        quantity:
          String(quantity),
      });

    if (handoff.productCode) {
      params.set(
        "productCode",
        handoff.productCode,
      );
    }

    if (unitCost) {
      params.set(
        "unitCost",
        unitCost,
      );
    }

    window.location.assign(
      `/purchases/new?${params.toString()}`,
    );
  }

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getOwnerInventoryIntelligenceReport(
          token,
        );

      setReport(result);
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل ذكاء المخزون",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        OWNER_EXECUTION_STORAGE_KEY,
        JSON.stringify(executionState),
      );
    } catch {
      // Local execution tracking is best-effort only.
    }
  }, [executionState]);

  useEffect(() => {
    if (!preview) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setPreview(null);
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, [preview]);

  const categories =
    useMemo(
      () =>
        Array.from(
          new Set(
            report?.products.map(
              (product) =>
                product.category,
            ) ?? [],
          ),
        ).sort(
          (left, right) =>
            left.localeCompare(
              right,
              "ar",
            ),
        ),
      [report],
    );

  const ownerPriorities =
    useMemo(() => {
      const priorities =
        (report?.products ?? [])
          .map(ownerPriorityItem)
          .filter(
            (
              item,
            ): item is OwnerPriorityItem =>
              item !== null,
          );

      return priorities
        .sort((left, right) => {
          if (left.rank !== right.rank) {
            return left.rank - right.rank;
          }

          const leftUnits =
            left.product
              .suggestedReorderQuantity ??
            left.product.excessUnits ??
            0;
          const rightUnits =
            right.product
              .suggestedReorderQuantity ??
            right.product.excessUnits ??
            0;

          if (leftUnits !== rightUnits) {
            return rightUnits - leftUnits;
          }

          return (
            right.product.sold30 -
            left.product.sold30
          );
        })
        .slice(0, 10);
    }, [report]);

  const ownerExecutionSummary =
    useMemo(() => {
      const counts: Record<
        OwnerExecutionStatus,
        number
      > = {
        new: 0,
        in_progress: 0,
        done: 0,
        deferred: 0,
      };

      ownerPriorities.forEach((item) => {
        const status =
          executionState[
            item.product.productId
          ]?.status ?? "new";

        counts[status] += 1;
      });

      return counts;
    }, [ownerPriorities, executionState]);

  const displayedOwnerPriorities =
    useMemo(
      () =>
        ownerPriorities.filter((item) => {
          if (executionFilter === "all") {
            return true;
          }

          return (
            executionState[
              item.product.productId
            ]?.status ?? "new"
          ) === executionFilter;
        }),
      [
        ownerPriorities,
        executionFilter,
        executionState,
      ],
    );

  const ownerActionSummary =
    useMemo(() => {
      const products =
        report?.products ?? [];

      const liquidateProducts =
        products.filter((product) =>
          matchesMetricFilter(
            product,
            "owner_liquidate",
          ),
        );

      const watchProducts =
        products.filter((product) =>
          matchesMetricFilter(
            product,
            "owner_watch",
          ),
        );

      return {
        liquidateProducts:
          liquidateProducts.length,
        watchProducts:
          watchProducts.length,
      };
    }, [report]);


  const filteredVariants =
    useMemo(() => {
      const normalizedQuery =
        variantQuery
          .trim()
          .toLowerCase();

      return [
        ...(report?.variants ?? []),
      ]
        .filter((variant) => {
          if (
            !variantMatchesFilter(
              variant,
              variantFilter,
            )
          ) {
            return false;
          }

          if (!normalizedQuery) {
            return true;
          }

          const haystack = [
            variant.nameAr,
            variant.productId,
            variant.productCode ?? "",
            variant.barcode ?? "",
            variant.category,
            variant.color,
            variant.size,
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(
            normalizedQuery,
          );
        })
        .sort(
          (left, right) => {
            const priority =
              variantPriority(left) -
              variantPriority(right);

            if (priority !== 0) {
              return priority;
            }

            const reorder =
              (
                right
                  .suggestedReorderQuantity ??
                -1
              ) -
              (
                left
                  .suggestedReorderQuantity ??
                -1
              );

            if (reorder !== 0) {
              return reorder;
            }

            return (
              right.netDemand30 -
              left.netDemand30
            );
          },
        );
    }, [
      report,
      variantFilter,
      variantQuery,
    ]);

  const filtered =
    useMemo(() => {
      const normalizedQuery =
        query
          .trim()
          .toLowerCase();

      const rows =
        report?.products.filter(
          (product) => {
            if (
              metricFilter &&
              !matchesMetricFilter(
                product,
                metricFilter,
              )
            ) {
              return false;
            }

            if (
              movementFilter !==
                "all" &&
              product.movementClass !==
                movementFilter
            ) {
              return false;
            }

            if (
              stockFilter !==
                "all" &&
              product.stockState !==
                stockFilter
            ) {
              return false;
            }

            if (
              categoryFilter !==
                "all" &&
              product.category !==
                categoryFilter
            ) {
              return false;
            }

            if (
              coverageFilter !==
                "all" &&
              product.coverageSignal !==
                coverageFilter
            ) {
              return false;
            }

            if (
              riskFilter !==
                "all" &&
              product.inventoryRiskSignal !==
                riskFilter
            ) {
              return false;
            }

            if (
              actionFilter !==
                "all" &&
              product.inventoryActionSignal !==
                actionFilter
            ) {
              return false;
            }

            if (
              normalizedQuery
            ) {
              const haystack =
                [
                  product.nameAr,
                  product.productId,
                  product.productCode ??
                    "",
                  product.barcode ??
                    "",
                  product.category,
                ]
                  .join(" ")
                  .toLowerCase();

              if (
                !haystack.includes(
                  normalizedQuery,
                )
              ) {
                return false;
              }
            }

            return true;
          },
        ) ?? [];

      return [
        ...rows,
      ].sort(
        (left, right) => {
          if (
            sortMode ===
            "sold30"
          ) {
            return (
              right.sold30 -
              left.sold30
            );
          }

          if (
            sortMode ===
            "sold90"
          ) {
            return (
              right.sold90 -
              left.sold90
            );
          }

          if (
            sortMode ===
            "sell_through_30"
          ) {
            if (
              left.sellThrough30Percent ===
                null &&
              right.sellThrough30Percent ===
                null
            ) {
              return 0;
            }

            if (
              left.sellThrough30Percent ===
              null
            ) {
              return 1;
            }

            if (
              right.sellThrough30Percent ===
              null
            ) {
              return -1;
            }

            return (
              right.sellThrough30Percent -
              left.sellThrough30Percent
            );
          }

          if (
            sortMode ===
            "velocity"
          ) {
            return (
              (right.averageDailyNetDemand ??
                -1) -
              (left.averageDailyNetDemand ??
                -1)
            );
          }

          if (
            sortMode ===
            "days_of_supply"
          ) {
            if (
              left.daysOfSupply ===
                null &&
              right.daysOfSupply ===
                null
            ) {
              return 0;
            }

            if (
              left.daysOfSupply ===
              null
            ) {
              return 1;
            }

            if (
              right.daysOfSupply ===
              null
            ) {
              return -1;
            }

            return (
              left.daysOfSupply -
              right.daysOfSupply
            );
          }

          if (
            sortMode ===
            "inventory_risk"
          ) {
            const riskRank =
              riskPriority(
                left.inventoryRiskSignal,
              ) -
              riskPriority(
                right.inventoryRiskSignal,
              );

            if (riskRank !== 0) {
              return riskRank;
            }

            return (
              right.sold30 -
              left.sold30
            );
          }

          if (
            sortMode ===
            "reorder_quantity"
          ) {
            return (
              (right.suggestedReorderQuantity ??
                -1) -
              (left.suggestedReorderQuantity ??
                -1)
            );
          }

          if (
            sortMode ===
            "excess_units"
          ) {
            return (
              (right.excessUnits ??
                -1) -
              (left.excessUnits ??
                -1)
            );
          }

          if (
            sortMode ===
            "reorder_budget"
          ) {
            return (
              (right.suggestedReorderBudgetMinor ??
                -1) -
              (left.suggestedReorderBudgetMinor ??
                -1)
            );
          }

          if (
            sortMode ===
            "excess_value"
          ) {
            return (
              (right.excessInventoryValueMinor ??
                -1) -
              (left.excessInventoryValueMinor ??
                -1)
            );
          }

          if (
            sortMode ===
            "slow_dead_capital"
          ) {
            return (
              (right.slowDeadCapitalMinor ??
                -1) -
              (left.slowDeadCapitalMinor ??
                -1)
            );
          }

          if (
            sortMode ===
            "oldest"
          ) {
            return (
              right.ageDays -
              left.ageDays
            );
          }

          if (
            sortMode ===
            "last_sale"
          ) {
            if (
              left.lastSaleDate ===
              null
            ) {
              return -1;
            }

            if (
              right.lastSaleDate ===
              null
            ) {
              return 1;
            }

            return left.lastSaleDate.localeCompare(
              right.lastSaleDate,
            );
          }

          const rank =
            attentionRank(
              left,
            ) -
            attentionRank(
              right,
            );

          if (rank !== 0) {
            return rank;
          }

          if (
            left.movementClass ===
            "dead"
          ) {
            return (
              right.ageDays -
              left.ageDays
            );
          }

          return (
            right.sold30 -
            left.sold30
          );
        },
      );
    }, [
      report,
      query,
      metricFilter,
      movementFilter,
      stockFilter,
      categoryFilter,
      coverageFilter,
      riskFilter,
      actionFilter,
      sortMode,
    ]);

  if (loading) {
    return (
      <section className="inventory-intelligence-page lk-report-refresh">
        <div className="inventory-intelligence-state">
          جاري تحليل حركة المخزون...
        </div>
      </section>
    );
  }

  if (
    error ||
    !report
  ) {
    return (
      <section className="inventory-intelligence-page lk-report-refresh">
        <div className="inventory-intelligence-state is-error">
          <strong>
            تعذر تحميل التقرير
          </strong>
          <p>
            {error ||
              "حدث خطأ غير متوقع"}
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void loadData()
            }
          >
            إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="inventory-intelligence-page lk-report-refresh">
      <header className="inventory-intelligence-hero">
        <div>
          <span className="inventory-intelligence-eyebrow">
            Stage 5.1–5.9 · Inventory Intelligence
          </span>
          <h1>
            عمر وحركة وتغطية المخزون
          </h1>
          <p>
            يحول ذكاء المخزون إلى قرارات يومية مباشرة لصاحب المتجر: ماذا تشتري، ماذا توقف شراءه، ماذا تبدأ بتصريفه، وما الذي يحتاج مراقبة اليوم — مع الأثر المالي لكل قرار.
          </p>
        </div>

        <div className="inventory-intelligence-date">
          <span>
            التقرير حتى
          </span>
          <strong>
            {report.asOfDate}
          </strong>
          <small>
            بيع مكتمل:{" "}
            {formatNumber(
              report.history
                .coverageDays,
            )}{" "}
            يوم · حركات مخزون:{" "}
            {formatNumber(
              report.history
                .inventoryMovementCoverageDays,
            )}{" "}
            يوم
          </small>
        </div>
      </header>

      {report.warnings.length >
        0 && (
        <div className="inventory-intelligence-warning">
          <strong>
            ملاحظات دقة التقرير
          </strong>
          {report.warnings.map(
            (warning) => (
              <p key={warning}>
                {warning}
              </p>
            ),
          )}
        </div>
      )}

      <section className="inventory-owner-dashboard">
        <div className="inventory-owner-dashboard-head">
          <div>
            <span>
              Stage 5.7–5.9 · Owner Action Dashboard
            </span>
            <h2>
              ماذا أعمل اليوم؟
            </h2>
            <p>
              ملخص تنفيذي مبني على نفس إشارات الحركة والتغطية والمخاطر وخطة الكمية. اضغط أي قرار لعرض أصنافه مباشرة.
            </p>
          </div>
          <small>
            هدف الشراء:{" "}
            {formatNumber(
              report.thresholds
                .targetCoverageDays,
            )}{" "}
            يوم · حد الفائض:{" "}
            {formatNumber(
              report.thresholds
                .highCoverageDays,
            )}{" "}
            يوم
          </small>
        </div>

        <div className="inventory-owner-action-grid">
          <OwnerActionCard
            label="اشترِ الآن"
            count={
              report.summary
                .reorderSuggestedProducts
            }
            primary={`${formatNumber(
              report.summary
                .suggestedReorderUnits,
            )} وحدة شراء مقترحة`}
            secondary={`ميزانية معروفة: ${formatMoney(
              report.summary
                .suggestedReorderBudgetKnownMinor,
            )}${
              report.summary
                .reorderBudgetMissingCostProducts >
              0
                ? ` · ${formatNumber(
                    report.summary
                      .reorderBudgetMissingCostProducts,
                  )} صنف ناقص تكلفة`
                : ""
            }`}
            tone="buy"
            {...metricProps("owner_buy")}
          />

          <OwnerActionCard
            label="أوقف / خفف الشراء"
            count={
              report.summary
                .excessSuggestedProducts
            }
            primary={`${formatNumber(
              report.summary
                .excessUnits,
            )} وحدة فائض محتمل`}
            secondary="هذه الأصناف فوق الخطة أو بلا طلب صافي؛ لا تضف لها مخزونًا قبل المراجعة."
            tone="stop"
            {...metricProps(
              "owner_stop_buying",
            )}
          />

          <OwnerActionCard
            label="ابدأ التصريف"
            count={
              ownerActionSummary
                .liquidateProducts
            }
            primary="أولوية: فائض مرتفع أو مخزون ميت"
            secondary="ابدأ بالسعر، العرض أو البكجات قبل شراء كمية إضافية."
            tone="liquidate"
            {...metricProps(
              "owner_liquidate",
            )}
          />

          <OwnerActionCard
            label="راقب اليوم"
            count={
              ownerActionSummary
                .watchProducts
            }
            primary="قريب من قرار شراء أو تخفيف"
            secondary="مراقبة نفاد أو فائض قبل انتقال الصنف إلى مستوى خطر أعلى."
            tone="watch"
            {...metricProps(
              "owner_watch",
            )}
          />
        </div>

        <section className="inventory-owner-priority">
          <div className="inventory-owner-priority-head">
            <div>
              <span>
                Stage 5.8–5.9 · Daily Priority & Execution
              </span>
              <h3>
                أول 10 أصناف أتعامل معها اليوم
              </h3>
              <p>
                مرتبة حسب الخطر والشراء والتصريف. Stage 5.9 يضيف متابعة التنفيذ وربط الشراء بفاتورة المشتريات بدون اعتماد تلقائي.
              </p>
            </div>
            <strong>
              {formatNumber(
                ownerPriorities.length,
              )}{" "}
              أولوية حالية
            </strong>
          </div>

          <div className="inventory-owner-execution-summary">
            {(
              [
                ["new", "جديد"],
                [
                  "in_progress",
                  "قيد التنفيذ",
                ],
                ["done", "تم"],
                ["deferred", "مؤجل"],
              ] as const
            ).map(([status, label]) => (
              <button
                type="button"
                key={status}
                className={
                  executionFilter === status
                    ? "is-active"
                    : undefined
                }
                onClick={() =>
                  setExecutionFilter(
                    executionFilter === status
                      ? "all"
                      : status,
                  )
                }
              >
                <span>{label}</span>
                <strong>
                  {formatNumber(
                    ownerExecutionSummary[
                      status
                    ],
                  )}
                </strong>
              </button>
            ))}

            <button
              type="button"
              className={
                executionFilter === "all"
                  ? "is-active"
                  : undefined
              }
              onClick={() =>
                setExecutionFilter("all")
              }
            >
              <span>الكل</span>
              <strong>
                {formatNumber(
                  ownerPriorities.length,
                )}
              </strong>
            </button>

            <small>
              حالة التنفيذ محفوظة على هذا الجهاز فقط حاليًا.
            </small>
          </div>

          <div className="inventory-owner-priority-list">
            {displayedOwnerPriorities.map(
              (item) => {
                const originalIndex =
                  ownerPriorities.findIndex(
                    (candidate) =>
                      candidate.product
                        .productId ===
                      item.product.productId,
                  );

                const execution =
                  executionState[
                    item.product.productId
                  ];

                const status =
                  execution?.status ??
                  "new";

                return (
                  <article
                    key={
                      item.product
                        .productId
                    }
                    className={`inventory-owner-priority-row tone-${item.tone} status-${status}`}
                  >
                    <span className="inventory-owner-priority-index">
                      {originalIndex + 1}
                    </span>

                    <img
                      src={
                        item.product.image
                      }
                      alt=""
                    />

                    <span className="inventory-owner-priority-product">
                      <strong>
                        {
                          item.product
                            .nameAr
                        }
                      </strong>
                      <small>
                        كود:{" "}
                        {item.product
                          .productCode ||
                          "—"}{" "}
                        ·{" "}
                        {
                          item.product
                            .category
                        }
                      </small>
                    </span>

                    <span className="inventory-owner-priority-action">
                      <b>
                        {item.action}
                      </b>
                      <small>
                        {item.reason}
                      </small>
                    </span>

                    <span className="inventory-owner-priority-quantity">
                      <b>
                        {ownerPriorityQuantity(
                          item.product,
                        )}
                      </b>
                      <small>
                        {item.product
                          .daysOfSupply ===
                        null
                          ? "تغطية N/A"
                          : `${formatDecimal(
                              item.product
                                .daysOfSupply,
                            )} يوم تغطية`}
                      </small>
                    </span>

                    <span className="inventory-owner-priority-money">
                      <b>
                        {ownerPriorityMoney(
                          item.product,
                        )}
                      </b>
                      <small>
                        حالة التنفيذ:{" "}
                        {
                          ownerExecutionLabels[
                            status
                          ]
                        }
                      </small>
                    </span>

                    <div className="inventory-owner-priority-controls">
                      <span
                        className={`inventory-owner-execution-status status-${status}`}
                      >
                        {
                          ownerExecutionLabels[
                            status
                          ]
                        }
                      </span>

                      {status !==
                        "in_progress" && (
                        <button
                          type="button"
                          onClick={() =>
                            updateExecutionStatus(
                              item,
                              "in_progress",
                            )
                          }
                        >
                          ابدأ
                        </button>
                      )}

                      {status !== "done" && (
                        <button
                          type="button"
                          onClick={() =>
                            updateExecutionStatus(
                              item,
                              "done",
                            )
                          }
                        >
                          تم
                        </button>
                      )}

                      {status !==
                        "deferred" && (
                        <button
                          type="button"
                          onClick={() =>
                            updateExecutionStatus(
                              item,
                              "deferred",
                            )
                          }
                        >
                          تأجيل
                        </button>
                      )}

                      {(status === "done" ||
                        status ===
                          "deferred") && (
                        <button
                          type="button"
                          onClick={() =>
                            updateExecutionStatus(
                              item,
                              "new",
                            )
                          }
                        >
                          إعادة فتح
                        </button>
                      )}

                      {item.tone === "buy" &&
                        (item.product
                          .suggestedReorderQuantity ??
                          0) > 0 && (
                          <button
                            type="button"
                            className="is-purchase"
                            onClick={() =>
                              preparePurchase(
                                item,
                              )
                            }
                          >
                            جهّز فاتورة شراء
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() =>
                          handlePriorityProduct(
                            item.product,
                          )
                        }
                      >
                        عرض التفاصيل
                      </button>
                    </div>
                  </article>
                );
              },
            )}

            {displayedOwnerPriorities.length ===
              0 && (
              <div className="inventory-owner-priority-empty">
                لا توجد أولويات بهذه الحالة حاليًا.
              </div>
            )}
          </div>
        </section>

        <div className="inventory-owner-finance-grid">
          <article>
            <span>
              المبلغ المطلوب للشراء
            </span>
            <strong>
              {formatMoney(
                report.summary
                  .suggestedReorderBudgetKnownMinor,
              )}
            </strong>
            <small>
              معروف حاليًا؛{" "}
              {formatNumber(
                report.summary
                  .reorderBudgetMissingCostProducts,
              )}{" "}
              صنف شراء ناقص تكلفة مرجعية.
            </small>
          </article>

          <article>
            <span>
              قيمة فائض قابلة للتحرير
            </span>
            <strong>
              {formatMoney(
                report.summary
                  .excessInventoryValueKnownMinor,
              )}
            </strong>
            <small>
              قيمة معروفة فقط؛{" "}
              {formatNumber(
                report.summary
                  .excessValueMissingCostProducts,
              )}{" "}
              صنف فائض ناقص قيمة موثوقة.
            </small>
          </article>

          <article>
            <span>
              رأس مال بطيء / ميت
            </span>
            <strong>
              {formatMoney(
                report.summary
                  .slowDeadCapitalKnownMinor,
              )}
            </strong>
            <small>
              لا يُجمع تلقائيًا مع قيمة الفائض لأن بعض الأصناف قد تدخل في الرقمين.
            </small>
          </article>
        </div>
      </section>


      <section
        className="inventory-variant-intelligence"
        id="inventory-variant-intelligence"
      >
        <div className="inventory-variant-head">
          <div>
            <span>
              Stage 5.3 · Variant Intelligence
            </span>
            <h2>
              ذكاء اللون والمقاس
            </h2>
            <p>
              القرار هنا على مستوى اللون + المقاس نفسه، وليس المنتج كاملًا: ما الذي نفد، ما الذي يتحرك، ما الذي يركد، وما الكمية المقترحة للشراء.
            </p>
          </div>

          <small>
            {formatNumber(
              report.variantSummary
                .trackedVariants,
            )}{" "}
            Variant بكمية متتبعة من أصل{" "}
            {formatNumber(
              report.variantSummary
                .totalVariants,
            )}
          </small>
        </div>

        <div className="inventory-variant-summary">
          <button
            type="button"
            className={
              variantFilter ===
              "reorder"
                ? "is-active"
                : ""
            }
            onClick={() =>
              setVariantFilter(
                "reorder",
              )
            }
          >
            <span>
              شراء مقترح
            </span>
            <strong>
              {formatNumber(
                report.variantSummary
                  .reorderSuggestedVariants,
              )}
            </strong>
            <small>
              {formatNumber(
                report.variantSummary
                  .suggestedReorderUnits,
              )}{" "}
              وحدة
            </small>
          </button>

          <button
            type="button"
            className={
              variantFilter ===
              "stockout"
                ? "is-active"
                : ""
            }
            onClick={() =>
              setVariantFilter(
                "stockout",
              )
            }
          >
            <span>
              نفاد / خطر نفاد
            </span>
            <strong>
              {formatNumber(
                report.variantSummary
                  .stockoutNowVariants +
                  report.variantSummary
                    .stockoutHighRiskVariants +
                  report.variantSummary
                    .stockoutWatchVariants,
              )}
            </strong>
            <small>
              نفد مع طلب:{" "}
              {formatNumber(
                report.variantSummary
                  .stockoutNowVariants,
              )}
            </small>
          </button>

          <button
            type="button"
            className={
              variantFilter ===
              "excess"
                ? "is-active"
                : ""
            }
            onClick={() =>
              setVariantFilter(
                "excess",
              )
            }
          >
            <span>
              فائض / بلا طلب
            </span>
            <strong>
              {formatNumber(
                report.variantSummary
                  .excessSuggestedVariants,
              )}
            </strong>
            <small>
              {formatNumber(
                report.variantSummary
                  .excessUnits,
              )}{" "}
              وحدة محتملة
            </small>
          </button>

          <button
            type="button"
            className={
              variantFilter ===
              "slow"
                ? "is-active"
                : ""
            }
            onClick={() =>
              setVariantFilter(
                "slow",
              )
            }
          >
            <span>
              بطيء / ميت
            </span>
            <strong>
              {formatNumber(
                report.variantSummary
                  .slowVariants +
                  report.variantSummary
                    .deadVariants,
              )}
            </strong>
            <small>
              حركة ضعيفة على اللون والمقاس
            </small>
          </button>

          <article>
            <span>
              ميزانية شراء معروفة
            </span>
            <strong>
              {formatMoney(
                report.variantSummary
                  .suggestedReorderBudgetKnownMinor,
              )}
            </strong>
            <small>
              {formatNumber(
                report.variantSummary
                  .reorderBudgetMissingCostVariants,
              )}{" "}
              Variant ناقص تكلفة
            </small>
          </article>

          <article>
            <span>
              طلب غير منسوب
            </span>
            <strong>
              {formatNumber(
                report.variantSummary
                  .unattributedDemand30,
              )}
            </strong>
            <small>
              وحدة خلال 30 يوم بلا لون/مقاس كامل
            </small>
          </article>
        </div>

        <div className="inventory-variant-toolbar">
          <div className="inventory-variant-filter-buttons">
            {(
              [
                [
                  "attention",
                  "يحتاج انتباه",
                ],
                ["all", "الكل"],
                ["reorder", "شراء"],
                ["stockout", "نفاد"],
                ["excess", "فائض"],
                ["slow", "بطيء"],
              ] as const
            ).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    variantFilter ===
                    value
                      ? "is-active"
                      : ""
                  }
                  onClick={() =>
                    setVariantFilter(
                      value,
                    )
                  }
                >
                  {label}
                </button>
              ),
            )}
          </div>

          <input
            value={variantQuery}
            onChange={(event) =>
              setVariantQuery(
                event.target.value,
              )
            }
            placeholder="ابحث بالمنتج، الكود، الباركود، اللون أو المقاس"
          />
        </div>

        <div className="inventory-variant-table-wrap">
          <table className="inventory-variant-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>اللون</th>
                <th>المقاس</th>
                <th>المخزون</th>
                <th>طلب 30</th>
                <th>طلب 90</th>
                <th>التغطية</th>
                <th>الحالة</th>
                <th>القرار</th>
                <th>اقتراح الشراء</th>
                <th>آخر طلب</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filteredVariants.map(
                (variant) => (
                  <tr
                    key={
                      variant.variantKey
                    }
                  >
                    <td>
                      <div className="inventory-variant-product">
                        <button
                          type="button"
                          className="inventory-variant-image"
                          onClick={() =>
                            setPreview({
                              image:
                                variant.image,
                              name:
                                variant.nameAr,
                            })
                          }
                        >
                          <img
                            src={
                              variant.image
                            }
                            alt=""
                          />
                        </button>
                        <span>
                          <strong>
                            {
                              variant.nameAr
                            }
                          </strong>
                          <small>
                            كود:{" "}
                            {variant.productCode ||
                              "—"}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <strong>
                        {variant.color}
                      </strong>
                    </td>
                    <td>
                      <strong>
                        {variant.size}
                      </strong>
                    </td>
                    <td>
                      {variant.currentQuantity ===
                      null
                        ? "N/A"
                        : formatNumber(
                            variant.currentQuantity,
                          )}
                    </td>
                    <td>
                      {variant.sellThrough30Reliable
                        ? formatNumber(
                            variant.netDemand30,
                          )
                        : "N/A"}
                    </td>
                    <td>
                      {variant.sellThrough90Reliable
                        ? formatNumber(
                            variant.netDemand90,
                          )
                        : "N/A"}
                    </td>
                    <td>
                      {variant.daysOfSupply ===
                      null
                        ? coverageLabels[
                            variant
                              .coverageSignal
                          ]
                        : `${formatDecimal(
                            variant.daysOfSupply,
                          )} يوم`}
                    </td>
                    <td>
                      <span
                        className={`inventory-variant-risk risk-${variant.inventoryRiskSignal}`}
                      >
                        {
                          riskLabels[
                            variant
                              .inventoryRiskSignal
                          ]
                        }
                      </span>
                    </td>
                    <td>
                      <strong>
                        {variantDecision(
                          variant,
                        )}
                      </strong>
                      <small className="inventory-variant-action-label">
                        {
                          actionLabels[
                            variant
                              .inventoryActionSignal
                          ]
                        }
                      </small>
                    </td>
                    <td>
                      {(variant
                        .suggestedReorderQuantity ??
                        0) > 0 ? (
                        <>
                          <strong>
                            +
                            {formatNumber(
                              variant
                                .suggestedReorderQuantity ??
                                0,
                            )}
                          </strong>
                          <small className="inventory-variant-action-label">
                            {formatMoney(
                              variant
                                .suggestedReorderBudgetMinor,
                            )}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {formatDate(
                        variant.lastDemandDate,
                      )}
                    </td>
                    <td>
                      {(variant
                        .suggestedReorderQuantity ??
                        0) > 0 ? (
                        variant.barcode ? (
                          <button
                            type="button"
                            className="inventory-variant-purchase"
                            onClick={() =>
                              prepareVariantPurchase(
                                variant,
                              )
                            }
                          >
                            جهّز شراء
                          </button>
                        ) : (
                          <small className="inventory-variant-barcode-warning">
                            اربط باركود اللون/المقاس أولًا
                          </small>
                        )
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ),
              )}

              {filteredVariants.length ===
                0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="inventory-variant-empty"
                  >
                    لا توجد Variants مطابقة لهذا الفلتر حاليًا.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="inventory-variant-methodology">
          {report.methodology
            .variantIntelligence}
        </p>
      </section>

      <div className="inventory-intelligence-metrics">
        <Metric
          {...metricProps("fast_movers")}
          label="أصناف سريعة"
          value={formatNumber(
            report.summary
              .fastMovers,
          )}
          hint="وصلت لحد السرعة خلال 30 أو 90 يوم"
          emphasis
        />

        <Metric
          {...metricProps("slow_movers")}
          label="أصناف بطيئة"
          value={formatNumber(
            report.summary
              .slowMovers,
          )}
          hint="مخزون موجود وحركة بيع ضعيفة"
        />

        <Metric
          {...metricProps("dead_movers")}
          label="مخزون ميت"
          value={formatNumber(
            report.summary
              .deadMovers,
          )}
          hint={
            report.history
              .hasNinetyDayHistory
              ? "90 يوم بدون بيع مع وجود مخزون"
              : "لن يُفعّل قبل توفر 90 يوم من التاريخ"
          }
        />

        <Metric
          {...metricProps("fast_out_of_stock")}
          label="سريع ونفد"
          value={formatNumber(
            report.summary
              .fastOutOfStock,
          )}
          hint="السريع الذي نفد؛ العاجل فقط إذا كان آخر بيع خلال 14 يوم"
        />

        <Metric
          {...metricProps("never_sold_in_stock")}
          label="لم يُبع بعد"
          value={formatNumber(
            report.summary
              .neverSoldInStock,
          )}
          hint="أصناف لديها مخزون ولا يوجد بيع مسجل"
        />

        <Metric
          {...metricProps("in_stock")}
          label="أصناف متوفرة"
          value={formatNumber(
            report.summary
              .inStockProducts,
          )}
          hint={`من أصل ${formatNumber(
            report.summary
              .totalProducts,
          )} صنف فعّال في التقرير`}
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          {...metricProps("sell_through_30")}
          label="تصريف 30 يوم"
          value={formatPercent(
            report.summary
              .sellThrough30Percent,
          )}
          hint={`${formatNumber(
            report.summary
              .sellThrough30ReliableProducts,
          )} صنف بنافذة حركة موثوقة كاملة`}
          emphasis
        />

        <Metric
          {...metricProps("sell_through_90")}
          label="تصريف 90 يوم"
          value={formatPercent(
            report.summary
              .sellThrough90Percent,
          )}
          hint={`${formatNumber(
            report.summary
              .sellThrough90ReliableProducts,
          )} صنف بنافذة حركة موثوقة كاملة`}
        />

        <Metric
          {...metricProps("coverage_low")}
          label="تغطية حتى 14 يوم"
          value={formatNumber(
            report.summary
              .coverUnder14Days,
          )}
          hint="مخزون متوفر لكن سرعته الحالية قد تنفده قريبًا"
        />

        <Metric
          {...metricProps("coverage_healthy")}
          label="تغطية 15–60 يوم"
          value={formatNumber(
            report.summary
              .cover15To60Days,
          )}
          hint="تغطية جيدة حسب صافي الطلب الحالي"
        />

        <Metric
          {...metricProps("coverage_high")}
          label="تغطية فوق 60 يوم"
          value={formatNumber(
            report.summary
              .coverOver60Days,
          )}
          hint="مرشح للمراجعة إذا استمرت نفس سرعة البيع"
        />

        <Metric
          {...metricProps("coverage_insufficient")}
          label="بيانات تغطية غير كافية"
          value={formatNumber(
            report.summary
              .insufficientCoverageData,
          )}
          hint={`يلزم ${formatNumber(
            report.thresholds
              .minimumVelocityHistoryDays,
          )} أيام حركة موثوقة على الأقل؛ بلا طلب صافي: ${formatNumber(
            report.summary
              .noVelocityInStock,
          )}`}
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          {...metricProps("stockout_now")}
          label="نفد مع طلب حديث"
          value={formatNumber(
            report.summary
              .stockoutNow,
          )}
          hint={`مخزون صفر مع بيع خلال آخر ${formatNumber(
            report.thresholds
              .lowCoverageDays,
          )} يوم`}
          emphasis
        />

        <Metric
          {...metricProps("stockout_high")}
          label="خطر نفاد مرتفع"
          value={formatNumber(
            report.summary
              .stockoutHighRisk,
          )}
          hint={`متوفر لكن التغطية ${formatNumber(
            report.thresholds
              .stockoutHighDays,
          )} أيام أو أقل`}
        />

        <Metric
          {...metricProps("stockout_watch")}
          label="مراقبة نفاد"
          value={formatNumber(
            report.summary
              .stockoutWatch,
          )}
          hint={`فوق ${formatNumber(
            report.thresholds
              .stockoutHighDays,
          )} وحتى ${formatNumber(
            report.thresholds
              .lowCoverageDays,
          )} يوم`}
        />

        <Metric
          {...metricProps("overstock_high")}
          label="فائض مرتفع"
          value={formatNumber(
            report.summary
              .overstockHighRisk,
          )}
          hint={`بعد عمر ${formatNumber(
            report.thresholds
              .minimumOverstockAgeDays,
          )} يوم وبإشارة فائض قوية`}
        />

        <Metric
          {...metricProps("overstock_watch")}
          label="مراقبة فائض"
          value={formatNumber(
            report.summary
              .overstockWatch,
          )}
          hint={`بطيء، بلا طلب صافي، أو تغطية فوق ${formatNumber(
            report.thresholds
              .highCoverageDays,
          )} يوم`}
        />

        <Metric
          {...metricProps("risk_insufficient")}
          label="بيانات مخاطرة غير كافية"
          value={formatNumber(
            report.summary
              .insufficientRiskData,
          )}
          hint="لا يصدر إنذار نفاد/فائض قبل توفر بيانات موثوقة"
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          {...metricProps("reorder_products")}
          label="أصناف شراء مقترح"
          value={formatNumber(
            report.summary
              .reorderSuggestedProducts,
          )}
          hint={`تحتاج رفع المخزون إلى هدف ${formatNumber(
            report.thresholds
              .targetCoverageDays,
          )} يوم`}
          emphasis
        />

        <Metric
          {...metricProps("reorder_units")}
          label="إجمالي وحدات شراء"
          value={formatNumber(
            report.summary
              .suggestedReorderUnits,
          )}
          hint="إجمالي الكمية المقترحة من الأصناف ذات الطلب الصافي الموثوق"
        />

        <Metric
          {...metricProps("excess_products")}
          label="أصناف فائض محتمل"
          value={formatNumber(
            report.summary
              .excessSuggestedProducts,
          )}
          hint={`فوق حد ${formatNumber(
            report.thresholds
              .highCoverageDays,
          )} يوم أو بلا طلب صافي بعد عمر كافٍ`}
        />

        <Metric
          {...metricProps("excess_units")}
          label="إجمالي وحدات فائض"
          value={formatNumber(
            report.summary
              .excessUnits,
          )}
          hint="كمية محتملة للتخفيف أو التصريف، وليست أمر بيع تلقائي"
        />

        <Metric
          {...metricProps("no_demand_review")}
          label="بلا طلب صافي للمراجعة"
          value={formatNumber(
            report.summary
              .noDemandReviewProducts,
          )}
          hint="أصناف ناضجة بمخزون لكن سرعة الطلب الصافية صفر"
        />

        <Metric
          {...metricProps("action_insufficient")}
          label="بيانات قرار غير كافية"
          value={formatNumber(
            report.summary
              .insufficientActionData,
          )}
          hint="لا نعطي كمية شراء أو فائض عندما تاريخ الحركة غير موثوق"
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          {...metricProps("reorder_budget_known")}
          label="ميزانية شراء تقديرية"
          value={formatMoney(
            report.summary
              .suggestedReorderBudgetKnownMinor,
          )}
          hint={report.summary
            .reorderBudgetMissingCostProducts >
          0
            ? `${formatNumber(
                report.summary
                  .reorderBudgetMissingCostProducts,
              )} صنف شراء مقترح بدون تكلفة مرجعية`
            : "كل كميات الشراء المقترحة لها تكلفة مرجعية"}
          emphasis
        />

        <Metric
          {...metricProps("excess_value_known")}
          label="قيمة فائض محتملة"
          value={formatMoney(
            report.summary
              .excessInventoryValueKnownMinor,
          )}
          hint={report.summary
            .excessValueMissingCostProducts >
          0
            ? `${formatNumber(
                report.summary
                  .excessValueMissingCostProducts,
              )} صنف فائض بدون قيمة تكلفة موثوقة`
            : "قيمة الفائض المعروفة حسب تكلفة المخزون الحالية"}
        />

        <Metric
          {...metricProps("slow_dead_capital_known")}
          label="رأس مال بطيء / ميت"
          value={formatMoney(
            report.summary
              .slowDeadCapitalKnownMinor,
          )}
          hint={report.summary
            .slowDeadCapitalMissingCostProducts >
          0
            ? `${formatNumber(
                report.summary
                  .slowDeadCapitalMissingCostProducts,
              )} صنف بطيء/ميت ناقص تكلفة موثوقة`
            : "قيمة المخزون الحالية في الأصناف البطيئة والميتة"}
        />

        <Metric
          {...metricProps("reorder_budget_missing")}
          label="شراء ناقص التكلفة"
          value={formatNumber(
            report.summary
              .reorderBudgetMissingCostProducts,
          )}
          hint="لا يدخل في إجمالي ميزانية الشراء حتى تتوفر تكلفة مرجعية"
        />

        <Metric
          {...metricProps("excess_value_missing")}
          label="فائض ناقص القيمة"
          value={formatNumber(
            report.summary
              .excessValueMissingCostProducts,
          )}
          hint="لا يدخل في قيمة رأس المال القابل للتحرير"
        />

        <Metric
          {...metricProps("cost_quantity_mismatch")}
          label="فروق كمية التكلفة"
          value={formatNumber(
            report.summary
              .costQuantityMismatchProducts,
          )}
          hint="قيمة المخزون لا تعتمد ماليًا حتى تتطابق كمية التكلفة مع المخزون"
        />
      </div>

      <div className="inventory-intelligence-filters">
        <label className="inventory-intelligence-search">
          <span>
            بحث
          </span>
          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="اسم، كود، باركود أو رقم الصنف"
          />
        </label>

        <label>
          <span>
            الحركة
          </span>
          <select
            value={
              movementFilter
            }
            onChange={(event) =>
              setMovementFilter(
                event.target
                  .value as
                  | InventoryMovementClass
                  | "all",
              )
            }
          >
            <option value="all">
              كل التصنيفات
            </option>
            <option value="fast">
              سريع
            </option>
            <option value="normal">
              طبيعي
            </option>
            <option value="slow">
              بطيء
            </option>
            <option value="dead">
              ميت
            </option>
            <option value="new">
              جديد
            </option>
          </select>
        </label>

        <label>
          <span>
            حالة المخزون
          </span>
          <select
            value={
              stockFilter
            }
            onChange={(event) =>
              setStockFilter(
                event.target
                  .value as
                  | InventoryStockState
                  | "all",
              )
            }
          >
            <option value="all">
              الكل
            </option>
            <option value="in_stock">
              متوفر
            </option>
            <option value="out_of_stock">
              نفد
            </option>
            <option value="untracked">
              كمية غير مكتملة
            </option>
          </select>
        </label>

        <label>
          <span>
            التصنيف
          </span>
          <select
            value={
              categoryFilter
            }
            onChange={(event) =>
              setCategoryFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              كل التصنيفات
            </option>
            {categories.map(
              (category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            التغطية
          </span>
          <select
            value={
              coverageFilter
            }
            onChange={(event) =>
              setCoverageFilter(
                event.target
                  .value as
                  | InventoryCoverageSignal
                  | "all",
              )
            }
          >
            <option value="all">
              كل الإشارات
            </option>
            {(
              Object.keys(
                coverageLabels,
              ) as InventoryCoverageSignal[]
            ).map(
              (signal) => (
                <option
                  key={signal}
                  value={signal}
                >
                  {
                    coverageLabels[
                      signal
                    ]
                  }
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            مخاطر المخزون
          </span>
          <select
            value={
              riskFilter
            }
            onChange={(event) =>
              setRiskFilter(
                event.target
                  .value as
                  | InventoryRiskSignal
                  | "all",
              )
            }
          >
            <option value="all">
              كل المخاطر
            </option>
            {(
              Object.keys(
                riskLabels,
              ) as InventoryRiskSignal[]
            ).map(
              (signal) => (
                <option
                  key={signal}
                  value={signal}
                >
                  {
                    riskLabels[
                      signal
                    ]
                  }
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            قرار الكمية
          </span>
          <select
            value={
              actionFilter
            }
            onChange={(event) =>
              setActionFilter(
                event.target
                  .value as
                  | InventoryActionSignal
                  | "all",
              )
            }
          >
            <option value="all">
              كل القرارات
            </option>
            {(
              Object.keys(
                actionLabels,
              ) as InventoryActionSignal[]
            ).map(
              (signal) => (
                <option
                  key={signal}
                  value={signal}
                >
                  {
                    actionLabels[
                      signal
                    ]
                  }
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            الترتيب
          </span>
          <select
            value={sortMode}
            onChange={(event) =>
              setSortMode(
                event.target
                  .value as
                  SortMode,
              )
            }
          >
            <option value="attention">
              أولوية القرار
            </option>
            <option value="inventory_risk">
              أعلى مخاطر المخزون
            </option>
            <option value="reorder_quantity">
              أكبر كمية شراء مقترحة
            </option>
            <option value="excess_units">
              أكبر كمية فائض محتمل
            </option>
            <option value="reorder_budget">
              أكبر ميزانية شراء
            </option>
            <option value="excess_value">
              أكبر قيمة فائض
            </option>
            <option value="slow_dead_capital">
              أكبر رأس مال بطيء/ميت
            </option>
            <option value="sold30">
              الأكثر بيعًا 30 يوم
            </option>
            <option value="sold90">
              الأكثر بيعًا 90 يوم
            </option>
            <option value="sell_through_30">
              أعلى تصريف 30 يوم
            </option>
            <option value="velocity">
              أعلى سرعة طلب صافية
            </option>
            <option value="days_of_supply">
              أقل أيام تغطية
            </option>
            <option value="oldest">
              الأقدم
            </option>
            <option value="last_sale">
              الأبعد عن آخر بيع
            </option>
          </select>
        </label>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void loadData()
          }
        >
          تحديث
        </button>
      </div>

      {metricFilter && (
        <div
          className="inventory-intelligence-active-metric-filter"
          role="status"
        >
          <div>
            <span>
              الفلتر الحالي من لوحة القرار / المؤشر
            </span>
            <strong>
              {
                metricFilterLabels[
                  metricFilter
                ]
              }
            </strong>
            <small>
              يعرض الآن{" "}
              {formatNumber(
                filtered.length,
              )}{" "}
              صنف مطابق. يمكنك تضييق النتائج أكثر من الفلاتر أدناه.
            </small>
          </div>

          <button
            type="button"
            onClick={() =>
              setMetricFilter(null)
            }
          >
            إزالة فلتر المربع ×
          </button>
        </div>
      )}

      <div
        id="inventory-intelligence-products"
        className="inventory-intelligence-table-card"
      >
        <div className="inventory-intelligence-table-head">
          <div>
            <h2>
              تفاصيل الأصناف
            </h2>
            <p>
              Stage 5.9 يضيف طبقة تنفيذ يومية فوق Stage 5.8: قرارات الشراء والتخفيف والتصريف والمراقبة تبقى مبنية على نفس قواعد التقرير، مع متابعة حالة التنفيذ وربط الشراء بفاتورة المشتريات الحالية دون اعتماد تلقائي.
            </p>
          </div>

          <span>
            {formatNumber(
              filtered.length,
            )}{" "}
            صنف
          </span>
        </div>

        <div className="inventory-intelligence-table-wrap">
          <table className="inventory-intelligence-table">
            <thead>
              <tr>
                <th>
                  الصنف
                </th>
                <th>
                  الحركة
                </th>
                <th>
                  المخزون
                </th>
                <th>
                  بيع 30 يوم
                </th>
                <th>
                  بيع 90 يوم
                </th>
                <th>
                  Sell-through
                </th>
                <th>
                  سرعة صافية
                </th>
                <th>
                  أيام التغطية
                </th>
                <th>
                  حالة التغطية
                </th>
                <th>
                  آخر بيع
                </th>
                <th>
                  آخر شراء
                </th>
                <th>
                  عمر الصنف
                </th>
                <th>
                  مخاطر المخزون
                </th>
                <th>
                  خطة 5.5
                </th>
                <th>
                  الأثر المالي 5.6
                </th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(
                (product) => (
                  <tr
                    key={
                      product.productId
                    }
                    className={
                      product.isHidden
                        ? "is-hidden-product"
                        : undefined
                    }
                  >
                    <td>
                      <div className="inventory-intelligence-product">
                        <button
                          type="button"
                          className="product-analytics-image-button inventory-intelligence-image-button"
                          onClick={() =>
                            setPreview({
                              image:
                                product.image,
                              name:
                                product.nameAr,
                            })
                          }
                          aria-label={`معاينة صورة ${product.nameAr}`}
                        >
                          <img
                            src={
                              product.image
                            }
                            alt={
                              product.nameAr
                            }
                          />
                        </button>
                        <div>
                          <strong>
                            {
                              product.nameAr
                            }
                          </strong>
                          <small>
                            #
                            {
                              product.productId
                            }
                            {" · "}
                            كود:{" "}
                            {product.productCode ||
                              "—"}
                            {product.isHidden
                              ? " · مخفي"
                              : ""}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge movement-${product.movementClass}`}
                      >
                        {
                          movementLabels[
                            product
                              .movementClass
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <strong>
                        {product.currentQuantity ===
                        null
                          ? "—"
                          : formatNumber(
                              product.currentQuantity,
                            )}
                      </strong>
                      <small className={`inventory-intelligence-stock stock-${product.stockState}`}>
                        {
                          stockLabels[
                            product
                              .stockState
                          ]
                        }
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.sold30,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.sold90,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        30d{" "}
                        {formatPercent(
                          product.sellThrough30Percent,
                        )}
                      </strong>
                      <small>
                        {product.sellThrough30Reliable
                          ? `صافي ${formatNumber(
                              product.sellThrough30NetDemand,
                            )} من ${formatNumber(
                              product.sellThrough30AvailableUnits ??
                                0,
                            )} · ${formatNumber(
                              product.sellThrough30WindowDays,
                            )} يوم`
                          : "30d: سجل الحركات لا يغطي النافذة كاملة"}
                      </small>
                      <small>
                        90d{" "}
                        {formatPercent(
                          product.sellThrough90Percent,
                        )}
                        {product.sellThrough90Reliable
                          ? ` · صافي ${formatNumber(
                              product.sellThrough90NetDemand,
                            )}`
                          : " · N/A"}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatRate(
                          product.averageDailyNetDemand,
                        )}{" "}
                        {product.averageDailyNetDemand ===
                        null
                          ? ""
                          : "قطعة/يوم"}
                      </strong>
                      <small>
                        صافي{" "}
                        {formatNumber(
                          product.velocityNetDemand,
                        )}{" "}
                        خلال{" "}
                        {formatNumber(
                          product.velocityWindowDays,
                        )}{" "}
                        يوم
                      </small>
                    </td>

                    <td>
                      <strong>
                        {product.daysOfSupply ===
                        null
                          ? "N/A"
                          : `${formatDecimal(
                              product.daysOfSupply,
                            )} يوم`}
                      </strong>
                      <small>
                        {product.coverageSignal ===
                        "no_net_demand"
                          ? "لا توجد حركة طلب صافية"
                          : product.coverageSignal ===
                              "insufficient_history"
                            ? "تاريخ الحركة غير كافٍ"
                            : product.coverageSignal ===
                                "untracked"
                              ? "المخزون غير متتبع"
                              : `نافذة السرعة ${formatNumber(
                                  product.velocityWindowDays,
                                )} يوم`}
                      </small>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge coverage-${product.coverageSignal}`}
                      >
                        {
                          coverageLabels[
                            product
                              .coverageSignal
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <strong>
                        {formatDate(
                          product.lastSaleDate,
                        )}
                      </strong>
                      <small>
                        {product.daysSinceLastSale ===
                        null
                          ? "لم يُبع"
                          : `منذ ${formatNumber(
                              product.daysSinceLastSale,
                            )} يوم`}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatDate(
                          product.lastPurchaseDate,
                        )}
                      </strong>
                      <small>
                        {product.firstPurchaseDate
                          ? `أول شراء ${product.firstPurchaseDate}`
                          : "العمر من تاريخ إنشاء الصنف"}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.ageDays,
                        )}{" "}
                        يوم
                      </strong>
                      <small>
                        من{" "}
                        {
                          product.inventoryStartDate
                        }
                      </small>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge risk-${product.inventoryRiskSignal}`}
                      >
                        {
                          riskLabels[
                            product
                              .inventoryRiskSignal
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge action-${product.inventoryActionSignal}`}
                      >
                        {
                          actionLabels[
                            product
                              .inventoryActionSignal
                          ]
                        }
                      </span>
                      <small>
                        {product.inventoryActionSignal ===
                        "reorder"
                          ? `شراء +${formatNumber(
                              product.suggestedReorderQuantity ??
                                0,
                            )} · هدف ${formatNumber(
                              report.thresholds
                                .targetCoverageDays,
                            )} يوم = ${formatNumber(
                              product.targetStockUnits ??
                                0,
                            )} قطعة`
                          : product.inventoryActionSignal ===
                              "reduce"
                            ? `فائض ${formatNumber(
                                product.excessUnits ??
                                  0,
                              )} · حد ${formatNumber(
                                report.thresholds
                                  .highCoverageDays,
                              )} يوم = ${formatNumber(
                                product.maxHealthyStockUnits ??
                                  0,
                              )} قطعة`
                            : product.inventoryActionSignal ===
                                "review_no_demand"
                              ? `فائض محتمل ${formatNumber(
                                  product.excessUnits ??
                                    0,
                                )} · لا يوجد طلب صافي`
                              : product.inventoryActionSignal ===
                                  "balanced"
                                ? product.targetStockUnits ===
                                    null
                                  ? "لا شراء حاليًا · لا يوجد طلب صافي بعد"
                                  : `هدف ${formatNumber(
                                      report.thresholds
                                        .targetCoverageDays,
                                    )} يوم: ${formatNumber(
                                      product.targetStockUnits,
                                    )} قطعة`
                                : "N/A"}
                      </small>
                      <small>
                        {inventoryRiskAction(
                          product,
                        )}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {(
                          product
                            .suggestedReorderQuantity ??
                          0
                        ) > 0
                          ? `ميزانية شراء: ${formatMoney(
                              product.suggestedReorderBudgetMinor,
                            )}`
                          : (
                                product.excessUnits ??
                                0
                              ) > 0
                            ? `قيمة فائض: ${formatMoney(
                                product.excessInventoryValueMinor,
                              )}`
                            : product.movementClass ===
                                  "slow" ||
                                product.movementClass ===
                                  "dead"
                              ? `رأس مال: ${formatMoney(
                                  product.slowDeadCapitalMinor,
                                )}`
                              : "لا أثر مالي عاجل"}
                      </strong>
                      <small>
                        {product.referenceUnitCostMinor ===
                        null
                          ? "تكلفة مرجعية: N/A"
                          : `تكلفة مرجعية: ${formatMoney(
                              product.referenceUnitCostMinor,
                            )} / قطعة`}
                      </small>
                      {(
                        product.movementClass ===
                          "slow" ||
                        product.movementClass ===
                          "dead"
                      ) && (
                        <small>
                          رأس مال بطيء/ميت:{" "}
                          {formatMoney(
                            product.slowDeadCapitalMinor,
                          )}
                        </small>
                      )}
                      <small>
                        {costStatusLabel(
                          product,
                        )}
                      </small>
                    </td>
                  </tr>
                ),
              )}

              {filtered.length ===
                0 && (
                <tr>
                  <td
                    colSpan={15}
                    className="inventory-intelligence-empty"
                  >
                    لا توجد أصناف مطابقة للفلاتر الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="inventory-intelligence-methodology">
        <h2>
          كيف يتم التصنيف؟
        </h2>

        <div>
          <p>
            <strong>
              سريع:
            </strong>{" "}
            {
              report.methodology
                .fast
            }
          </p>
          <p>
            <strong>
              بطيء:
            </strong>{" "}
            {
              report.methodology
                .slow
            }
          </p>
          <p>
            <strong>
              ميت:
            </strong>{" "}
            {
              report.methodology
                .dead
            }
          </p>
          <p>
            <strong>
              جديد:
            </strong>{" "}
            {
              report.methodology
                .new
            }
          </p>
          <p>
            <strong>
              Sell-through:
            </strong>{" "}
            {
              report.methodology
                .sellThrough
            }
          </p>
          <p>
            <strong>
              أيام التغطية:
            </strong>{" "}
            {
              report.methodology
                .daysOfSupply
            }
          </p>
          <p>
            <strong>
              مخاطر المخزون:
            </strong>{" "}
            {
              report.methodology
                .inventoryRisk
            }
          </p>
          <p>
            <strong>
              خطة الكمية:
            </strong>{" "}
            {
              report.methodology
                .inventoryAction
            }
          </p>
          <p>
            <strong>
              الأثر المالي:
            </strong>{" "}
            {
              report.methodology
                .financialImpact
            }
          </p>
          <p>
            <strong>
              مصدر البيع:
            </strong>{" "}
            {
              report.methodology
                .sales
            }
          </p>
          <p>
            <strong>
              عمر الصنف:
            </strong>{" "}
            {
              report.methodology
                .purchase
            }
          </p>
        </div>
      </section>

      {preview && (
        <div
          className="product-analytics-preview-backdrop"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setPreview(null);
            }
          }}
        >
          <section
            className="product-analytics-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`معاينة صورة ${preview.name}`}
          >
            <div className="product-analytics-preview-head">
              <div>
                <span>
                  معاينة المنتج
                </span>
                <strong>
                  {preview.name}
                </strong>
              </div>

              <button
                type="button"
                className="product-analytics-preview-close"
                onClick={() =>
                  setPreview(null)
                }
                aria-label="إغلاق المعاينة"
              >
                ×
              </button>
            </div>

            <div className="product-analytics-preview-image">
              <img
                src={
                  preview.image
                }
                alt={
                  preview.name
                }
              />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
