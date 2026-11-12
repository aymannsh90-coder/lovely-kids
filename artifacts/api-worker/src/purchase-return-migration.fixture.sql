-- Synthetic prerequisite tables for validating the standalone POS return migration.
-- This test database is disposable and contains no live business information.
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.users (id serial PRIMARY KEY);
CREATE TABLE public.suppliers (id serial PRIMARY KEY);
CREATE TABLE public.products (id serial PRIMARY KEY);
CREATE TABLE public.pos_purchases (id serial PRIMARY KEY);
CREATE TABLE public.pos_purchase_items (id serial PRIMARY KEY);
CREATE TABLE public.inventory_movements (
  id serial PRIMARY KEY,
  movement_type text NOT NULL,
  source_type text NOT NULL,
  CONSTRAINT inventory_movements_type_valid CHECK (movement_type IN ('purchase', 'purchase_void')),
  CONSTRAINT inventory_movements_source_type_valid CHECK (source_type IN ('pos_purchase'))
);
CREATE TABLE public.product_cost_ledger (
  id serial PRIMARY KEY,
  event_type text NOT NULL,
  CONSTRAINT product_cost_ledger_event_valid CHECK (event_type IN ('purchase', 'purchase_void'))
);
