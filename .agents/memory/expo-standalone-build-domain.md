---
name: Expo standalone build domain fallback
description: Why builds (APK/EAS/standalone) of an Expo app can appear "disconnected from the database" even though the dev preview works fine.
---

`process.env.EXPO_PUBLIC_DOMAIN` is only injected by Replit's dev workflow (set to `$REPLIT_DEV_DOMAIN`). It is a build-time env var — Expo/Metro inlines its value into the JS bundle when the app is built. Any build produced outside the Replit dev workflow (EAS cloud build, `eas build --local`, etc.) does not have this var set, so every `fetch` call using it resolves to `https://undefined` and silently fails (image uploads, push token registration, any API call).

**Why:** the user reported "APK works but image upload and push notifications fail, app seems disconnected from DB" — root cause was exactly this, not a real connectivity/DB issue.

**How to apply:** centralize the API base URL in one constants file with a fallback to the app's published production domain (get via `getDeploymentInfo()`, not `$REPLIT_DOMAINS` which is dev-only inside the container):
```ts
export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN || "<production-domain-from-getDeploymentInfo>"}`;
```
Do this for every artifact that ships a standalone/native build, not just when explicitly asked — the dev preview will mask the bug completely since `EXPO_PUBLIC_DOMAIN` is always set there.

Also note: Replit's `expo` skill forbids running EAS CLI commands and doesn't officially support Android/Google Play publishing (only iOS via "Expo Launch"). If a user is already using `eas-cli`/`eas.json` manually, fix the underlying code bug rather than trying to run `eas build` yourself.
