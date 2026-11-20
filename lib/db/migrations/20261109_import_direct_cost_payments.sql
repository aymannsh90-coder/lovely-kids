-- Draft import direct-cost settlements. OFF by default until all accounting tests pass.
CREATE TABLE IF NOT EXISTS public.import_cost_direct_payments (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE RESTRICT,
  shipment_id integer REFERENCES public.import_cost_shipments(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  cost_type text NOT NULL,
  payment_method text NOT NULL,
  bank_account_id integer REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  cash_session_id integer REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  settlement_finance_account_id integer NOT NULL REFERENCES public.finance_accounts(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  amount_ils_minor integer NOT NULL,
  finance_transaction_id integer REFERENCES public.finance_transactions(id) ON DELETE RESTRICT UNIQUE,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_cost_direct_payment_case_shipment_fk FOREIGN KEY (case_id, shipment_id)
    REFERENCES public.import_cost_shipments(case_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_cost_direct_payment_kind_valid CHECK (
    cost_type IN ('freight','customs','local_transport','travel')
  ),
  CONSTRAINT import_cost_direct_payment_method_valid CHECK (payment_method IN ('bank','cash')),
  CONSTRAINT import_cost_direct_payment_amount_positive CHECK (amount_ils_minor > 0),
  CONSTRAINT import_cost_direct_payment_target_valid CHECK (
    (cost_type='travel' AND shipment_id IS NULL) OR
    (cost_type <> 'travel' AND shipment_id IS NOT NULL)
  ),
  CONSTRAINT import_cost_direct_payment_settlement_valid CHECK (
    (payment_method='bank' AND bank_account_id IS NOT NULL AND cash_session_id IS NULL) OR
    (payment_method='cash' AND cash_session_id IS NOT NULL AND bank_account_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS import_cost_direct_payment_case_idx ON public.import_cost_direct_payments(case_id);
CREATE INDEX IF NOT EXISTS import_cost_direct_payment_shipment_idx ON public.import_cost_direct_payments(shipment_id);
ALTER TABLE public.import_cost_direct_payments ENABLE ROW LEVEL SECURITY;
-- No client grants/policies: owner-only Worker through an explicit feature gate.
