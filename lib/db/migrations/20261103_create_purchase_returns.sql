BEGIN;

CREATE TABLE IF NOT EXISTS public.pos_purchase_returns (
  id serial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  purchase_id integer NOT NULL REFERENCES public.pos_purchases(id) ON DELETE RESTRICT,
  supplier_id integer NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  refund_amount_minor integer NOT NULL CHECK (refund_amount_minor >= 0),
  inventory_cost_minor integer NOT NULL CHECK (inventory_cost_minor >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 500),
  notes text,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  voided_at timestamptz,
  voided_by_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_purchase_returns_void_state_valid CHECK (
    (status = 'completed' AND voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL)
    OR
    (status = 'voided' AND voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND length(btrim(void_reason)) >= 2)
  )
);

CREATE INDEX IF NOT EXISTS pos_purchase_returns_purchase_idx ON public.pos_purchase_returns(purchase_id);
CREATE INDEX IF NOT EXISTS pos_purchase_returns_supplier_idx ON public.pos_purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS pos_purchase_returns_business_date_idx ON public.pos_purchase_returns(business_date);

CREATE TABLE IF NOT EXISTS public.pos_purchase_return_items (
  id serial PRIMARY KEY,
  return_id integer NOT NULL REFERENCES public.pos_purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id integer NOT NULL REFERENCES public.pos_purchase_items(id) ON DELETE RESTRICT,
  product_id integer NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  color text,
  size text,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99999),
  refund_amount_minor integer NOT NULL CHECK (refund_amount_minor >= 0),
  inventory_cost_minor integer NOT NULL CHECK (inventory_cost_minor >= 0),
  cost_quality text NOT NULL CHECK (cost_quality IN ('confirmed', 'estimated', 'mixed')),
  general_stock_before integer,
  general_stock_after integer,
  variant_stock_before integer,
  variant_stock_after integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_purchase_return_items_return_idx ON public.pos_purchase_return_items(return_id);
CREATE INDEX IF NOT EXISTS pos_purchase_return_items_purchase_item_idx ON public.pos_purchase_return_items(purchase_item_id);
CREATE INDEX IF NOT EXISTS pos_purchase_return_items_product_idx ON public.pos_purchase_return_items(product_id);

ALTER TABLE public.pos_purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_purchase_return_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.pos_purchase_returns, public.pos_purchase_return_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pos_purchase_returns_id_seq, public.pos_purchase_return_items_id_seq TO service_role;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_type_valid;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_type_valid CHECK (movement_type IN (
    'purchase', 'purchase_void', 'purchase_return', 'purchase_return_void',
    'pos_sale', 'pos_sale_void', 'pos_sale_edit', 'pos_sale_return', 'pos_sale_return_void',
    'online_order', 'online_order_cancel', 'online_order_restore', 'online_order_edit',
    'exchange_return', 'exchange_sale', 'exchange_return_void', 'exchange_sale_void', 'adjustment'
  ));
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_source_type_valid;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_source_type_valid CHECK (source_type IN (
    'pos_purchase', 'pos_purchase_return', 'pos_sale', 'pos_sale_return', 'online_order', 'exchange', 'manual'
  ));

ALTER TABLE public.product_cost_ledger
  DROP CONSTRAINT IF EXISTS product_cost_ledger_event_valid;
ALTER TABLE public.product_cost_ledger
  ADD CONSTRAINT product_cost_ledger_event_valid CHECK (event_type IN (
    'opening', 'purchase', 'purchase_void', 'purchase_return', 'purchase_return_void',
    'pos_sale', 'pos_sale_void', 'pos_sale_edit_reverse', 'pos_return', 'pos_mobile_return',
    'pos_return_void', 'online_order', 'online_order_cancel', 'online_order_edit_reverse',
    'exchange_return', 'exchange_sale', 'exchange_return_void', 'exchange_sale_void',
    'adjustment_in', 'adjustment_out', 'correction'
  ));

COMMIT;
