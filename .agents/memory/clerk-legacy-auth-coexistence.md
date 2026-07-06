---
name: Clerk + legacy custom auth coexistence
description: Pattern for adding Clerk OAuth (e.g. Google sign-in) alongside an existing custom session-token auth system without breaking the old flow.
---

When a project already has a custom auth system (e.g. phone+password with an opaque session token in a `sessions` table) and Clerk OAuth is added as an *additional* sign-in option, treat the two as parallel identity sources rather than replacing one with the other.

**Server side:** a single `getCurrentUser(req)` helper should try the legacy Bearer session token first, then fall back to Clerk's `getAuth(req)` and JIT-provision a local `users` row (via `clerkClient.users.getUser`) keyed on a nullable `clerkUserId` column. Columns that were previously required for local accounts (e.g. `phone`, `passwordHash`) must become nullable so Clerk-only users can exist without them.

**Client side (Expo):** don't try to unify Clerk's short-lived JWT with the legacy static token in one stored value. Instead expose a single async `getAuthToken()` from the auth context that returns the legacy token if a legacy session exists, or calls Clerk's `getToken()` fresh otherwise — and have every authenticated fetch call `getAuthToken()` right before the request instead of reading a cached token from state/AsyncStorage. Both token types are simply sent as `Authorization: Bearer <token>`, since the server's `getCurrentUser` already handles either.

**Why:** Clerk session tokens expire in ~60s and can't be persisted like the legacy opaque token; a naive shared `token` state field goes stale silently. Keeping resolution behind one async function avoids scattering the two-source logic across every screen/context that needs auth.
