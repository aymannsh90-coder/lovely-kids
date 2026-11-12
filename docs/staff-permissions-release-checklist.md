# Lovely Kids POS — staff permissions release checklist

This branch is not a production deployment. Always publish the API Worker before POS frontend, after a safe isolated staging test.

## Automated checks
- [ ] API Worker TypeScript typecheck on the final merge SHA
- [ ] POS TypeScript typecheck on the final merge SHA
- [ ] Production POS build on the final merge SHA
- [ ] Related order/returns/cash/discount regressions on the final merge SHA
- [ ] Verify `main` is ancestor of the release branch and no conflicts remain

## Staff acceptance matrix (in isolated environment/test accounts)
- [ ] Owner can create/update/disable staff; staff and admins cannot manage staff
- [ ] Cashier with sales.create only: sale allowed, sale void/edit and finance denied by UI and direct API
- [ ] Cashier with sales.returns only: returns allowed; sales void denied
- [ ] Cashier with sales.exchange.online only: online exchange allowed; void/receiving require their separate grants
- [ ] Accountant reports.financial: financial reports read only; voucher writing and profit/cost data not implicitly granted
- [ ] Inventory viewer cannot edit or see costs without inventory.edit / inventory.cost
- [ ] Purchase viewer cannot create/void; purchase-return create and void are separate rights; original purchase void owner only
- [ ] Voucher viewer cannot create/void; voucher writer cannot void
- [ ] Banking viewer cannot create, reverse or reconcile; banking.create has only explicitly granted writes
- [ ] Orders viewer cannot alter; orders.edit cannot delete or reverse courier journals; orders.cancel only cancels new orders
- [ ] cash.view, cash.open, cash.close are independent grants
- [ ] Removed/disabled permissions take effect on direct API calls (403), not just hidden UI
- [ ] Owner-only discount notes, salary, destructive deletion, staff administration and sensitive financial corrections remain owner-only
- [ ] Print A4 and thermal flows remain unchanged for owner

## Deployment / rollback safeguards
- No testing with actual customers/orders, live cash session, real stock or production bank entries.
- Snapshot database/financial state and note the API Worker and Pages release versions before deployment.
- Publish only after explicit owner approval and complete acceptance.
- Deploy Worker, smoke-test owner and restricted staff account, then publish POS Pages.
- On error revert both API Worker and POS Pages to recorded previous versions; reconcile any posted financial movement before any data correction.
