-- Isolated PostgreSQL schema for CI, never production.
CREATE TABLE public.users (id integer PRIMARY KEY);
CREATE TABLE public.suppliers (id integer PRIMARY KEY);
INSERT INTO public.users (id) VALUES (1);
INSERT INTO public.suppliers (id) VALUES (11), (22);

CREATE TABLE public.bank_accounts (id integer PRIMARY KEY);
CREATE TABLE public.finance_transactions (id integer PRIMARY KEY);
INSERT INTO public.bank_accounts(id) VALUES (10);
INSERT INTO public.finance_transactions(id) VALUES (100);
