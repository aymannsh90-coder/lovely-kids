BEGIN;

ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS item_discount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_minor integer NOT NULL DEFAULT 0;

UPDATE public.pos_sales
SET
  item_discount_minor = 0,
  invoice_discount_minor = discount_minor
WHERE
  discount_minor > 0
  AND item_discount_minor = 0
  AND invoice_discount_minor = 0;

ALTER TABLE public.pos_sales
  DROP CONSTRAINT IF EXISTS pos_sales_amounts_nonnegative,
  DROP CONSTRAINT IF EXISTS pos_sales_discount_breakdown_matches,
  DROP CONSTRAINT IF EXISTS pos_sales_total_matches;

ALTER TABLE public.pos_sales
  ADD CONSTRAINT pos_sales_amounts_nonnegative
    CHECK (
      subtotal_minor >= 0
      AND discount_minor >= 0
      AND item_discount_minor >= 0
      AND invoice_discount_minor >= 0
      AND total_minor >= 0
      AND paid_minor >= 0
      AND change_minor >= 0
    ),
  ADD CONSTRAINT pos_sales_discount_breakdown_matches
    CHECK (
      discount_minor =
      item_discount_minor + invoice_discount_minor
    ),
  ADD CONSTRAINT pos_sales_total_matches
    CHECK (
      total_minor = subtotal_minor - discount_minor
    );

ALTER TABLE public.pos_sale_items
  ADD COLUMN IF NOT EXISTS line_discount_minor integer NOT NULL DEFAULT 0;

ALTER TABLE public.pos_sale_items
  DROP CONSTRAINT IF EXISTS pos_sale_items_prices_nonnegative,
  DROP CONSTRAINT IF EXISTS pos_sale_items_line_discount_not_over_gross,
  DROP CONSTRAINT IF EXISTS pos_sale_items_total_matches;

ALTER TABLE public.pos_sale_items
  ADD CONSTRAINT pos_sale_items_prices_nonnegative
    CHECK (
      website_unit_price_minor >= 0
      AND sold_unit_price_minor >= 0
      AND line_discount_minor >= 0
      AND line_total_minor >= 0
    ),
  ADD CONSTRAINT pos_sale_items_line_discount_not_over_gross
    CHECK (
      line_discount_minor <= sold_unit_price_minor * quantity
    ),
  ADD CONSTRAINT pos_sale_items_total_matches
    CHECK (
      line_total_minor =
      sold_unit_price_minor * quantity - line_discount_minor
    );

ALTER TABLE public.pos_sale_return_items
  ADD COLUMN IF NOT EXISTS line_discount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_minor integer NOT NULL DEFAULT 0;

UPDATE public.pos_sale_return_items
SET
  line_discount_minor = 0,
  invoice_discount_minor = allocated_discount_minor
WHERE
  allocated_discount_minor > 0
  AND line_discount_minor = 0
  AND invoice_discount_minor = 0;

ALTER TABLE public.pos_sale_return_items
  DROP CONSTRAINT IF EXISTS pos_sale_return_items_amounts_nonnegative,
  DROP CONSTRAINT IF EXISTS pos_sale_return_items_discount_breakdown_matches,
  DROP CONSTRAINT IF EXISTS pos_sale_return_items_discount_not_over_gross,
  DROP CONSTRAINT IF EXISTS pos_sale_return_items_refund_matches;

ALTER TABLE public.pos_sale_return_items
  ADD CONSTRAINT pos_sale_return_items_amounts_nonnegative
    CHECK (
      sold_unit_price_minor >= 0
      AND gross_amount_minor >= 0
      AND line_discount_minor >= 0
      AND invoice_discount_minor >= 0
      AND allocated_discount_minor >= 0
      AND refund_amount_minor >= 0
    ),
  ADD CONSTRAINT pos_sale_return_items_discount_breakdown_matches
    CHECK (
      allocated_discount_minor =
      line_discount_minor + invoice_discount_minor
    ),
  ADD CONSTRAINT pos_sale_return_items_discount_not_over_gross
    CHECK (
      allocated_discount_minor <= gross_amount_minor
    ),
  ADD CONSTRAINT pos_sale_return_items_refund_matches
    CHECK (
      refund_amount_minor =
      gross_amount_minor - allocated_discount_minor
    );

COMMIT;
