BEGIN;

-- Lovely Kids finance foundation

CREATE TABLE IF NOT EXISTS delivery_companies (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  notes text,
  status text NOT NULL DEFAULT 'active',

  created_by_user_id integer NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_companies_code_valid
    CHECK (length(btrim(code)) BETWEEN 1 AND 40),

  CONSTRAINT delivery_companies_name_not_empty
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT delivery_companies_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_companies_code_idx
  ON delivery_companies(code);

CREATE INDEX IF NOT EXISTS delivery_companies_name_idx
  ON delivery_companies(name);

ALTER TABLE delivery_companies ENABLE ROW LEVEL SECURITY;


ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_method text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_company_id integer;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_company_cost integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_fulfillment_method_valid'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_method_valid
      CHECK (
        fulfillment_method IS NULL
        OR fulfillment_method IN ('delivery', 'pickup')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_company_cost_valid'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_company_cost_valid
      CHECK (
        delivery_company_cost IS NULL
        OR delivery_company_cost >= 0
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_details_valid'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_details_valid
      CHECK (
        fulfillment_method IS NULL
        OR (
          fulfillment_method = 'pickup'
          AND delivery_company_id IS NULL
          AND (
            delivery_company_cost IS NULL
            OR delivery_company_cost = 0
          )
        )
        OR (
          fulfillment_method = 'delivery'
          AND delivery_company_id IS NOT NULL
          AND delivery_company_cost IS NOT NULL
          AND delivery_company_cost >= 0
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_company_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_company_id_fkey
      FOREIGN KEY (delivery_company_id)
      REFERENCES delivery_companies(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS orders_delivery_company_idx
  ON orders(delivery_company_id);

CREATE INDEX IF NOT EXISTS orders_fulfillment_method_idx
  ON orders(fulfillment_method);


CREATE TABLE IF NOT EXISTS finance_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL,

  linked_entity_type text,
  linked_entity_id integer,

  currency_code text NOT NULL DEFAULT 'ILS',
  status text NOT NULL DEFAULT 'active',
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_accounts_code_valid
    CHECK (length(btrim(code)) BETWEEN 1 AND 80),

  CONSTRAINT finance_accounts_name_not_empty
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT finance_accounts_type_valid
    CHECK (
      account_type IN (
        'asset',
        'liability',
        'income',
        'expense',
        'equity'
      )
    ),

  CONSTRAINT finance_accounts_currency_valid
    CHECK (char_length(currency_code) = 3),

  CONSTRAINT finance_accounts_status_valid
    CHECK (status IN ('active', 'inactive')),

  CONSTRAINT finance_accounts_linked_entity_pair
    CHECK (
      (
        linked_entity_type IS NULL
        AND linked_entity_id IS NULL
      )
      OR
      (
        linked_entity_type IS NOT NULL
        AND linked_entity_id IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_code_idx
  ON finance_accounts(code);

CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_linked_entity_idx
  ON finance_accounts(linked_entity_type, linked_entity_id)
  WHERE linked_entity_type IS NOT NULL
    AND linked_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_accounts_type_idx
  ON finance_accounts(account_type);

ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS finance_transactions (
  id serial PRIMARY KEY,

  public_id text NOT NULL,
  idempotency_key text NOT NULL,
  business_date date NOT NULL,

  transaction_type text NOT NULL,

  source_type text NOT NULL,
  source_id text NOT NULL,
  source_event text NOT NULL,

  cash_session_id integer
    REFERENCES cash_sessions(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'posted',
  notes text,

  created_by_user_id integer
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_transactions_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 100),

  CONSTRAINT finance_transactions_idempotency_valid
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160),

  CONSTRAINT finance_transactions_type_valid
    CHECK (
      transaction_type IN (
        'sale',
        'purchase',
        'receipt',
        'payment',
        'expense',
        'refund',
        'reversal',
        'adjustment',
        'transfer'
      )
    ),

  CONSTRAINT finance_transactions_source_valid
    CHECK (
      length(btrim(source_type)) > 0
      AND length(btrim(source_id)) > 0
      AND length(btrim(source_event)) > 0
    ),

  CONSTRAINT finance_transactions_status_valid
    CHECK (status IN ('posted', 'reversed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_public_id_idx
  ON finance_transactions(public_id);

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_idempotency_idx
  ON finance_transactions(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_active_source_event_idx
  ON finance_transactions(source_type, source_id, source_event)
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS finance_transactions_business_date_idx
  ON finance_transactions(business_date);

CREATE INDEX IF NOT EXISTS finance_transactions_cash_session_idx
  ON finance_transactions(cash_session_id);

CREATE INDEX IF NOT EXISTS finance_transactions_source_idx
  ON finance_transactions(source_type, source_id);

ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS finance_transaction_lines (
  id serial PRIMARY KEY,

  transaction_id integer NOT NULL
    REFERENCES finance_transactions(id)
    ON DELETE CASCADE,

  line_number integer NOT NULL,

  account_id integer NOT NULL
    REFERENCES finance_accounts(id)
    ON DELETE RESTRICT,

  debit_minor integer NOT NULL DEFAULT 0,
  credit_minor integer NOT NULL DEFAULT 0,

  memo text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_transaction_lines_line_positive
    CHECK (line_number > 0),

  CONSTRAINT finance_transaction_lines_amount_valid
    CHECK (
      (
        debit_minor > 0
        AND credit_minor = 0
      )
      OR
      (
        credit_minor > 0
        AND debit_minor = 0
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_transaction_lines_number_idx
  ON finance_transaction_lines(transaction_id, line_number);

CREATE INDEX IF NOT EXISTS finance_transaction_lines_transaction_idx
  ON finance_transaction_lines(transaction_id);

CREATE INDEX IF NOT EXISTS finance_transaction_lines_account_idx
  ON finance_transaction_lines(account_id);

ALTER TABLE finance_transaction_lines ENABLE ROW LEVEL SECURITY;

COMMIT;
