BEGIN;

CREATE TABLE public.assistant_drafts (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  original_text text NOT NULL,
  source text NOT NULL DEFAULT 'text',
  intent text,
  amount_minor integer,
  employee_id integer
    REFERENCES public.employees(id)
    ON DELETE RESTRICT,
  expense_category_id integer
    REFERENCES public.expense_categories(id)
    ON DELETE RESTRICT,
  payment_method text NOT NULL DEFAULT 'cash',
  register_key text NOT NULL DEFAULT 'main',
  confidence integer,
  parse_message text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  finance_voucher_id integer
    REFERENCES public.finance_vouchers(id)
    ON DELETE RESTRICT,
  created_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  reviewed_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assistant_drafts_public_id_valid
    CHECK (length(btrim(public_id)) BETWEEN 6 AND 100),

  CONSTRAINT assistant_drafts_original_text_valid
    CHECK (length(btrim(original_text)) BETWEEN 1 AND 2000),

  CONSTRAINT assistant_drafts_source_valid
    CHECK (source IN ('text', 'voice')),

  CONSTRAINT assistant_drafts_intent_valid
    CHECK (
      intent IS NULL
      OR intent IN (
        'expense',
        'employee_advance',
        'owner_withdrawal'
      )
    ),

  CONSTRAINT assistant_drafts_amount_valid
    CHECK (
      amount_minor IS NULL
      OR amount_minor > 0
    ),

  CONSTRAINT assistant_drafts_payment_method_valid
    CHECK (payment_method = 'cash'),

  CONSTRAINT assistant_drafts_register_key_valid
    CHECK (register_key ~ '^[a-z0-9_-]{1,50}$'),

  CONSTRAINT assistant_drafts_confidence_valid
    CHECK (
      confidence IS NULL
      OR confidence BETWEEN 0 AND 100
    ),

  CONSTRAINT assistant_drafts_employee_scope_valid
    CHECK (
      employee_id IS NULL
      OR intent = 'employee_advance'
    ),

  CONSTRAINT assistant_drafts_expense_scope_valid
    CHECK (
      expense_category_id IS NULL
      OR intent = 'expense'
    ),

  CONSTRAINT assistant_drafts_status_valid
    CHECK (
      status IN ('pending', 'approved', 'rejected')
    ),

  CONSTRAINT assistant_drafts_review_state_valid
    CHECK (
      (
        status = 'pending'
        AND finance_voucher_id IS NULL
        AND reviewed_by_user_id IS NULL
        AND reviewed_at IS NULL
      )
      OR
      (
        status = 'approved'
        AND finance_voucher_id IS NOT NULL
        AND reviewed_by_user_id IS NOT NULL
        AND reviewed_at IS NOT NULL
        AND intent IS NOT NULL
        AND amount_minor IS NOT NULL
        AND (
          (
            intent = 'employee_advance'
            AND employee_id IS NOT NULL
            AND expense_category_id IS NULL
          )
          OR
          (
            intent = 'expense'
            AND expense_category_id IS NOT NULL
            AND employee_id IS NULL
          )
          OR
          (
            intent = 'owner_withdrawal'
            AND employee_id IS NULL
            AND expense_category_id IS NULL
          )
        )
      )
      OR
      (
        status = 'rejected'
        AND finance_voucher_id IS NULL
        AND reviewed_by_user_id IS NOT NULL
        AND reviewed_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX assistant_drafts_public_id_idx
  ON public.assistant_drafts(public_id);

CREATE UNIQUE INDEX assistant_drafts_finance_voucher_idx
  ON public.assistant_drafts(finance_voucher_id)
  WHERE finance_voucher_id IS NOT NULL;

CREATE INDEX assistant_drafts_status_idx
  ON public.assistant_drafts(status);

CREATE INDEX assistant_drafts_created_by_idx
  ON public.assistant_drafts(created_by_user_id);

CREATE INDEX assistant_drafts_created_at_idx
  ON public.assistant_drafts(created_at);

ALTER TABLE public.assistant_drafts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.assistant_drafts
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.assistant_drafts
TO service_role;

REVOKE ALL ON SEQUENCE
  public.assistant_drafts_id_seq
FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.assistant_drafts_id_seq
TO service_role;

COMMIT;
