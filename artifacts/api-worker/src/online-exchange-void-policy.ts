/**
 * Online exchange voids must never reverse inventory after the replacement
 * has been processed, or after either financial/return receipt milestone.
 * Existing customer-created orders follow the same rules as system drafts.
 */
export interface OnlineExchangeVoidState {
  replacementOrderOrigin: string | null;
  replacementOrderStatus: string;
  financialCompletedAt: Date | string | null;
  returnReceivedAt: Date | string | null;
}

export function canVoidOnlineExchangeBeforeProcessing(
  state: OnlineExchangeVoidState,
): boolean {
  return (
    (state.replacementOrderOrigin === "system_created" ||
      state.replacementOrderOrigin === "existing_order") &&
    state.replacementOrderStatus === "new" &&
    state.financialCompletedAt === null &&
    state.returnReceivedAt === null
  );
}
