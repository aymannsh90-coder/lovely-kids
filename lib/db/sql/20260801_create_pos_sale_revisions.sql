BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pos_sale_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'POS sale revisions table already exists';
  END IF;
END
$$;

CREATE TABLE public.pos_sale_revisions (
  id serial PRIMARY KEY,

  sale_id integer NOT NULL
    REFERENCES public.pos_sales(id)
    ON DELETE RESTRICT,

  idempotency_key text NOT NULL,

  revision_number integer NOT NULL,

  edited_by_user_id integer NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,

  reason text NOT NULL,

  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pos_sale_revisions_number_positive
    CHECK (revision_number > 0),

  CONSTRAINT pos_sale_revisions_reason_not_empty
    CHECK (char_length(trim(reason)) > 0)
);

CREATE UNIQUE INDEX pos_sale_revisions_idempotency_key_idx
  ON public.pos_sale_revisions (idempotency_key);

CREATE UNIQUE INDEX pos_sale_revisions_sale_number_idx
  ON public.pos_sale_revisions (
    sale_id,
    revision_number
  );

CREATE INDEX pos_sale_revisions_sale_idx
  ON public.pos_sale_revisions (sale_id);

CREATE INDEX pos_sale_revisions_editor_idx
  ON public.pos_sale_revisions (edited_by_user_id);

CREATE INDEX pos_sale_revisions_created_at_idx
  ON public.pos_sale_revisions (created_at);

ALTER TABLE public.pos_sale_revisions
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.pos_sale_revisions
FROM anon, authenticated;

REVOKE ALL ON SEQUENCE
  public.pos_sale_revisions_id_seq
FROM anon, authenticated;

COMMIT;
