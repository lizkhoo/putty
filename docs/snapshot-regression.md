# Regression snapshots (manual)

Automated `toSVG()` snapshot tests are deferred. Until a small runner exists, use this checklist after outline-deformation or param-engine changes.

## Setup

1. `npm run dev` → open `http://127.0.0.1:5173/index.html`
2. Text: `Hello jazz`
3. Default: deformable outline (reference face preset, **Static compare** off)

## Per preset (deformable outline)

For each preset (`bubbly`, `instrumentSerif`, `sourceSans`, `bitter`, `ibmPlexMono`):

1. Select reference face, click **Reset letters**
2. Drag primary axis to `0`, `0.5`, `1` (slider + right-side handle)
3. Export code or screenshot `#stage` SVG
4. Note filename: `snap-{preset}-axis-{value}-hello-jazz.svg`

| Preset | Primary axis |
|--------|----------------|
| `bubbly` | Bubbliness |
| `instrumentSerif`, `bitter` | Serif length |
| `sourceSans`, `ibmPlexMono` | Width |

## Parametric mode (`none` preset)

1. Select **Parametric letters (no reference font)**
2. Curvature toggle: **on** (unless testing straight monoline)
3. Reset, screenshot, spot-check aperture / mouse follow (tangent only)

## Spot checks

| Check | What to verify |
|-------|----------------|
| `bubbly` bubbliness | At `0` the outline matches Rubik Bubbles as-is; at `0.5` ~10 sine-wave bumps ripple around each contour; at `1` ~20 bumps with 6%-of-glyph amplitude |
| `instrumentSerif` / `bitter` | Serif stubs grow at axis 1 |
| Mouse follow (outline) | Primary axis tracks cursor X |
| Mouse follow (parametric) | Tangent handles only |
| Static compare | Filled paths, no handles |
| Reset (outline) | Axis defaults restored |

Store exports under `docs/snapshots/` if you want a repo baseline (gitignored by default).
