---
name: Phone-based auth for Expo apps needing SMS/Facebook login
description: Decision record for when a user wants phone-number and/or Facebook/WhatsApp login on an Expo app.
---

Clerk (the default recommended auth provider) does not support native phone/SMS sign-in or Facebook login out of the box (only Google/GitHub/Apple/X). Facebook/WhatsApp OAuth also requires an external Meta developer app + review, which isn't set up as a Replit integration.

**Why:** when a user asks for phone-number registration or Facebook/WhatsApp login and is flexible about the exact method, these constraints usually rule out Clerk and third-party OAuth as a fast path.

**How to apply:** default to a custom users table (phone unique, name, passwordHash via Node's built-in `crypto.scryptSync`, isAdmin flag) + a simple opaque-token `sessions` table, with the token persisted client-side in AsyncStorage. This satisfies "each user has an account with saved data" without external dependencies. Revisit if the user later wants real SMS OTP (needs an SMS provider) or explicitly wants to invest in Meta OAuth setup.
