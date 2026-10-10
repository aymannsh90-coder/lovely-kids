BEGIN;

CREATE TABLE public.customers (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  address text,
  notes text,
  credit_limit_minor integer,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id integer NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customers_code_valid
    CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),

  CONSTRAINT customers_name_not_empty
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT customers_credit_limit_valid
    CHECK (
      credit_limit_minor IS NULL
      OR credit_limit_minor >= 0
    ),

  CONSTRAINT customers_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX customers_code_idx
  ON public.customers(code);

CREATE INDEX customers_name_idx
  ON public.customers(name);

CREATE INDEX customers_phone_idx
  ON public.customers(phone);

CREATE INDEX customers_status_idx
  ON public.customers(status);

ALTER TABLE public.customers
  ENABLE ROW LEVEL SECURITY;


CREATE TABLE public.employees (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  user_id integer
    REFERENCES public.users(id) ON DELETE SET NULL,
  base_salary_minor integer NOT NULL DEFAULT 0,
  hire_date date,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id integer NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employees_code_valid
    CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),

  CONSTRAINT employees_name_not_empty
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT employees_salary_valid
    CHECK (base_salary_minor >= 0),

  CONSTRAINT employees_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX employees_code_idx
  ON public.employees(code);

CREATE UNIQUE INDEX employees_user_idx
  ON public.employees(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX employees_name_idx
  ON public.employees(name);

CREATE INDEX employees_status_idx
  ON public.employees(status);

ALTER TABLE public.employees
  ENABLE ROW LEVEL SECURITY;


INSERT INTO public.finance_accounts (
  code,
  name,
  account_type,
  linked_entity_type,
  linked_entity_id,
  currency_code,
  status
)
VALUES
  ('EXPENSE_RENT', 'مصروف الإيجار', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_UTILITIES', 'مصروف الكهرباء والمياه والاتصالات', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_SALARY', 'مصروف الرواتب', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_ADS', 'مصروف الإعلانات والتسويق', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_TRANSPORT', 'مصروف النقل والمواصلات', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_MAINTENANCE', 'مصروف الصيانة', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_SUPPLIES', 'مصروف المستلزمات', 'expense', NULL, NULL, 'ILS', 'active'),
  ('EXPENSE_OTHER', 'مصاريف أخرى', 'expense', NULL, NULL, 'ILS', 'active'),
  ('OWNER_DRAWINGS', 'مسحوبات المالك الشخصية', 'equity', NULL, NULL, 'ILS', 'active')
ON CONFLICT (code) DO NOTHING;


CREATE TABLE public.expense_categories (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  finance_account_id integer NOT NULL
    REFERENCES public.finance_accounts(id)
    ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id integer
    REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT expense_categories_code_valid
    CHECK (code ~ '^[A-Za-z0-9_-]{1,50}$'),

  CONSTRAINT expense_categories_name_valid
    CHECK (length(btrim(name)) > 0),

  CONSTRAINT expense_categories_status_valid
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX expense_categories_code_idx
  ON public.expense_categories(code);

CREATE UNIQUE INDEX expense_categories_finance_account_idx
  ON public.expense_categories(finance_account_id);

CREATE INDEX expense_categories_status_idx
  ON public.expense_categories(status);

ALTER TABLE public.expense_categories
  ENABLE ROW LEVEL SECURITY;


INSERT INTO public.expense_categories (
  code,
  name,
  finance_account_id,
  status
)
SELECT
  seed.code,
  seed.name,
  account.id,
  'active'
FROM (
  VALUES
    ('rent', 'إيجار', 'EXPENSE_RENT'),
    ('utilities', 'كهرباء ومياه واتصالات', 'EXPENSE_UTILITIES'),
    ('salary', 'رواتب', 'EXPENSE_SALARY'),
    ('ads', 'إعلانات وتسويق', 'EXPENSE_ADS'),
    ('transport', 'نقل ومواصلات', 'EXPENSE_TRANSPORT'),
    ('maintenance', 'صيانة', 'EXPENSE_MAINTENANCE'),
    ('supplies', 'مستلزمات', 'EXPENSE_SUPPLIES'),
    ('other', 'أخرى', 'EXPENSE_OTHER')
) AS seed(code, name, account_code)
JOIN public.finance_accounts account
  ON account.code = seed.account_code
ON CONFLICT (code) DO NOTHING;


CREATE TABLE public.finance_vouchers (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  idempotency_key text NOT NULL,
  voucher_type text NOT NULL,

  party_type text,
  party_id integer,

  expense_category_id integer
    REFERENCES public.expense_categories(id)
    ON DELETE RESTRICT,

  payment_method text NOT NULL,
  amount_minor integer NOT NULL,
  business_date date NOT NULL,
  reference_period text,

  cash_session_id integer
    REFERENCES public.cash_sessions(id)
    ON DELETE RESTRICT,

  finance_transaction_id integer
    REFERENCES public.finance_transactions(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'posted',
  notes text,

  created_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  voided_at timestamptz,
  voided_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  void_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_vouchers_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 100),

  CONSTRAINT finance_vouchers_idempotency_valid
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160),

  CONSTRAINT finance_vouchers_type_valid
    CHECK (
      voucher_type IN (
        'customer_receipt',
        'expense',
        'employee_advance',
        'employee_repayment',
        'salary_accrual',
        'employee_payment',
        'owner_withdrawal',
        'adjustment'
      )
    ),

  CONSTRAINT finance_vouchers_party_pair_valid
    CHECK (
      (
        party_type IS NULL
        AND party_id IS NULL
      )
      OR
      (
        party_type IN ('customer', 'employee', 'owner')
        AND party_id IS NOT NULL
      )
    ),

  CONSTRAINT finance_vouchers_party_type_matches
    CHECK (
      (
        voucher_type = 'customer_receipt'
        AND party_type = 'customer'
        AND party_id IS NOT NULL
      )
      OR
      (
        voucher_type IN (
          'employee_advance',
          'employee_repayment',
          'salary_accrual',
          'employee_payment'
        )
        AND party_type = 'employee'
        AND party_id IS NOT NULL
      )
      OR
      (
        voucher_type = 'owner_withdrawal'
        AND party_type = 'owner'
        AND party_id IS NOT NULL
      )
      OR
      (
        voucher_type IN ('expense', 'adjustment')
      )
    ),

  CONSTRAINT finance_vouchers_expense_category_valid
    CHECK (
      (
        voucher_type = 'expense'
        AND expense_category_id IS NOT NULL
      )
      OR
      (
        voucher_type <> 'expense'
        AND expense_category_id IS NULL
      )
    ),

  CONSTRAINT finance_vouchers_payment_method_valid
    CHECK (
      payment_method IN (
        'cash',
        'card',
        'bank',
        'non_cash'
      )
    ),

  CONSTRAINT finance_vouchers_amount_valid
    CHECK (amount_minor > 0),

  CONSTRAINT finance_vouchers_cash_session_valid
    CHECK (
      (
        payment_method = 'cash'
        AND cash_session_id IS NOT NULL
      )
      OR
      (
        payment_method <> 'cash'
        AND cash_session_id IS NULL
      )
    ),

  CONSTRAINT finance_vouchers_status_valid
    CHECK (status IN ('posted', 'voided')),

  CONSTRAINT finance_vouchers_void_state_valid
    CHECK (
      (
        status = 'posted'
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

CREATE UNIQUE INDEX finance_vouchers_public_id_idx
  ON public.finance_vouchers(public_id);

CREATE UNIQUE INDEX finance_vouchers_idempotency_idx
  ON public.finance_vouchers(idempotency_key);

CREATE UNIQUE INDEX finance_vouchers_finance_tx_idx
  ON public.finance_vouchers(finance_transaction_id)
  WHERE finance_transaction_id IS NOT NULL;

CREATE INDEX finance_vouchers_business_date_idx
  ON public.finance_vouchers(business_date);

CREATE INDEX finance_vouchers_party_idx
  ON public.finance_vouchers(party_type, party_id);

CREATE INDEX finance_vouchers_type_idx
  ON public.finance_vouchers(voucher_type);

CREATE INDEX finance_vouchers_cash_session_idx
  ON public.finance_vouchers(cash_session_id);

ALTER TABLE public.finance_vouchers
  ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.pos_sales
  ADD COLUMN customer_id integer
    REFERENCES public.customers(id)
    ON DELETE RESTRICT;

ALTER TABLE public.pos_sales
  ADD COLUMN account_due_minor integer
    NOT NULL
    DEFAULT 0;

CREATE INDEX pos_sales_customer_idx
  ON public.pos_sales(customer_id);


ALTER TABLE public.pos_sales
  DROP CONSTRAINT pos_sales_payment_method_valid;

ALTER TABLE public.pos_sales
  ADD CONSTRAINT pos_sales_payment_method_valid
  CHECK (
    payment_method IN (
      'cash',
      'card',
      'mixed',
      'credit'
    )
  );


ALTER TABLE public.pos_sales
  DROP CONSTRAINT pos_sales_amounts_nonnegative;

ALTER TABLE public.pos_sales
  ADD CONSTRAINT pos_sales_amounts_nonnegative
  CHECK (
    subtotal_minor >= 0
    AND discount_minor >= 0
    AND item_discount_minor >= 0
    AND invoice_discount_minor >= 0
    AND total_minor >= 0
    AND paid_minor >= 0
    AND change_minor >= 0
    AND account_due_minor >= 0
  );


ALTER TABLE public.pos_sales
  DROP CONSTRAINT pos_sales_payment_matches;

ALTER TABLE public.pos_sales
  ADD CONSTRAINT pos_sales_payment_matches
  CHECK (
    (
      payment_method = 'cash'
      AND account_due_minor = 0
      AND paid_minor >= total_minor
      AND change_minor = paid_minor - total_minor
    )
    OR
    (
      payment_method = 'card'
      AND account_due_minor = 0
      AND paid_minor = total_minor
      AND change_minor = 0
    )
    OR
    (
      payment_method = 'mixed'
      AND account_due_minor = 0
    )
    OR
    (
      payment_method = 'credit'
      AND customer_id IS NOT NULL
      AND account_due_minor = total_minor
      AND paid_minor = 0
      AND change_minor = 0
    )
  );


-- PARTY_FINANCE_SECURITY_GRANTS
-- Keep the same security model used by the existing POS/finance tables:
-- RLS enabled, no client policies, service_role only.

REVOKE ALL ON TABLE
  public.customers,
  public.employees,
  public.expense_categories,
  public.finance_vouchers
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.customers,
  public.employees,
  public.expense_categories,
  public.finance_vouchers
TO service_role;

REVOKE ALL ON SEQUENCE
  public.customers_id_seq,
  public.employees_id_seq,
  public.expense_categories_id_seq,
  public.finance_vouchers_id_seq
FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.customers_id_seq,
  public.employees_id_seq,
  public.expense_categories_id_seq,
  public.finance_vouchers_id_seq
TO service_role;

COMMIT;
