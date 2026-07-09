---
name: Expo web preview babel plugin ordering bug
description: Why Expo web shows "Welcome to Expo" tutorial in monorepos — babel plugin ordering causes _ctx.web.js to get a wrong require.context path, producing empty route keys.
---

## The Rule

In `babel.config.js`, always exclude the Expo Router env vars from `babel-plugin-transform-inline-environment-variables`:

```js
plugins: [
  ["transform-inline-environment-variables", {
    exclude: ["EXPO_ROUTER_APP_ROOT", "EXPO_ROUTER_ABS_APP_ROOT", "EXPO_ROUTER_IMPORT_MODE", "EXPO_PROJECT_ROOT"],
  }],
],
```

Never set `EXPO_ROUTER_APP_ROOT` in `.env` for the dev server — the Expo CLI + `expoRouterBabelPlugin` compute it automatically.

## Why

Babel plugin ordering: **plugins run before presets**. `transform-inline-environment-variables` (a project plugin) replaces `process.env.EXPO_ROUTER_APP_ROOT` with the raw env value — either `'app'` (if in `.env`) or `undefined` — before `expoRouterBabelPlugin` (inside `babel-preset-expo`, a preset) can replace it with the correct relative path from `_ctx.web.js` to the actual `app/` folder.

Result: `require.context('app', ...)` inside `expo-router/_ctx.web.js` resolves relative to `node_modules/expo-router/` — a directory with no route files. `contextModule.keys()` returns `[]`, `isValid` stays `false`, `getDirectoryTree()` returns `null`, `routeNode` is `null`, `shouldShowTutorial()` returns `true` → "Welcome to Expo" screen instead of the actual app.

## How `expoRouterBabelPlugin` works (when allowed to run)

- Reads `caller.routerRoot` (the `transform.routerRoot=app` Metro custom transform option)
- Computes absolute app root: `path.join(projectRoot, routerRoot)` → `/…/artifacts/lovely-kids/app`
- Computes relative path from `_ctx.web.js`'s directory to the absolute app root
- Replaces `process.env.EXPO_ROUTER_APP_ROOT` with this correct relative path
- Metro's `require.context` then correctly finds all route files

## How to Apply

Any pnpm monorepo Expo project using `babel-plugin-transform-inline-environment-variables` in `babel.config.js` must add the `exclude` list above. This issue only surfaces in monorepos (or other setups where `projectRoot` resolution might differ from a single-app project) because in flat projects the issue is masked.

Also: do NOT add `--clear` to the Expo dev script permanently — it forces a full 24-second cold rebuild on every workflow restart. Use it once for cache-busting, then remove it.
