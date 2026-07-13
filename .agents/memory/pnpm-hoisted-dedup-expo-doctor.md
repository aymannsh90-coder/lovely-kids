---
name: pnpm hoisted dedup for expo-doctor
description: Two-phase postinstall script (dedup-expo.cjs) that keeps expo-doctor at 18/18 in a pnpm node-linker=hoisted monorepo after --no-frozen-lockfile reinstalls.
---

## The Rule

`dedup-expo.cjs` in the workspace root runs as a postinstall hook with two phases. Do NOT collapse them into one or add react/react-dom to the Phase 1 allowlist.

## Phase 1 – Allowlist dedup (lovely-kids local → root)

Removes a fixed list of Expo native modules from `artifacts/lovely-kids/node_modules` when the identical version exists in the hoisted root `node_modules`. Without this, expo-doctor finds the same package at two paths and reports "duplicate native module".

Allowlist: `expo`, `expo-asset`, `expo-constants`, `expo-font`, `expo-file-system`, `expo-modules-core`, `@expo/vector-icons`, and `react-native` (conditional: only if truly duplicated in both locations).

**Why:** With `node-linker=hoisted`, pnpm installs direct workspace-package dependencies in both the workspace root's flat `node_modules` AND inside the individual artifact's `node_modules`. expo-doctor sees both and complains.

## Phase 2 – Hoisted vs virtual-store inode alignment (react / react-dom)

After `--no-frozen-lockfile`, pnpm may rebuild its virtual store, creating:
- `node_modules/react` — physical copy (hardlink from global store run A), inode X
- `node_modules/.pnpm/react@VERSION/node_modules/react` — physical copy (hardlink from global store run B), inode Y
- `node_modules/.pnpm/@tanstack+react-query@.../react` — symlink → `.pnpm/react@VERSION/...` (inode Y)

expo-doctor resolves react via `@tanstack/react-query`'s peer dep chain, finds inode Y ≠ X, and reports "linked to a different installation".

**Fix:** Convert the hoisted `node_modules/react` (and `react-dom`) from a physical copy into a symlink pointing at the `.pnpm/react@VERSION/node_modules/react` virtual store entry. Both paths now resolve to inode Y → same installation → no expo-doctor error.

**Why NOT Phase 1:** react is NOT duplicated between lovely-kids and root (it's only in root). The issue is within root's own flat+virtual structure — two different physical copies for the same version.

## Trigger

Root `package.json` has `"postinstall": "node dedup-expo.cjs"`. Runs automatically after every `pnpm install`.

## What NOT to change

- Do NOT add react, react-dom, Clerk, or other non-native packages to the Phase 1 allowlist.
- Do NOT remove Phase 2; it's required when `--no-frozen-lockfile` is used.
- Keep `node-linker=hoisted` in `.npmrc`; removing it breaks the Expo dev server startup.

## Verified state

After `pnpm install --no-frozen-lockfile --prefer-offline` with this script:
- expo-doctor: 18/18 ✓
- expo-modules-core resolves to 3.0.30 from root ✓
- react inodes match (hoisted symlink → .pnpm virtual store) ✓
