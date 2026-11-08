# Online exchange return parcel barcode receipt

## Flow
The **returned old items** (not the replacement shipment items) are independently verified in the existing "تأكيد استلام الطرد المرتجع" dialog.

- GET `/api/pos/exchanges/online/return-picking?publicId=EXC-...` displays the expected returned items and persisted scan progress.
- POST `/api/pos/exchanges/online/return-picking/scan` with `{publicId,barcode,requestId}` validates the exact item, color, size, quantity. One accepted scan is **one unit**, even if a label is shared by several identical pieces.
- DELETE `/api/pos/exchanges/online/return-picking/scans/{scanId}` with `{publicId}` reverses an accidental scan; DELETE `/api/pos/exchanges/online/return-picking/reset` restarts verification.
- Scans record verifier, server timestamp, barcode and idempotency request ID. They do not mutate order status, products, stock or finance.
- The existing POST `/api/pos/exchanges/online/receive-return` remains the only operation that restores physical inventory and transfers its already accrued cost. It requires a complete, current verified picking session **inside the same row-locked transaction**; client-side disabling alone does not authorize receipt.
- If quantities/items change, the signature no longer matches: verification is invalidated. The operator must reset and scan again.
- Old exchanges completed **before** this feature can be inspected without changing history; receiving any not-yet-received exchange will require verification once the new API is deployed.
- No automatic stock receipt or financial posting at 100%. The human must press the existing final confirmation.
- Missing/damaged/unmatched returns cannot be booked as complete; owner exception / partial receipt needs a dedicated stock and accounting workflow and is **not** silently permitted.

## Release gate
1. Run API and storefront typechecks and builds; apply the migration to a disposable PostgreSQL instance and verify RLS and FK behavior.
2. Apply the SQL migration on production only when approving deployment, then deploy API Worker and storefront from a pinned tested commit. **Neither step was done by creating this branch.**
3. Verify actual label scans with 2 identical units, different variants and a wrong barcode; reject over-scan and stale signature.
4. Verify receipt reverses no sale, books each piece once only, and a repeated receipt call is idempotent (already received).
5. Keep other open PRs and unrelated projects untouched.
