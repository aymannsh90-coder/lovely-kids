-- Online-order exchange workflow.
-- LOCAL MIGRATION FILE ONLY until explicitly applied to Production.
-- Separates financial completion from physical return receipt.

ALTER TABLE exchange_documents
  ADD COLUMN IF NOT EXISTS replacement_order_id integer
    REFERENCES orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS replacement_order_origin text,
  ADD COLUMN IF NOT EXISTS financial_business_date date,
  ADD COLUMN IF NOT EXISTS financial_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS financial_completed_by_user_id integer
    REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS return_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_received_by_user_id integer
    REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_base_charge_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_discount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_discount_mode text;

ALTER TABLE exchange_documents
  DROP CONSTRAINT IF EXISTS exchange_documents_source_valid,
  DROP CONSTRAINT IF EXISTS exchange_documents_settlement_party_valid,
  DROP CONSTRAINT IF EXISTS exchange_documents_amounts_valid;

ALTER TABLE exchange_documents
  ADD CONSTRAINT exchange_documents_source_valid CHECK (
    (
      source_type = 'pos_sale'
      AND original_pos_sale_id IS NOT NULL
      AND original_order_id IS NULL
      AND replacement_order_id IS NULL
    )
    OR
    (
      source_type = 'pos_no_receipt'
      AND original_pos_sale_id IS NULL
      AND original_order_id IS NULL
      AND replacement_order_id IS NULL
    )
    OR
    (
      source_type = 'online_order'
      AND original_pos_sale_id IS NULL
      AND original_order_id IS NOT NULL
      AND replacement_order_id IS NOT NULL
      AND replacement_order_id <> original_order_id
    )
  ),
  ADD CONSTRAINT exchange_documents_replacement_origin_valid CHECK (
    (
      source_type = 'online_order'
      AND replacement_order_origin IN ('existing_order', 'system_created')
    )
    OR
    (
      source_type <> 'online_order'
      AND replacement_order_origin IS NULL
    )
  ),
  ADD CONSTRAINT exchange_documents_settlement_party_valid CHECK (
    (
      source_type = 'online_order'
      AND settlement_type = 'delivery_company'
      AND (
        financial_completed_at IS NULL
        OR settlement_party_id IS NOT NULL
      )
    )
    OR
    (
      source_type <> 'online_order'
      AND (
        (
          settlement_type IN ('cash', 'card')
          AND settlement_party_id IS NULL
        )
        OR
        (
          settlement_type IN ('delivery_company', 'customer')
          AND settlement_party_id IS NOT NULL
        )
      )
    )
  ),
  ADD CONSTRAINT exchange_documents_amounts_valid CHECK (
    return_gross_minor >= 0
    AND return_discount_minor >= 0
    AND return_net_minor >= 0
    AND new_gross_minor >= 0
    AND new_discount_minor >= 0
    AND new_net_minor >= 0
    AND delivery_base_charge_minor >= 0
    AND delivery_discount_minor >= 0
    AND delivery_charge_minor >= 0
    AND delivery_company_cost_minor >= 0
  ),
  ADD CONSTRAINT exchange_documents_online_delivery_valid CHECK (
    (
      source_type <> 'online_order'
      AND delivery_base_charge_minor = 0
      AND delivery_discount_minor = 0
    )
    OR
    (
      source_type = 'online_order'
      AND delivery_discount_minor <= delivery_base_charge_minor
      AND delivery_charge_minor =
        delivery_base_charge_minor - delivery_discount_minor
      AND settlement_type = 'delivery_company'
    )
  ),
  ADD CONSTRAINT exchange_documents_online_workflow_valid CHECK (
    (
      financial_completed_at IS NULL
      AND financial_completed_by_user_id IS NULL
      AND financial_business_date IS NULL
    )
    OR
    (
      financial_completed_at IS NOT NULL
      AND financial_completed_by_user_id IS NOT NULL
      AND financial_business_date IS NOT NULL
    )
  ),
  ADD CONSTRAINT exchange_documents_return_received_valid CHECK (
    (
      return_received_at IS NULL
      AND return_received_by_user_id IS NULL
    )
    OR
    (
      return_received_at IS NOT NULL
      AND return_received_by_user_id IS NOT NULL
      AND financial_completed_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT exchange_documents_non_online_workflow_valid CHECK (
    source_type = 'online_order'
    OR (
      financial_completed_at IS NULL
      AND financial_completed_by_user_id IS NULL
      AND financial_business_date IS NULL
      AND return_received_at IS NULL
      AND return_received_by_user_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS exchange_documents_replacement_order_idx
  ON exchange_documents(replacement_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS exchange_documents_active_replacement_order_idx
  ON exchange_documents(replacement_order_id)
  WHERE replacement_order_id IS NOT NULL
    AND status = 'completed';

CREATE INDEX IF NOT EXISTS exchange_documents_financial_business_date_idx
  ON exchange_documents(financial_business_date);


ALTER TABLE exchange_documents
  DROP CONSTRAINT IF EXISTS exchange_documents_delivery_discount_mode_valid,
  ADD CONSTRAINT exchange_documents_delivery_discount_mode_valid CHECK (
    (
      source_type = 'online_order'
      AND delivery_discount_mode IN ('none', 'half', 'full', 'manual')
    )
    OR
    (
      source_type <> 'online_order'
      AND delivery_discount_mode IS NULL
    )
  );
