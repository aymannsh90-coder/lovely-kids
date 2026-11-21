-- Apply BEFORE deploying the new API Worker. No existing session is revoked.
-- The DB default maintains compatibility with the old Worker while rolling out.
BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamp without time zone;

-- Give every pre-existing session a full 30-day transition period. New
-- customer sessions get 30 days; new owner/staff sessions get 24 hours via API.
UPDATE public.sessions
SET expires_at = (now() + interval '30 days')::timestamp
WHERE expires_at IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_expiry_idx
  ON public.sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.auth_login_failures (
  key_hash text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at timestamp without time zone NOT NULL DEFAULT now(),
  blocked_until timestamp without time zone,
  last_failed_at timestamp without time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_login_failures FROM anon, authenticated;

COMMIT;
