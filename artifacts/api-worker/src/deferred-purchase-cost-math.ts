/**
 * Cost of stock entered physically and sold/returned before the supplier draft
 * has been approved. All money values are integer minor units (agorot).
 * The sale and its returns are snapshotted separately; only NET COGS leaves
 * the supplier receipt's inventory asset at approval.
 */
export type DeferredReturn = { returnItemId: number; quantity: number };
export type DeferredSale = { saleItemId: number; quantity: number; returns: DeferredReturn[] };

export type DeferredSaleAllocation = {
  saleItemId: number;
  quantity: number;
  costTotalMinor: number;
  returns: Array<DeferredReturn & { costTotalMinor: number }>;
};

function integer(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid " + label);
}

function distribute(total: number, weights: number[]): number[] {
  integer(total, "allocation");
  const sum = weights.reduce((a, b) => { integer(b, "weight"); return a + b; }, 0);
  if (sum === 0) {
    if (total !== 0) throw new Error("Allocation without quantity");
    return weights.map(() => 0);
  }
  const parts = weights.map(w => Math.floor(total * w / sum));
  const residues = weights.map((w, i) => ({ i, residue: (total * w) % sum }))
    .sort((a, b) => b.residue - a.residue || a.i - b.i);
  let difference = total - parts.reduce((a, b) => a + b, 0);
  for (const item of residues) {
    if (difference-- <= 0) break;
    parts[item.i]! += 1;
  }
  return parts;
}

export function allocateDeferredPurchaseCost(input: {
  receivedQuantity: number;
  receiptCostTotalMinor: number;
  sales: DeferredSale[];
}) {
  const { receivedQuantity, receiptCostTotalMinor } = input;
  integer(receivedQuantity, "receivedQuantity");
  integer(receiptCostTotalMinor, "receiptCostTotalMinor");
  if (receivedQuantity === 0) throw new Error("Receipt must be positive");
  let netSoldQuantity = 0;
  const sales = [...input.sales].sort((a, b) => a.saleItemId - b.saleItemId);
  for (const sale of sales) {
    integer(sale.quantity, "sold quantity");
    if (sale.quantity === 0) throw new Error("Sale must be positive");
    const returned = sale.returns.reduce((sum, r) => {
      integer(r.quantity, "return quantity");
      if (r.quantity === 0) throw new Error("Return must be positive");
      return sum + r.quantity;
    }, 0);
    if (returned > sale.quantity) throw new Error("Return exceeds sale");
    netSoldQuantity += sale.quantity - returned;
  }
  if (netSoldQuantity > receivedQuantity) throw new Error("Sale exceeds receipt");
  const targetNetCost = Math.round(receiptCostTotalMinor * netSoldQuantity / receivedQuantity);
  const base = Math.floor(receiptCostTotalMinor / receivedQuantity);
  const extras = targetNetCost - base * netSoldQuantity;
  const netWeights = sales.map(s =>
    s.quantity - s.returns.reduce((sum, r) => sum + r.quantity, 0));
  const extraBySale = distribute(extras, netWeights);
  const allocations: DeferredSaleAllocation[] = sales.map((sale, i) => ({
    saleItemId: sale.saleItemId,
    quantity: sale.quantity,
    costTotalMinor: base * sale.quantity + extraBySale[i]!,
    returns: sale.returns.map(r => ({
      ...r, costTotalMinor: base * r.quantity,
    })),
  }));
  const netSoldCostTotalMinor = allocations.reduce((sum, a) =>
    sum + a.costTotalMinor - a.returns.reduce((rSum, r) => rSum + r.costTotalMinor, 0), 0);
  const stockQuantityApplied = receivedQuantity - netSoldQuantity;
  const stockCostTotalMinor = receiptCostTotalMinor - netSoldCostTotalMinor;
  if (netSoldCostTotalMinor !== targetNetCost || stockCostTotalMinor < 0 ||
      (stockQuantityApplied === 0 && stockCostTotalMinor !== 0))
    throw new Error("Unbalanced deferred cost allocation");
  return { netSoldQuantity, netSoldCostTotalMinor, stockQuantityApplied,
    stockCostTotalMinor, allocations };
}
