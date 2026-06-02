# Third-party fonts

Putty loads open-source reference fonts in **outline mode** (default). Outlines are extracted at runtime via [opentype.js](https://github.com/opentypejs/opentype.js) for prototype experimentation and visual comparison — **not** for redistribution as a font, commercial typesetting, or trademark use.

## Prototype disclaimer

> **PROTOTYPE / EXPERIMENTATION ONLY.** Reference font outlines are shown for visual comparison and learning. Do not use exported SVG paths or embedded bundles as a substitute for licensing the original fonts for production work. This project is a learning toy, not a font product.

## Font starters

| Key | Display name | License | Copyright / attribution |
|-----|--------------|---------|-------------------------|
| `bubbly` | Rubik Bubbles | [OFL-1.1](https://openfontlicense.org/) | Copyright 2022 The Rubik Bubbles Project Authors. Rubik Bubbles by NaN, Rubik Bubbles Project Authors. |
| `instrumentSerif` | Instrument Serif | [OFL-1.1](https://openfontlicense.org/) | Copyright 2022 The Instrument Serif Project Authors. Instrument Serif by Instrument. |
| `sourceSans` | Source Sans 3 | [OFL-1.1](https://openfontlicense.org/) | Copyright 2023 The Source Sans 3 Project Authors (Adobe). Source Sans 3 by Paul D. Hunt, Adobe. |
| `bitter` | Bitter | [OFL-1.1](https://openfontlicense.org/) | Copyright 2011 The Bitter Project Authors. Bitter by Huerta Tipográfica. |
| `ibmPlexMono` | IBM Plex Mono | [OFL-1.1](https://openfontlicense.org/) | Copyright 2017 IBM Corp. IBM Plex Mono by IBM. |

Font files are fetched at runtime from [@fontsource](https://fontsource.org/) WOFF packages on jsDelivr (latin 400). We do not ship font binaries in this repository.

## License texts

Full license texts belong in your deployment if you redistribute exports containing third-party outlines. Source copies:

- [SIL Open Font License 1.1](https://openfontlicense.org/ofl-1.1/)

## Parametric mode

Choosing **Parametric letters (no reference font)** uses hand-authored Bézier parameters only — no third-party outlines are loaded.

## Library constants

`Putty.OUTLINE_DISCLAIMER` and `Putty.OUTLINE_DISCLAIMER_SHORT` are embedded in `lib/putty.js` and included in outline exports (`toSVG`, `toInteractiveBundle`).
