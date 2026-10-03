BEGIN;

ALTER TABLE public.exchange_documents
  DROP CONSTRAINT exchange_documents_source_valid;

ALTER TABLE public.exchange_documents
  ADD CONSTRAINT exchange_documents_source_valid
  CHECK (
    (
      source_type = 'pos_sale'
      AND original_pos_sale_id IS NOT NULL
      AND original_order_id IS NULL
    )
    OR
    (
      source_type = 'pos_no_receipt'
      AND original_pos_sale_id IS NULL
      AND original_order_id IS NULL
    )
    OR
    (
      source_type = 'online_order'
      AND original_pos_sale_id IS NULL
      AND original_order_id IS NOT NULL
    )
  );

ALTER TABLE public.exchange_return_items
  ADD COLUMN catalog_unit_price_minor integer;

ALTER TABLE public.exchange_return_items
  ADD CONSTRAINT exchange_return_items_catalog_price_valid
  CHECK (
    catalog_unit_price_minor IS NULL
    OR catalog_unit_price_minor >= 0
  );

ALTER TABLE public.exchange_return_items
  DROP CONSTRAINT exchange_return_items_source_valid;

ALTER TABLE public.exchange_return_items
  ADD CONSTRAINT exchange_return_items_source_valid
  CHECK (
    (
      original_pos_sale_item_id IS NOT NULL
      AND original_order_line_number IS NULL
    )
    OR
    (
      original_pos_sale_item_id IS NULL
      AND original_order_line_number IS NOT NULL
      AND original_order_line_number > 0
    )
    OR
    (
      original_pos_sale_item_id IS NULL
      AND original_order_line_number IS NULL
      AND product_id IS NOT NULL
    )
  );

COMMIT;
