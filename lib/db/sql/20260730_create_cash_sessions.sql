BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id serial PRIMARY KEY,

  register_key text NOT NULL DEFAULT 'main',
  business_date date NOT NULL,

  opened_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  closed_by_user_id integer
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  opening_balance_minor integer NOT NULL,
  closing_balance_minor integer,
  expected_balance_minor integer,

  currency_code text NOT NULL DEFAULT 'ILS',
  status text NOT NULL DEFAULT 'open',

  opening_note text,
  closing_note text,

  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_sessions_opening_balance_nonnegative
    CHECK (opening_balance_minor >= 0),

  CONSTRAINT cash_sessions_closing_balance_nonnegative
    CHECK (
      closing_balance_minor IS NULL
      OR closing_balance_minor >= 0
    ),

  CONSTRAINT cash_sessions_valid_status
    CHECK (status IN ('open', 'closed')),

  CONSTRAINT cash_sessions_currency_code_length
    CHECK (char_length(currency_code) = 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS
  cash_sessions_one_open_per_register
ON public.cash_sessions (register_key)
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS
  cash_sessions_business_date_idx
ON public.cash_sessions (business_date);

CREATE INDEX IF NOT EXISTS
  cash_sessions_opened_by_user_idx
ON public.cash_sessions (opened_by_user_id);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cash_sessions
FROM anon, authenticated;

REVOKE ALL ON SEQUENCE public.cash_sessions_id_seq
FROM anon, authenticated;

COMMIT;
