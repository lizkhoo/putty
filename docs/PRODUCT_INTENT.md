# Product intent

**Putty is a toy, not a professional type-design tool.**

It lets curious learners — people who are not type designers — play with letterforms and discover parts of anatomy through direct manipulation. Success is tactile exploration, vocabulary built from handles and tooltips, and delight at parametric extremes. It is not a path to shipping text fonts, full axis systems, or studio-grade workflows.

## Primary experience (per-preset pipeline routing)

The library loads **real open-source reference font outlines** (via opentype.js) and each preset declares the **pipeline** it routes through — the right gesture for that preset's mood, not a single global default. See [ADR 0001](adr/0001-per-preset-pipeline-routing.md).

- **Anatomy-deform** (the four readable-text faces — Instrument Serif, Bitter, Source Sans 3, IBM Plex Mono): the WOFF outline is the starting shape, and **per-letter anatomy handles** (height, width, serifLength, weight, …) let users grab and deform individual letters in place. This is the default experience.
- **Outline-deform** (shape-novelty faces — Rubik Bubbles): a single global **preset axis** (bubbliness) deforms the whole wordmark. Per-letter handles aren't what the user reaches for here.

Drag handles and optional mouse-follow map to the loaded paths — not to a separate hand-drawn alphabet. A **static reference-outline** mode remains for side-by-side comparison (no handles). **Parametric letters** (the `none` preset, no reference font) are a fallback and pedagogy mode: hand-authored + monoline glyphs with per-letter anatomy handles.

## Audience

- Non–type-designers, students, and curious makers
- Developers embedding a playful wordmark demo
- Contributors improving interaction, pedagogy, and discoverability

**Not the primary audience:** type designers evaluating production font quality, OpenType feature completeness, or professional kerning/contrast systems.

## What success looks like

- Selecting a reference face and seeing **that font’s outline**, then morphing it with clear axes
- Dragging axis handles (or mouse-follow) and seeing immediate, legible feedback
- Learning terms via tooltips and experimentation
- Fun at extremes without breaking the toy’s purpose
- Export as a shareable embed or curiosity artifact, not as a font source file

## What is explicitly out of scope

- Shipping a complete text font or variable-font product
- Full contrast axes, pair kerning, optical sidebearing systems, ink traps, OTF/TTF export
- Per-anchor editing of every outline point (vector-font-editor scope)
- Professional QA bars (hinting, cross-platform rendering parity, large multilingual coverage)

## Guidance for contributors and reviewers

When reviewing or extending this project:

1. **Respect each preset's declared pipeline** (per-letter anatomy handles for the readable faces; a global preset axis for shape-novelty faces). Keep the `SandboxWordmark` engine for the `none` preset and fallback glyphs. See [ADR 0001](adr/0001-per-preset-pipeline-routing.md).
2. **Distinguish gaps:** “Missing for a font” ≠ “Missing for this toy.”
3. **Type-design expertise still applies** for naming anatomy, mapping params to design language, and spotting when extremes confuse learners.
4. **Do not refactor toward a full font editor** unless the user explicitly changes this intent.

## Related docs

- `docs/adr/0001-per-preset-pipeline-routing.md` — the per-preset pipeline routing decision
- `docs/API.md` — public surface reference for embedding the library
- `docs/THIRD_PARTY_FONTS.md` — OFL attribution for reference faces
