# Deferred supplier-draft cost for POS sale

Status: review-only, **NOT FOR PRODUCTION** before full integration tests and applying its guarded migration.

Physical stock is entered in the product card; the supplier draft is accounting-only.
Before approving supplier draft, POS may sell **only** if:
- exact physical stock and a single matching pending `stock_receipt` balance agree;
- the pre-sale product cost state is empty (no legacy/approved accounting quantity is consumed);
- the sale is recorded by `deferred_purchase_sale_costs` in the same transaction;
- any difference, multiple drafts, or known cost quantity rejects the sale.

No provisional cost snapshot is written and the UI must not present uncosted profit as final.

At supplier approval, the server locks the draft and product, verifies the active POS
sales and linked returns, checks the physical/accounting bridge, then divides the
supplier amount between stock on hand and net sold quantity. The original POS sale
snapshots and linked return snapshots are created with **confirmed** costs, and
the GL debits stock for the remainder and the existing historical COGS equity
bridge for the already-sold amount. The supplier credit/cash remains the full
purchase total. Neither POS sale nor supplier approval adds physical stock twice.

Voiding an unresolved POS sale marks its deferred row voided; an unpriced POS
return is allowed without inventing a reference price and is reconciled on
approval. Revisions are blocked while any item has deferred accounting.
An already settled item follows normal cost restore/return paths.

## Deployment order (not executed)

1. Review reconciliation with real (anonymized) fixtures and accounting team,
   including multi-line, exchange, online orders, purchase draft edits,
   negative stock prevention, return void, and concurrent cash sessions.
2. Apply `lib/db/migrations/20261115_add_deferred_purchase_sale_costs.sql`
   in a reviewed maintenance window before new API code is deployed.
3. Run Worker and POS typechecks, Node unit tests, and database-backed
   integration tests, then staged transactions.
4. Deploy Worker (not necessary to change storefront/POS clients),
   watch inventory mismatch errors and ledger invariants.
5. Approve only completed supplier invoices after manually reconciling
   original quantities and costs.

## Known limitations (must close before production)

Online checkout and order changes currently retain their existing block when
draft cost is unapproved. This patch addresses POS checkout only.
Production DB migration has not been applied, and database-backed tests have
not yet run. Partial POS sale edits during pending cost are deliberately blocked.
