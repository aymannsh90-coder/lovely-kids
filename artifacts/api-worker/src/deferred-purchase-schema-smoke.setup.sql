-- Disposable PostgreSQL test fixture. NEVER run against Lovely Kids production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.products (id integer PRIMARY KEY);
CREATE TABLE public.pos_sale_items (id integer PRIMARY KEY);
CREATE TABLE public.pos_purchases (
  id integer PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  status text NOT NULL
);
INSERT INTO public.products(id) VALUES (313);
INSERT INTO public.pos_sale_items(id) VALUES (7001);
INSERT INTO public.pos_purchases(id,public_id,status)
  VALUES (8,'DRAFT-TEST-0001','draft');
