---
name: reanimated-color-picker worklet callbacks
description: onChange/onComplete on reanimated-color-picker's ColorPicker expect worklet functions; plain JS callbacks (e.g. calling useState setters) must use onChangeJS/onCompleteJS instead.
---

`reanimated-color-picker`'s `<ColorPicker>` component exposes two parallel sets of callback props:

- `onChange` / `onComplete` — documented as worklet-only (`@worklet` in the type defs). They run on the UI thread.
- `onChangeJS` / `onCompleteJS` — plain JS callbacks that run on the JS thread.

**Why:** Passing a normal arrow function that calls React state setters (`setState`) to `onChange`/`onComplete` is a common mistake since the prop name reads like a generic callback. Because these callbacks aren't auto-workletized in this usage pattern, wiring plain state updates into them will misbehave/error rather than updating React state correctly.

**How to apply:** Whenever wrapping this library in app code (e.g. a shared `ColorPickerModal`), always use `onChangeJS` / `onCompleteJS` for regular React callbacks (state updates, calling other JS functions). Only reach for `onChange`/`onComplete` if you're intentionally writing a `worklet` function that touches shared values directly.
