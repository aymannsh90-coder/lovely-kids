-- Relate import Excel groups to ALREADY posted POS purchases. Does not post any GL/cost entry.
-- Review-only SQL in PR #219; production is untouched.
ALTER TABLE public.import_cost_allocations
  ADD CONSTRAINT import_cost_allocations_case_id_unique UNIQUE (case_id,id);

CREATE TABLE public.import_cost_purchase_links (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.import_cost_cases(id) ON DELETE RESTRICT,
  allocation_id integer NOT NULL REFERENCES public.import_cost_allocations(id) ON DELETE RESTRICT,
  purchase_id integer NOT NULL REFERENCES public.pos_purchases(id) ON DELETE RESTRICT,
  created_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_cost_purchase_links_purchase_unique UNIQUE (purchase_id),
  CONSTRAINT import_cost_purchase_links_same_case_fk
    FOREIGN KEY (case_id, allocation_id)
    REFERENCES public.import_cost_allocations (case_id,id)
    ON DELETE RESTRICT
);
CREATE INDEX import_cost_purchase_links_allocation_idx ON public.import_cost_purchase_links(allocation_id);
CREATE INDEX import_cost_purchase_links_case_idx ON public.import_cost_purchase_links(case_id);
ALTER TABLE public.import_cost_purchase_links ENABLE ROW LEVEL SECURITY;
-- Intentionally no anon/authenticated policy: owner-only Worker controls access.
