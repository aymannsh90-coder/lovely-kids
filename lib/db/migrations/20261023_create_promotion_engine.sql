begin;

create table if not exists public.promotions (
  id serial primary key,
  name text not null,
  public_label text not null,
  description text,
  kind text not null,
  scope text not null default 'selected_products',
  channel text not null default 'both',
  status text not null default 'draft',
  buy_quantity integer,
  reward_quantity integer,
  reward_mode text,
  reward_percent integer,
  reward_price_minor integer,
  reward_selection_mode text not null default 'cheapest',
  percent_off integer,
  bundle_quantity integer,
  bundle_price_minor integer,
  repeatable boolean not null default true,
  max_applications_per_order integer,
  stack_with_other_promotions boolean not null default false,
  stack_with_discount_codes boolean not null default false,
  stack_with_shipping_promotion boolean not null default true,
  priority integer not null default 100,
  starts_at timestamptz,
  ends_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint promotions_kind_valid
    check (kind in ('buy_x_get_y', 'percent_off', 'bundle_price')),
  constraint promotions_scope_valid
    check (scope in ('all_products', 'selected_products')),
  constraint promotions_channel_valid
    check (channel in ('web', 'pos', 'both')),
  constraint promotions_status_valid
    check (status in ('draft', 'active', 'archived')),
  constraint promotions_dates_valid
    check (starts_at is null or ends_at is null or ends_at >= starts_at),
  constraint promotions_priority_valid
    check (priority between 0 and 100000),
  constraint promotions_max_applications_valid
    check (max_applications_per_order is null or max_applications_per_order > 0),
  constraint promotions_reward_selection_mode_valid
    check (reward_selection_mode in ('cheapest', 'customer_choice')),
  constraint promotions_buy_x_get_y_valid
    check (
      kind <> 'buy_x_get_y'
      or (
        buy_quantity is not null
        and buy_quantity > 0
        and reward_quantity is not null
        and reward_quantity > 0
        and reward_mode in ('free', 'percent_off', 'fixed_price')
        and (
          reward_mode <> 'percent_off'
          or reward_percent between 1 and 100
        )
        and (
          reward_mode <> 'fixed_price'
          or reward_price_minor >= 0
        )
      )
    ),
  constraint promotions_percent_off_valid
    check (
      kind <> 'percent_off'
      or percent_off between 1 and 100
    ),
  constraint promotions_bundle_price_valid
    check (
      kind <> 'bundle_price'
      or (
        bundle_quantity is not null
        and bundle_quantity > 1
        and bundle_price_minor is not null
        and bundle_price_minor >= 0
      )
    )
);

create index if not exists promotions_status_window_idx
  on public.promotions(status, starts_at, ends_at);

create index if not exists promotions_channel_idx
  on public.promotions(channel);

create table if not exists public.promotion_products (
  id serial primary key,
  promotion_id integer not null
    references public.promotions(id) on delete cascade,
  product_id integer not null
    references public.products(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),

  constraint promotion_products_role_valid
    check (role in ('qualifying', 'reward', 'excluded')),

  constraint promotion_products_unique
    unique (promotion_id, product_id, role)
);

create index if not exists promotion_products_product_idx
  on public.promotion_products(product_id);

create index if not exists promotion_products_promotion_idx
  on public.promotion_products(promotion_id);

alter table public.orders
  add column if not exists promotion_discount_amount integer not null default 0;

alter table public.pos_sales
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.pos_sale_items
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.pos_sale_returns
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.pos_sale_return_items
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.exchange_return_items
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.exchange_sale_items
  add column if not exists promotion_discount_minor integer not null default 0;

alter table public.pos_sales
  drop constraint if exists pos_sales_amounts_nonnegative,
  drop constraint if exists pos_sales_discount_breakdown_matches,
  drop constraint if exists pos_sales_total_matches;

alter table public.pos_sales
  add constraint pos_sales_amounts_nonnegative
    check (
      subtotal_minor >= 0
      and discount_minor >= 0
      and item_discount_minor >= 0
      and promotion_discount_minor >= 0
      and invoice_discount_minor >= 0
      and total_minor >= 0
      and paid_minor >= 0
      and change_minor >= 0
      and account_due_minor >= 0
    ),
  add constraint pos_sales_discount_breakdown_matches
    check (
      discount_minor =
        item_discount_minor
        + promotion_discount_minor
        + invoice_discount_minor
    ),
  add constraint pos_sales_total_matches
    check (
      total_minor = subtotal_minor - discount_minor
    );

alter table public.pos_sale_items
  drop constraint if exists pos_sale_items_prices_nonnegative,
  drop constraint if exists pos_sale_items_line_discount_not_over_gross,
  drop constraint if exists pos_sale_items_total_matches;

alter table public.pos_sale_items
  add constraint pos_sale_items_prices_nonnegative
    check (
      website_unit_price_minor >= 0
      and sold_unit_price_minor >= 0
      and line_discount_minor >= 0
      and promotion_discount_minor >= 0
      and line_total_minor >= 0
    ),
  add constraint pos_sale_items_line_discount_not_over_gross
    check (
      line_discount_minor + promotion_discount_minor
      <= sold_unit_price_minor * quantity
    ),
  add constraint pos_sale_items_total_matches
    check (
      line_total_minor =
        sold_unit_price_minor * quantity
        - line_discount_minor
        - promotion_discount_minor
    );

alter table public.pos_sale_return_items
  drop constraint if exists pos_sale_return_items_amounts_nonnegative,
  drop constraint if exists pos_sale_return_items_discount_breakdown_matches,
  drop constraint if exists pos_sale_return_items_discount_not_over_gross,
  drop constraint if exists pos_sale_return_items_refund_matches;

alter table public.pos_sale_return_items
  add constraint pos_sale_return_items_amounts_nonnegative
    check (
      gross_amount_minor >= 0
      and line_discount_minor >= 0
      and promotion_discount_minor >= 0
      and invoice_discount_minor >= 0
      and allocated_discount_minor >= 0
      and refund_amount_minor >= 0
    ),
  add constraint pos_sale_return_items_discount_breakdown_matches
    check (
      allocated_discount_minor =
        line_discount_minor
        + promotion_discount_minor
        + invoice_discount_minor
    ),
  add constraint pos_sale_return_items_discount_not_over_gross
    check (allocated_discount_minor <= gross_amount_minor),
  add constraint pos_sale_return_items_refund_matches
    check (
      refund_amount_minor =
        gross_amount_minor - allocated_discount_minor
    );

alter table public.exchange_return_items
  drop constraint if exists exchange_return_items_amounts_nonnegative,
  drop constraint if exists exchange_return_items_discount_matches,
  drop constraint if exists exchange_return_items_discount_not_over_gross,
  drop constraint if exists exchange_return_items_net_matches;

alter table public.exchange_return_items
  add constraint exchange_return_items_amounts_nonnegative
    check (
      quantity > 0
      and sold_unit_price_minor >= 0
      and gross_amount_minor >= 0
      and line_discount_minor >= 0
      and promotion_discount_minor >= 0
      and invoice_discount_minor >= 0
      and allocated_discount_minor >= 0
      and return_net_minor >= 0
    ),
  add constraint exchange_return_items_discount_matches
    check (
      allocated_discount_minor =
        line_discount_minor
        + promotion_discount_minor
        + invoice_discount_minor
    ),
  add constraint exchange_return_items_discount_not_over_gross
    check (allocated_discount_minor <= gross_amount_minor),
  add constraint exchange_return_items_net_matches
    check (
      return_net_minor =
        gross_amount_minor - allocated_discount_minor
    );

alter table public.exchange_sale_items
  drop constraint if exists exchange_sale_items_amounts_nonnegative,
  drop constraint if exists exchange_sale_items_discount_matches,
  drop constraint if exists exchange_sale_items_discount_not_over_gross,
  drop constraint if exists exchange_sale_items_net_matches;

alter table public.exchange_sale_items
  add constraint exchange_sale_items_amounts_nonnegative
    check (
      quantity > 0
      and sold_unit_price_minor >= 0
      and gross_amount_minor >= 0
      and line_discount_minor >= 0
      and promotion_discount_minor >= 0
      and invoice_discount_minor >= 0
      and allocated_discount_minor >= 0
      and line_net_minor >= 0
    ),
  add constraint exchange_sale_items_discount_matches
    check (
      allocated_discount_minor =
        line_discount_minor
        + promotion_discount_minor
        + invoice_discount_minor
    ),
  add constraint exchange_sale_items_discount_not_over_gross
    check (allocated_discount_minor <= gross_amount_minor),
  add constraint exchange_sale_items_net_matches
    check (
      line_net_minor =
        gross_amount_minor - allocated_discount_minor
    );

create table if not exists public.order_promotions (
  id serial primary key,
  order_id integer not null
    references public.orders(id) on delete cascade,
  promotion_id integer
    references public.promotions(id) on delete set null,
  promotion_name text not null,
  promotion_kind text not null,
  discount_minor integer not null,
  application_count integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),

  constraint order_promotions_discount_valid
    check (discount_minor >= 0),
  constraint order_promotions_application_count_valid
    check (application_count > 0)
);

create index if not exists order_promotions_order_idx
  on public.order_promotions(order_id);

create index if not exists order_promotions_promotion_idx
  on public.order_promotions(promotion_id);

create table if not exists public.pos_sale_promotions (
  id serial primary key,
  sale_id integer not null
    references public.pos_sales(id) on delete cascade,
  promotion_id integer
    references public.promotions(id) on delete set null,
  promotion_name text not null,
  promotion_kind text not null,
  discount_minor integer not null,
  application_count integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),

  constraint pos_sale_promotions_discount_valid
    check (discount_minor >= 0),
  constraint pos_sale_promotions_application_count_valid
    check (application_count > 0)
);

create index if not exists pos_sale_promotions_sale_idx
  on public.pos_sale_promotions(sale_id);

create index if not exists pos_sale_promotions_promotion_idx
  on public.pos_sale_promotions(promotion_id);

create table if not exists public.exchange_sale_promotions (
  id serial primary key,
  exchange_id integer not null
    references public.exchange_documents(id) on delete cascade,
  promotion_id integer
    references public.promotions(id) on delete set null,
  promotion_name text not null,
  promotion_kind text not null,
  discount_minor integer not null,
  application_count integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),

  constraint exchange_sale_promotions_discount_valid
    check (discount_minor >= 0),
  constraint exchange_sale_promotions_application_count_valid
    check (application_count > 0)
);

create index if not exists exchange_sale_promotions_exchange_idx
  on public.exchange_sale_promotions(exchange_id);

create index if not exists exchange_sale_promotions_promotion_idx
  on public.exchange_sale_promotions(promotion_id);

create table if not exists public.pos_sale_item_promotion_allocations (
  id serial primary key,
  sale_id integer not null
    references public.pos_sales(id) on delete cascade,
  sale_item_id integer not null
    references public.pos_sale_items(id) on delete cascade,
  promotion_id integer
    references public.promotions(id) on delete set null,
  promotion_name text not null,
  group_key text not null,
  discount_minor integer not null,
  created_at timestamptz not null default now(),

  constraint pos_sale_item_promotion_allocations_discount_valid
    check (discount_minor >= 0)
);

create index if not exists pos_sale_item_promotion_allocations_sale_idx
  on public.pos_sale_item_promotion_allocations(sale_id);

create index if not exists pos_sale_item_promotion_allocations_item_idx
  on public.pos_sale_item_promotion_allocations(sale_item_id);

create index if not exists pos_sale_item_promotion_allocations_promotion_idx
  on public.pos_sale_item_promotion_allocations(promotion_id);

alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.order_promotions enable row level security;
alter table public.pos_sale_promotions enable row level security;
alter table public.pos_sale_item_promotion_allocations enable row level security;
alter table public.exchange_sale_promotions enable row level security;

revoke all on table public.promotions from anon, authenticated;
revoke all on table public.promotion_products from anon, authenticated;
revoke all on table public.order_promotions from anon, authenticated;
revoke all on table public.pos_sale_promotions from anon, authenticated;
revoke all on table public.pos_sale_item_promotion_allocations from anon, authenticated;
revoke all on table public.exchange_sale_promotions from anon, authenticated;

revoke all on sequence public.promotions_id_seq from anon, authenticated;
revoke all on sequence public.promotion_products_id_seq from anon, authenticated;
revoke all on sequence public.order_promotions_id_seq from anon, authenticated;
revoke all on sequence public.pos_sale_promotions_id_seq from anon, authenticated;
revoke all on sequence public.pos_sale_item_promotion_allocations_id_seq from anon, authenticated;
revoke all on sequence public.exchange_sale_promotions_id_seq from anon, authenticated;

commit;
