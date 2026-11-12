# Optional online-order barcode verification

## Scope
- From the expanded online order, select **تحضير الطلب**. Supports QR labels, a hardware keyboard scanner, or device camera.
- Every unit must be scanned. The API checks product **and** color **and** size. Unknown, mismatched and excess scans are refused.
- A complete, current verification displays **تم التحقق بالباركود**; orders.status remains a **manual** action.
- Does not change stock, sale totals, cashbox, settlement, deliveries, or accounting.
- Resuming the same order preserves scan history. Removing a scan or restarting verification is explicit.
- An item/size/color/quantity edit invalidates old verification using a signature of the order lines; old scans cannot be applied to changed items.
- Owners/admins and staff with `orders.edit` may scan; `orders.view` permits read-only inspection. No public endpoint.

## Required pre-deploy sequence
1. Review PR and run:
   `pnpm --filter @workspace/api-worker typecheck`
   `pnpm --filter @workspace/lovely-kids typecheck`
   `pnpm --filter @workspace/lovely-kids build`.
2. Apply **only** `lib/db/migrations/20261107_create_order_picking_sessions.sql` to the intended Supabase database. Check table and RLS before API deployment.
3. Deploy the API Worker to the correct environment, then the Lovely Kids storefront frontend through Cloudflare Pages.
4. Test with a **test order**, including repeated scans, wrong model/size/color, changed order after verification, refresh/resume, permission denial and manual status change. Do not use live financial/stock changes for scanning tests.

## Design constraints
- Only QR/variant-specific product barcodes are acceptable where an order item has a color or size.
- Generic product barcodes are only accepted for products with **no** color and **no** size on the order line.
- If barcode mappings are incomplete, label them correctly in Product Management before relying on verification.
- The API uses an order-row lock for concurrent scans and client request IDs for retry-safety.
- If a prior verification signature is stale, the user must explicitly restart the verification.
