-- Proposed import accounting closure. Kept on PR branch; NEVER applied to production.
ALTER TABLE public.import_cost_cases
  DROP CONSTRAINT import_cost_cases_status_draft_only;
ALTER TABLE public.import_cost_cases
  ADD CONSTRAINT import_cost_cases_status_valid CHECK (status in ('draft','closed'));

CREATE TABLE public.import_cost_closures (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'posted',
  business_date date NOT NULL,
  debit_ils_minor integer NOT NULL,
  finance_transaction_id integer UNIQUE REFERENCES public.finance_transactions(id) ON DELETE RESTRICT,
  reversal_finance_transaction_id integer UNIQUE REFERENCES public.finance_transactions(id) ON DELETE RESTRICT,
  reversal_key text UNIQUE,
  reversal_reason text,
  travel_classification_approved boolean NOT NULL DEFAULT false,
  closed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reversed_by_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  CONSTRAINT import_cost_closure_status_valid CHECK (status in ('posted','reversed')),
  CONSTRAINT import_cost_closure_amount_valid CHECK (debit_ils_minor >= 0),
  CONSTRAINT import_cost_closure_reversal_valid CHECK (
    (status='posted' AND reversal_finance_transaction_id IS NULL
      AND reversal_key IS NULL AND reversed_at IS NULL)
    OR
    (status='reversed' AND reversal_key IS NOT NULL
      AND reversal_reason IS NOT NULL AND reversed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX import_cost_closure_active_case_unique
  ON public.import_cost_closures(case_id) WHERE status='posted';
CREATE INDEX import_cost_closure_case_idx ON public.import_cost_closures(case_id);
ALTER TABLE public.import_cost_closures ENABLE ROW LEVEL SECURITY;
-- No Data API or client policies: only the owner-authorized Worker under separate flag.
