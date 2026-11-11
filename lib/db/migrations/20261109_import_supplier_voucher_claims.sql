-- Evidence-only supplier voucher split attribution to import invoice.
-- Not deployed. Production untouched until separate approval and CI completion.
CREATE TABLE public.import_cost_supplier_voucher_claims (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE RESTRICT,
  invoice_id integer NOT NULL REFERENCES public.import_cost_invoices(id) ON DELETE RESTRICT,
  voucher_id integer NOT NULL REFERENCES public.finance_vouchers(id) ON DELETE RESTRICT,
  amount_ils_minor integer NOT NULL,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_cost_supplier_voucher_claim_unique UNIQUE(invoice_id,voucher_id),
  CONSTRAINT import_cost_supplier_voucher_claim_case_invoice_fk
    FOREIGN KEY (case_id,invoice_id)
    REFERENCES public.import_cost_invoices(case_id,id) ON DELETE RESTRICT,
  CONSTRAINT import_cost_supplier_voucher_claim_amount_positive
    CHECK (amount_ils_minor > 0)
);
CREATE INDEX import_cost_supplier_voucher_claim_voucher_idx
  ON public.import_cost_supplier_voucher_claims(voucher_id);
CREATE INDEX import_cost_supplier_voucher_claim_case_idx
  ON public.import_cost_supplier_voucher_claims(case_id);
ALTER TABLE public.import_cost_supplier_voucher_claims ENABLE ROW LEVEL SECURITY;
-- Owner Worker only; no anon or authenticated policies.
