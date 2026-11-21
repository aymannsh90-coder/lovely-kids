# Lovely Kids — Auth hardening rollout (2026-11-21)

**Status: implementation proposed in a branch / PR. NOT yet deployed.**

## Goals and scope

- Keep guest browsing, cart, checkout and order creation untouched.
- Defend password login from repeated wrong guesses *across Worker isolates*.
- Do not prompt all customers or cashiers to sign in immediately on rollout.
- Keep the primary API hostname and Cloudflare WAF as configured.
- No changes to cash-register sessions, inventory, finance or order state.

## Policy

- Cloudflare WAF login IP rate limiting remains active (10 requests / 10 seconds).
- In-API failed-password limiter: 8 invalid attempts over 15 minutes per **normalized phone + Cloudflare connecting IP**. Further attempts from the same pair return HTTP 429 with Retry-After 60 seconds, for the 60-second cooldown. No global permanent account lock: customers on other networks aren't blocked by another user's failed attempts.
- New customer sessions: absolute 30-day expiration.
- New owner, admin and registered POS staff sessions: absolute 24-hour expiration.
- All sessions that exist *when the SQL migration is applied* receive **30 days from migration time** to sign in again naturally (including cashiers). The browser retains the existing token until expiry; no forced sign-out on rollout.
- Token hashing and logout semantics remain unchanged; guest checkout has no added steps.
- No sliding idle-timeout in this first phase (avoid interrupting cashier work mid-shift).

## IMPORTANT: release order

1. Review the PR and CI results; **do not deploy the Worker before its schema migration**.
2. Snapshot/backup the database. Verify current table columns and RLS before applying anything.
3. Apply `lib/db/migrations/20261121_auth_sessions_and_login_failures.sql` using approved SQL/migration tooling. It is additive; the current Worker continues to work with the new columns/table.
4. Verify in DB (read only):
   - `SELECT COUNT(*) FILTER (WHERE expires_at IS NULL), COUNT(*) FROM public.sessions;` (first count must be 0)
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_login_failures'::regclass;` (must be true)
   - verify `anon` and `authenticated` have no privileges on `auth_login_failures`.
5. Only then merge PR into `main` and deploy `artifacts/api-worker` from **that exact merged SHA** using the established production Wrangler flow.
6. Test:
   - `GET https://api.lovelykids.net/api/health`
   - Normal storefront customer login, logout, register, `/api/auth/me`, guest checkout *without creating a production test order*.
   - POS owner/cashier login and normal read-only navigation.
   - Invalid login once returns 401 with unchanged Arabic error; retry burst protection in a non-production environment. Do not deliberately lock legitimate production accounts.
   - Verify security events in Cloudflare and check unexpected HTTP 429/401 counts.
7. If something breaks, redeploy the previous known-good Worker SHA. Do not roll back or drop the additive SQL columns/table as part of immediate incident recovery.

## Operational caveats

- The database limiter relies on `CF-Connecting-IP` forwarded by Cloudflare. If the header isn't present/valid, the per-phone/IP limit is skipped rather than grouping all shoppers under a single fake IP; the existing edge WAF remains in force.
- Counter table currently retains historical keys. Schedule safe cleanup separately, e.g. records whose `last_failed_at` is older than 30 days; never run automatic deletes during normal login.
- Credential-stuffing from many IPs is not fully stopped by a phone+IP keyed limit. Follow up with carefully designed adaptive verification for targeted attacks *without imposing CAPTCHA on all customers*.
- Changing a password remains its existing separate flow. The planned password-strength upgrade and account-level 2FA should be reviewed in a separate PR with corresponding UI.
- This change does not establish the reason for FortiGuard's risk rating.
