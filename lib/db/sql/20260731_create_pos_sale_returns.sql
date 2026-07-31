BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pos_sale_returns') IS NOT NULL
     OR to_regclass('public.pos_sale_return_items') IS NOT NULL THEN
    RAISE EXCEPTION 'POS sale return tables already exist';
  END IF;
END
$$;

CREATE TABLE public.pos_sale_returns (
  id serial PRIMARY KEY,

  public_id text NOT NULL,
  idempotency_key text NOT NULL,

  original_sale_id integer NOT NULL
    REFERENCES public.pos_sales(id)
    ON DELETE RESTRICT,

  cash_session_id integer NOT NULL
    REFERENCES public.cash_sessions(id)
    ON DELETE RESTRICT,

  register_key text NOT NULL,
  business_date date NOT NULL,

  cashier_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'completed',
  refund_method text NOT NULL DEFAULT 'cash',

  gross_amount_minor integer NOT NULL,
  discount_amount_minor integer NOT NULL,
  refund_amount_minor integer NOT NULL,

  reason text NOT NULL,
  notes text,

  voided_at timestamptz,

  voided_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  void_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_returns_register_key_valid
    CHECK (register_key ~ '^[a-z0-9_-]{1,50}$'),

  CONSTRAINT pos_sale_returns_status_valid
    CHECK (status IN ('completed', 'voided')),

  CONSTRAINT pos_sale_returns_refund_method_valid
    CHECK (refund_method IN ('cash')),

  CONSTRAINT pos_sale_returns_amounts_nonnegative
    CHECK (
      gross_amount_minor >= 0
      AND discount_amount_minor >= 0
      AND refund_amount_minor >= 0
    ),

  CONSTRAINT pos_sale_returns_discount_not_over_gross
    CHECK (discount_amount_minor <= gross_amount_minor),

  CONSTRAINT pos_sale_returns_refund_matches
    CHECK (
      refund_amount_minor =
      gross_amount_minor - discount_amount_minor
    ),

  CONSTRAINT pos_sale_returns_void_state_valid
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

CREATE UNIQUE INDEX pos_sale_returns_public_id_idx
  ON public.pos_sale_returns (public_id);

CREATE UNIQUE INDEX pos_sale_returns_idempotency_key_idx
  ON public.pos_sale_returns (idempotency_key);

CREATE INDEX pos_sale_returns_original_sale_idx
  ON public.pos_sale_returns (original_sale_id);

CREATE INDEX pos_sale_returns_cash_session_idx
  ON public.pos_sale_returns (cash_session_id);

CREATE INDEX pos_sale_returns_business_date_idx
  ON public.pos_sale_returns (business_date);

CREATE INDEX pos_sale_returns_cashier_idx
  ON public.pos_sale_returns (cashier_user_id);

CREATE INDEX pos_sale_returns_created_at_idx
  ON public.pos_sale_returns (created_at);

CREATE TABLE public.pos_sale_return_items (
  id serial PRIMARY KEY,

  return_id integer NOT NULL
    REFERENCES public.pos_sale_returns(id)
    ON DELETE CASCADE,

  original_sale_item_id integer NOT NULL
    REFERENCES public.pos_sale_items(id)
    ON DELETE RESTRICT,

  line_number integer NOT NULL,

  product_id integer
    REFERENCES public.products(id)
    ON DELETE SET NULL,

  barcode text,
  product_code text,
  product_name_ar text NOT NULL,

  color text,
  size text,

  quantity integer NOT NULL,

  sold_unit_price_minor integer NOT NULL,
  gross_amount_minor integer NOT NULL,
  allocated_discount_minor integer NOT NULL,
  refund_amount_minor integer NOT NULL,

  general_stock_before integer,
  general_stock_after integer,

  variant_stock_before integer,
  variant_stock_after integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_return_items_line_positive
    CHECK (line_number > 0),

  CONSTRAINT pos_sale_return_items_quantity_valid
    CHECK (quantity > 0 AND quantity <= 99),

  CONSTRAINT pos_sale_return_items_amounts_nonnegative
    CHECK (
      sold_unit_price_minor >= 0
      AND gross_amount_minor >= 0
      AND allocated_discount_minor >= 0
      AND refund_amount_minor >= 0
    ),

  CONSTRAINT pos_sale_return_items_discount_not_over_gross
    CHECK (allocated_discount_minor <= gross_amount_minor),

  CONSTRAINT pos_sale_return_items_refund_matches
    CHECK (
      refund_amount_minor =
      gross_amount_minor - allocated_discount_minor
    ),

  CONSTRAINT pos_sale_return_items_general_stock_valid
    CHECK (
      (general_stock_before IS NULL OR general_stock_before >= 0)
      AND
      (general_stock_after IS NULL OR general_stock_after >= 0)
    ),

  CONSTRAINT pos_sale_return_items_variant_stock_valid
    CHECK (
      (variant_stock_before IS NULL OR variant_stock_before >= 0)
      AND
      (variant_stock_after IS NULL OR variant_stock_after >= 0)
    )
);

CREATE UNIQUE INDEX pos_sale_return_items_return_line_idx
  ON public.pos_sale_return_items (return_id, line_number);

CREATE UNIQUE INDEX pos_sale_return_items_return_sale_item_idx
  ON public.pos_sale_return_items (
    return_id,
    original_sale_item_id
  );

CREATE INDEX pos_sale_return_items_return_idx
  ON public.pos_sale_return_items (return_id);

CREATE INDEX pos_sale_return_items_original_item_idx
  ON public.pos_sale_return_items (original_sale_item_id);

CREATE INDEX pos_sale_return_items_product_idx
  ON public.pos_sale_return_items (product_id);

ALTER TABLE public.pos_sale_returns
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_sale_return_items
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.pos_sale_returns,
  public.pos_sale_return_items
FROM anon, authenticated;

REVOKE ALL ON SEQUENCE
  public.pos_sale_returns_id_seq,
  public.pos_sale_return_items_id_seq
FROM anon, authenticated;

COMMIT;
