-- Isolated PostgreSQL schema for CI, never production.
CREATE TABLE public.users (id integer PRIMARY KEY);
CREATE TABLE public.suppliers (id integer PRIMARY KEY);
INSERT INTO public.users (id) VALUES (1);
INSERT INTO public.suppliers (id) VALUES (11), (22);

CREATE TABLE public.bank_accounts (id integer PRIMARY KEY);
CREATE TABLE public.finance_transactions (id integer PRIMARY KEY);
INSERT INTO public.bank_accounts(id) VALUES (10);
INSERT INTO public.finance_transactions(id) VALUES (100);

CREATE TABLE public.cash_sessions (id integer PRIMARY KEY);
CREATE TABLE public.finance_accounts (id integer PRIMARY KEY);
INSERT INTO public.cash_sessions(id) VALUES (55);
INSERT INTO public.finance_accounts(id) VALUES (77);

CREATE TABLE public.pos_purchases (id integer PRIMARY KEY);
INSERT INTO public.pos_purchases(id) VALUES (1001),(1002);

CREATE TABLE public.finance_vouchers(id integer PRIMARY KEY);
INSERT INTO public.finance_vouchers(id) VALUES (201),(202);
