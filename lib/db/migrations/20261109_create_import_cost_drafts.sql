-- Draft-only import documents: no cash, supplier payable or stock journal side-effects.
-- Prepared for review; DO NOT apply to production before API integration validation.
CREATE TABLE IF NOT EXISTS public.import_cost_cases (
  id serial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  business_date date NOT NULL,
  title text NOT NULL,
  with_travel boolean NOT NULL DEFAULT false,
  travel_recorded_ils_minor integer NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_cost_cases_status_draft_only CHECK (status = 'draft'),
  CONSTRAINT import_cost_cases_revision_positive CHECK (revision > 0),
  CONSTRAINT import_cost_cases_travel_nonnegative
    CHECK (travel_recorded_ils_minor >= 0 AND (with_travel OR travel_recorded_ils_minor = 0))
);
CREATE INDEX IF NOT EXISTS import_cost_cases_date_idx ON public.import_cost_cases(business_date);

CREATE TABLE IF NOT EXISTS public.import_cost_invoices (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE CASCADE,
  line_ref text NOT NULL,
  supplier_id integer NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  goods_usd_minor integer NOT NULL,
  goods_booked_ils_minor integer NOT NULL,
  CONSTRAINT import_cost_invoices_case_ref_unique UNIQUE(case_id, line_ref),
  CONSTRAINT import_cost_invoices_amounts_nonnegative CHECK (goods_usd_minor >= 0 AND goods_booked_ils_minor >= 0),
  CONSTRAINT import_cost_invoices_ref_valid CHECK (length(btrim(line_ref)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS import_cost_invoices_supplier_idx ON public.import_cost_invoices(supplier_id);

CREATE TABLE IF NOT EXISTS public.import_cost_shipments (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE CASCADE,
  line_ref text NOT NULL,
  tracking_number text,
  freight_clearing_ils_minor integer NOT NULL,
  CONSTRAINT import_cost_shipments_case_ref_unique UNIQUE(case_id, line_ref),
  CONSTRAINT import_cost_shipments_freight_nonnegative CHECK (freight_clearing_ils_minor >= 0),
  CONSTRAINT import_cost_shipments_ref_valid CHECK (length(btrim(line_ref)) BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS public.import_cost_allocations (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE CASCADE,
  line_ref text NOT NULL,
  invoice_id integer NOT NULL REFERENCES public.import_cost_invoices(id) ON DELETE CASCADE,
  shipment_id integer NOT NULL REFERENCES public.import_cost_shipments(id) ON DELETE CASCADE,
  goods_ils_minor integer NOT NULL,
  freight_ils_minor integer NOT NULL,
  travel_managerial_ils_minor integer NOT NULL DEFAULT 0,
  travel_capitalizable_ils_minor integer NOT NULL DEFAULT 0,
  excel_landed_ils_minor integer NOT NULL,
  CONSTRAINT import_cost_allocations_case_ref_unique UNIQUE(case_id, line_ref),
  CONSTRAINT import_cost_allocations_nonnegative CHECK (
    LEAST(goods_ils_minor,freight_ils_minor,travel_managerial_ils_minor,travel_capitalizable_ils_minor,excel_landed_ils_minor) >= 0
  ),
  CONSTRAINT import_cost_allocations_travel_eligible_limit CHECK (travel_capitalizable_ils_minor <= travel_managerial_ils_minor),
  CONSTRAINT import_cost_allocations_excel_matches CHECK (
    excel_landed_ils_minor = goods_ils_minor + freight_ils_minor + travel_managerial_ils_minor
  )
);
CREATE INDEX IF NOT EXISTS import_cost_allocations_invoice_idx ON public.import_cost_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS import_cost_allocations_shipment_idx ON public.import_cost_allocations(shipment_id);

-- Worker-only database access: there are intentionally no anon/authenticated policies.
ALTER TABLE public.import_cost_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_cost_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_cost_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_cost_allocations ENABLE ROW LEVEL SECURITY;
