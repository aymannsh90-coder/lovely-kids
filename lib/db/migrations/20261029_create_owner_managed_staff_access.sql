-- Dedicated staff access: never give staff is_admin or is_owner privileges.
CREATE TABLE IF NOT EXISTS public.staff_access (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role_name text NOT NULL CHECK (role_name IN ('cashier','accountant','inventory','custom')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_access FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS staff_access_role_idx ON public.staff_access(role_name);
