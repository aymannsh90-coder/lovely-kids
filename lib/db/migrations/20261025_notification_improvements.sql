create table if not exists public.stock_notification_subscriptions (
  id serial primary key,
  product_id integer not null references public.products(id) on delete cascade,
  color text,
  size text,
  channel text not null check (channel in ('expo', 'web')),
  target text not null,
  created_at timestamptz not null default now()
);

create index if not exists stock_notification_subscriptions_product_idx
  on public.stock_notification_subscriptions(product_id, color, size);

create index if not exists stock_notification_subscriptions_target_idx
  on public.stock_notification_subscriptions(channel, target);

alter table public.stock_notification_subscriptions enable row level security;
revoke all on table public.stock_notification_subscriptions from anon, authenticated;

create table if not exists public.expo_push_receipts (
  id serial primary key,
  ticket_id text not null unique,
  token text not null,
  created_at timestamptz not null default now()
);

create index if not exists expo_push_receipts_created_idx
  on public.expo_push_receipts(created_at);

alter table public.expo_push_receipts enable row level security;
revoke all on table public.expo_push_receipts from anon, authenticated;
