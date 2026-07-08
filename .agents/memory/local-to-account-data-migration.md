---
name: Migrating device-local data to account-backed storage
description: Pattern for converting an AsyncStorage-only feature (e.g. wishlist/favorites) to sync with a user account without losing existing local data.
---

When a feature starts as device-only (AsyncStorage) and later needs to sync to
a user account in the DB, do the migration client-side, gated on login:

1. Guest (no user): keep the exact old AsyncStorage read/write behavior untouched.
2. On login (once per user id, e.g. via a ref keyed on user.id): read any local
   AsyncStorage data, POST it to the server to merge into the account, then
   clear the local key, then GET the authoritative server state and use that
   from then on.
3. After login, all reads/writes go through the API with the auth token;
   AsyncStorage is no longer touched for that data.

**Why:** doing the upload-then-clear-then-fetch sequence (rather than just
switching to server state on login) prevents silently discarding whatever the
user had accumulated locally before creating/logging into their account.

**How to apply:** any "was local-only, now becomes account-synced" feature in
this app (favorites/wishlist was the first case) — reuse this same shape rather
than inventing a new sync strategy per feature.
