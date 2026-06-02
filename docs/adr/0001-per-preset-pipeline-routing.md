# ADR 0001 — Per-preset pipeline routing

**Status:** Accepted (2026-05-27, ratified after the α/γ prototype comparison)

**Background:** Ratified after a prototype comparison of two candidate approaches. Path α (WOFF + per-letter anatomy handles) was directionally correct; path γ (extended outline-deform with multi-axis sliders) was less faithful to the picked font's anatomy at the per-letter level. The parametric pipeline in this ADR refers specifically to path α as defined below.

## Context

The library began with two rendering engines (`SandboxWordmark` — formerly `Wordmark` — for parametric hand-authored Bézier glyphs, and `DeformableOutlineWordmark` for WOFF + a single global axis). A third — the **path α engine, `AnatomyDeformWordmark`** — was validated in a throwaway prototype and is the chosen production target. It ships in `lib/putty.js`.

Until this ADR, the demo wired **every named font preset** to `DeformableOutlineWordmark`. Per-letter anatomy handles were only reachable via the `none` preset's `Wordmark` engine, AND that hand-authored output didn't visually match the named font — the hand-authored alphabet is not derived from any WOFF. The "scrubbed" sensation from the owner came from picking Instrument Serif and getting either (a) the WOFF with only a global slider, or (b) — via `none` — a generic monoline-with-serifs that didn't read as Instrument Serif.

The α/γ prototype (2026-05-26 → 2026-05-27) put both candidate fixes side-by-side. **Path α won.** Dragging a per-letter handle on the actual loaded Instrument Serif `a` is the experience the owner wanted. Path γ's extra global sliders were useful but felt coarse at the per-letter scale — every letter moved together, not what the user reaches for.

In path α, the WOFF outline is the starting shape. Each glyph gets a small set of handles (height, width, serifLength, weight — filtered per preset and per letter category) anchored on its bounding box. Dragging a handle applies a per-glyph affine transform (`scaleX-left`, `scaleY-base`) or, for `weight`, a stroke overlay. The prototype's transforms are "directionally correct" — the gesture model is locked; the math underneath each handle is the production work.

## Decision

**Each preset declares its own pipeline.** The preset definition specifies whether it routes to `DeformableOutlineWordmark` (outline-deform) or to `AnatomyDeformWordmark` (anatomy-deform). The router in `createWordmark()` respects that declaration. Users do not toggle pipelines globally. The legacy `SandboxWordmark` (renamed from `Wordmark`) services the `none` preset only.

The classification rule for choosing a preset's pipeline:

> **Shape-novelty presets are outline-deform. Anatomy-driven presets are parametric.**

A preset is "shape-novelty" when the outline itself is the joke (display faces like Rubik Bubbles, or future hypothetical additions like Pixel Operator). A preset is "anatomy-driven" when the interesting tunables are letterform anatomy — serifs, x-height, bowl proportions, weight, mono-cell width.

Initial classification of the five presets:

| Preset key        | Pipeline       |
| ----------------- | -------------- |
| `bubbly`          | outline-deform |
| `instrumentSerif` | parametric     |
| `bitter`          | parametric     |
| `sourceSans`      | parametric     |
| `ibmPlexMono`     | parametric     |

Additionally:

- The two pipelines deliberately use **different handle vocabularies**. Outline-deform shows preset axes only (global slider + right-side axis handle). Parametric shows per-letter anatomy handles only. There is no global "preset axis" slider equivalent in parametric mode; if a wordmark-level tuning gesture is wanted later, it is a separate design question.
- `OutlineWordmark` (static, filled WOFF, no handles) remains available behind the "Reference outlines" toggle for side-by-side comparison in both pipelines.

## Consequences

**Positive.**

- The user gets the right vocabulary for the mood. Bubbliness on a real outline; anatomy handles on a parametric serif.
- The two pipelines stay simple internally — neither has to learn the other's handle model.
- Adding a sixth preset is a one-line classification decision against the rule above.

**Negative.**

- Two distinct interaction models the user has to learn. Mitigated by the fact that most presets (four of five) sit in parametric, so the parametric model is the default experience.
- Calibration burden: parametric presets need their `defaults` + `glyphParams` tuned so the output reads as the named font.
- The "Mouse follow" affordance behaves differently per pipeline (axis-mapped in outline-deform; tangent-only handle dragging in parametric). The pipelines diverging is intentional but cross-pipeline UX consistency requires conscious design.

## Alternatives considered

**A. All presets route to outline-deform.** _(Previous state.)_ Rejected because per-letter anatomy handles were the original pedagogical hook of the toy and disappeared from the UI under this regime. The owner specifically called this out as the foundational issue.

**B. All presets route to parametric, with the WOFF loaded only for `OutlineWordmark` static compare.** Rejected because Rubik Bubbles doesn't have a meaningful parametric expression — its visual identity is in the outline shape, not its anatomy. Parametric Rubik Bubbles would be a different font in spirit.

**C. User toggles globally between outline-deform and parametric, with the preset orthogonal.** Rejected because the two modes give meaningfully different experiences and the right mode is a function of the preset's mood, not the user's session state. A global toggle forces every user to learn a decision the library can make for them.

**D. One unified pipeline that supports both global axes and per-letter handles on top of either Bézier or outline data.** Rejected as premature. The two engines diverge in fundamental ways (where the path data comes from, what "deform" means, what a handle binds to) and merging them is a significant refactor with unclear payoff for a toy.

## Implementation notes (locked 2026-05-27)

1. **Preset schema.** Each preset declares `pipeline: 'outline-deform' | 'anatomy-deform'`. `bubbly` is `'outline-deform'`; the other four are `'anatomy-deform'`. The codename `alpha` does **not** appear in production code.
2. **New engine class:** `AnatomyDeformWordmark` (sibling of `DeformableOutlineWordmark`; not a subclass, not a mode flag). Shares WOFF-loading helpers.
3. **Router.** `createWordmark()` reads `preset.pipeline` and dispatches. The existing `mode` option (`outline-static`) is retained for the static-compare toggle.
4. **First landing math.** Port the prototype's affine + stroke transforms as-is. Production-grade math (real outline dilation for `weight`, region-clipped scale for `height`, anchor-point translation for `serifLength`, anatomy-aware partitioning for `width`) lands as four separate follow-ups in that order.
5. **Anchors.** Bbox-derived by default; per-glyph overrides authored only for problem letters (`f`, `t`, capitals with overhangs, etc.).
6. **Handle vocabulary per preset:** `instrumentSerif` / `bitter` get `height`, `width`, `serifLength`, `weight`; `sourceSans` / `ibmPlexMono` get `height`, `width`, `weight`. `serifLength` skipped on round-bottom letters: `o`, `c`, `e`, `s`, `g`, `O`, `C`, `S`, `Q`, `G`. Descender letters (`g`, `j`, `p`, `q`, `y`) additionally get `descenderDepth`.
7. **Height handle label.** Adapts per letter: `cap-height` for A–Z, `ascender` for `b`/`d`/`f`/`h`/`k`/`l`/`t`, `x-height` otherwise.
8. **Mono cell.** `ibmPlexMono` exposes a wordmark-level "mono" toggle (default on). Other presets never see it.
9. **Reset.** Wordmark-level only.
10. **State.** `toState()` emits `pipeline: 'anatomy-deform'` + per-letter handle values; `fromState()` reads the discriminator before instantiating.
11. **Mouse-follow.** Anatomy-deform presets map cursor **X → `weight`** and **Y → `height`**, globally (every glyph's value updates together). Same mapping across all four. Bubbly unchanged (X → `bubbliness`).

The hand-authored engine (renamed from `Wordmark` to `SandboxWordmark`; `Wordmark` is kept as a backward-compat alias) and its glyph modules survive **only** as the engine behind the `none` preset (no reference font). The `axes` field stays on `bubbly` only; it is dead on the four anatomy-deform presets.
