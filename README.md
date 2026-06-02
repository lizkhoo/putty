# Putty

A small JavaScript **library** for playing with letterforms, plus a **demo / configurator / exporter** site (with in-page developer docs) built on top of it. Pick one of five open-source reference fonts, drag the handles, watch the wordmark respond — then embed the library yourself or export a self-contained interactive bundle. Built for curious learners and developers embedding playful demos — not for shipping production type.

> See `docs/PRODUCT_INTENT.md` for the full statement of intent. The short version: tactile exploration, vocabulary built from handles and tooltips, delight at parametric extremes. Not a path to OTF/TTF export.

## Run it

```bash
git clone https://github.com/lizkhoo/putty.git
cd putty
npm install
npm run dev
# open http://127.0.0.1:5173/index.html
```

This is a small JS **library** (`lib/putty.js`, one file, ~8.2k LOC, UMD-ish) plus a **demo / configurator / exporter** site (`index.html`) that doubles as in-page developer docs. Embed the library yourself, or use the site to tune a wordmark and export a self-contained HTML bundle. There is no build step beyond Vite dev tooling. For the embedding API, see **[`docs/API.md`](docs/API.md)**.

## Where to read next

1. **[`docs/PRODUCT_INTENT.md`](docs/PRODUCT_INTENT.md)** — what this project is and isn't. Read first.
2. **[`CONTEXT.md`](CONTEXT.md)** — glossary of canonical terms (preset, pipeline, anatomy handle, preset axis, mood tuning). Disambiguates fuzzy language before you touch code.
3. **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — file-by-file map of `lib/putty.js` and the demo page; the per-preset pipeline model (outline-deform vs anatomy-deform, plus the static-compare and sandbox engines).
4. **[`docs/API.md`](docs/API.md)** — public surface reference for embedding the library: the `createWordmark` router, the engine classes, presets, and state shapes.
5. **[`docs/adr/`](docs/adr/)** — Architecture Decision Records. Read before changing the public API or the pipeline model. ADR 0001 (per-preset pipeline routing) is **accepted**.
6. **[`docs/snapshot-regression.md`](docs/snapshot-regression.md)** — manual visual-regression checklist. Run after any change to outline deformation or the anatomy-handle math.
7. **[`docs/THIRD_PARTY_FONTS.md`](docs/THIRD_PARTY_FONTS.md)** — OFL attribution and the runtime font-loading model.

## What the demo does

Pick a **starting point** (`Rubik Bubbles`, `Instrument Serif`, `Source Sans 3`, `Bitter`, `IBM Plex Mono`, or `Parametric letters`). Type a word. Drag the handles. Hit **Export code** to download a self-contained interactive HTML bundle (no CDN dependencies for the parametric path; one CDN dep — opentype.js — for the outline path).

## License

The library and demo are this repository's own code, released under the [MIT License](LICENSE). Reference font outlines are loaded at runtime from open-source faces under SIL OFL 1.1 — see `docs/THIRD_PARTY_FONTS.md` for attribution. **Prototype use only**; do not redistribute exported outlines as a substitute for licensing the original fonts.
