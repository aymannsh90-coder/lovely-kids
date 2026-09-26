BEGIN;

-- =========================================================
-- Lovely Kids inventory cost accounting foundation
--
-- IMPORTANT:
-- These tables contain private cost/profit data.
-- They are intentionally separate from products/orders/sales
-- so normal Admin APIs never need to expose cost information.
-- Access must be enforced as Owner-only at the API layer.
-- =========================================================

CREATE TABLE public.product_cost_state (
  product_id integer PRIMARY KEY
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  -- Accounting quantity represented by the cost ledger.
  quantity_on_hand integer NOT NULL DEFAULT 0,

  -- Total remaining inventory value, in minor ILS units (agorot).
  -- Average cost is derived:
  -- inventory_value_minor / quantity_on_hand
  inventory_value_minor integer NOT NULL DEFAULT 0,

  -- confirmed = entirely supported by confirmed cost data
  -- estimated = based on an estimated/opening historical cost
  -- mixed = remaining stock contains both confirmed + estimated basis
  cost_quality text NOT NULL DEFAULT 'estimated',

  initialized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_cost_state_quantity_valid
    CHECK (quantity_on_hand >= 0),

  CONSTRAINT product_cost_state_value_valid
    CHECK (inventory_value_minor >= 0),

  CONSTRAINT product_cost_state_empty_value_valid
    CHECK (
      quantity_on_hand > 0
      OR inventory_value_minor = 0
    ),

  CONSTRAINT product_cost_state_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX product_cost_state_quality_idx
  ON public.product_cost_state (cost_quality);


CREATE TABLE public.product_cost_ledger (
  id serial PRIMARY KEY,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  event_type text NOT NULL,

  -- Identifies where the movement came from without coupling
  -- the cost ledger to only one business table.
  source_type text,
  source_ref text,
  source_item_ref text,

  -- Positive for inventory entering, negative for inventory leaving.
  quantity_delta integer NOT NULL,

  -- Positive for inventory value entering, negative for inventory value leaving.
  inventory_value_delta_minor integer NOT NULL,

  quantity_after integer NOT NULL,
  inventory_value_after_minor integer NOT NULL,

  cost_quality text NOT NULL,

  business_date date,

  note text,

  created_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_cost_ledger_event_valid
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
        'adjustment_in',
        'adjustment_out',
        'correction'
      )
    ),

  CONSTRAINT product_cost_ledger_quantity_after_valid
    CHECK (quantity_after >= 0),

  CONSTRAINT product_cost_ledger_value_after_valid
    CHECK (inventory_value_after_minor >= 0),

  CONSTRAINT product_cost_ledger_empty_value_valid
    CHECK (
      quantity_after > 0
      OR inventory_value_after_minor = 0
    ),

  CONSTRAINT product_cost_ledger_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX product_cost_ledger_product_idx
  ON public.product_cost_ledger (product_id);

CREATE INDEX product_cost_ledger_created_at_idx
  ON public.product_cost_ledger (created_at);

CREATE INDEX product_cost_ledger_business_date_idx
  ON public.product_cost_ledger (business_date);

CREATE INDEX product_cost_ledger_source_idx
  ON public.product_cost_ledger (
    source_type,
    source_ref,
    source_item_ref
  );

CREATE UNIQUE INDEX product_cost_ledger_source_event_unique_idx
  ON public.product_cost_ledger (
    source_type,
    source_ref,
    source_item_ref,
    event_type
  )
  WHERE source_ref IS NOT NULL
    AND source_item_ref IS NOT NULL;


-- Historical cost periods used only for rebuilding old profitability.
-- They do NOT directly change live inventory value.
CREATE TABLE public.product_historical_costs (
  id serial PRIMARY KEY,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  effective_from timestamptz NOT NULL,
  effective_to timestamptz,

  unit_cost_minor integer NOT NULL,

  cost_quality text NOT NULL,

  note text,

  created_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_historical_costs_cost_valid
    CHECK (unit_cost_minor >= 0),

  CONSTRAINT product_historical_costs_quality_valid
    CHECK (cost_quality IN ('confirmed', 'estimated')),

  CONSTRAINT product_historical_costs_period_valid
    CHECK (
      effective_to IS NULL
      OR effective_to > effective_from
    )
);

CREATE INDEX product_historical_costs_product_period_idx
  ON public.product_historical_costs (
    product_id,
    effective_from
  );


-- Private cost snapshot for POS sale lines.
-- cost_total_minor is authoritative. unit_cost_minor is the
-- rounded per-unit display snapshot.
CREATE TABLE public.pos_sale_item_costs (
  sale_item_id integer PRIMARY KEY
    REFERENCES public.pos_sale_items(id)
    ON DELETE CASCADE,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  quantity integer NOT NULL,

  unit_cost_minor integer NOT NULL,
  cost_total_minor integer NOT NULL,

  cost_quality text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_item_costs_quantity_valid
    CHECK (quantity > 0),

  CONSTRAINT pos_sale_item_costs_values_valid
    CHECK (
      unit_cost_minor >= 0
      AND cost_total_minor >= 0
    ),

  CONSTRAINT pos_sale_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX pos_sale_item_costs_product_idx
  ON public.pos_sale_item_costs (product_id);


-- Private cost snapshot for returned POS quantities.
CREATE TABLE public.pos_sale_return_item_costs (
  return_item_id integer PRIMARY KEY
    REFERENCES public.pos_sale_return_items(id)
    ON DELETE CASCADE,

  original_sale_item_id integer
    REFERENCES public.pos_sale_items(id)
    ON DELETE RESTRICT,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  quantity integer NOT NULL,

  cost_total_minor integer NOT NULL,

  cost_quality text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_return_item_costs_quantity_valid
    CHECK (quantity > 0),

  CONSTRAINT pos_sale_return_item_costs_value_valid
    CHECK (cost_total_minor >= 0),

  CONSTRAINT pos_sale_return_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX pos_sale_return_item_costs_original_sale_item_idx
  ON public.pos_sale_return_item_costs (original_sale_item_id);

CREATE INDEX pos_sale_return_item_costs_product_idx
  ON public.pos_sale_return_item_costs (product_id);


-- Orders currently store their lines inside orders.items JSON.
-- Keep cost snapshots outside that JSON so Admin/order APIs
-- never expose cost information.
CREATE TABLE public.order_item_costs (
  id serial PRIMARY KEY,

  order_id integer NOT NULL
    REFERENCES public.orders(id)
    ON DELETE CASCADE,

  line_number integer NOT NULL,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  color text,
  size text,

  quantity integer NOT NULL,

  unit_cost_minor integer NOT NULL,
  cost_total_minor integer NOT NULL,

  cost_quality text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_item_costs_line_valid
    CHECK (line_number > 0),

  CONSTRAINT order_item_costs_quantity_valid
    CHECK (quantity > 0),

  CONSTRAINT order_item_costs_values_valid
    CHECK (
      unit_cost_minor >= 0
      AND cost_total_minor >= 0
    ),

  CONSTRAINT order_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE UNIQUE INDEX order_item_costs_order_line_idx
  ON public.order_item_costs (
    order_id,
    line_number
  );

CREATE INDEX order_item_costs_product_idx
  ON public.order_item_costs (product_id);


-- Defense in depth:
-- no direct anon/authenticated table access.
ALTER TABLE public.product_cost_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_historical_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_item_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_return_item_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.product_cost_state,
  public.product_cost_ledger,
  public.product_historical_costs,
  public.pos_sale_item_costs,
  public.pos_sale_return_item_costs,
  public.order_item_costs
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.product_cost_state,
  public.product_cost_ledger,
  public.product_historical_costs,
  public.pos_sale_item_costs,
  public.pos_sale_return_item_costs,
  public.order_item_costs
TO service_role;

REVOKE ALL ON SEQUENCE
  public.product_cost_ledger_id_seq,
  public.product_historical_costs_id_seq,
  public.order_item_costs_id_seq
FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.product_cost_ledger_id_seq,
  public.product_historical_costs_id_seq,
  public.order_item_costs_id_seq
TO service_role;

COMMIT;
