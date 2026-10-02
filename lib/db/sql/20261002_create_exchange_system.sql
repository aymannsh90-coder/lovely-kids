BEGIN;

-- =========================================================
-- Lovely Kids exchange invoice system
-- POS + online orders + cash/card/courier/customer settlement.
-- Cost snapshots remain private and are never exposed directly
-- through normal Admin/POS APIs.
-- =========================================================

DO $$
BEGIN
  IF to_regclass('public.pos_sales') IS NULL THEN
    RAISE EXCEPTION 'Required table public.pos_sales does not exist';
  END IF;

  IF to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION 'Required table public.orders does not exist';
  END IF;

  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'Required table public.products does not exist';
  END IF;

  IF to_regclass('public.exchange_documents') IS NOT NULL THEN
    RAISE EXCEPTION 'Table public.exchange_documents already exists';
  END IF;
END
$$;

CREATE TABLE public.exchange_documents (
  id serial PRIMARY KEY,

  public_id text NOT NULL,
  idempotency_key text NOT NULL,

  source_type text NOT NULL,

  original_pos_sale_id integer
    REFERENCES public.pos_sales(id)
    ON DELETE RESTRICT,

  original_order_id integer
    REFERENCES public.orders(id)
    ON DELETE RESTRICT,

  business_date date NOT NULL,

  cash_session_id integer
    REFERENCES public.cash_sessions(id)
    ON DELETE RESTRICT,

  register_key text,

  created_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'completed',

  settlement_type text NOT NULL,
  settlement_party_id integer,

  return_gross_minor integer NOT NULL,
  return_discount_minor integer NOT NULL,
  return_net_minor integer NOT NULL,

  new_gross_minor integer NOT NULL,
  new_discount_minor integer NOT NULL,
  new_net_minor integer NOT NULL,

  difference_minor integer NOT NULL,

  delivery_charge_minor integer NOT NULL DEFAULT 0,
  delivery_company_cost_minor integer NOT NULL DEFAULT 0,

  settlement_amount_minor integer NOT NULL,

  reason text,
  notes text,

  voided_at timestamptz,

  voided_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  void_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_documents_source_valid
    CHECK (
      (
        source_type = 'pos_sale'
        AND original_pos_sale_id IS NOT NULL
        AND original_order_id IS NULL
      )
      OR
      (
        source_type = 'online_order'
        AND original_pos_sale_id IS NULL
        AND original_order_id IS NOT NULL
      )
    ),

  CONSTRAINT exchange_documents_status_valid
    CHECK (status IN ('completed', 'voided')),

  CONSTRAINT exchange_documents_settlement_type_valid
    CHECK (
      settlement_type IN (
        'cash',
        'card',
        'delivery_company',
        'customer'
      )
    ),

  CONSTRAINT exchange_documents_settlement_party_valid
    CHECK (
      (
        settlement_type IN ('cash', 'card')
        AND settlement_party_id IS NULL
      )
      OR
      (
        settlement_type IN ('delivery_company', 'customer')
        AND settlement_party_id IS NOT NULL
      )
    ),

  CONSTRAINT exchange_documents_amounts_valid
    CHECK (
      return_gross_minor >= 0
      AND return_discount_minor >= 0
      AND return_net_minor >= 0
      AND new_gross_minor >= 0
      AND new_discount_minor >= 0
      AND new_net_minor >= 0
      AND delivery_charge_minor >= 0
      AND delivery_company_cost_minor >= 0
    ),

  CONSTRAINT exchange_documents_return_total_valid
    CHECK (
      return_net_minor =
      return_gross_minor - return_discount_minor
    ),

  CONSTRAINT exchange_documents_new_total_valid
    CHECK (
      new_net_minor =
      new_gross_minor - new_discount_minor
    ),

  CONSTRAINT exchange_documents_difference_valid
    CHECK (
      difference_minor =
      new_net_minor - return_net_minor
    ),

  CONSTRAINT exchange_documents_settlement_amount_valid
    CHECK (
      settlement_amount_minor =
      difference_minor + delivery_charge_minor
    ),

  CONSTRAINT exchange_documents_card_direction_valid
    CHECK (
      settlement_type <> 'card'
      OR settlement_amount_minor > 0
    ),

  CONSTRAINT exchange_documents_void_state_valid
    CHECK (
      (
        status = 'completed'
        AND voided_at IS NULL
        AND voided_by_user_id IS NULL
      )
      OR
      (
        status = 'voided'
        AND voided_at IS NOT NULL
        AND voided_by_user_id IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX exchange_documents_public_id_idx
  ON public.exchange_documents(public_id);

CREATE UNIQUE INDEX exchange_documents_idempotency_key_idx
  ON public.exchange_documents(idempotency_key);

CREATE INDEX exchange_documents_pos_sale_idx
  ON public.exchange_documents(original_pos_sale_id);

CREATE INDEX exchange_documents_order_idx
  ON public.exchange_documents(original_order_id);

CREATE INDEX exchange_documents_business_date_idx
  ON public.exchange_documents(business_date);

CREATE INDEX exchange_documents_settlement_party_idx
  ON public.exchange_documents(
    settlement_type,
    settlement_party_id
  );

-- =========================================================
-- Returned items in an exchange.
-- Each line points either to an original POS sale item
-- or to an original online-order line.
-- =========================================================

CREATE TABLE public.exchange_return_items (
  id serial PRIMARY KEY,

  exchange_id integer NOT NULL
    REFERENCES public.exchange_documents(id)
    ON DELETE CASCADE,

  line_number integer NOT NULL,

  original_pos_sale_item_id integer
    REFERENCES public.pos_sale_items(id)
    ON DELETE RESTRICT,

  original_order_line_number integer,

  product_id integer
    REFERENCES public.products(id)
    ON DELETE SET NULL,

  barcode text,
  product_code text,
  product_name_ar text NOT NULL,
  product_image text,

  color text,
  size text,

  quantity integer NOT NULL,

  sold_unit_price_minor integer NOT NULL,
  gross_amount_minor integer NOT NULL,

  line_discount_minor integer NOT NULL DEFAULT 0,
  invoice_discount_minor integer NOT NULL DEFAULT 0,
  allocated_discount_minor integer NOT NULL,

  return_net_minor integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,

  variant_stock_before integer,
  variant_stock_after integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_return_items_line_positive
    CHECK (line_number > 0),

  CONSTRAINT exchange_return_items_quantity_valid
    CHECK (quantity > 0 AND quantity <= 99),

  CONSTRAINT exchange_return_items_source_valid
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
    ),

  CONSTRAINT exchange_return_items_amounts_nonnegative
    CHECK (
      sold_unit_price_minor >= 0
      AND gross_amount_minor >= 0
      AND line_discount_minor >= 0
      AND invoice_discount_minor >= 0
      AND allocated_discount_minor >= 0
      AND return_net_minor >= 0
    ),

  CONSTRAINT exchange_return_items_gross_matches
    CHECK (
      gross_amount_minor =
      sold_unit_price_minor * quantity
    ),

  CONSTRAINT exchange_return_items_discount_matches
    CHECK (
      allocated_discount_minor =
      line_discount_minor + invoice_discount_minor
    ),

  CONSTRAINT exchange_return_items_discount_not_over_gross
    CHECK (allocated_discount_minor <= gross_amount_minor),

  CONSTRAINT exchange_return_items_net_matches
    CHECK (
      return_net_minor =
      gross_amount_minor - allocated_discount_minor
    ),

  CONSTRAINT exchange_return_items_general_stock_valid
    CHECK (
      (
        general_stock_before IS NULL
        OR general_stock_before >= 0
      )
      AND
      (
        general_stock_after IS NULL
        OR general_stock_after >= 0
      )
    ),

  CONSTRAINT exchange_return_items_variant_stock_valid
    CHECK (
      (
        variant_stock_before IS NULL
        OR variant_stock_before >= 0
      )
      AND
      (
        variant_stock_after IS NULL
        OR variant_stock_after >= 0
      )
    )
);

CREATE UNIQUE INDEX exchange_return_items_exchange_line_idx
  ON public.exchange_return_items(exchange_id, line_number);

CREATE UNIQUE INDEX exchange_return_items_pos_source_idx
  ON public.exchange_return_items(
    exchange_id,
    original_pos_sale_item_id
  )
  WHERE original_pos_sale_item_id IS NOT NULL;

CREATE UNIQUE INDEX exchange_return_items_online_source_idx
  ON public.exchange_return_items(
    exchange_id,
    original_order_line_number
  )
  WHERE original_order_line_number IS NOT NULL;

CREATE INDEX exchange_return_items_exchange_idx
  ON public.exchange_return_items(exchange_id);

CREATE INDEX exchange_return_items_product_idx
  ON public.exchange_return_items(product_id);

CREATE INDEX exchange_return_items_barcode_idx
  ON public.exchange_return_items(barcode);

-- =========================================================
-- New items given to the customer in an exchange.
-- These behave like POS sale lines for stock and pricing.
-- =========================================================

CREATE TABLE public.exchange_sale_items (
  id serial PRIMARY KEY,

  exchange_id integer NOT NULL
    REFERENCES public.exchange_documents(id)
    ON DELETE CASCADE,

  line_number integer NOT NULL,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  barcode text,
  product_code text,
  product_name_ar text NOT NULL,
  product_image text,

  color text,
  size text,

  quantity integer NOT NULL,

  website_unit_price_minor integer NOT NULL,
  sold_unit_price_minor integer NOT NULL,

  gross_amount_minor integer NOT NULL,

  line_discount_minor integer NOT NULL DEFAULT 0,
  invoice_discount_minor integer NOT NULL DEFAULT 0,
  allocated_discount_minor integer NOT NULL,

  line_net_minor integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,

  variant_stock_before integer,
  variant_stock_after integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_sale_items_line_positive
    CHECK (line_number > 0),

  CONSTRAINT exchange_sale_items_quantity_valid
    CHECK (quantity > 0 AND quantity <= 99),

  CONSTRAINT exchange_sale_items_amounts_nonnegative
    CHECK (
      website_unit_price_minor >= 0
      AND sold_unit_price_minor >= 0
      AND gross_amount_minor >= 0
      AND line_discount_minor >= 0
      AND invoice_discount_minor >= 0
      AND allocated_discount_minor >= 0
      AND line_net_minor >= 0
    ),

  CONSTRAINT exchange_sale_items_gross_matches
    CHECK (
      gross_amount_minor =
      sold_unit_price_minor * quantity
    ),

  CONSTRAINT exchange_sale_items_discount_matches
    CHECK (
      allocated_discount_minor =
      line_discount_minor + invoice_discount_minor
    ),

  CONSTRAINT exchange_sale_items_discount_not_over_gross
    CHECK (allocated_discount_minor <= gross_amount_minor),

  CONSTRAINT exchange_sale_items_net_matches
    CHECK (
      line_net_minor =
      gross_amount_minor - allocated_discount_minor
    ),

  CONSTRAINT exchange_sale_items_general_stock_valid
    CHECK (
      (
        general_stock_before IS NULL
        OR general_stock_before >= 0
      )
      AND
      (
        general_stock_after IS NULL
        OR general_stock_after >= 0
      )
    ),

  CONSTRAINT exchange_sale_items_variant_stock_valid
    CHECK (
      (
        variant_stock_before IS NULL
        OR variant_stock_before >= 0
      )
      AND
      (
        variant_stock_after IS NULL
        OR variant_stock_after >= 0
      )
    )
);

CREATE UNIQUE INDEX exchange_sale_items_exchange_line_idx
  ON public.exchange_sale_items(exchange_id, line_number);

CREATE INDEX exchange_sale_items_exchange_idx
  ON public.exchange_sale_items(exchange_id);

CREATE INDEX exchange_sale_items_product_idx
  ON public.exchange_sale_items(product_id);

CREATE INDEX exchange_sale_items_barcode_idx
  ON public.exchange_sale_items(barcode);

-- =========================================================
-- Private cost snapshots for exchange items.
-- Return cost = original historical cost being restored.
-- Sale cost   = current cost consumed by the new item.
-- These tables are Owner-only at the API layer.
-- =========================================================

CREATE TABLE public.exchange_return_item_costs (
  return_item_id integer PRIMARY KEY
    REFERENCES public.exchange_return_items(id)
    ON DELETE CASCADE,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  quantity integer NOT NULL,

  unit_cost_minor integer NOT NULL,
  cost_total_minor integer NOT NULL,

  cost_quality text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_return_item_costs_quantity_valid
    CHECK (quantity > 0),

  CONSTRAINT exchange_return_item_costs_values_valid
    CHECK (
      unit_cost_minor >= 0
      AND cost_total_minor >= 0
    ),

  CONSTRAINT exchange_return_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX exchange_return_item_costs_product_idx
  ON public.exchange_return_item_costs(product_id);


CREATE TABLE public.exchange_sale_item_costs (
  sale_item_id integer PRIMARY KEY
    REFERENCES public.exchange_sale_items(id)
    ON DELETE CASCADE,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  quantity integer NOT NULL,

  unit_cost_minor integer NOT NULL,
  cost_total_minor integer NOT NULL,

  cost_quality text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_sale_item_costs_quantity_valid
    CHECK (quantity > 0),

  CONSTRAINT exchange_sale_item_costs_values_valid
    CHECK (
      unit_cost_minor >= 0
      AND cost_total_minor >= 0
    ),

  CONSTRAINT exchange_sale_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX exchange_sale_item_costs_product_idx
  ON public.exchange_sale_item_costs(product_id);

-- =========================================================
-- Extend inventory + cost ledgers with exchange events.
-- =========================================================

DO $$
BEGIN
  IF to_regclass('public.inventory_movements') IS NULL THEN
    RAISE EXCEPTION 'Required table public.inventory_movements does not exist';
  END IF;

  IF to_regclass('public.product_cost_ledger') IS NULL THEN
    RAISE EXCEPTION 'Required table public.product_cost_ledger does not exist';
  END IF;
END
$$;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT inventory_movements_type_valid;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_type_valid
  CHECK (
    movement_type IN (
      'purchase',
      'purchase_void',
      'pos_sale',
      'pos_sale_void',
      'pos_sale_edit',
      'pos_sale_return',
      'pos_sale_return_void',
      'online_order',
      'online_order_cancel',
      'online_order_restore',
      'online_order_edit',
      'exchange_return',
      'exchange_sale',
      'exchange_return_void',
      'exchange_sale_void',
      'adjustment'
    )
  );

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT inventory_movements_source_type_valid;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_source_type_valid
  CHECK (
    source_type IN (
      'pos_purchase',
      'pos_sale',
      'pos_sale_return',
      'online_order',
      'exchange',
      'manual'
    )
  );

ALTER TABLE public.product_cost_ledger
  DROP CONSTRAINT product_cost_ledger_event_valid;

ALTER TABLE public.product_cost_ledger
  ADD CONSTRAINT product_cost_ledger_event_valid
  CHECK (
    event_type IN (
      'opening',
      'purchase',
      'purchase_void',
      'pos_sale',
      'pos_sale_void',
      'pos_sale_edit_reverse',
      'pos_return',
      'pos_mobile_return',
      'pos_return_void',
      'online_order',
      'online_order_cancel',
      'online_order_edit_reverse',
      'exchange_return',
      'exchange_sale',
      'exchange_return_void',
      'exchange_sale_void',
      'adjustment_in',
      'adjustment_out',
      'correction'
    )
  );

-- =========================================================
-- Security / RLS
-- Exchange data is accessed through the API Worker only.
-- Cost snapshot tables remain private.
-- =========================================================

ALTER TABLE public.exchange_documents
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exchange_return_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exchange_sale_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exchange_return_item_costs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exchange_sale_item_costs
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.exchange_documents,
  public.exchange_return_items,
  public.exchange_sale_items,
  public.exchange_return_item_costs,
  public.exchange_sale_item_costs
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.exchange_documents,
  public.exchange_return_items,
  public.exchange_sale_items,
  public.exchange_return_item_costs,
  public.exchange_sale_item_costs
TO service_role;

REVOKE ALL ON SEQUENCE
  public.exchange_documents_id_seq,
  public.exchange_return_items_id_seq,
  public.exchange_sale_items_id_seq
FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.exchange_documents_id_seq,
  public.exchange_return_items_id_seq,
  public.exchange_sale_items_id_seq
TO service_role;

COMMIT;
