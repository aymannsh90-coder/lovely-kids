-- Isolated PostgreSQL schema for CI, never production.
CREATE TABLE public.users (id integer PRIMARY KEY);
CREATE TABLE public.suppliers (id integer PRIMARY KEY);
INSERT INTO public.users (id) VALUES (1);
INSERT INTO public.suppliers (id) VALUES (11), (22);
