-- Supplier USD advances posted atomically through postFinanceTransaction.
-- Controlled by POS_IMPORT_FINANCIAL_POSTING_ENABLED (defaults OFF).
-- This migration is a repository artifact. DO NOT run against production yet.
CREATE TABLE IF NOT EXISTS public.import_cost_advance_payments (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE RESTRICT,
  invoice_id integer NOT NULL REFERENCES public.import_cost_invoices(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  bank_account_id integer NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  usd_amount_minor integer NOT NULL,
  spot_rate_micros integer NOT NULL,
  bank_book_ils_minor integer NOT NULL,
  advance_ils_minor integer NOT NULL,
  fx_gain_ils_minor integer NOT NULL DEFAULT 0,
  fx_loss_ils_minor integer NOT NULL DEFAULT 0,
  finance_transaction_id integer REFERENCES public.finance_transactions(id) ON DELETE RESTRICT,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_cost_advance_payment_key_idx UNIQUE (idempotency_key),
  CONSTRAINT import_cost_advance_payment_finance_transaction_idx UNIQUE (finance_transaction_id),
  CONSTRAINT import_cost_advance_payment_case_invoice_fk FOREIGN KEY (case_id, invoice_id)
    REFERENCES public.import_cost_invoices(case_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_cost_advance_payment_positive CHECK (
    LEAST(usd_amount_minor, spot_rate_micros, bank_book_ils_minor, advance_ils_minor) > 0
  ),
  CONSTRAINT import_cost_advance_payment_fx_nonnegative CHECK (
    LEAST(fx_gain_ils_minor, fx_loss_ils_minor) >= 0
  ),
  CONSTRAINT import_cost_advance_payment_one_fx_side CHECK (
    fx_gain_ils_minor = 0 OR fx_loss_ils_minor = 0
  ),
  CONSTRAINT import_cost_advance_payment_balanced CHECK (
    advance_ils_minor + fx_loss_ils_minor = bank_book_ils_minor + fx_gain_ils_minor
  )
);
CREATE INDEX IF NOT EXISTS import_cost_advance_payment_invoice_idx
  ON public.import_cost_advance_payments(invoice_id);
ALTER TABLE public.import_cost_advance_payments ENABLE ROW LEVEL SECURITY;
-- No policies: API Worker only, not browser direct access.
