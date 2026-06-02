# Architecture

A map of this codebase. For terminology see [CONTEXT.md](../CONTEXT.md); for the rationale behind the major split see [adr/0001-per-preset-pipeline-routing.md](./adr/0001-per-preset-pipeline-routing.md); for the public surface see [API.md](./API.md).

> The four anatomy-driven presets route to `AnatomyDeformWordmark` in `lib/putty.js`. The legacy hand-authored engine is `SandboxWordmark` (a `Wordmark` alias is kept for backward compatibility) and serves only the `none` preset.

## The pipeline model

The library renders a wordmark through one of three engines. The choice is per-preset (locked at preset-definition time via `preset.pipeline`, not user-toggled), except for the static-compare mode which is independent of pipeline.

```
                     createWordmark(text, opts)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
  renderMode =          preset.pipeline =     preset.pipeline =
 "outline-static"      "outline-deform"       "anatomy-deform"
        │                     │                     │
  OutlineWordmark    DeformableOutlineWordmark  AnatomyDeformWordmark
  (static, no         (WOFF + one global         (WOFF + per-letter
   handles)            preset axis: bubbly)       anatomy handles)
                                                        │
        no preset / preset === "none"  ────────►  SandboxWordmark
                                                  (hand-authored Béziers)
```

- `OutlineWordmark` powers the demo's "Reference outlines" toggle (filled WOFF, no handles) for side-by-side comparison. Reachable for any named preset via `renderMode: "outline-static"`.
- `SandboxWordmark` is the fallback for the `none` preset (no reference font) — the hand-authored Bézier sandbox + monoline factory. A `Wordmark` export alias points at it so previously-generated `toInteractiveBundle()` HTML keeps working.

## File layout

```
putty/
├── index.html                    ← demo + in-page dev docs page; UI wiring; mount()
├── lib/putty.js                  ← entire library, single UMD-ish file (~8.2k LOC)
├── CONTEXT.md                     ← glossary
├── README.md                     ← library + demo overview; "where to read next"
├── LICENSE                        ← MIT
├── docs/
│   ├── ARCHITECTURE.md            ← this file
│   ├── API.md                     ← public surface reference
│   ├── PRODUCT_INTENT.md          ← toy, not a type-design tool
│   ├── THIRD_PARTY_FONTS.md       ← OFL attribution; font-loading
│   ├── snapshot-regression.md     ← manual visual-regression checklist
│   └── adr/
│       └── 0001-per-preset-pipeline-routing.md
└── package.json                   ← Vite dev only; one runtime dep (opentype.js)
```

## Tour of `lib/putty.js`

The single file is laid out top-to-bottom in dependency order. The file grows often, so **navigate by the named functions/classes below** — the line ranges are approximate.

| ~Lines    | Section                                            | Notes                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30–115    | UMD wrapper, registry, `Glyph`                     | Exposes `Putty` global. `registerGlyph` populates the alphabet registry; `Glyph` is one instance per character.                                                                                                                                                                       |
| 117–2140  | Curated glyph modules + geometry helpers           | Hand-authored Bézier glyphs (`a`, `n`, `o`, `s`, `h`, `i`, `e`, `t`, `r`, `l`, `w`, `d`, `b`, `c`, `m`, `g`, space) + helpers (`bboxFromPaths`, `clampAperture`, `advanceWithBearings`, …). Each module exports `{character, defaultParams, paramRanges, construct, handles, advance, bounds}`. |
| 2148–2700 | Uppercase + extra-lowercase polyline defs          | `UPPERCASE_DEFS` (2148), `EXTRA_LOWERCASE_DEFS` (2557) — normalized polylines for the monoline factory.                                                                                                                                                                                         |
| 2708–2940 | Monoline factory                                   | `createMonolineGlyph()` builds the remaining ~30 letters from polyline defs + Catmull-Rom curvature. Fallback alphabet. `curatedGlyphParams()` helper at 2939.                                                                                                                                  |
| 2948–3290 | Outline runtime helpers                            | `setOpentypeParser`, attribution/disclaimer constants, `_fontCache`, `outlineAttributionBlock`.                                                                                                                                                                                                 |
| 3300–3915 | Outline deformation core                           | `applyBubbliness` (3300), dense subpath sampling, serif extras, preset-axis application.                                                                                                                                                                                                        |
| 3919–4100 | `buildDeformedPathData`                            | Builds deformed path data per axis change (the outline-deform workhorse; also reused by anatomy-deform path resolution).                                                                                                                                                                        |
| 4108–4880 | Preset definitions                                 | The five presets (`bubbly` 4108, `instrumentSerif` 4265, `sourceSans` 4423, `bitter` 4572, `ibmPlexMono` 4731) + their `pipeline`, `handles`/`axes`, `defaults`, `glyphParams`.                                                                                                                 |
| 4882–4912 | Preset registry + `resolvePresetParams`            | `presets` const (4882); `resolvePresetParams` merges `defaults` then overlays `glyphParams[ch]`.                                                                                                                                                                                                |
| 4913–5624 | `class SandboxWordmark` (alias `Wordmark`)         | Hand-authored Bézier sandbox. Serves only the `none` preset. Layout, render, drag, mouse-follow, `setText`/`setPreset`/`toSVG`/`toState`/`toInteractiveBundle`.                                                                                                                                 |
| 5625–6391 | `class DeformableOutlineWordmark`                  | Outline-deform pipeline (`bubbly`). Loads WOFF, builds deformed path data per axis change, right-side axis handle, mouse-follow → primary axis. `setAxis`, static `fromState`.                                                                                                                  |
| 6392–7835 | `class AnatomyDeformWordmark`                      | Anatomy-deform pipeline (the four readable-text faces). WOFF outline + per-letter anatomy handles (`height`/`width`/`serifLength`/`weight`/`descenderDepth`/`counterContour`); per-glyph deformations baked into the outline commands; mono-cell toggle; static `fromState`.                    |
| 7836–8081 | `class OutlineWordmark`                            | Static comparison only. Filled WOFF paths, no handles.                                                                                                                                                                                                                                          |
| 8082–end  | `createWordmark()` router + registration + exports | Dispatches on `renderMode` / `preset.pipeline`. Registers glyphs. Returns the public surface (see API.md).                                                                                                                                                                                      |

## How the demo wires it together

`index.html` is a single page with inline `<script>`. Key responsibilities:

1. Loads `lib/putty.js` and `opentype.js` (CDN, for outline parsing).
2. Custom combobox (preset picker) — hidden `<select>` for accessibility + a styled `<button>`/`<ul>` for the visible UI. Each option renders in its preset's `fontRef` web font.
3. `mount()` — given current text + preset + mode toggles, calls `createWordmark()` and replaces `#stage` SVG. Always tears down mouse-follow on the previous instance to avoid orphaned `window` listeners.
4. Toggle controls — "Reference outlines" (static compare), "Mouse follow", and the `ibmPlexMono`-only "mono cell" toggle.
5. Reset, hex color input, Export code (downloads `toInteractiveBundle()` HTML).

## When you change something, where the change lives

| Goal                                          | File / region                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tune a preset's mood                          | `lib/putty.js` preset definitions (~4108–4880) — edit `defaults` / `glyphParams` / `axes`     |
| Change a preset's handle vocabulary           | The preset's `handles:` array (anatomy-deform) or `axes:` block (outline-deform)               |
| Add/adjust per-letter anatomy-handle math     | `AnatomyDeformWordmark` (~6392) — `_resolveGlyphPath` and the band/region helpers              |
| Add a new preset axis (outline-deform)        | `applyPresetAxesToCommands` / `buildDeformedPathData` + the preset's `axes:` block             |
| Change which pipeline a preset uses           | The preset object's `pipeline` field + the router in `createWordmark()` (~8082). See ADR 0001. |
| Wire a new demo control                       | `index.html` inline script + `mount()`                                           |
| Add a new hand-authored glyph (`none` preset) | Register near the curated section; export `bounds()` (required since Sprint 2)                 |
