BEGIN;

CREATE TABLE IF NOT EXISTS public.product_daily_analytics (
  id serial PRIMARY KEY,
  visitor_id text NOT NULL,
  product_id integer NOT NULL,
  event_date date NOT NULL,
  event_type text NOT NULL,
  event_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_daily_analytics_visitor_valid
    CHECK (length(btrim(visitor_id)) BETWEEN 12 AND 100),

  CONSTRAINT product_daily_analytics_product_valid
    CHECK (product_id > 0),

  CONSTRAINT product_daily_analytics_event_type_valid
    CHECK (event_type IN ('view', 'add_to_cart')),

  CONSTRAINT product_daily_analytics_event_count_valid
    CHECK (event_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS
  product_daily_analytics_visitor_product_day_event_idx
ON public.product_daily_analytics(
  visitor_id,
  product_id,
  event_date,
  event_type
);

CREATE INDEX IF NOT EXISTS
  product_daily_analytics_date_product_idx
ON public.product_daily_analytics(
  event_date,
  product_id
);

CREATE INDEX IF NOT EXISTS
  product_daily_analytics_event_date_idx
ON public.product_daily_analytics(
  event_type,
  event_date
);

CREATE INDEX IF NOT EXISTS
  product_daily_analytics_product_date_idx
ON public.product_daily_analytics(
  product_id,
  event_date
);

ALTER TABLE public.product_daily_analytics
  ENABLE ROW LEVEL SECURITY;

COMMIT;
