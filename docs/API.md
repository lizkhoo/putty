# API reference — `Putty`

The public surface of `lib/putty.js`. The library loads as a UMD-ish global `Putty` (via `<script>`) or via `import`. For the why behind the pipeline split see [ADR 0001](adr/0001-per-preset-pipeline-routing.md); for terminology see [CONTEXT.md](../CONTEXT.md); for the file map see [ARCHITECTURE.md](ARCHITECTURE.md).

> **Scope.** This is a playful exploration toy, not a font-production tool (see [PRODUCT_INTENT.md](PRODUCT_INTENT.md)). Outline-based pipelines deform real open-source WOFF outlines at runtime — **prototype use only**; don't redistribute exported outlines as a substitute for licensing the source fonts ([THIRD_PARTY_FONTS.md](THIRD_PARTY_FONTS.md)).

---

## Quick start

```js
// 1. Outline / anatomy pipelines need opentype.js loaded first.
Putty.setOpentypeParser(opentype);

// 2. Create — the router reads the preset's declared pipeline.
const wm = await Putty.createWordmark("Hello", {
  presetKey: "instrumentSerif",
});

// 3. Mount + make interactive.
wm.mount("#stage"); // selector string or Element
wm.makeInteractive(); // draggable handles + tooltip

// 4. Serialize / export.
const state = wm.toState();
const html = await wm.toInteractiveBundle(); // self-contained embed
```

The `none` preset (hand-authored Bézier sandbox) needs no opentype.js and can be constructed synchronously via `SandboxWordmark`.

---

## Setup

### `Putty.setOpentypeParser(opentype)`

Registers the [opentype.js](https://github.com/opentypejs/opentype.js) module the library uses to parse WOFF outlines. **Required** before any outline-deform or anatomy-deform pipeline runs (i.e. every preset except `none`). Calling those pipelines without it throws.

---

## Router

### `await Putty.createWordmark(text, options)`

The single entry point. Reads `options` and dispatches to the right engine. Async because outline pipelines fetch and parse a WOFF.

**Options:**

| Option            | Type               | Default     | Notes                                                                                                                                                        |
| ----------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presetKey`       | `string`           | —           | Preset key: `bubbly`, `instrumentSerif`, `sourceSans`, `bitter`, `ibmPlexMono`, or `none`.                                                                   |
| `preset`          | `string \| object` | —           | Alternative to `presetKey` — a key, or a full preset object.                                                                                                 |
| `renderMode`      | `string`           | `"outline"` | `"outline-static"` forces `OutlineWordmark` (filled, no handles) for any named preset, independent of its pipeline. Other values defer to `preset.pipeline`. |
| `tracking`        | `number`           | per-class   | Inter-glyph spacing.                                                                                                                                         |
| `color`           | `string`           | `"#2a2ae5"` | Fill color.                                                                                                                                                  |
| `padding`         | `number`           | per-class   | ViewBox padding.                                                                                                                                             |
| `fontSize`        | `number`           | `1000`      | Internal units-per-em scale for outline pipelines.                                                                                                           |
| `monoCellEnabled` | `boolean`          | `true`      | `AnatomyDeformWordmark` only; takes effect on presets that declare a mono cell (`ibmPlexMono`).                                                              |

**Dispatch rules:**

1. `renderMode === "outline-static"` + a named preset → **`OutlineWordmark`**.
2. `preset.pipeline === "outline-deform"` → **`DeformableOutlineWordmark`** (today: `bubbly`).
3. `preset.pipeline === "anatomy-deform"` → **`AnatomyDeformWordmark`** (the four readable-text faces).
4. Otherwise (`none`, or a preset with no pipeline) → **`SandboxWordmark`**.

---

## Engine classes

All four engines share a common interaction surface. Differences are called out per class.

### Common surface

| Member                                              | Signature                    | Notes                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mount(target)`                                     | `(string \| Element) → void` | Builds the SVG and inserts it into `target`.                                                                                                                                       |
| `makeInteractive()`                                 | `() → void`                  | Enables drag handles + tooltip.                                                                                                                                                    |
| `freezeInteraction()`                               | `() → void`                  | Disables dragging (handles stay rendered).                                                                                                                                         |
| `setText(text)`                                     | `(string) → void \| Promise` | Position-matched diff — reuses tuned glyphs where characters are unchanged. Async on outline pipelines.                                                                            |
| `enableMouseFollow(opts?)` / `disableMouseFollow()` | —                            | Cursor-driven "sweep" mode (mutually exclusive with click-drag). Per-pipeline mapping; see below.                                                                                  |
| `toSVG()`                                           | `() → string`                | Serialized standalone SVG markup.                                                                                                                                                  |
| `toState()`                                         | `() → object`                | Round-trippable snapshot (shapes below).                                                                                                                                           |
| `await toInteractiveBundle()`                       | `() → Promise<string>`       | A complete, self-contained interactive HTML document with the library source + a `toState()` snapshot inlined. The matching `fromState()` for the engine is wired into the bundle. |

`mount`, `setText`, `toState`, and `toInteractiveBundle` exist on **all four** classes. `OutlineWordmark` (static) has no drag/mouse-follow surface.

### `SandboxWordmark` (alias `Wordmark`)

The hand-authored Bézier sandbox. Serves the **`none`** preset only (no reference font). Synchronous constructor — no opentype.js needed. The `Wordmark` export alias points at this class so previously-generated `toInteractiveBundle()` HTML keeps deserializing.

- Class-specific: `setPreset(preset)`, `resetAll()`, `resetGlyph(i)`.
- Per-letter anatomy handles come from each glyph module's `handles()`; presets seed `defaults` + `glyphParams` only.

```js
const wm = new Putty.SandboxWordmark("hello", {
  preset: Putty.presets.none,
});
wm.mount("#stage");
wm.makeInteractive();
```

### `DeformableOutlineWordmark` — outline-deform pipeline

WOFF outline deformed by **one global preset axis** (today `bubbly` / `bubbliness`). No per-letter handles; a single right-side axis handle plus a slider.

- Construct via `await DeformableOutlineWordmark.create(text, options)` (or through `createWordmark`).
- Class-specific: **`setAxis(id, value)`**, `resetAxes()`, `setPresetKey(key)`, static `await fromState(state)`.
- **Mouse-follow:** cursor **X → primary axis** (`bubbliness`).

### `AnatomyDeformWordmark` — anatomy-deform pipeline

WOFF outline + **per-letter anatomy handles**. Each drag bakes a per-glyph deformation into the outline commands (not a wrapper transform). Serves `instrumentSerif`, `bitter`, `sourceSans`, `ibmPlexMono`.

- Construct via `await AnatomyDeformWordmark.create(text, options)` (or through `createWordmark`).
- Class-specific: `resetAll()`, `resetGlyph(index)`, `setPresetKey(key)`, `setMonoCellEnabled(enabled)`, static `await fromState(state)`.
- **Handles** (filtered per preset and per letter): `height`, `width`, `serifLength`, `weight`, plus `descenderDepth` on descender letters (`g`, `j`, `p`, `q`, `y`) and `counterContour` on countered glyphs (runtime-detected).
  - `serifLength` is skipped on round-bottom letters (`o`, `c`, `e`, `s`, `g`, `O`, `C`, `S`, `Q`, `G`) and on sans/mono presets.
  - The `height` handle's label adapts per letter: _cap-height_ (A–Z), _ascender_ (`b`/`d`/`f`/`h`/`k`/`l`/`t`), _x-height_ (everything else).
- **Mouse-follow:** cursor **X → every glyph's `weight`**, cursor **Y → every glyph's `height`** (global). Per-glyph `width`/`serifLength`/`descenderDepth`/`counterContour` stay click-drag only.

### `OutlineWordmark` — static comparison

Filled WOFF outline, **no handles**. Powers the demo's "Reference outlines" toggle. Construct via `await OutlineWordmark.create(text, options)` or `renderMode: "outline-static"`. Has `setText`, `setPreset­Key`, `toSVG`, `toState`, static `fromState`, `toInteractiveBundle`.

---

## Presets

`Putty.presets` is a map keyed by preset key. Each preset object:

| Field                       | Type       | Notes                                                                                                         |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `name`                      | `string`   | The preset key (`bubbly`, `instrumentSerif`, …).                                                              |
| `fontRef`                   | `string`   | Human-facing font name (e.g. `"Instrument Serif"`).                                                           |
| `fontUrl`                   | `string`   | WOFF URL loaded at runtime (outline pipelines).                                                               |
| `license`                   | `string`   | e.g. `"OFL-1.1"`.                                                                                             |
| `copyright` / `attribution` | `string`   | Attribution strings for the loaded face.                                                                      |
| `pipeline`                  | `string`   | `"outline-deform"` or `"anatomy-deform"`. Read by the router.                                                 |
| `axes`                      | `array`    | **outline-deform only** — the global preset axes (e.g. `bubbliness`).                                         |
| `handles`                   | `string[]` | **anatomy-deform only** — the per-letter handle vocabulary, e.g. `["height","width","serifLength","weight"]`. |
| `counterContour`            | `boolean`  | **anatomy-deform only** — whether countered glyphs get a `counterContour` handle.                             |
| `defaults`                  | `object`   | Param defaults applied to any glyph not in `glyphParams` (used by `SandboxWordmark` / `none`).                |
| `glyphParams`               | `object`   | Per-character param overrides (used by `SandboxWordmark` / `none`).                                           |

The `none` preset (hand-authored fallback) carries no `fontUrl`/`pipeline` and routes to `SandboxWordmark`.

---

## State shape

`toState()` emits a **pipeline discriminator** so the matching `fromState()` can rehydrate. Shapes differ per engine:

**`AnatomyDeformWordmark`:**

```js
{
  pipeline: "anatomy-deform",
  text, color, padding, tracking, fontSize,
  preset,                 // preset key
  monoCellEnabled,
  glyphs: [{ character, handles: { height, width, serifLength, weight, descenderDepth, counterContour } }],
  modes: { mouseFollow: { enabled, opts? } },
}
```

**`DeformableOutlineWordmark`:**

```js
{
  renderMode: "outline",
  text, color, padding, tracking, fontSize,
  preset,
  axisValues: { /* e.g. bubbliness */ },
  modes: { mouseFollow: { enabled, opts? } },
  glyphs: [{ character, pathData, advance, bounds }],
}
```

**`SandboxWordmark`:**

```js
{
  text, tracking, color, padding,
  preset,                 // preset key or null
  glyphs: [{ character, params }],
}
```

`OutlineWordmark.toState()` mirrors the deformable-outline shape (static — no handles/axes). Each engine has its own static `fromState(state)` (async for the outline pipelines); `toInteractiveBundle()` embeds a call to the matching one, so generated bundles are self-contained. There is no central `Putty.fromState`.

---

## Other exports

| Export                                                                     | Purpose                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Glyph`                                                                    | Per-character instance used internally by `SandboxWordmark`.                |
| `glyphs`                                                                   | Map of registered hand-authored glyph modules.                              |
| `registerGlyph(module)` / `getRegisteredGlyphs()`                          | Register / list glyph modules for the sandbox engine.                       |
| `buildDeformedPathData(baseGlyph, axisValues, preset)`                     | The outline-deform workhorse — builds deformed path `d` from base commands. |
| `defaultAxisValuesForPreset(...)`                                          | Default axis values for an outline-deform preset.                           |
| `outlineAttributionHtml(presetKey)` / `outlineAttributionBlock(presetKey)` | Attribution markup for a loaded face.                                       |
| `OUTLINE_DISCLAIMER` / `OUTLINE_DISCLAIMER_SHORT`                          | Standard "prototype use only" disclaimer strings.                           |
