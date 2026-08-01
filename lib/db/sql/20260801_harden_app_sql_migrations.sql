BEGIN;

DO $$
BEGIN
  IF to_regclass(
    'public.app_sql_migrations'
  ) IS NULL THEN
    RAISE EXCEPTION
      'app_sql_migrations table does not exist';
  END IF;
END
$$;

ALTER TABLE public.app_sql_migrations
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.app_sql_migrations
FROM PUBLIC, anon, authenticated;

COMMIT;
