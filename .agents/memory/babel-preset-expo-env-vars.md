---
name: babel-preset-expo env var handling
description: Why transform-inline-environment-variables must NOT be a custom plugin alongside babel-preset-expo
---

# babel-preset-expo handles EXPO_ROUTER_APP_ROOT internally

`babel-preset-expo` contains two internal plugins relevant to env vars:

1. **`expoInlineEnvVars`** — inlines `EXPO_PUBLIC_*` and other app env vars for non-node-module files.
2. **`expoRouterBabelPlugin`** — handles `EXPO_ROUTER_APP_ROOT` via Metro's `api.caller()` mechanism: reads `caller.routerRoot` (passed by Metro main process) and computes a **relative path** from each file to the app folder. This works even in Babel workers that don't inherit shell env vars.

**Why:** In Babel, plugins run before presets. If you add `transform-inline-environment-variables` as a **plugin** in `babel.config.js`, it runs first and replaces `process.env.EXPO_ROUTER_APP_ROOT` before `expoRouterBabelPlugin` can handle it. In Babel workers (Metro), the env var is absent → replaced with `undefined` → `require.context(undefined)` → SyntaxError on Vercel / routes missing locally.

**How to apply:** Keep `babel.config.js` minimal — only `babel-preset-expo` preset, no custom `transform-inline-environment-variables` plugin. The preset handles all env var inlining correctly:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
```

**Verified result:** ~1900+ modules in web bundle, routes (BiometricGate, productShareBaseUrl, CartContext) present, `process.env.EXPO_ROUTER_APP_ROOT` absent from dist, no SyntaxError.
