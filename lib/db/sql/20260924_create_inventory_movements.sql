BEGIN;

DO $$
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'Required table public.products does not exist';
  END IF;

  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    RAISE EXCEPTION 'Table public.inventory_movements already exists';
  END IF;
END
$$;

CREATE TABLE public.inventory_movements (
  id serial PRIMARY KEY,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  barcode text,
  product_code text,
  product_name_ar text NOT NULL,

  color text,
  size text,

  movement_type text NOT NULL,

  quantity_delta integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,

  variant_stock_before integer,
  variant_stock_after integer,

  source_type text NOT NULL,
  source_id integer,
  source_item_id integer,
  source_public_id text,

  event_key text NOT NULL,

  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_movements_type_valid
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
        'adjustment'
      )
    ),

  CONSTRAINT inventory_movements_source_type_valid
    CHECK (
      source_type IN (
        'pos_purchase',
        'pos_sale',
        'pos_sale_return',
        'online_order',
        'manual'
      )
    ),

  CONSTRAINT inventory_movements_delta_nonzero
    CHECK (quantity_delta <> 0),

  CONSTRAINT inventory_movements_event_key_valid
    CHECK (length(btrim(event_key)) BETWEEN 3 AND 180),

  CONSTRAINT inventory_movements_general_stock_valid
    CHECK (
      (
        general_stock_before IS NULL
        AND general_stock_after IS NULL
      )
      OR
      (
        general_stock_before IS NOT NULL
        AND general_stock_after IS NOT NULL
        AND general_stock_before >= 0
        AND general_stock_after >= 0
        AND general_stock_after =
          general_stock_before + quantity_delta
      )
    ),

  CONSTRAINT inventory_movements_variant_stock_valid
    CHECK (
      (
        variant_stock_before IS NULL
        AND variant_stock_after IS NULL
      )
      OR
      (
        variant_stock_before IS NOT NULL
        AND variant_stock_after IS NOT NULL
        AND variant_stock_before >= 0
        AND variant_stock_after >= 0
        AND variant_stock_after =
          variant_stock_before + quantity_delta
      )
    )
);

CREATE UNIQUE INDEX inventory_movements_event_key_idx
  ON public.inventory_movements(event_key);

CREATE INDEX inventory_movements_product_idx
  ON public.inventory_movements(product_id);

CREATE INDEX inventory_movements_product_occurred_idx
  ON public.inventory_movements(product_id, occurred_at);

CREATE INDEX inventory_movements_barcode_idx
  ON public.inventory_movements(barcode);

CREATE INDEX inventory_movements_source_idx
  ON public.inventory_movements(source_type, source_id);

CREATE INDEX inventory_movements_occurred_at_idx
  ON public.inventory_movements(occurred_at);

ALTER TABLE public.inventory_movements
  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE
  public.inventory_movements
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE
  public.inventory_movements_id_seq
TO service_role;

COMMIT;
