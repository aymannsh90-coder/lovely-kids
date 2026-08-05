BEGIN;

DO $$
BEGIN
  IF to_regclass('public.suppliers') IS NOT NULL
     OR to_regclass('public.pos_purchases') IS NOT NULL
     OR to_regclass('public.pos_purchase_items') IS NOT NULL THEN
    RAISE EXCEPTION 'Supplier or purchase tables already exist';
  END IF;
END
$$;

CREATE TABLE public.suppliers (
  id serial PRIMARY KEY,

  code text NOT NULL,
  name text NOT NULL,

  contact_person text,
  phone text,
  mobile text,
  email text,
  address text,
  notes text,

  status text NOT NULL DEFAULT 'active',

  created_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT suppliers_code_valid
    CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),

  CONSTRAINT suppliers_name_not_empty
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT suppliers_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX suppliers_code_idx
  ON public.suppliers (code);

CREATE INDEX suppliers_name_idx
  ON public.suppliers (name);

CREATE INDEX suppliers_status_idx
  ON public.suppliers (status);

CREATE INDEX suppliers_created_at_idx
  ON public.suppliers (created_at);

CREATE TABLE public.pos_purchases (
  id serial PRIMARY KEY,

  public_id text NOT NULL,
  idempotency_key text NOT NULL,

  supplier_id integer NOT NULL
    REFERENCES public.suppliers(id)
    ON DELETE RESTRICT,

  supplier_invoice_number text,

  business_date date NOT NULL,
  warehouse_key text NOT NULL DEFAULT 'main',
  currency_code text NOT NULL DEFAULT 'ILS',

  entered_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'completed',
  payment_method text NOT NULL DEFAULT 'credit',

  subtotal_minor integer NOT NULL,
  discount_minor integer NOT NULL DEFAULT 0,
  total_minor integer NOT NULL,

  paid_minor integer NOT NULL DEFAULT 0,
  due_minor integer NOT NULL,

  notes text,

  voided_at timestamptz,

  voided_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  void_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_purchases_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 80),

  CONSTRAINT pos_purchases_idempotency_key_valid
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 120),

  CONSTRAINT pos_purchases_warehouse_key_valid
    CHECK (warehouse_key ~ '^[a-z0-9_-]{1,50}$'),

  CONSTRAINT pos_purchases_currency_code_valid
    CHECK (currency_code ~ '^[A-Z]{3}$'),

  CONSTRAINT pos_purchases_status_valid
    CHECK (status IN ('completed', 'voided')),

  CONSTRAINT pos_purchases_payment_method_valid
    CHECK (payment_method IN ('cash', 'credit', 'mixed')),

  CONSTRAINT pos_purchases_amounts_nonnegative
    CHECK (
      subtotal_minor >= 0
      AND discount_minor >= 0
      AND total_minor >= 0
      AND paid_minor >= 0
      AND due_minor >= 0
    ),

  CONSTRAINT pos_purchases_discount_not_over_subtotal
    CHECK (discount_minor <= subtotal_minor),

  CONSTRAINT pos_purchases_total_matches
    CHECK (
      total_minor =
      subtotal_minor - discount_minor
    ),

  CONSTRAINT pos_purchases_settlement_matches
    CHECK (
      paid_minor <= total_minor
      AND due_minor = total_minor - paid_minor
    ),

  CONSTRAINT pos_purchases_void_state_valid
    CHECK (
      (
        status = 'completed'
        AND voided_at IS NULL
        AND voided_by_user_id IS NULL
        AND void_reason IS NULL
      )
      OR
      (
        status = 'voided'
        AND voided_at IS NOT NULL
        AND voided_by_user_id IS NOT NULL
        AND length(btrim(void_reason)) > 0
      )
    )
);

CREATE UNIQUE INDEX pos_purchases_public_id_idx
  ON public.pos_purchases (public_id);

CREATE UNIQUE INDEX pos_purchases_idempotency_key_idx
  ON public.pos_purchases (idempotency_key);

CREATE INDEX pos_purchases_supplier_idx
  ON public.pos_purchases (supplier_id);

CREATE UNIQUE INDEX pos_purchases_supplier_invoice_unique_idx
  ON public.pos_purchases (
    supplier_id,
    supplier_invoice_number
  )
  WHERE supplier_invoice_number IS NOT NULL;

CREATE INDEX pos_purchases_business_date_idx
  ON public.pos_purchases (business_date);

CREATE INDEX pos_purchases_entered_by_idx
  ON public.pos_purchases (entered_by_user_id);

CREATE INDEX pos_purchases_created_at_idx
  ON public.pos_purchases (created_at);

CREATE TABLE public.pos_purchase_items (
  id serial PRIMARY KEY,

  purchase_id integer NOT NULL
    REFERENCES public.pos_purchases(id)
    ON DELETE CASCADE,

  line_number integer NOT NULL,

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
  free_quantity integer NOT NULL DEFAULT 0,

  unit_cost_minor integer NOT NULL,
  line_discount_minor integer NOT NULL DEFAULT 0,
  line_total_minor integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,

  variant_stock_before integer,
  variant_stock_after integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_purchase_items_line_positive
    CHECK (line_number > 0),

  CONSTRAINT pos_purchase_items_quantities_valid
    CHECK (
      quantity > 0
      AND quantity <= 99999
      AND free_quantity >= 0
      AND free_quantity <= 99999
      AND quantity + free_quantity <= 99999
    ),

  CONSTRAINT pos_purchase_items_prices_nonnegative
    CHECK (
      unit_cost_minor >= 0
      AND line_discount_minor >= 0
      AND line_total_minor >= 0
    ),

  CONSTRAINT pos_purchase_items_discount_not_over_gross
    CHECK (
      line_discount_minor <=
      unit_cost_minor * quantity
    ),

  CONSTRAINT pos_purchase_items_total_matches
    CHECK (
      line_total_minor =
      unit_cost_minor * quantity
      - line_discount_minor
    ),

  CONSTRAINT pos_purchase_items_general_stock_valid
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
        AND general_stock_after =
          general_stock_before
          + quantity
          + free_quantity
      )
    ),

  CONSTRAINT pos_purchase_items_variant_stock_valid
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
        AND variant_stock_after =
          variant_stock_before
          + quantity
          + free_quantity
      )
    )
);

CREATE UNIQUE INDEX pos_purchase_items_purchase_line_idx
  ON public.pos_purchase_items (
    purchase_id,
    line_number
  );

CREATE INDEX pos_purchase_items_purchase_idx
  ON public.pos_purchase_items (purchase_id);

CREATE INDEX pos_purchase_items_product_idx
  ON public.pos_purchase_items (product_id);

CREATE INDEX pos_purchase_items_barcode_idx
  ON public.pos_purchase_items (barcode);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_purchase_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE
  public.suppliers,
  public.pos_purchases,
  public.pos_purchase_items
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE
  public.suppliers_id_seq,
  public.pos_purchases_id_seq,
  public.pos_purchase_items_id_seq
TO service_role;

COMMIT;
