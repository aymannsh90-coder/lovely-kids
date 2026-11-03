# Lovely Kids — staff permission rollout and consolidated acceptance

This branch extends the existing owner-managed staff table. Owner authorization, password re-confirmation, and staff session invalidation remain unchanged. Existing administrator behavior remains unchanged.

## Authorization design

- Permissions are stored server-side in `staff_access`, never trusted from client payloads.
- Non-owner staff must have an **enabled** staff record with the exact grant.
- Previously owner-only APIs use explicit allowlists matching the **method and path**, with unknown actions denied.
- Sensitive financial reversing, changing accounts, changing purchase costs, and delivery cash posting require separate grants.
- Frontend visibility is supplementary; API checks are authoritative. A displayed button does not imply approval.
- Any permission update/deactivation revokes prior sessions. The owner alone can manage staff accounts.
- Staff never receive `isAdmin` as part of their role.

## Permissions and protected operations

| Domain | Read | Post/edit | Cancellation or higher-risk action |
| --- | --- | --- | --- |
| POS sales | `sales.view` | `sales.create`, `sales.edit` | `sales.void` |
| POS returns | `sales.returns` | `sales.returns` | `sales.returns.void` |
| Local/online exchange | `sales.exchange` / `sales.exchange.online` | Same for allowed type | Additional `sales.exchange.void` |
| Cash sessions | `cash.view` | `cash.open` / `cash.close` | Separate permissions |
| Products | `inventory.view` | `inventory.edit` | Product cost requires `inventory.cost`; permanent deletion remains legacy admin/owner only |
| Purchases | `purchases.view` | `purchases.create` | `purchases.void` |
| Purchase returns | `purchases.view` | `purchases.returns` | `purchases.returns.void` |
| Customer/supplier | `parties.view` | `parties.edit` | Payroll remains owner-only |
| General vouchers | `vouchers.view` | `vouchers.create` | `vouchers.edit`, `vouchers.void` |
| Banking/checks/transfers/card settlements | `banking.view` | `banking.create` | `banking.manage` for accounts/rates; `banking.reverse` for reversals |
| Expenses | `finance.expenses.view` | `finance.expenses.create` | Owner withdrawals and employee salaries remain owner-only |
| Finance reports | `reports.financial` | Read only | `reports.cost` for profits; `inventory.cost` for valuation |
| Online orders | `orders.view` | `orders.create`, `orders.edit` | `orders.cancel`, `orders.confirm-payment`, `orders.delivery-cost`, `orders.courier.cash`, `orders.courier.reverse` |
| Delivery companies | `delivery.view` | `delivery.manage`, `delivery.settle` | `delivery.reverse` |

The following **legacy capabilities are intentionally not delegated**: employee payroll/month close, permanent product deletion, historical cost repair/attestation, bulk order merge, physical order delete, and owner withdrawals. Do not assign administrator access to work around this.

Dependency notes: purchase creation needs both `purchases.view` and `purchases.create` to load draft and save; purchase returns additionally need `purchases.view`. Expense entry needs `finance.expenses.view`, `finance.expenses.create`, and `cash.view` to load a cash session. Financial statements use financial + profit + inventory-cost reports.

## Consolidated end-to-end acceptance (perform ONCE after the complete code is built and deployed to a controlled test environment)

1. Owner: add a cashier with `sales.create`, `sales.view`, `cash.view`, and (optionally) local exchange. Verify other menu sections are hidden and direct URL/HTTP requests are denied.
2. Create a controlled zero-risk sale or use a disposable test copy of the database; verify finance/cash/stock ledger effects and reversal. **Never use a real customer transaction for a permission test**.
3. Cashier returns/exchange: search old sale, preview calculations, create one test transaction and reverse. Verify explicit reverse permission is required.
4. Accountant read-only: assign `reports.financial`, `purchases.view`, `vouchers.view`, `banking.view`, `parties.view`, `delivery.view`. Verify reports load; write/void/confirm-payment calls fail with 403 and do not change rows.
5. Accountant writes: selectively grant voucher creation, then bank create, then reverse. Verify each endpoint remains blocked until its own checkbox is granted.
6. Purchasing: verify invoice create, supplier lookup, invoice void, purchase return create/void, and matching inventory/cost/finance movements using test data.
7. Inventory staff: grant `inventory.view` only. Verify no editing/cost endpoint. Grant edit and recheck. Cost and permanent delete remain blocked until independently authorized (delete is not delegated).
8. Orders: grant view only and confirm no status/confirm-payment/courier posting. Grant permissions separately and verify 403 for ungranted actions.
9. Delivery: view-only company summary, then test settlement and reversal independently.
10. Disable employee while logged in; old token must fail. Re-enable; old token still fails; new login succeeds.
11. Confirm even a legacy Admin cannot access `/api/pos/access/staff` to create, edit, or disable staff.
12. Compare staff-visible profit/cost fields with permissions. Capture security audit entries for every grant change.

All successful tests must assert BOTH UI visibility and server-side authorization; monetary test actions also require confirming balanced journal lines and inventory counts.

## Release rules

- Run API TypeScript, POS TypeScript, POS Vite build, and automated checks.
- Verify the PR is based on latest main and code-reviewed for implicit server privileges.
- Publish API Worker first, then POS Pages, only as a coordinated release.
- Carry out the above acceptance as one scheduled batch after controlled deployment.
- Do not claim the feature is production-approved until the post-release matrix passes.
