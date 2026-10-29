-- 2026-10-29: Owner-only checkout stock friction analytics.
-- Applied to lovely-kids-production via Supabase migration add_cart_stock_analytics_events.
create table if not exists public.cart_stock_analytics_events (
  id bigserial primary key,
  event_id text not null unique,
  visitor_id text not null,
  product_id integer not null,
  event_type text not null,
  issue_kind text not null,
  selected_color text,
  selected_size text,
  requested_quantity integer not null,
  available_quantity integer,
  created_at timestamptz not null default now(),
  constraint cart_stock_analytics_event_id_valid check (length(event_id) between 16 and 100 and event_id ~ '^[A-Za-z0-9_-]+$'),
  constraint cart_stock_analytics_visitor_valid check (length(visitor_id) between 12 and 100 and visitor_id ~ '^[A-Za-z0-9_-]+$'),
  constraint cart_stock_analytics_product_valid check (product_id > 0),
  constraint cart_stock_analytics_type_valid check (event_type in ('issue_seen','checkout_blocked','item_corrected','item_removed')),
  constraint cart_stock_analytics_kind_valid check (issue_kind in ('product_unavailable','selection_unavailable','quantity_exceeds_stock')),
  constraint cart_stock_analytics_quantity_valid check (requested_quantity between 1 and 99 and (available_quantity is null or available_quantity between 0 and 999999)),
  constraint cart_stock_analytics_color_length_valid check (selected_color is null or length(selected_color) <= 100),
  constraint cart_stock_analytics_size_length_valid check (selected_size is null or length(selected_size) <= 100)
);
create index if not exists cart_stock_analytics_created_type_idx on public.cart_stock_analytics_events (created_at desc, event_type);
create index if not exists cart_stock_analytics_product_date_idx on public.cart_stock_analytics_events (product_id, created_at desc);
alter table public.cart_stock_analytics_events enable row level security;
revoke all on table public.cart_stock_analytics_events from anon, authenticated;
revoke all on sequence public.cart_stock_analytics_events_id_seq from anon, authenticated;
