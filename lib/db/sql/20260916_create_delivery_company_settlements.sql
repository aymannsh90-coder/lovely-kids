BEGIN;

CREATE TABLE IF NOT EXISTS delivery_company_settlements (
  id serial PRIMARY KEY,

  public_id text NOT NULL,

  delivery_company_id integer NOT NULL
    REFERENCES delivery_companies(id)
    ON DELETE RESTRICT,

  business_date date NOT NULL,

  receipt_method text NOT NULL,

  total_minor integer NOT NULL,

  cash_session_id integer
    REFERENCES cash_sessions(id)
    ON DELETE RESTRICT,

  finance_transaction_id integer
    REFERENCES finance_transactions(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'posted',

  notes text,

  created_by_user_id integer NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_company_settlements_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 100),

  CONSTRAINT delivery_company_settlements_total_positive
    CHECK (total_minor > 0),

  CONSTRAINT delivery_company_settlements_receipt_method_valid
    CHECK (receipt_method IN ('cash', 'bank')),

  CONSTRAINT delivery_company_settlements_status_valid
    CHECK (status IN ('posted', 'reversed')),

  CONSTRAINT delivery_company_settlements_cash_session_valid
    CHECK (
      (
        receipt_method = 'cash'
        AND cash_session_id IS NOT NULL
      )
      OR
      (
        receipt_method = 'bank'
        AND cash_session_id IS NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_settlements_public_id_idx
  ON delivery_company_settlements(public_id);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_settlements_finance_tx_idx
  ON delivery_company_settlements(finance_transaction_id)
  WHERE finance_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_company_settlements_company_idx
  ON delivery_company_settlements(delivery_company_id);

CREATE INDEX IF NOT EXISTS delivery_company_settlements_business_date_idx
  ON delivery_company_settlements(business_date);

CREATE INDEX IF NOT EXISTS delivery_company_settlements_status_idx
  ON delivery_company_settlements(status);

ALTER TABLE delivery_company_settlements ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS delivery_company_settlement_items (
  id serial PRIMARY KEY,

  settlement_id integer NOT NULL
    REFERENCES delivery_company_settlements(id)
    ON DELETE CASCADE,

  order_id integer NOT NULL
    REFERENCES orders(id)
    ON DELETE RESTRICT,

  amount_minor integer NOT NULL,

  status text NOT NULL DEFAULT 'posted',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_company_settlement_items_amount_positive
    CHECK (amount_minor > 0),

  CONSTRAINT delivery_company_settlement_items_status_valid
    CHECK (status IN ('posted', 'reversed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_settlement_items_pair_idx
  ON delivery_company_settlement_items(settlement_id, order_id);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_settlement_items_active_order_idx
  ON delivery_company_settlement_items(order_id)
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS delivery_company_settlement_items_settlement_idx
  ON delivery_company_settlement_items(settlement_id);

CREATE INDEX IF NOT EXISTS delivery_company_settlement_items_order_idx
  ON delivery_company_settlement_items(order_id);

ALTER TABLE delivery_company_settlement_items ENABLE ROW LEVEL SECURITY;

COMMIT;
