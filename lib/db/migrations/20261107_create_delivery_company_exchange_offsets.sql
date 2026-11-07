-- Offset negative exchange parcels explicitly, without changing historical
-- cash transactions. Each posted offset is linked to the settlement that
-- consumed it; historical rows document preexisting courier deductions.
CREATE TABLE IF NOT EXISTS public.delivery_company_exchange_offsets (
  id serial PRIMARY KEY,
  delivery_company_id integer NOT NULL REFERENCES public.delivery_companies(id) ON DELETE RESTRICT,
  order_id integer NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  settlement_id integer REFERENCES public.delivery_company_settlements(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CONSTRAINT delivery_company_exchange_offsets_amount_positive CHECK(amount_minor > 0),
  status text NOT NULL DEFAULT 'posted' CONSTRAINT delivery_company_exchange_offsets_status_valid CHECK(status IN ('historical','posted','reversed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_company_exchange_offsets_settlement_valid CHECK(
    (status = 'historical' AND settlement_id IS NULL)
    OR (status IN ('posted','reversed') AND settlement_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_exchange_offsets_settlement_order_idx
  ON public.delivery_company_exchange_offsets(settlement_id,order_id) WHERE settlement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_company_exchange_offsets_historical_order_idx
  ON public.delivery_company_exchange_offsets(delivery_company_id,order_id) WHERE status='historical';
CREATE INDEX IF NOT EXISTS delivery_company_exchange_offsets_company_idx
  ON public.delivery_company_exchange_offsets(delivery_company_id);
CREATE INDEX IF NOT EXISTS delivery_company_exchange_offsets_order_idx
  ON public.delivery_company_exchange_offsets(order_id);
ALTER TABLE public.delivery_company_exchange_offsets ENABLE ROW LEVEL SECURITY;

-- Previously reconciled with the old courier statement: exchange parcel
-- #241 (original #221), -4 ILS. This is metadata, not a second financial posting.
INSERT INTO public.delivery_company_exchange_offsets
  (delivery_company_id,order_id,amount_minor,status,notes)
SELECT 1,241,400,'historical',
  'طرد التبديل #241 (أم آدم) كان ضمن كشف شبلي السابق المحصل، لا تخصمه ثانية من الكشف الحالي.'
WHERE EXISTS(
  SELECT 1 FROM public.orders o WHERE o.id=241 AND o.delivery_company_id=1
) AND NOT EXISTS(
  SELECT 1 FROM public.delivery_company_exchange_offsets x
  WHERE x.delivery_company_id=1 AND x.order_id=241 AND x.status='historical'
);
