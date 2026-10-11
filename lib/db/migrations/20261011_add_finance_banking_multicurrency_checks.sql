BEGIN;

-- Finance banking + multi-currency foundation.
-- Base accounting currency remains ILS.
-- Foreign-currency operations preserve the entered currency amount and
-- the ILS-per-unit exchange rate used when the transaction was posted.

CREATE TABLE IF NOT EXISTS public.finance_currencies (
  code text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  symbol text NOT NULL,
  minor_unit integer NOT NULL DEFAULT 2,
  is_base boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_currencies_code_valid
    CHECK (code ~ '^[A-Z]{3}$'),

  CONSTRAINT finance_currencies_name_ar_valid
    CHECK (length(btrim(name_ar)) > 0),

  CONSTRAINT finance_currencies_name_en_valid
    CHECK (length(btrim(name_en)) > 0),

  CONSTRAINT finance_currencies_symbol_valid
    CHECK (length(btrim(symbol)) BETWEEN 1 AND 8),

  CONSTRAINT finance_currencies_minor_unit_valid
    CHECK (minor_unit BETWEEN 0 AND 4),

  CONSTRAINT finance_currencies_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_currencies_single_base_idx
  ON public.finance_currencies(is_base)
  WHERE is_base = true;

ALTER TABLE public.finance_currencies
  ENABLE ROW LEVEL SECURITY;

INSERT INTO public.finance_currencies (
  code,
  name_ar,
  name_en,
  symbol,
  minor_unit,
  is_base,
  status
)
VALUES
  ('ILS', 'شيكل', 'Israeli New Shekel', '₪', 2, true, 'active'),
  ('USD', 'دولار أمريكي', 'US Dollar', '$', 2, false, 'active'),
  ('JOD', 'دينار أردني', 'Jordanian Dinar', 'JD', 2, false, 'active')
ON CONFLICT (code) DO UPDATE
SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  symbol = EXCLUDED.symbol,
  minor_unit = EXCLUDED.minor_unit,
  status = 'active',
  updated_at = now();

DO $bank_currency_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_accounts_currency_code_fkey'
      AND conrelid = 'public.finance_accounts'::regclass
  ) THEN
    ALTER TABLE public.finance_accounts
      ADD CONSTRAINT finance_accounts_currency_code_fkey
      FOREIGN KEY (currency_code)
      REFERENCES public.finance_currencies(code)
      ON DELETE RESTRICT;
  END IF;
END
$bank_currency_fk$;

CREATE TABLE IF NOT EXISTS public.finance_exchange_rates (
  id serial PRIMARY KEY,
  currency_code text NOT NULL
    REFERENCES public.finance_currencies(code)
    ON DELETE RESTRICT,
  rate_date date NOT NULL,
  ils_per_unit_micros integer NOT NULL,
  source text,
  notes text,
  created_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_exchange_rates_rate_valid
    CHECK (ils_per_unit_micros > 0),

  CONSTRAINT finance_exchange_rates_source_valid
    CHECK (
      source IS NULL
      OR length(btrim(source)) > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_exchange_rates_currency_date_idx
  ON public.finance_exchange_rates(currency_code, rate_date);

CREATE INDEX IF NOT EXISTS finance_exchange_rates_date_idx
  ON public.finance_exchange_rates(rate_date);

ALTER TABLE public.finance_exchange_rates
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.banks (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT banks_code_valid
    CHECK (code ~ '^[A-Z0-9_-]{2,40}$'),

  CONSTRAINT banks_name_ar_valid
    CHECK (length(btrim(name_ar)) > 0),

  CONSTRAINT banks_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS banks_code_idx
  ON public.banks(code);

CREATE INDEX IF NOT EXISTS banks_name_ar_idx
  ON public.banks(name_ar);

ALTER TABLE public.banks
  ENABLE ROW LEVEL SECURITY;

INSERT INTO public.banks (
  code,
  name_ar,
  name_en,
  status
)
VALUES
  ('ARAB_BANK', 'البنك العربي', 'Arab Bank', 'active'),
  ('ARAB_ISLAMIC_BANK', 'البنك الإسلامي العربي', 'Arab Islamic Bank', 'active'),
  ('BANK_OF_PALESTINE', 'بنك فلسطين', 'Bank of Palestine', 'active')
ON CONFLICT (code) DO UPDATE
SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  status = 'active',
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id serial PRIMARY KEY,
  bank_id integer NOT NULL
    REFERENCES public.banks(id)
    ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_number text,
  iban text,
  currency_code text NOT NULL
    REFERENCES public.finance_currencies(code)
    ON DELETE RESTRICT,
  finance_account_id integer NOT NULL
    REFERENCES public.finance_accounts(id)
    ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bank_accounts_code_valid
    CHECK (code ~ '^[A-Za-z0-9_-]{2,60}$'),

  CONSTRAINT bank_accounts_name_valid
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT bank_accounts_account_number_valid
    CHECK (
      account_number IS NULL
      OR length(btrim(account_number)) > 0
    ),

  CONSTRAINT bank_accounts_iban_valid
    CHECK (
      iban IS NULL
      OR length(btrim(iban)) > 0
    ),

  CONSTRAINT bank_accounts_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_code_idx
  ON public.bank_accounts(code);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_finance_account_idx
  ON public.bank_accounts(finance_account_id);

CREATE INDEX IF NOT EXISTS bank_accounts_bank_idx
  ON public.bank_accounts(bank_id);

CREATE INDEX IF NOT EXISTS bank_accounts_currency_idx
  ON public.bank_accounts(currency_code);

CREATE INDEX IF NOT EXISTS bank_accounts_status_idx
  ON public.bank_accounts(status);

ALTER TABLE public.bank_accounts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS currency_code text;

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS currency_amount_minor integer;

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS exchange_rate_micros integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_currency_code_fkey'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_currency_code_fkey
      FOREIGN KEY (currency_code)
      REFERENCES public.finance_currencies(code)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_currency_pair_valid'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_currency_pair_valid
      CHECK (
        (
          currency_code IS NULL
          AND currency_amount_minor IS NULL
          AND exchange_rate_micros IS NULL
        )
        OR
        (
          currency_code IS NOT NULL
          AND currency_amount_minor IS NOT NULL
          AND currency_amount_minor > 0
          AND exchange_rate_micros IS NOT NULL
          AND exchange_rate_micros > 0
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS finance_transaction_lines_currency_idx
  ON public.finance_transaction_lines(currency_code)
  WHERE currency_code IS NOT NULL;

ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS currency_code text;

ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS transaction_amount_minor integer;

ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS exchange_rate_micros integer;

ALTER TABLE public.finance_vouchers
  ADD COLUMN IF NOT EXISTS bank_account_id integer;

UPDATE public.finance_vouchers
SET
  currency_code = COALESCE(currency_code, 'ILS'),
  transaction_amount_minor = COALESCE(transaction_amount_minor, amount_minor),
  exchange_rate_micros = COALESCE(exchange_rate_micros, 1000000)
WHERE
  currency_code IS NULL
  OR transaction_amount_minor IS NULL
  OR exchange_rate_micros IS NULL;

ALTER TABLE public.finance_vouchers
  ALTER COLUMN currency_code SET DEFAULT 'ILS';

ALTER TABLE public.finance_vouchers
  ALTER COLUMN currency_code SET NOT NULL;

-- transaction_amount_minor intentionally remains nullable during the
-- rolling-deployment transition so the pre-migration Worker can continue
-- creating vouchers until the new Worker is deployed.

ALTER TABLE public.finance_vouchers
  ALTER COLUMN exchange_rate_micros SET DEFAULT 1000000;

ALTER TABLE public.finance_vouchers
  ALTER COLUMN exchange_rate_micros SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_vouchers_currency_code_fkey'
      AND conrelid = 'public.finance_vouchers'::regclass
  ) THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT finance_vouchers_currency_code_fkey
      FOREIGN KEY (currency_code)
      REFERENCES public.finance_currencies(code)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_vouchers_bank_account_id_fkey'
      AND conrelid = 'public.finance_vouchers'::regclass
  ) THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT finance_vouchers_bank_account_id_fkey
      FOREIGN KEY (bank_account_id)
      REFERENCES public.bank_accounts(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_vouchers_transaction_amount_valid'
      AND conrelid = 'public.finance_vouchers'::regclass
  ) THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT finance_vouchers_transaction_amount_valid
      CHECK (
        transaction_amount_minor IS NULL
        OR transaction_amount_minor > 0
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_vouchers_exchange_rate_valid'
      AND conrelid = 'public.finance_vouchers'::regclass
  ) THEN
    ALTER TABLE public.finance_vouchers
      ADD CONSTRAINT finance_vouchers_exchange_rate_valid
      CHECK (exchange_rate_micros > 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS finance_vouchers_currency_idx
  ON public.finance_vouchers(currency_code);

CREATE INDEX IF NOT EXISTS finance_vouchers_bank_account_idx
  ON public.finance_vouchers(bank_account_id)
  WHERE bank_account_id IS NOT NULL;

INSERT INTO public.finance_accounts (
  code,
  name,
  account_type,
  linked_entity_type,
  linked_entity_id,
  currency_code,
  status,
  notes
)
VALUES
  (
    'CHECKS_RECEIVABLE_CONTROL',
    'شيكات برسم التحصيل',
    'asset',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for received checks before bank clearance.'
  ),
  (
    'CHECKS_PAYABLE_CONTROL',
    'شيكات صادرة',
    'liability',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for issued checks before bank clearance.'
  ),
  (
    'FX_GAIN',
    'أرباح فروقات العملة',
    'income',
    NULL,
    NULL,
    'ILS',
    'active',
    'Realized foreign exchange gains.'
  ),
  (
    'FX_LOSS',
    'خسائر فروقات العملة',
    'expense',
    NULL,
    NULL,
    'ILS',
    'active',
    'Realized foreign exchange losses.'
  )
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_checks (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  idempotency_key text NOT NULL,
  direction text NOT NULL,
  check_number text NOT NULL,
  bank_id integer NOT NULL
    REFERENCES public.banks(id)
    ON DELETE RESTRICT,
  bank_account_id integer
    REFERENCES public.bank_accounts(id)
    ON DELETE RESTRICT,
  deposited_to_bank_account_id integer
    REFERENCES public.bank_accounts(id)
    ON DELETE RESTRICT,
  currency_code text NOT NULL
    REFERENCES public.finance_currencies(code)
    ON DELETE RESTRICT,
  amount_minor integer NOT NULL,
  exchange_rate_micros integer NOT NULL,
  base_amount_minor integer NOT NULL,
  due_date date NOT NULL,

  customer_id integer
    REFERENCES public.customers(id)
    ON DELETE RESTRICT,
  supplier_id integer
    REFERENCES public.suppliers(id)
    ON DELETE RESTRICT,
  employee_id integer
    REFERENCES public.employees(id)
    ON DELETE RESTRICT,

  drawer_name text,
  payee_name text,

  status text NOT NULL,
  initial_finance_transaction_id integer
    REFERENCES public.finance_transactions(id)
    ON DELETE RESTRICT,
  settlement_finance_transaction_id integer
    REFERENCES public.finance_transactions(id)
    ON DELETE RESTRICT,

  notes text,
  created_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  deposited_at timestamptz,
  cleared_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  cancel_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_checks_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 100),

  CONSTRAINT finance_checks_idempotency_valid
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160),

  CONSTRAINT finance_checks_direction_valid
    CHECK (direction IN ('received', 'issued')),

  CONSTRAINT finance_checks_number_valid
    CHECK (length(btrim(check_number)) BETWEEN 1 AND 100),

  CONSTRAINT finance_checks_amount_valid
    CHECK (
      amount_minor > 0
      AND exchange_rate_micros > 0
      AND base_amount_minor > 0
    ),

  CONSTRAINT finance_checks_single_party
    CHECK (
      num_nonnulls(
        customer_id,
        supplier_id,
        employee_id
      ) <= 1
    ),

  CONSTRAINT finance_checks_status_valid
    CHECK (
      status IN (
        'on_hand',
        'deposited',
        'issued',
        'cleared',
        'returned',
        'cancelled'
      )
    ),

  CONSTRAINT finance_checks_direction_status_valid
    CHECK (
      (
        direction = 'received'
        AND status IN (
          'on_hand',
          'deposited',
          'cleared',
          'returned',
          'cancelled'
        )
      )
      OR
      (
        direction = 'issued'
        AND status IN (
          'issued',
          'cleared',
          'returned',
          'cancelled'
        )
      )
    ),

  CONSTRAINT finance_checks_cancel_state_valid
    CHECK (
      (
        status <> 'cancelled'
        AND cancelled_at IS NULL
        AND cancelled_by_user_id IS NULL
        AND cancel_reason IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND cancelled_by_user_id IS NOT NULL
        AND length(btrim(cancel_reason)) > 0
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_checks_public_id_idx
  ON public.finance_checks(public_id);

CREATE UNIQUE INDEX IF NOT EXISTS finance_checks_idempotency_idx
  ON public.finance_checks(idempotency_key);

CREATE INDEX IF NOT EXISTS finance_checks_number_idx
  ON public.finance_checks(check_number);

CREATE INDEX IF NOT EXISTS finance_checks_due_date_idx
  ON public.finance_checks(due_date);

CREATE INDEX IF NOT EXISTS finance_checks_status_idx
  ON public.finance_checks(status);

CREATE INDEX IF NOT EXISTS finance_checks_bank_idx
  ON public.finance_checks(bank_id);

CREATE INDEX IF NOT EXISTS finance_checks_customer_idx
  ON public.finance_checks(customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_checks_supplier_idx
  ON public.finance_checks(supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_checks_employee_idx
  ON public.finance_checks(employee_id)
  WHERE employee_id IS NOT NULL;

ALTER TABLE public.finance_checks
  ENABLE ROW LEVEL SECURITY;

COMMIT;
