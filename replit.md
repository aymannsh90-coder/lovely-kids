# Lovely Kids

An Arabic-language children's clothing store mobile app (Expo/React Native) for a shop in Nablus, Palestine, backed by an Express + PostgreSQL API.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/lovely-kids` — Expo app (customer-facing store + admin screens under `app/admin/`)
- `artifacts/api-server` — Express API (`/api/products`, `/api/orders`, `/api/auth`, `/api/notifications`, `/api/images`, `/api/settings`)
- `lib/db/src/schema` — Drizzle schema: `products`, `orders`, `push-tokens`, `users`, `sessions`, `app-settings` (singleton row, jsonb `data`, id=1)
- `artifacts/lovely-kids/constants/api.ts` — single source of truth for `API_BASE`, used by every context/screen instead of inlining `process.env.EXPO_PUBLIC_DOMAIN`

## Architecture decisions

- User accounts use a custom phone-number + password system (not Clerk) since Clerk lacks native phone/SMS and Facebook login. Sessions are opaque tokens in a `sessions` table, stored client-side in AsyncStorage.
- Admin access is not a separate password screen anymore. Any registered user can be promoted to admin from inside "حسابي" (long-press the header logo to reveal a password prompt calling `POST /api/auth/promote-admin`); once `isAdmin` is true, an "الإدارة" card appears in the profile.
- `API_BASE` falls back to the published production domain (`lovely-kids--aymannsh90.replit.app`) when `EXPO_PUBLIC_DOMAIN` is unset at build time — this is what was breaking image uploads/push notifications in the standalone APK build.
- Products refresh via polling (20s) + on app-foreground, not push-based, so new/edited products appear for all users without an app reinstall.
- App settings (colors, tab labels, banner, offers, category/age-group labels, bank info, WhatsApp number) are DB-backed the same way: `AppSettingsContext` polls `GET /api/settings` (20s + on-foreground) and caches to AsyncStorage as an instant-load/offline fallback; `PUT /api/settings` (admin-only, Bearer token) shallow-merges the posted partial into the stored JSON so admin edits propagate live without a reinstall. `AuthProvider` must wrap `AppSettingsProvider` in `app/_layout.tsx` so the settings context can read the auth token.
- `DATABASE_URL` now points to the user's own Supabase Postgres project (not the Replit-managed DB). Publishing will no longer get automatic dev→prod schema diffing from Replit's Postgres integration — schema changes must be pushed manually to whichever DB is live in each environment.
- Products support optional `colorVariants` (jsonb column): `{ color, hex, sizes: { size, outOfStock }[] }[]`. Admin add-product screen lets admins add colors (with a swatch picker), add sizes per color, and toggle a size to "out of stock" (shown with a red X to customers, unselectable). The product detail page shows a color selector + size grid per color when `colorVariants` is present, falling back to the old flat `sizes` list for products without colors. Cart/order items carry an optional `color` alongside `size`.
- The "تواصل معنا" (contact) screen (`app/contact.tsx`) is fully DB-backed like other app settings: `AppSettings.contactInfo` (store name/tagline, direct-call phone, social links, address lines, maps link, working hours, shipping info, return policy) is editable from an admin section in `app/admin/settings.tsx` and propagates to all users via the existing `AppSettingsContext` poll/PUT mechanism — no separate schema/table needed.

## Product

- Customers browse/search products, add to cart, checkout (COD or bank transfer with payment proof upload), track order status, and can register/log in with phone + password.
- Admins (promoted via the hidden profile flow) manage products (multi-image upload), stock, orders, categories, offers, and send push notifications to all users.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The user has been manually building Android APKs via `eas-cli`/`eas.json` outside of Replit's supported flow. Replit's Expo skill explicitly forbids running EAS CLI commands and does not officially support Google Play/Android publishing — only iOS via "Expo Launch". Any future APK build issues should be diagnosed via code fixes (like the `API_BASE` fallback), not by running `eas build` from this environment.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
