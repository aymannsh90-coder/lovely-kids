---
name: babel-preset-expo hasModule in pnpm monorepo
description: Root cause and fix for expo export failing with "First argument of require.context should be a string" when expo-router is not visible from ROOT/node_modules.
---

## The Rule

When `babel-preset-expo` (installed in ROOT/node_modules) calls `hasModule('expo-router')` and expo-router is ONLY in a workspace package's local node_modules (not hoisted to ROOT), `hasModule` returns false and `expoRouterBabelPlugin` is never added. This leaves `process.env.EXPO_ROUTER_APP_ROOT` un-inlined in `_ctx.android.js` / `_ctx.web.js`, causing `collect-dependencies.js` to throw "First argument of require.context should be a string".

## Affected packages (all checked via hasModule in babel-preset-expo)

- `expo-router` — critical: expoRouterBabelPlugin handles EXPO_ROUTER_APP_ROOT
- `react-native-reanimated` — reanimated babel plugin
- `react-native-worklets` — worklets babel plugin

## Why they're missing from ROOT

With `node-linker=hoisted`, pnpm hoists packages that are shared across multiple workspace packages to ROOT. These three packages are only direct dependencies of `artifacts/lovely-kids`, not the workspace root or any other package, so pnpm installs them exclusively in `artifacts/lovely-kids/node_modules`. They never appear in ROOT/node_modules.

## Fix

Phase 3 in `dedup-expo.cjs` (postinstall hook) creates relative symlinks:
```
ROOT/node_modules/expo-router → ../artifacts/lovely-kids/node_modules/expo-router
ROOT/node_modules/react-native-reanimated → ../artifacts/lovely-kids/node_modules/react-native-reanimated
ROOT/node_modules/react-native-worklets → ../artifacts/lovely-kids/node_modules/react-native-worklets
```

The symlinks are safe because pnpm never manages these ROOT paths (no root-level dependency on them). On subsequent installs, Phase 3 detects the existing symlinks and skips them.

## metro.config.js fix (companion fix)

The metro.config.js must MERGE watchFolders with Expo's defaults, not replace them:
```js
config.watchFolders = [
  ...(config.watchFolders ?? []),
  monorepoRoot,
];
```
Replacing (not merging) causes expo-doctor to fail with "watchFolders does not contain all entries from Expo's defaults".

## Verification

After Phase 3:
- `babel-preset-expo` finds expo-router via `require.resolve` from ROOT context
- `expoRouterBabelPlugin` is added to babel transforms
- `process.env.EXPO_ROUTER_APP_ROOT` is inlined as a relative string literal (e.g. `'../../app'`)
- `expo export --platform android --clear` succeeds with exit 0
- `expo-doctor`: 18/18

**Why:** `hasModule()` uses Node.js's `require.resolve()` which respects the calling module's location. Code inside ROOT/node_modules can only resolve packages that are in ROOT/node_modules or higher. Metro's `resolver.nodeModulesPaths` does NOT affect `require.resolve()` inside installed packages.
