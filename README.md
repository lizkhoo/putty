# Putty

A small JavaScript library for playing with letterforms, plus a demo site built on top of it. Pick one of five open-source reference fonts, drag the handles, watch the wordmark respond — then embed the library yourself or export a self-contained interactive bundle.

## Run it

```bash
git clone https://github.com/lizkhoo/putty.git
cd putty
npm install
npm run dev
# open http://127.0.0.1:5173/index.html
```

One library file (`lib/putty.js`) plus a demo page (`index.html`) that doubles as in-page developer docs. No build step beyond Vite.

## What it does

Pick a starting point (`Rubik Bubbles`, `Instrument Serif`, `Source Sans 3`, `Bitter`, `IBM Plex Mono`, or `Parametric letters`). Type a word. Drag the handles. Hit **Export code** to download a self-contained interactive HTML bundle.

## License & attribution

The library and demo are this repository's own code, released under the [MIT License](LICENSE). Reference font outlines are loaded at runtime from open-source faces under SIL OFL 1.1 — see [`docs/THIRD_PARTY_FONTS.md`](docs/THIRD_PARTY_FONTS.md) for full attribution. **Prototype use only**; do not redistribute exported outlines as a substitute for licensing the original fonts.
