BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pos_sales') IS NOT NULL
     OR to_regclass('public.pos_sale_items') IS NOT NULL THEN
    RAISE EXCEPTION 'POS sales tables already exist';
  END IF;
END
$$;

CREATE TABLE public.pos_sales (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  idempotency_key text NOT NULL,

  cash_session_id integer NOT NULL
    REFERENCES public.cash_sessions(id)
    ON DELETE RESTRICT,

  register_key text NOT NULL,
  business_date date NOT NULL,

  cashier_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'completed',
  payment_method text NOT NULL DEFAULT 'cash',

  subtotal_minor integer NOT NULL,
  discount_minor integer NOT NULL DEFAULT 0,
  total_minor integer NOT NULL,
  paid_minor integer NOT NULL,
  change_minor integer NOT NULL DEFAULT 0,

  customer_name text,
  customer_phone text,
  notes text,

  voided_at timestamptz,
  voided_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  void_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sales_register_key_valid
    CHECK (register_key ~ '^[a-z0-9_-]{1,50}$'),

  CONSTRAINT pos_sales_status_valid
    CHECK (status IN ('completed', 'voided')),

  CONSTRAINT pos_sales_payment_method_valid
    CHECK (payment_method IN ('cash', 'card', 'mixed')),

  CONSTRAINT pos_sales_amounts_nonnegative
    CHECK (
      subtotal_minor >= 0
      AND discount_minor >= 0
      AND total_minor >= 0
      AND paid_minor >= 0
      AND change_minor >= 0
    ),

  CONSTRAINT pos_sales_discount_not_over_subtotal
    CHECK (discount_minor <= subtotal_minor),

  CONSTRAINT pos_sales_total_matches
    CHECK (total_minor = subtotal_minor - discount_minor),

  CONSTRAINT pos_sales_payment_matches
    CHECK (
      paid_minor >= total_minor
      AND change_minor = paid_minor - total_minor
    ),

  CONSTRAINT pos_sales_void_state_valid
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

CREATE UNIQUE INDEX pos_sales_public_id_idx
  ON public.pos_sales (public_id);

CREATE UNIQUE INDEX pos_sales_idempotency_key_idx
  ON public.pos_sales (idempotency_key);

CREATE INDEX pos_sales_cash_session_idx
  ON public.pos_sales (cash_session_id);

CREATE INDEX pos_sales_business_date_idx
  ON public.pos_sales (business_date);

CREATE INDEX pos_sales_cashier_idx
  ON public.pos_sales (cashier_user_id);

CREATE INDEX pos_sales_created_at_idx
  ON public.pos_sales (created_at);

CREATE TABLE public.pos_sale_items (
  id serial PRIMARY KEY,

  sale_id integer NOT NULL
    REFERENCES public.pos_sales(id)
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

  website_unit_price_minor integer NOT NULL,
  sold_unit_price_minor integer NOT NULL,
  line_total_minor integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,
  variant_stock_before integer,
  variant_stock_after integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_items_line_positive
    CHECK (line_number > 0),

  CONSTRAINT pos_sale_items_quantity_valid
    CHECK (quantity > 0 AND quantity <= 99),

  CONSTRAINT pos_sale_items_prices_nonnegative
    CHECK (
      website_unit_price_minor >= 0
      AND sold_unit_price_minor >= 0
      AND line_total_minor >= 0
    ),

  CONSTRAINT pos_sale_items_total_matches
    CHECK (
      line_total_minor =
      sold_unit_price_minor * quantity
    ),

  CONSTRAINT pos_sale_items_general_stock_valid
    CHECK (
      (general_stock_before IS NULL OR general_stock_before >= 0)
      AND
      (general_stock_after IS NULL OR general_stock_after >= 0)
    ),

  CONSTRAINT pos_sale_items_variant_stock_valid
    CHECK (
      (variant_stock_before IS NULL OR variant_stock_before >= 0)
      AND
      (variant_stock_after IS NULL OR variant_stock_after >= 0)
    )
);

CREATE UNIQUE INDEX pos_sale_items_sale_line_idx
  ON public.pos_sale_items (sale_id, line_number);

CREATE INDEX pos_sale_items_sale_idx
  ON public.pos_sale_items (sale_id);

CREATE INDEX pos_sale_items_product_idx
  ON public.pos_sale_items (product_id);

CREATE INDEX pos_sale_items_barcode_idx
  ON public.pos_sale_items (barcode);

ALTER TABLE public.pos_sales
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_sale_items
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.pos_sales,
  public.pos_sale_items
FROM anon, authenticated;

REVOKE ALL ON SEQUENCE
  public.pos_sales_id_seq,
  public.pos_sale_items_id_seq
FROM anon, authenticated;

COMMIT;
