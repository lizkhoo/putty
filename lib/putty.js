/**
 * Putty — a small library for tactile, parametric letterforms.
 * ─────────────────────────────────────────────
 * Pick a reference font, drag the anatomy handles, watch the wordmark
 * respond — then embed it or export a self-contained interactive bundle.
 *
 * Loads as a UMD-ish global `Putty` (script tag) or via `import` (module).
 * Public surface: see docs/API.md. Architecture: see docs/ARCHITECTURE.md.
 *
 * MIT licensed. Reference font outlines are loaded at runtime under SIL OFL 1.1
 * — see docs/THIRD_PARTY_FONTS.md for attribution.
 */

(function (root, factory) {
  if (typeof exports === "object" && typeof module === "object") {
    module.exports = factory();
  } else {
    root.Putty = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // Measure the rendered width (in user units) of `text` at the given SVG
  // text styling by briefly inserting a probe <text> into `layer`. Used to
  // size tooltip bubbles from real metrics instead of a fixed per-char
  // estimate, so long labels don't overflow. Falls back to a monospace
  // estimate when measurement isn't available (detached SVG / no layout).
  function measureSvgText(layer, text, fontSize, opts) {
    const o = opts || {};
    const fallback = String(text).length * fontSize * 0.62;
    if (!layer || typeof document === "undefined") return fallback;
    try {
      const probe = document.createElementNS(SVG_NS, "text");
      probe.setAttribute("x", "-9999");
      probe.setAttribute("y", "-9999");
      probe.setAttribute("font-size", String(fontSize));
      if (o.fontFamily) probe.setAttribute("font-family", o.fontFamily);
      if (o.fontWeight) probe.setAttribute("font-weight", o.fontWeight);
      if (o.letterSpacing)
        probe.setAttribute("letter-spacing", o.letterSpacing);
      probe.textContent = String(text);
      layer.appendChild(probe);
      const w = probe.getComputedTextLength();
      layer.removeChild(probe);
      return w > 0 ? w : fallback;
    } catch {
      return fallback;
    }
  }

  // Give the generated stage SVG an accessible name + role. Static renders
  // are a single image (role="img"); interactive renders are a labelled
  // group so the focusable per-letter glyph buttons inside stay exposed to AT
  // (role "img" would collapse the SVG into one opaque image and hide them).
  // Each deformable glyph <g> is rendered as a keyboard-operable button
  // (tabindex/role/aria-label + arrow-key handler), so the group's operable
  // children are the letters themselves.
  function describeWordmarkSvg(svgEl, text, interactive) {
    if (!svgEl || typeof svgEl.setAttribute !== "function") return;
    const t = String(text || "").trim();
    svgEl.setAttribute("role", interactive ? "group" : "img");
    svgEl.setAttribute(
      "aria-label",
      (interactive ? "Editable wordmark" : "Wordmark") +
        (t ? ': "' + t + '"' : "")
    );
  }

  // camelCase param/axis id → readable words, for accessible handle names.
  function humanizeHandleId(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase();
  }

  // Make an SVG handle hit-circle keyboard-operable (a11y). The circle gets
  // button semantics + an accessible name; arrow keys drive `onNudge(dir,
  // mult)` where dir is +1 (Right/Up) or -1 (Left/Down) and mult is 10 while
  // Shift is held (coarse step). The nudge callback owns applying the value
  // and re-rendering; because a re-render rebuilds the handle layer and drops
  // focus, the callback is responsible for restoring focus to the equivalent
  // handle afterwards.
  function makeHandleKeyboardOperable(circle, label, onNudge) {
    circle.setAttribute("role", "button");
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("aria-label", label);
    // Draw a visible focus ring on the (otherwise invisible) hit-circle so
    // keyboard focus is discernible without relying on inconsistent UA
    // focus outlines for SVG elements.
    circle.addEventListener("focus", () => {
      circle.setAttribute("stroke", "#1a2f6e");
      circle.setAttribute("stroke-width", "2");
      circle.setAttribute("stroke-dasharray", "3 2");
    });
    circle.addEventListener("blur", () => {
      circle.setAttribute("stroke", "none");
      circle.removeAttribute("stroke-width");
      circle.removeAttribute("stroke-dasharray");
    });
    circle.addEventListener("keydown", (ev) => {
      let dir = 0;
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") dir = 1;
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") dir = -1;
      else return;
      ev.preventDefault();
      onNudge(dir, ev.shiftKey ? 10 : 1);
    });
  }

  // Captured at module-load time so async exports can find the library source.
  const _SELF_SRC =
    typeof document !== "undefined" && document.currentScript
      ? document.currentScript.src
      : null;

  // ════════════════════════════════════════════════════════════════════
  // Registry
  // ════════════════════════════════════════════════════════════════════
  const registry = Object.create(null);
  function registerGlyph(module) {
    registry[module.character] = module;
  }
  function getRegisteredGlyphs() {
    return Object.keys(registry);
  }

  // ════════════════════════════════════════════════════════════════════
  // Glyph instance
  // ════════════════════════════════════════════════════════════════════
  class Glyph {
    constructor(module, initialParams) {
      this.module = module;
      this.character = module.character;
      this.params = Object.assign(
        {},
        module.defaultParams,
        initialParams || {}
      );
      this._clampAll();
    }
    set(name, value) {
      if (!(name in this.params)) {
        throw new Error(
          "Unknown param '" + name + "' for glyph '" + this.character + "'"
        );
      }
      const r = this.module.paramRanges[name];
      this.params[name] = Math.max(r.min, Math.min(r.max, value));
    }
    setMany(updates) {
      for (const k of Object.keys(updates)) {
        if (typeof updates[k] === "number" && k in this.params)
          this.set(k, updates[k]);
      }
    }
    reset() {
      this.params = Object.assign({}, this.module.defaultParams);
    }
    construct() {
      return this.module.construct(this.params);
    }
    handles() {
      return this.module.handles(this.params);
    }
    advance() {
      return this.module.advance(this.params);
    }
    /** Sprint 2 fix #1 — explicit bounds, no more param-name heuristics. */
    bounds() {
      return this.module.bounds(this.params);
    }
    get paramRanges() {
      return this.module.paramRanges;
    }
    get tangentParams() {
      return this.module.tangentParams || [];
    }
    _clampAll() {
      for (const k of Object.keys(this.params)) {
        const r = this.module.paramRanges[k];
        if (r)
          this.params[k] = Math.max(r.min, Math.min(r.max, this.params[k]));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Bounds helpers
  // ════════════════════════════════════════════════════════════════════
  /**
   * For glyph modules that don't supply a tight bounds(), this walks the
   * SVG path d-strings and the handle anchors to compute a loose bbox.
   * Modules SHOULD supply their own bounds() for accuracy — this is the floor.
   */
  function bboxFromPaths(ds, strokeWeight) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const re = /-?\d+(\.\d+)?/g;
    for (const d of ds) {
      const nums = d.match(re);
      if (!nums) continue;
      for (let i = 0; i < nums.length; i += 2) {
        const x = parseFloat(nums[i]);
        const y = parseFloat(nums[i + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const pad = strokeWeight / 2;
    return {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad,
    };
  }

  const KAPPA = 0.5523;

  /** Keep counters from fully closing; scales with stroke weight. */
  function clampAperture(aperture, strokeWeight, bowlHeight) {
    const min = Math.max(8, strokeWeight * 0.5);
    const max = Math.max(min + 2, bowlHeight * 1.65);
    return Math.max(min, Math.min(aperture, max));
  }

  function advanceWithBearings(p, base) {
    return (p.leftBearing || 0) + base + (p.rightBearing || 0);
  }

  /** Blend advance toward mono cell without forcing wide letters to a full cell. */
  function monoAdjustedAdvance(baseAdv, monoCell) {
    if (!monoCell || monoCell <= 0) return baseAdv;
    const blend = 0.55;
    return baseAdv + (monoCell - baseAdv) * blend;
  }

  /** Parametric serif stubs (horizontal strokes at terminals). */
  function appendSerifStubs(paths, stubs) {
    for (const s of stubs) {
      if (!s.len || s.len <= 0) continue;
      const half = s.len / 2;
      if (s.side === "left" || s.side === "both") {
        paths.push(`M ${s.x - half} ${s.y} L ${s.x} ${s.y}`);
      }
      if (s.side === "right" || s.side === "both") {
        paths.push(`M ${s.x} ${s.y} L ${s.x + half} ${s.y}`);
      }
    }
    return paths;
  }

  const BEARING_RANGE = { min: -10, max: 24 };
  const SERIF_RANGE = { min: 0, max: 28 };

  // ════════════════════════════════════════════════════════════════════
  // CURATED GLYPHS  (hand-authored — keep the rich Bezier+tangent vocabulary)
  // ════════════════════════════════════════════════════════════════════

  // ─── 'a' ──────────────────────────────────────────────────────────────
  // CHANGE [Sprint 1, fix #3]: bowlTopTension now drives BOTH the outgoing
  // tangent from A0 and the incoming tangent toward A1. Original repo only
  // applied it to the outgoing tangent → asymmetric stretch on drag.
  const a = (function () {
    const defaultParams = {
      xHeight: 140,
      bowlWidth: 55,
      bowlHeight: 55,
      strokeWeight: 24,
      aperture: 16,
      terminalLength: 20,
      bowlTopTension: 0.5523,
      bowlBottomTension: 0.5523,
      terminalArm: 12,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const paramRanges = {
      xHeight: { min: 80, max: 200 },
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      aperture: { min: 0, max: 80 },
      terminalLength: { min: 0, max: 60 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlBottomTension: { min: 0.15, max: 1.4 },
      terminalArm: { min: 2, max: 40 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function geom(p) {
      const hs = p.strokeWeight / 2;
      const bowlLeft = hs,
        bowlCenterX = hs + p.bowlWidth,
        bowlRight = hs + 2 * p.bowlWidth;
      const bowlCenterY = -p.bowlHeight;
      const aperture = clampAperture(p.aperture, p.strokeWeight, p.bowlHeight);
      return {
        hs,
        bowlLeft,
        bowlCenterX,
        bowlRight,
        bowlCenterY,
        apertureHalf: aperture / 2,
        stemX: bowlRight,
        bowlTop: bowlCenterY - p.bowlHeight,
        bowlBottom: bowlCenterY + p.bowlHeight,
        stemTopY: -p.xHeight,
      };
    }
    function construct(p) {
      const g = geom(p);
      const A0 = { x: g.bowlCenterX, y: g.bowlTop };
      const A1 = { x: g.bowlRight, y: g.bowlCenterY - g.apertureHalf };
      const A2 = { x: g.bowlRight, y: g.bowlCenterY + g.apertureHalf };
      const A3 = { x: g.bowlCenterX, y: g.bowlBottom };
      const A4 = { x: g.bowlLeft, y: g.bowlCenterY };
      const tTop = p.bowlWidth * p.bowlTopTension;
      const tH = p.bowlHeight * p.bowlTopTension;
      const tBot = p.bowlHeight * p.bowlBottomTension;
      const tBw = p.bowlWidth * p.bowlBottomTension;
      const paths = [
        [
          `M ${A0.x} ${A0.y}`,
          `C ${A0.x + tTop} ${A0.y}, ${A1.x} ${A1.y - tH}, ${A1.x} ${A1.y}`,
          `M ${A2.x} ${A2.y}`,
          `C ${A2.x} ${A2.y + tBot}, ${A3.x + tBw} ${A3.y}, ${A3.x} ${A3.y}`,
          `C ${A3.x - tBw} ${A3.y}, ${A4.x} ${A4.y + tBot}, ${A4.x} ${A4.y}`,
          `C ${A4.x} ${A4.y - tH}, ${A0.x - tTop} ${A0.y}, ${A0.x} ${A0.y}`,
        ].join(" "),
      ];
      let stem = `M ${g.stemX} ${g.stemTopY} L ${g.stemX} 0`;
      if (p.terminalLength > 0) {
        const tl = p.terminalLength,
          arm = p.terminalArm;
        const endX = g.stemX + tl,
          endY = -tl * 0.14;
        stem += ` C ${g.stemX + arm / Math.SQRT2} ${arm / Math.SQRT2}, ${endX - arm * 0.5} ${endY + arm * 0.05}, ${endX} ${endY}`;
      }
      paths.push(stem);
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: g.stemX, y: 0, len: p.serifLength, side: "both" },
          { x: g.bowlLeft, y: 0, len: p.serifLength * 0.7, side: "left" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const g = geom(p);
      const tTop = p.bowlWidth * p.bowlTopTension;
      const midStemY = (g.stemTopY + 0) / 2;
      const list = [
        {
          id: "xHeight",
          anchor: { x: g.stemX, y: g.stemTopY },
          control: { x: g.stemX, y: g.stemTopY - 18 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "bowlWidth",
          anchor: { x: g.bowlLeft, y: g.bowlCenterY },
          control: { x: g.bowlLeft - 18, y: g.bowlCenterY },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: { x: g.bowlCenterX, y: g.bowlTop },
          control: { x: g.bowlCenterX, y: g.bowlTop - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "strokeWeight",
          anchor: { x: g.stemX, y: midStemY },
          control: { x: g.stemX + p.strokeWeight / 2 + 6, y: midStemY },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "aperture",
          anchor: { x: g.bowlRight, y: g.bowlCenterY - g.apertureHalf },
          control: { x: g.bowlRight, y: g.bowlCenterY + g.apertureHalf },
          paramName: "aperture",
          deltaFromDrag: (_, dy) => 2 * dy,
        },
        {
          id: "terminalLength",
          anchor: { x: g.stemX, y: 0 },
          control: {
            x: g.stemX + p.terminalLength,
            y: -p.terminalLength * 0.14,
          },
          paramName: "terminalLength",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "bowlTopTension",
          anchor: { x: g.bowlCenterX, y: g.bowlTop },
          control: { x: g.bowlCenterX + tTop, y: g.bowlTop },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlBottomTension",
          anchor: { x: g.bowlCenterX, y: g.bowlBottom },
          control: {
            x: g.bowlCenterX + p.bowlWidth * p.bowlBottomTension,
            y: g.bowlBottom,
          },
          paramName: "bowlBottomTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "terminalArm",
          anchor: { x: g.stemX, y: 0 },
          control: {
            x: g.stemX + p.terminalArm / Math.SQRT2,
            y: p.terminalArm / Math.SQRT2,
          },
          paramName: "terminalArm",
          deltaFromDrag: (dx, dy) => dx + dy,
          isTangent: true,
        },
      ];
      if (p.serifLength > 0) {
        list.push({
          id: "serifLength",
          anchor: { x: g.stemX, y: 0 },
          control: { x: g.stemX + p.serifLength, y: 0 },
          paramName: "serifLength",
          deltaFromDrag: (dx) => dx,
        });
      }
      return list;
    }
    function bounds(p) {
      const g = geom(p);
      const halfStroke = p.strokeWeight / 2;
      const serifPad = p.serifLength / 2;
      return {
        minX: -halfStroke - serifPad,
        maxX: g.stemX + halfStroke + Math.max(0, p.terminalLength) + serifPad,
        minY: -p.xHeight - halfStroke,
        maxY: halfStroke,
      };
    }
    function baseAdvance(p) {
      return (
        p.strokeWeight +
        2 * p.bowlWidth +
        p.strokeWeight / 2 +
        Math.max(0, p.terminalLength)
      );
    }
    return {
      character: "a",
      defaultParams,
      paramRanges,
      tangentParams: ["bowlTopTension", "bowlBottomTension", "terminalArm"],
      construct,
      handles,
      advance: (p) => advanceWithBearings(p, baseAdvance(p)),
      bounds,
    };
  })();

  // ─── 'n' ──────────────────────────────────────────────────────────────
  const n = makeArchGlyph("n", { hasAscender: false });
  // ─── 'h' ──────────────────────────────────────────────────────────────
  const h = makeArchGlyph("h", { hasAscender: true });

  function makeArchGlyph(character, opts) {
    const dp = {
      xHeight: 140,
      archWidth: 85,
      strokeWeight: 24,
      shoulder: 40,
      archTension: 0.5523,
    };
    if (opts.hasAscender) {
      dp.ascenderRise = 50;
      dp.capOvershoot = 2;
    }
    const ranges = {
      xHeight: { min: 80, max: 200 },
      archWidth: { min: 40, max: 130 },
      strokeWeight: { min: 6, max: 44 },
      shoulder: { min: 10, max: 80 },
      archTension: { min: 0.15, max: 1.4 },
    };
    if (opts.hasAscender) {
      ranges.ascenderRise = { min: 10, max: 100 };
      ranges.capOvershoot = { min: 0, max: 12 };
    }
    function g(p) {
      const hs = p.strokeWeight / 2;
      const leftX = hs,
        rightX = hs + p.archWidth;
      const xLineY = -p.xHeight;
      const overshoot = opts.hasAscender ? p.capOvershoot || 0 : 0;
      const stemTopY = opts.hasAscender
        ? xLineY - p.ascenderRise - overshoot
        : xLineY;
      const shoulderY = xLineY + p.shoulder;
      return { hs, leftX, rightX, xLineY, stemTopY, shoulderY };
    }
    function construct(p) {
      const gg = g(p);
      const tArm = p.archWidth * p.archTension * 0.5;
      const leftStem = `M ${gg.leftX} 0 L ${gg.leftX} ${gg.stemTopY}`;
      // CHANGE: arch tangent now actually uses archTension (the original n.ts had `void tArm`).
      const midX = (gg.leftX + gg.rightX) / 2;
      const arch = `M ${gg.leftX} ${gg.shoulderY} C ${gg.leftX} ${gg.xLineY - tArm + p.archWidth * 0.276}, ${gg.rightX} ${gg.xLineY - tArm + p.archWidth * 0.276}, ${gg.rightX} ${gg.shoulderY}`;
      const rightStem = `M ${gg.rightX} ${gg.shoulderY} L ${gg.rightX} 0`;
      void midX;
      return [leftStem, arch, rightStem];
    }
    function handles(p) {
      const gg = g(p);
      const midX = (gg.leftX + gg.rightX) / 2;
      const tArm = p.archWidth * p.archTension * 0.5;
      const midStemY = gg.shoulderY / 2;
      const list = [
        {
          id: "xHeight",
          anchor: { x: midX, y: gg.xLineY },
          control: { x: midX, y: gg.xLineY - 18 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "archWidth",
          anchor: { x: gg.rightX, y: midStemY },
          control: { x: gg.rightX + 18, y: midStemY },
          paramName: "archWidth",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.rightX, y: midStemY },
          control: { x: gg.rightX + p.strokeWeight / 2 + 6, y: midStemY },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "shoulder",
          anchor: { x: gg.leftX, y: gg.shoulderY },
          control: { x: gg.leftX - 18, y: gg.shoulderY },
          paramName: "shoulder",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "archTension",
          anchor: { x: midX, y: gg.xLineY },
          control: { x: midX + tArm, y: gg.xLineY },
          paramName: "archTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.archWidth * 0.5),
          isTangent: true,
        },
      ];
      if (opts.hasAscender) {
        list.unshift({
          id: "ascenderRise",
          anchor: { x: gg.leftX, y: gg.stemTopY },
          control: { x: gg.leftX - 18, y: gg.stemTopY },
          paramName: "ascenderRise",
          deltaFromDrag: (_, dy) => -dy,
        });
      }
      return list;
    }
    function bounds(p) {
      const gg = g(p),
        hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: gg.rightX + hs,
        minY: gg.stemTopY - hs,
        maxY: hs,
      };
    }
    return {
      character,
      defaultParams: dp,
      paramRanges: ranges,
      tangentParams: ["archTension"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + p.archWidth,
      bounds,
    };
  }

  // ─── 'o' ──────────────────────────────────────────────────────────────
  const o = (function () {
    const dp = {
      bowlWidth: 60,
      bowlHeight: 60,
      strokeWeight: 24,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
    };
    const r = {
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        cx = hs + p.bowlWidth,
        cy = -p.bowlHeight;
      return {
        hs,
        cx,
        cy,
        top: { x: cx, y: cy - p.bowlHeight },
        right: { x: cx + p.bowlWidth, y: cy },
        bottom: { x: cx, y: cy + p.bowlHeight },
        left: { x: cx - p.bowlWidth, y: cy },
      };
    }
    function construct(p) {
      const gg = g(p);
      const tw = p.bowlWidth * p.bowlTopTension;
      const th = p.bowlHeight * p.bowlSideTension;
      return [
        [
          `M ${gg.top.x} ${gg.top.y}`,
          `C ${gg.top.x + tw} ${gg.top.y}, ${gg.right.x} ${gg.right.y - th}, ${gg.right.x} ${gg.right.y}`,
          `C ${gg.right.x} ${gg.right.y + th}, ${gg.bottom.x + tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
          `C ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.left.x} ${gg.left.y + th}, ${gg.left.x} ${gg.left.y}`,
          `C ${gg.left.x} ${gg.left.y - th}, ${gg.top.x - tw} ${gg.top.y}, ${gg.top.x} ${gg.top.y}`,
          "Z",
        ].join(" "),
      ];
    }
    function handles(p) {
      const gg = g(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      return [
        {
          id: "bowlWidth",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.right.x, y: gg.cy },
          control: { x: gg.right.x + p.strokeWeight / 2 + 6, y: gg.cy },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.right,
          control: { x: gg.right.x, y: gg.right.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + 2 * p.bowlWidth - hs + hs * 2,
        minY: -2 * p.bowlHeight - hs,
        maxY: hs,
      };
    }
    return {
      character: "o",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + 2 * p.bowlWidth,
      bounds,
    };
  })();

  // ─── 's' ──────────────────────────────────────────────────────────────
  const s = (function () {
    const dp = {
      xHeight: 140,
      sWidth: 70,
      strokeWeight: 24,
      curlTop: 24,
      curlBottom: 24,
      waistTension: 0.55,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      sWidth: { min: 35, max: 100 },
      strokeWeight: { min: 6, max: 44 },
      curlTop: { min: 4, max: 50 },
      curlBottom: { min: 4, max: 50 },
      waistTension: { min: 0.15, max: 1.4 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      const leftX = hs,
        rightX = hs + p.sWidth;
      const topY = -p.xHeight + hs,
        botY = -hs;
      return { hs, leftX, rightX, topY, botY, midY: (topY + botY) / 2 };
    }
    function construct(p) {
      const gg = g(p);
      const tArm = p.sWidth * p.waistTension * 0.4;
      const TR = { x: gg.rightX, y: gg.topY + 6 };
      const TL = { x: gg.leftX, y: gg.midY };
      const MR = { x: gg.rightX, y: gg.midY };
      const BL = { x: gg.leftX, y: gg.botY - 6 };
      const top = `M ${TR.x} ${TR.y} C ${TR.x} ${TR.y - p.curlTop}, ${TL.x} ${TL.y - p.curlTop * 0.8}, ${TL.x} ${TL.y}`;
      const waist = `M ${TL.x} ${TL.y} C ${TL.x + tArm} ${TL.y}, ${MR.x - tArm} ${MR.y}, ${MR.x} ${MR.y}`;
      const bot = `M ${MR.x} ${MR.y} C ${MR.x} ${MR.y + p.curlBottom}, ${BL.x} ${BL.y + p.curlBottom * 0.8}, ${BL.x} ${BL.y}`;
      return [top, waist, bot];
    }
    function handles(p) {
      const gg = g(p);
      const tArm = p.sWidth * p.waistTension * 0.4;
      return [
        {
          id: "xHeight",
          anchor: { x: gg.rightX, y: gg.topY },
          control: { x: gg.rightX + 18, y: gg.topY },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "sWidth",
          anchor: { x: gg.rightX, y: gg.midY },
          control: { x: gg.rightX + 18, y: gg.midY },
          paramName: "sWidth",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "strokeWeight",
          anchor: { x: (gg.leftX + gg.rightX) / 2, y: gg.midY },
          control: {
            x: (gg.leftX + gg.rightX) / 2,
            y: gg.midY + p.strokeWeight / 2 + 6,
          },
          paramName: "strokeWeight",
          deltaFromDrag: (_, dy) => 2 * dy,
        },
        {
          id: "curlTop",
          anchor: { x: gg.rightX, y: gg.topY },
          control: { x: gg.rightX, y: gg.topY - p.curlTop },
          paramName: "curlTop",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "curlBottom",
          anchor: { x: gg.leftX, y: gg.botY },
          control: { x: gg.leftX, y: gg.botY + p.curlBottom },
          paramName: "curlBottom",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "waistTension",
          anchor: { x: gg.leftX, y: gg.midY },
          control: { x: gg.leftX + tArm, y: gg.midY },
          paramName: "waistTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.sWidth * 0.4),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.sWidth + hs * 2,
        minY: -p.xHeight - hs,
        maxY: p.curlBottom + hs,
      };
    }
    return {
      character: "s",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["waistTension"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + p.sWidth,
      bounds,
    };
  })();

  // ─── 'i' ──────────────────────────────────────────────────────────────
  const i_ = (function () {
    const dp = { xHeight: 140, strokeWeight: 24, dotGap: 16 };
    const r = {
      xHeight: { min: 80, max: 200 },
      strokeWeight: { min: 6, max: 44 },
      dotGap: { min: 4, max: 40 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      return {
        hs,
        stemX: hs,
        stemTopY: -p.xHeight,
        dotY: -p.xHeight - p.dotGap - p.strokeWeight,
      };
    }
    function construct(p) {
      const gg = g(p);
      return [
        `M ${gg.stemX} 0 L ${gg.stemX} ${gg.stemTopY}`,
        `M ${gg.stemX} ${gg.dotY} L ${gg.stemX} ${gg.dotY + 0.01}`,
      ];
    }
    function handles(p) {
      const gg = g(p);
      return [
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX, y: gg.stemTopY - 18 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: -p.xHeight / 2 },
          control: { x: gg.stemX + p.strokeWeight / 2 + 6, y: -p.xHeight / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "dotGap",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX, y: gg.dotY + p.strokeWeight / 2 },
          paramName: "dotGap",
          deltaFromDrag: (_, dy) => -dy,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: hs,
        minY: -p.xHeight - p.dotGap - p.strokeWeight - hs,
        maxY: hs,
      };
    }
    return {
      character: "i",
      defaultParams: dp,
      paramRanges: r,
      construct,
      handles,
      advance: (p) => p.strokeWeight,
      bounds,
    };
  })();

  // ─── 'e' ──────────────────────────────────────────────────────────────
  const e = (function () {
    const dp = {
      bowlWidth: 58,
      bowlHeight: 58,
      strokeWeight: 24,
      aperture: 28,
      crossbarOffset: 10,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const r = {
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      aperture: { min: 6, max: 60 },
      crossbarOffset: { min: -20, max: 20 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        cx = hs + p.bowlWidth,
        cy = -p.bowlHeight;
      const aperture = clampAperture(p.aperture, p.strokeWeight, p.bowlHeight);
      return {
        hs,
        cx,
        cy,
        aperture,
        top: { x: cx, y: cy - p.bowlHeight },
        left: { x: cx - p.bowlWidth, y: cy },
        bottom: { x: cx, y: cy + p.bowlHeight },
        right: { x: cx + p.bowlWidth, y: cy },
        crossbarY: cy + p.crossbarOffset,
      };
    }
    function construct(p) {
      const gg = g(p);
      const tw = p.bowlWidth * p.bowlTopTension;
      const thSide = p.bowlHeight * p.bowlSideTension;
      const thTop = p.bowlHeight * p.bowlTopTension;
      const topOpen = { x: gg.cx + p.bowlWidth, y: gg.crossbarY };
      const bottomOpen = {
        x: gg.cx + p.bowlWidth * 0.6,
        y: gg.cy + p.bowlHeight * 0.85,
      };
      const paths = [
        [
          `M ${topOpen.x} ${topOpen.y}`,
          `C ${topOpen.x} ${topOpen.y - thTop * 0.6}, ${gg.top.x + tw} ${gg.top.y}, ${gg.top.x} ${gg.top.y}`,
          `C ${gg.top.x - tw} ${gg.top.y}, ${gg.left.x} ${gg.left.y - thSide}, ${gg.left.x} ${gg.left.y}`,
          `C ${gg.left.x} ${gg.left.y + thSide}, ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
          `C ${gg.bottom.x + tw * 0.5} ${gg.bottom.y}, ${bottomOpen.x - thSide * 0.3} ${bottomOpen.y}, ${bottomOpen.x} ${bottomOpen.y}`,
        ].join(" "),
      ];
      paths.push(
        `M ${gg.left.x} ${gg.crossbarY} L ${topOpen.x} ${gg.crossbarY}`
      );
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: gg.left.x, y: 0, len: p.serifLength * 0.75, side: "left" },
          { x: topOpen.x, y: 0, len: p.serifLength, side: "right" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const gg = g(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      const list = [
        {
          id: "bowlWidth",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "strokeWeight",
          anchor: gg.right,
          control: { x: gg.right.x + p.strokeWeight / 2 + 6, y: gg.right.y },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "crossbarOffset",
          anchor: { x: gg.cx, y: gg.crossbarY },
          control: { x: gg.cx, y: gg.crossbarY + 14 },
          paramName: "crossbarOffset",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "aperture",
          anchor: { x: gg.cx + p.bowlWidth, y: gg.crossbarY },
          control: { x: gg.cx + p.bowlWidth, y: gg.crossbarY + gg.aperture },
          paramName: "aperture",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.left,
          control: { x: gg.left.x, y: gg.left.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
      if (p.serifLength > 0) {
        list.push({
          id: "serifLength",
          anchor: { x: gg.left.x, y: 0 },
          control: { x: gg.left.x - p.serifLength, y: 0 },
          paramName: "serifLength",
          deltaFromDrag: (dx) => -dx,
        });
      }
      return list;
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      const serifPad = p.serifLength / 2;
      return {
        minX: -hs - serifPad,
        maxX: p.strokeWeight + 2 * p.bowlWidth + serifPad,
        minY: -2 * p.bowlHeight - hs,
        maxY: hs,
      };
    }
    return {
      character: "e",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) => advanceWithBearings(p, p.strokeWeight + 2 * p.bowlWidth),
      bounds,
    };
  })();

  // ─── 't' ──────────────────────────────────────────────────────────────
  const t = (function () {
    const dp = {
      totalHeight: 160,
      xHeight: 140,
      capOvershoot: 2,
      strokeWeight: 24,
      crossbarLeft: 18,
      crossbarRight: 22,
      footCurl: 10,
      footArm: 8,
    };
    const r = {
      totalHeight: { min: 100, max: 220 },
      xHeight: { min: 80, max: 200 },
      capOvershoot: { min: 0, max: 12 },
      strokeWeight: { min: 6, max: 44 },
      crossbarLeft: { min: 4, max: 40 },
      crossbarRight: { min: 4, max: 40 },
      footCurl: { min: 0, max: 30 },
      footArm: { min: 2, max: 20 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      return {
        hs,
        stemX: hs + p.crossbarLeft,
        stemTopY: -p.totalHeight - (p.capOvershoot || 0),
        crossbarY: -p.xHeight,
      };
    }
    function construct(p) {
      const gg = g(p);
      let stem = `M ${gg.stemX} ${gg.stemTopY} L ${gg.stemX} 0`;
      if (p.footCurl > 0) {
        stem += ` C ${gg.stemX + p.footArm} ${p.footArm * 0.4}, ${gg.stemX + p.footCurl - 2} -2, ${gg.stemX + p.footCurl} ${-p.footCurl * 0.2}`;
      }
      const cb = `M ${gg.stemX - p.crossbarLeft} ${gg.crossbarY} L ${gg.stemX + p.crossbarRight} ${gg.crossbarY}`;
      return [stem, cb];
    }
    function handles(p) {
      const gg = g(p);
      return [
        {
          id: "totalHeight",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX, y: gg.stemTopY - 18 },
          paramName: "totalHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: gg.crossbarY },
          control: { x: gg.stemX - 18, y: gg.crossbarY - 12 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "crossbarLeft",
          anchor: { x: gg.stemX - p.crossbarLeft, y: gg.crossbarY },
          control: { x: gg.stemX - p.crossbarLeft - 12, y: gg.crossbarY },
          paramName: "crossbarLeft",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "crossbarRight",
          anchor: { x: gg.stemX + p.crossbarRight, y: gg.crossbarY },
          control: { x: gg.stemX + p.crossbarRight + 12, y: gg.crossbarY },
          paramName: "crossbarRight",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: (gg.stemTopY + 0) / 2 + 10 },
          control: {
            x: gg.stemX + p.strokeWeight / 2 + 6,
            y: (gg.stemTopY + 0) / 2 + 10,
          },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "footCurl",
          anchor: { x: gg.stemX, y: 0 },
          control: { x: gg.stemX + p.footCurl, y: -p.footCurl * 0.2 },
          paramName: "footCurl",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "footArm",
          anchor: { x: gg.stemX, y: 0 },
          control: { x: gg.stemX + p.footArm, y: p.footArm * 0.4 },
          paramName: "footArm",
          deltaFromDrag: (dx, dy) => (dx + dy * 2.5) / 2,
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX:
          p.strokeWeight +
          p.crossbarLeft +
          Math.max(p.crossbarRight, p.footCurl),
        minY: -p.totalHeight - hs,
        maxY: hs,
      };
    }
    return {
      character: "t",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["footArm"],
      construct,
      handles,
      advance: (p) =>
        p.strokeWeight + p.crossbarLeft + Math.max(p.crossbarRight, p.footCurl),
      bounds,
    };
  })();

  // ─── 'r' ──────────────────────────────────────────────────────────────
  const r_ = (function () {
    const dp = {
      xHeight: 140,
      strokeWeight: 24,
      armLength: 32,
      armRise: 18,
      armArm: 18,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      strokeWeight: { min: 6, max: 44 },
      armLength: { min: 8, max: 60 },
      armRise: { min: 0, max: 40 },
      armArm: { min: 2, max: 40 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      return {
        hs,
        stemX: hs,
        stemTopY: -p.xHeight,
        armEndY: -p.xHeight - p.armRise,
        armEndX: hs + p.armLength,
      };
    }
    function construct(p) {
      const gg = g(p);
      return [
        `M ${gg.stemX} 0 L ${gg.stemX} ${gg.stemTopY}`,
        `M ${gg.stemX} ${gg.stemTopY} C ${gg.stemX} ${gg.stemTopY - p.armArm}, ${gg.armEndX - p.armArm * 0.5} ${gg.armEndY}, ${gg.armEndX} ${gg.armEndY}`,
      ];
    }
    function handles(p) {
      const gg = g(p);
      return [
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX - 18, y: gg.stemTopY },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: -p.xHeight / 2 },
          control: { x: gg.stemX + p.strokeWeight / 2 + 6, y: -p.xHeight / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "armLength",
          anchor: { x: gg.armEndX, y: gg.armEndY },
          control: { x: gg.armEndX + 12, y: gg.armEndY },
          paramName: "armLength",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "armRise",
          anchor: { x: gg.armEndX, y: gg.armEndY },
          control: { x: gg.armEndX, y: gg.armEndY - 12 },
          paramName: "armRise",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "armArm",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX, y: gg.stemTopY - p.armArm },
          paramName: "armArm",
          deltaFromDrag: (_, dy) => -dy,
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + p.armLength,
        minY: -p.xHeight - p.armRise - hs,
        maxY: hs,
      };
    }
    return {
      character: "r",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["armArm"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + p.armLength,
      bounds,
    };
  })();

  // ─── 'l' ──────────────────────────────────────────────────────────────
  const l = (function () {
    const dp = {
      xHeight: 140,
      ascenderRise: 50,
      capOvershoot: 2,
      strokeWeight: 24,
      footCurl: 16,
      footArm: 10,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      ascenderRise: { min: 10, max: 100 },
      capOvershoot: { min: 0, max: 12 },
      strokeWeight: { min: 6, max: 44 },
      footCurl: { min: 0, max: 42 },
      footArm: { min: 2, max: 28 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      return {
        hs,
        stemX: hs,
        stemTopY: -p.xHeight - p.ascenderRise - (p.capOvershoot || 0),
      };
    }
    function construct(p) {
      const gg = g(p);
      let stem = `M ${gg.stemX} ${gg.stemTopY} L ${gg.stemX} 0`;
      if (p.footCurl > 0) {
        stem += ` C ${gg.stemX + p.footArm} ${p.footArm * 0.4}, ${gg.stemX + p.footCurl - 2} -2, ${gg.stemX + p.footCurl} ${-p.footCurl * 0.16}`;
      }
      return [stem];
    }
    function handles(p) {
      const gg = g(p);
      return [
        {
          id: "ascenderRise",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX - 18, y: gg.stemTopY },
          paramName: "ascenderRise",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: -p.xHeight },
          control: { x: gg.stemX + 18, y: -p.xHeight },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: gg.stemTopY / 2 },
          control: { x: gg.stemX + p.strokeWeight / 2 + 6, y: gg.stemTopY / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "footCurl",
          anchor: { x: gg.stemX, y: 0 },
          control: { x: gg.stemX + p.footCurl, y: -p.footCurl * 0.16 },
          paramName: "footCurl",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "footArm",
          anchor: { x: gg.stemX, y: 0 },
          control: { x: gg.stemX + p.footArm, y: p.footArm * 0.4 },
          paramName: "footArm",
          deltaFromDrag: (dx, dy) => (dx + dy * 2.5) / 2,
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + Math.max(p.footCurl, p.strokeWeight * 0.5),
        minY: -p.xHeight - p.ascenderRise - hs,
        maxY: hs,
      };
    }
    return {
      character: "l",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["footArm"],
      construct,
      handles,
      advance: (p) =>
        p.strokeWeight + Math.max(p.footCurl, p.strokeWeight * 0.5),
      bounds,
    };
  })();

  // ─── 'w' ──────────────────────────────────────────────────────────────
  const w = (function () {
    const dp = {
      xHeight: 140,
      width: 132,
      dip: 20,
      strokeWeight: 24,
      joinTension: 0.46,
      exitCurl: 18,
      exitArm: 12,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      width: { min: 80, max: 190 },
      dip: { min: 0, max: 55 },
      strokeWeight: { min: 6, max: 44 },
      joinTension: { min: 0.15, max: 1.2 },
      exitCurl: { min: 0, max: 42 },
      exitArm: { min: 2, max: 28 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        leftX = hs,
        unit = p.width / 4;
      return {
        hs,
        leftTop: { x: leftX, y: -p.xHeight },
        valley1: { x: leftX + unit, y: 0 },
        midTop: { x: leftX + unit * 2, y: -p.xHeight + p.dip },
        valley2: { x: leftX + unit * 3, y: 0 },
        rightTop: { x: leftX + unit * 4, y: -p.xHeight },
      };
    }
    function construct(p) {
      const gg = g(p),
        arm = (p.width / 4) * p.joinTension;
      let path = [
        `M ${gg.leftTop.x} ${gg.leftTop.y}`,
        `C ${gg.leftTop.x + arm} ${gg.leftTop.y}, ${gg.valley1.x - arm} ${gg.valley1.y}, ${gg.valley1.x} ${gg.valley1.y}`,
        `C ${gg.valley1.x + arm} ${gg.valley1.y}, ${gg.midTop.x - arm} ${gg.midTop.y}, ${gg.midTop.x} ${gg.midTop.y}`,
        `C ${gg.midTop.x + arm} ${gg.midTop.y}, ${gg.valley2.x - arm} ${gg.valley2.y}, ${gg.valley2.x} ${gg.valley2.y}`,
        `C ${gg.valley2.x + arm} ${gg.valley2.y}, ${gg.rightTop.x - arm} ${gg.rightTop.y}, ${gg.rightTop.x} ${gg.rightTop.y}`,
      ].join(" ");
      if (p.exitCurl > 0) {
        path += ` C ${gg.rightTop.x + p.exitArm} ${gg.rightTop.y - p.exitArm * 0.15}, ${gg.rightTop.x + p.exitCurl - 2} ${gg.rightTop.y + p.exitCurl * 0.28}, ${gg.rightTop.x + p.exitCurl} ${gg.rightTop.y + p.exitCurl * 0.2}`;
      }
      return [path];
    }
    function handles(p) {
      const gg = g(p),
        arm = (p.width / 4) * p.joinTension;
      return [
        {
          id: "xHeight",
          anchor: gg.leftTop,
          control: { x: gg.leftTop.x, y: gg.leftTop.y - 18 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "width",
          anchor: gg.rightTop,
          control: { x: gg.rightTop.x + 18, y: gg.rightTop.y },
          paramName: "width",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "dip",
          anchor: gg.midTop,
          control: { x: gg.midTop.x, y: gg.midTop.y + 18 },
          paramName: "dip",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "strokeWeight",
          anchor: gg.valley2,
          control: {
            x: gg.valley2.x + p.strokeWeight / 2 + 6,
            y: gg.valley2.y,
          },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "joinTension",
          anchor: gg.valley1,
          control: { x: gg.valley1.x + arm, y: gg.valley1.y },
          paramName: "joinTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.width / 4),
          isTangent: true,
        },
        {
          id: "exitCurl",
          anchor: gg.rightTop,
          control: {
            x: gg.rightTop.x + p.exitCurl,
            y: gg.rightTop.y + p.exitCurl * 0.2,
          },
          paramName: "exitCurl",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "exitArm",
          anchor: gg.rightTop,
          control: {
            x: gg.rightTop.x + p.exitArm,
            y: gg.rightTop.y - p.exitArm * 0.15,
          },
          paramName: "exitArm",
          deltaFromDrag: (dx, dy) => (dx - dy / 0.15) / 2,
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + p.width + Math.max(0, p.exitCurl),
        minY: -p.xHeight - hs,
        maxY: hs + Math.max(0, p.exitCurl * 0.3),
      };
    }
    return {
      character: "w",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["joinTension", "exitArm"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + p.width + Math.max(0, p.exitCurl),
      bounds,
    };
  })();

  // ─── 'd' ──────────────────────────────────────────────────────────────
  const d = (function () {
    const dp = {
      xHeight: 140,
      ascenderRise: 50,
      bowlWidth: 56,
      bowlHeight: 58,
      strokeWeight: 24,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      ascenderRise: { min: 10, max: 100 },
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        bowlLeft = hs,
        cx = bowlLeft + p.bowlWidth,
        cy = -p.bowlHeight;
      const stemX = cx + p.bowlWidth;
      return {
        hs,
        cx,
        cy,
        stemX,
        stemTopY: -p.xHeight - p.ascenderRise,
        top: { x: cx, y: cy - p.bowlHeight },
        right: { x: stemX, y: cy },
        bottom: { x: cx, y: cy + p.bowlHeight },
        left: { x: cx - p.bowlWidth, y: cy },
      };
    }
    function construct(p) {
      const gg = g(p);
      const tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      const bowl = [
        `M ${gg.top.x} ${gg.top.y}`,
        `C ${gg.top.x + tw} ${gg.top.y}, ${gg.right.x} ${gg.right.y - th}, ${gg.right.x} ${gg.right.y}`,
        `C ${gg.right.x} ${gg.right.y + th}, ${gg.bottom.x + tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
        `C ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.left.x} ${gg.left.y + th}, ${gg.left.x} ${gg.left.y}`,
        `C ${gg.left.x} ${gg.left.y - th}, ${gg.top.x - tw} ${gg.top.y}, ${gg.top.x} ${gg.top.y}`,
        "Z",
      ].join(" ");
      const stem = `M ${gg.stemX} 0 L ${gg.stemX} ${gg.stemTopY}`;
      return [bowl, stem];
    }
    function handles(p) {
      const gg = g(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      return [
        {
          id: "ascenderRise",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX + 18, y: gg.stemTopY },
          paramName: "ascenderRise",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: -p.xHeight },
          control: { x: gg.stemX - 18, y: -p.xHeight },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "bowlWidth",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: gg.stemTopY / 2 },
          control: { x: gg.stemX + p.strokeWeight / 2 + 6, y: gg.stemTopY / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.right,
          control: { x: gg.right.x, y: gg.right.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + 2 * p.bowlWidth + hs,
        minY: -p.xHeight - p.ascenderRise - hs,
        maxY: hs,
      };
    }
    return {
      character: "d",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) => p.strokeWeight + 2 * p.bowlWidth,
      bounds,
    };
  })();

  // ─── 'b' — stem + right bowl (curated) ────────────────────────────────
  const b = (function () {
    const dp = {
      xHeight: 140,
      bowlWidth: 52,
      bowlHeight: 54,
      strokeWeight: 24,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
      shoulder: 36,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      shoulder: { min: 10, max: 80 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        stemX = hs,
        bowlRight = stemX + p.bowlWidth * 2;
      const cy = -p.xHeight + p.shoulder;
      return {
        hs,
        stemX,
        bowlRight,
        cy,
        stemTopY: -p.xHeight,
        top: { x: bowlRight - p.bowlWidth, y: cy - p.bowlHeight },
        right: { x: bowlRight, y: cy },
        bottom: { x: bowlRight - p.bowlWidth, y: cy + p.bowlHeight },
        left: { x: stemX, y: cy },
      };
    }
    function construct(p) {
      const gg = g(p);
      const tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      const paths = [
        `M ${gg.stemX} 0 L ${gg.stemX} ${gg.stemTopY}`,
        [
          `M ${gg.top.x} ${gg.top.y}`,
          `C ${gg.top.x + tw} ${gg.top.y}, ${gg.right.x} ${gg.right.y - th}, ${gg.right.x} ${gg.right.y}`,
          `C ${gg.right.x} ${gg.right.y + th}, ${gg.bottom.x + tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
          `C ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.left.x} ${gg.left.y + th * 0.5}, ${gg.left.x} ${gg.left.y}`,
        ].join(" "),
      ];
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: gg.stemX, y: 0, len: p.serifLength, side: "both" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const gg = g(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      return [
        {
          id: "xHeight",
          anchor: { x: gg.stemX, y: gg.stemTopY },
          control: { x: gg.stemX - 18, y: gg.stemTopY },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "bowlWidth",
          anchor: gg.right,
          control: { x: gg.right.x + 18, y: gg.right.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "shoulder",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "shoulder",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.stemX, y: gg.cy / 2 },
          control: { x: gg.stemX + p.strokeWeight / 2 + 6, y: gg.cy / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.right,
          control: { x: gg.right.x, y: gg.right.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      const gg = g(p);
      return {
        minX: -hs,
        maxX: gg.bowlRight + hs,
        minY: gg.stemTopY - hs,
        maxY: hs,
      };
    }
    return {
      character: "b",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) => advanceWithBearings(p, p.strokeWeight + 2 * p.bowlWidth),
      bounds,
    };
  })();

  // ─── 'c' — open bowl ──────────────────────────────────────────────────
  const c = (function () {
    const dp = {
      bowlWidth: 54,
      bowlHeight: 54,
      strokeWeight: 24,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
      opening: 22,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const r = {
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 25, max: 90 },
      strokeWeight: { min: 6, max: 44 },
      opening: { min: 8, max: 50 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function g(p) {
      const hs = p.strokeWeight / 2,
        cx = hs + p.bowlWidth,
        cy = -p.bowlHeight;
      return {
        hs,
        cx,
        cy,
        top: { x: cx, y: cy - p.bowlHeight },
        left: { x: cx - p.bowlWidth, y: cy },
        bottom: { x: cx, y: cy + p.bowlHeight },
        openTop: { x: cx + p.bowlWidth, y: cy - p.opening },
        openBot: { x: cx + p.bowlWidth * 0.7, y: cy + p.opening },
      };
    }
    function construct(p) {
      const gg = g(p);
      const tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      const paths = [
        [
          `M ${gg.openTop.x} ${gg.openTop.y}`,
          `C ${gg.openTop.x} ${gg.openTop.y - th * 0.5}, ${gg.top.x + tw} ${gg.top.y}, ${gg.top.x} ${gg.top.y}`,
          `C ${gg.top.x - tw} ${gg.top.y}, ${gg.left.x} ${gg.left.y - th}, ${gg.left.x} ${gg.left.y}`,
          `C ${gg.left.x} ${gg.left.y + th}, ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
          `C ${gg.bottom.x + tw * 0.4} ${gg.bottom.y}, ${gg.openBot.x - th * 0.25} ${gg.openBot.y}, ${gg.openBot.x} ${gg.openBot.y}`,
        ].join(" "),
      ];
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: gg.left.x, y: 0, len: p.serifLength * 0.7, side: "left" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const gg = g(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      return [
        {
          id: "bowlWidth",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "opening",
          anchor: gg.openTop,
          control: { x: gg.openTop.x, y: gg.openTop.y - p.opening },
          paramName: "opening",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.cx, y: gg.cy },
          control: { x: gg.cx + p.strokeWeight / 2 + 6, y: gg.cy },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.left,
          control: { x: gg.left.x, y: gg.left.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: p.strokeWeight + 2 * p.bowlWidth + hs,
        minY: -2 * p.bowlHeight - hs,
        maxY: hs,
      };
    }
    return {
      character: "c",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) => advanceWithBearings(p, p.strokeWeight + 2 * p.bowlWidth),
      bounds,
    };
  })();

  // ─── 'm' — double arch ────────────────────────────────────────────────
  const m = (function () {
    const dp = {
      xHeight: 140,
      archWidth: 44,
      strokeWeight: 24,
      shoulder: 34,
      archTension: 0.5523,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      archWidth: { min: 28, max: 70 },
      strokeWeight: { min: 6, max: 44 },
      shoulder: { min: 10, max: 70 },
      archTension: { min: 0.15, max: 1.4 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function g(p) {
      const hs = p.strokeWeight / 2;
      const leftX = hs,
        midX = hs + p.archWidth,
        rightX = hs + 2 * p.archWidth;
      const xLineY = -p.xHeight,
        shoulderY = xLineY + p.shoulder;
      return { hs, leftX, midX, rightX, xLineY, shoulderY };
    }
    function construct(p) {
      const gg = g(p);
      const tArm = p.archWidth * p.archTension * 0.5;
      const paths = [
        `M ${gg.leftX} 0 L ${gg.leftX} ${gg.shoulderY}`,
        `M ${gg.midX} 0 L ${gg.midX} ${gg.shoulderY}`,
        `M ${gg.rightX} 0 L ${gg.rightX} ${gg.shoulderY}`,
        `M ${gg.leftX} ${gg.shoulderY} C ${gg.leftX} ${gg.xLineY - tArm}, ${gg.midX} ${gg.xLineY - tArm}, ${gg.midX} ${gg.shoulderY}`,
        `M ${gg.midX} ${gg.shoulderY} C ${gg.midX} ${gg.xLineY - tArm}, ${gg.rightX} ${gg.xLineY - tArm}, ${gg.rightX} ${gg.shoulderY}`,
      ];
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: gg.leftX, y: 0, len: p.serifLength, side: "both" },
          { x: gg.rightX, y: 0, len: p.serifLength, side: "both" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const gg = g(p);
      const tArm = p.archWidth * p.archTension * 0.5;
      const midArch = (gg.leftX + gg.midX) / 2;
      return [
        {
          id: "xHeight",
          anchor: { x: midArch, y: gg.xLineY },
          control: { x: midArch, y: gg.xLineY - 18 },
          paramName: "xHeight",
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "archWidth",
          anchor: { x: gg.rightX, y: gg.shoulderY / 2 },
          control: { x: gg.rightX + 18, y: gg.shoulderY / 2 },
          paramName: "archWidth",
          deltaFromDrag: (dx) => dx / 2,
        },
        {
          id: "shoulder",
          anchor: { x: gg.leftX, y: gg.shoulderY },
          control: { x: gg.leftX - 18, y: gg.shoulderY },
          paramName: "shoulder",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "strokeWeight",
          anchor: { x: gg.midX, y: gg.shoulderY / 2 },
          control: { x: gg.midX + p.strokeWeight / 2 + 6, y: gg.shoulderY / 2 },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "archTension",
          anchor: { x: midArch, y: gg.xLineY },
          control: { x: midArch + tArm, y: gg.xLineY },
          paramName: "archTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.archWidth * 0.5),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const gg = g(p),
        hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: gg.rightX + hs,
        minY: gg.xLineY - hs,
        maxY: hs,
      };
    }
    return {
      character: "m",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["archTension"],
      construct,
      handles,
      advance: (p) => advanceWithBearings(p, p.strokeWeight + 2 * p.archWidth),
      bounds,
    };
  })();

  // ─── 'g' — bowl + descender ───────────────────────────────────────────
  const g = (function () {
    const dp = {
      xHeight: 140,
      bowlWidth: 52,
      bowlHeight: 50,
      strokeWeight: 24,
      bowlTopTension: 0.5523,
      bowlSideTension: 0.5523,
      descenderDrop: 48,
      descenderCurl: 14,
      serifLength: 0,
      leftBearing: 0,
      rightBearing: 0,
    };
    const r = {
      xHeight: { min: 80, max: 200 },
      bowlWidth: { min: 25, max: 90 },
      bowlHeight: { min: 22, max: 80 },
      strokeWeight: { min: 6, max: 44 },
      descenderDrop: { min: 20, max: 80 },
      descenderCurl: { min: 0, max: 32 },
      bowlTopTension: { min: 0.15, max: 1.4 },
      bowlSideTension: { min: 0.15, max: 1.4 },
      serifLength: SERIF_RANGE,
      leftBearing: BEARING_RANGE,
      rightBearing: BEARING_RANGE,
    };
    function gGeom(p) {
      const hs = p.strokeWeight / 2,
        cx = hs + p.bowlWidth,
        cy = -p.bowlHeight;
      const tailX = cx + p.bowlWidth * 0.85;
      return {
        hs,
        cx,
        cy,
        tailX,
        top: { x: cx, y: cy - p.bowlHeight },
        right: { x: cx + p.bowlWidth, y: cy },
        bottom: { x: cx, y: cy + p.bowlHeight },
        left: { x: cx - p.bowlWidth, y: cy },
        tailEnd: { x: tailX + p.descenderCurl * 0.3, y: p.descenderDrop },
      };
    }
    function construct(p) {
      const gg = gGeom(p);
      const tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      const paths = [
        [
          `M ${gg.top.x} ${gg.top.y}`,
          `C ${gg.top.x + tw} ${gg.top.y}, ${gg.right.x} ${gg.right.y - th}, ${gg.right.x} ${gg.right.y}`,
          `C ${gg.right.x} ${gg.right.y + th}, ${gg.bottom.x + tw} ${gg.bottom.y}, ${gg.bottom.x} ${gg.bottom.y}`,
          `C ${gg.bottom.x - tw} ${gg.bottom.y}, ${gg.left.x} ${gg.left.y + th}, ${gg.left.x} ${gg.left.y}`,
          `C ${gg.left.x} ${gg.left.y - th}, ${gg.top.x - tw} ${gg.top.y}, ${gg.top.x} ${gg.top.y}`,
          "Z",
        ].join(" "),
      ];
      paths.push(
        `M ${gg.right.x} ${gg.bottom.y} L ${gg.tailX} ${p.descenderDrop} C ${gg.tailX + p.descenderCurl * 0.4} ${p.descenderDrop + p.descenderCurl * 0.2}, ${gg.tailEnd.x} ${gg.tailEnd.y}, ${gg.tailEnd.x} ${gg.tailEnd.y}`
      );
      if (p.serifLength > 0) {
        appendSerifStubs(paths, [
          { x: gg.left.x, y: 0, len: p.serifLength * 0.65, side: "left" },
        ]);
      }
      return paths;
    }
    function handles(p) {
      const gg = gGeom(p),
        tw = p.bowlWidth * p.bowlTopTension,
        th = p.bowlHeight * p.bowlSideTension;
      return [
        {
          id: "bowlWidth",
          anchor: gg.left,
          control: { x: gg.left.x - 18, y: gg.left.y },
          paramName: "bowlWidth",
          deltaFromDrag: (dx) => -dx,
        },
        {
          id: "bowlHeight",
          anchor: gg.top,
          control: { x: gg.top.x, y: gg.top.y - 18 },
          paramName: "bowlHeight",
          deltaFromDrag: (_, dy) => -dy / 2,
        },
        {
          id: "descenderDrop",
          anchor: { x: gg.tailX, y: gg.bottom.y },
          control: { x: gg.tailX, y: p.descenderDrop },
          paramName: "descenderDrop",
          deltaFromDrag: (_, dy) => dy,
        },
        {
          id: "descenderCurl",
          anchor: gg.tailEnd,
          control: { x: gg.tailEnd.x + p.descenderCurl, y: gg.tailEnd.y },
          paramName: "descenderCurl",
          deltaFromDrag: (dx) => dx,
        },
        {
          id: "strokeWeight",
          anchor: gg.right,
          control: { x: gg.right.x + p.strokeWeight / 2 + 6, y: gg.right.y },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "bowlTopTension",
          anchor: gg.top,
          control: { x: gg.top.x + tw, y: gg.top.y },
          paramName: "bowlTopTension",
          deltaFromDrag: (dx) => dx / Math.max(1, p.bowlWidth),
          isTangent: true,
        },
        {
          id: "bowlSideTension",
          anchor: gg.right,
          control: { x: gg.right.x, y: gg.right.y + th },
          paramName: "bowlSideTension",
          deltaFromDrag: (_, dy) => dy / Math.max(1, p.bowlHeight),
          isTangent: true,
        },
      ];
    }
    function bounds(p) {
      const gg = gGeom(p),
        hs = p.strokeWeight / 2;
      return {
        minX: -hs,
        maxX: gg.right.x + hs + Math.max(p.descenderCurl, 8),
        minY: -2 * p.bowlHeight - hs,
        maxY: p.descenderDrop + hs,
      };
    }
    return {
      character: "g",
      defaultParams: dp,
      paramRanges: r,
      tangentParams: ["bowlTopTension", "bowlSideTension"],
      construct,
      handles,
      advance: (p) =>
        advanceWithBearings(
          p,
          p.strokeWeight + 2 * p.bowlWidth + Math.max(0, p.descenderCurl * 0.2)
        ),
      bounds,
    };
  })();

  // ─── space ────────────────────────────────────────────────────────────
  const space = (function () {
    const dp = { width: 60, strokeWeight: 24 };
    const r = {
      width: { min: 10, max: 200 },
      strokeWeight: { min: 6, max: 44 },
    };
    return {
      character: " ",
      defaultParams: dp,
      paramRanges: r,
      construct: () => [],
      handles: (p) => [
        {
          id: "width",
          anchor: { x: 0, y: -p.strokeWeight },
          control: { x: p.width, y: -p.strokeWeight },
          paramName: "width",
          deltaFromDrag: (dx) => dx,
        },
      ],
      advance: (p) => p.width,
      bounds: (p) => ({
        minX: 0,
        maxX: p.width,
        minY: -p.strokeWeight,
        maxY: 0,
      }),
    };
  })();

  // ════════════════════════════════════════════════════════════════════
  // MONOLINE GLYPH FACTORY  (the M9 expanded alphabet)
  // ────────────────────────────────────────────────────────────────────
  // CHANGE [Sprint 2, fix #2]: every monoline glyph now exposes a `curvature`
  // tangent parameter. At curvature=0 strokes are straight polylines (matches
  // the v1 visual). As curvature rises, strokes interpolate to a Catmull-Rom
  // spline through the same vertices — giving the whole expanded alphabet
  // the curve/tangent vocabulary the curated glyphs already have.
  //
  // This closes the "two-products" visual schism flagged in the design review.
  // ════════════════════════════════════════════════════════════════════

  const UPPERCASE_DEFS = {
    A: {
      width: 100,
      strokes: [
        [
          [0.02, 1],
          [0.5, 0],
          [0.98, 1],
        ],
        [
          [0.24, 0.58],
          [0.76, 0.58],
        ],
      ],
    },
    B: {
      width: 98,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0],
          [0.7, 0.08],
          [0.84, 0.24],
          [0.72, 0.44],
          [0.02, 0.48],
        ],
        [
          [0.02, 0.48],
          [0.74, 0.58],
          [0.88, 0.8],
          [0.72, 1],
          [0.02, 1],
        ],
      ],
    },
    C: {
      width: 102,
      strokes: [
        [
          [0.96, 0.12],
          [0.74, 0],
          [0.26, 0],
          [0.02, 0.24],
          [0.02, 0.76],
          [0.26, 1],
          [0.74, 1],
          [0.96, 0.88],
        ],
      ],
    },
    D: {
      width: 104,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0],
          [0.72, 0.08],
          [0.98, 0.32],
          [0.98, 0.68],
          [0.72, 0.92],
          [0.02, 1],
        ],
      ],
    },
    E: {
      width: 94,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0],
          [0.94, 0],
        ],
        [
          [0.02, 0.5],
          [0.74, 0.5],
        ],
        [
          [0.02, 1],
          [0.94, 1],
        ],
      ],
    },
    F: {
      width: 92,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0],
          [0.94, 0],
        ],
        [
          [0.02, 0.5],
          [0.72, 0.5],
        ],
      ],
    },
    G: {
      width: 108,
      strokes: [
        [
          [0.98, 0.18],
          [0.78, 0],
          [0.28, 0],
          [0.02, 0.26],
          [0.02, 0.76],
          [0.26, 1],
          [0.76, 1],
          [0.98, 0.82],
        ],
        [
          [0.98, 0.58],
          [0.6, 0.58],
          [0.6, 0.76],
          [0.98, 0.76],
        ],
      ],
    },
    H: {
      width: 104,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.98, 0],
          [0.98, 1],
        ],
        [
          [0.02, 0.52],
          [0.98, 0.52],
        ],
      ],
    },
    I: {
      width: 70,
      strokes: [
        [
          [0.02, 0],
          [0.98, 0],
        ],
        [
          [0.5, 0],
          [0.5, 1],
        ],
        [
          [0.02, 1],
          [0.98, 1],
        ],
      ],
    },
    J: {
      width: 90,
      strokes: [
        [
          [0.02, 0],
          [0.98, 0],
        ],
        [
          [0.82, 0],
          [0.82, 0.82],
          [0.62, 1],
          [0.28, 1],
          [0.08, 0.84],
        ],
      ],
    },
    K: {
      width: 102,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0.54],
          [0.98, 0],
        ],
        [
          [0.02, 0.54],
          [0.92, 1],
        ],
      ],
    },
    L: {
      width: 90,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 1],
          [0.96, 1],
        ],
      ],
    },
    M: {
      width: 120,
      strokes: [
        [
          [0.02, 1],
          [0.02, 0],
          [0.5, 0.58],
          [0.98, 0],
          [0.98, 1],
        ],
      ],
    },
    N: {
      width: 108,
      strokes: [
        [
          [0.02, 1],
          [0.02, 0],
          [0.98, 1],
          [0.98, 0],
        ],
      ],
    },
    O: {
      width: 108,
      strokes: [
        [
          [0.24, 0],
          [0.76, 0],
          [1, 0.24],
          [1, 0.76],
          [0.76, 1],
          [0.24, 1],
          [0, 0.76],
          [0, 0.24],
          [0.24, 0],
        ],
      ],
    },
    P: {
      width: 96,
      strokes: [
        [
          [0.02, 1],
          [0.02, 0],
        ],
        [
          [0.02, 0],
          [0.72, 0.08],
          [0.86, 0.28],
          [0.72, 0.5],
          [0.02, 0.5],
        ],
      ],
    },
    Q: {
      width: 108,
      strokes: [
        [
          [0.24, 0],
          [0.76, 0],
          [1, 0.24],
          [1, 0.76],
          [0.76, 1],
          [0.24, 1],
          [0, 0.76],
          [0, 0.24],
          [0.24, 0],
        ],
        [
          [0.62, 0.72],
          [1, 1.08],
        ],
      ],
    },
    R: {
      width: 102,
      strokes: [
        [
          [0.02, 1],
          [0.02, 0],
        ],
        [
          [0.02, 0],
          [0.72, 0.08],
          [0.86, 0.28],
          [0.72, 0.5],
          [0.02, 0.5],
        ],
        [
          [0.02, 0.5],
          [0.98, 1],
        ],
      ],
    },
    S: {
      width: 102,
      strokes: [
        [
          [0.98, 0.1],
          [0.76, 0],
          [0.26, 0],
          [0.02, 0.24],
          [0.26, 0.5],
          [0.74, 0.5],
          [0.98, 0.76],
          [0.76, 1],
          [0.24, 1],
          [0.02, 0.9],
        ],
      ],
    },
    T: {
      width: 98,
      strokes: [
        [
          [0.02, 0],
          [0.98, 0],
        ],
        [
          [0.5, 0],
          [0.5, 1],
        ],
      ],
    },
    U: {
      width: 104,
      strokes: [
        [
          [0.02, 0],
          [0.02, 0.78],
          [0.24, 1],
          [0.76, 1],
          [0.98, 0.78],
          [0.98, 0],
        ],
      ],
    },
    V: {
      width: 102,
      strokes: [
        [
          [0.02, 0],
          [0.5, 1],
          [0.98, 0],
        ],
      ],
    },
    W: {
      width: 134,
      strokes: [
        [
          [0.02, 0],
          [0.24, 1],
          [0.5, 0.48],
          [0.76, 1],
          [0.98, 0],
        ],
      ],
    },
    X: {
      width: 102,
      strokes: [
        [
          [0.02, 0],
          [0.98, 1],
        ],
        [
          [0.98, 0],
          [0.02, 1],
        ],
      ],
    },
    Y: {
      width: 102,
      strokes: [
        [
          [0.02, 0],
          [0.5, 0.52],
          [0.98, 0],
        ],
        [
          [0.5, 0.52],
          [0.5, 1],
        ],
      ],
    },
    Z: {
      width: 100,
      strokes: [
        [
          [0.02, 0],
          [0.98, 0],
          [0.02, 1],
          [0.98, 1],
        ],
      ],
    },
  };

  const EXTRA_LOWERCASE_DEFS = {
    // b, c, m, g are hand-authored curated glyphs (see above)
    f: {
      width: 78,
      strokes: [
        [
          [0.56, 0],
          [0.56, 1],
        ],
        [
          [0.18, 0.3],
          [0.92, 0.3],
        ],
        [
          [0.56, 0],
          [0.26, 0.1],
        ],
      ],
    },
    j: {
      width: 68,
      strokes: [
        [
          [0.56, 0.2],
          [0.56, 1.18],
          [0.36, 1.34],
          [0.14, 1.24],
        ],
        [
          [0.46, 0],
          [0.66, 0],
        ],
      ],
    },
    k: {
      width: 86,
      strokes: [
        [
          [0.02, 0],
          [0.02, 1],
        ],
        [
          [0.02, 0.58],
          [0.9, 0.08],
        ],
        [
          [0.02, 0.58],
          [0.86, 1],
        ],
      ],
    },
    p: {
      width: 90,
      strokes: [
        [
          [0.02, 0.34],
          [0.02, 1.34],
        ],
        [
          [0.02, 0.34],
          [0.62, 0.38],
          [0.82, 0.58],
          [0.62, 0.84],
          [0.02, 0.84],
        ],
      ],
    },
    q: {
      width: 90,
      strokes: [
        [
          [0.98, 0.34],
          [0.98, 1.34],
        ],
        [
          [0.98, 0.34],
          [0.38, 0.38],
          [0.18, 0.58],
          [0.38, 0.84],
          [0.98, 0.84],
        ],
      ],
    },
    u: {
      width: 92,
      strokes: [
        [
          [0.02, 0.34],
          [0.02, 0.78],
          [0.24, 1],
          [0.72, 1],
          [0.96, 0.78],
          [0.96, 0.34],
        ],
      ],
    },
    v: {
      width: 90,
      strokes: [
        [
          [0.02, 0.34],
          [0.5, 1],
          [0.98, 0.34],
        ],
      ],
    },
    x: {
      width: 90,
      strokes: [
        [
          [0.02, 0.34],
          [0.98, 1],
        ],
        [
          [0.98, 0.34],
          [0.02, 1],
        ],
      ],
    },
    y: {
      width: 90,
      strokes: [
        [
          [0.02, 0.34],
          [0.5, 0.92],
          [0.98, 0.34],
        ],
        [
          [0.5, 0.92],
          [0.34, 1.3],
          [0.12, 1.38],
        ],
      ],
    },
    z: {
      width: 88,
      strokes: [
        [
          [0.02, 0.34],
          [0.98, 0.34],
          [0.02, 1],
          [0.98, 1],
        ],
      ],
    },
  };

  function isUpper(ch) {
    return ch >= "A" && ch <= "Z";
  }

  function createMonolineGlyph(character, def) {
    const upper = isUpper(character);
    const heightParam = upper ? "capHeight" : "xHeight";
    const defaultHeight = upper ? 170 : 140;

    const defaultParams = {
      [heightParam]: defaultHeight,
      width: def.width,
      strokeWeight: 24,
      slant: 0,
      curvature: 0, // CHANGE: new tangent param. Default 0 = straight (back-compat).
    };
    const paramRanges = {
      [heightParam]: { min: upper ? 110 : 90, max: 240 },
      width: {
        min: Math.max(35, def.width * 0.55),
        max: Math.max(140, def.width * 2.1),
      },
      strokeWeight: { min: 6, max: 44 },
      slant: { min: -0.35, max: 0.35 },
      curvature: { min: 0, max: 1.4 },
    };

    function project(u, v, p) {
      const hgt = p[heightParam];
      return {
        x: p.strokeWeight / 2 + u * p.width + (1 - v) * hgt * p.slant,
        y: -hgt + v * hgt,
      };
    }

    function strokeToPath(stroke, p) {
      const pts = stroke.map((uv) => project(uv[0], uv[1], p));
      if (pts.length < 2) {
        // Single-vertex stroke → zero-length dot.
        return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x} ${pts[0].y + 0.01}`;
      }
      if (p.curvature < 0.005) {
        // Fast path: straight polyline.
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
        return d;
      }
      // Catmull-Rom → cubic Beziers. Endpoints duplicated for tangent calc.
      const t = p.curvature / 6;
      let d = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1x = p1.x + (p2.x - p0.x) * t;
        const c1y = p1.y + (p2.y - p0.y) * t;
        const c2x = p2.x - (p3.x - p1.x) * t;
        const c2y = p2.y - (p3.y - p1.y) * t;
        d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
      }
      return d;
    }

    function construct(p) {
      return def.strokes.map((s) => strokeToPath(s, p));
    }

    // For positioning the curvature handle: pick the midpoint of the first
    // multi-segment stroke and orient its arm perpendicular to that segment.
    function curvHandleGeom(p) {
      const stroke = def.strokes.find((s) => s.length >= 2) || def.strokes[0];
      const aRaw = stroke[0],
        bRaw = stroke[1] || stroke[0];
      const A = project(aRaw[0], aRaw[1], p);
      const B = project(bRaw[0], bRaw[1], p);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const dx = B.x - A.x,
        dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular pointing "outward" from the glyph (toward +x if vertical, toward -y otherwise).
      let px = -dy / len,
        py = dx / len;
      if (py > 0) {
        px = -px;
        py = -py;
      } // prefer the upward-facing perpendicular
      const armLen = 14 + p.curvature * 28;
      return { mid, perp: { x: px, y: py }, armLen };
    }

    const allPoints = [].concat.apply([], def.strokes);
    const minU = Math.min.apply(
      null,
      allPoints.map((pt) => pt[0])
    );
    const maxU = Math.max.apply(
      null,
      allPoints.map((pt) => pt[0])
    );
    const minV = Math.min.apply(
      null,
      allPoints.map((pt) => pt[1])
    );
    const maxV = Math.max.apply(
      null,
      allPoints.map((pt) => pt[1])
    );

    function handles(p) {
      const top = project((minU + maxU) / 2, minV, p);
      const rightMid = project(maxU, (minV + maxV) / 2, p);
      const weightAnchor = project(minU + (maxU - minU) * 0.22, 0.5, p);
      const slantAnchor = project((minU + maxU) / 2, minV + 0.08, p);
      const c = curvHandleGeom(p);
      return [
        {
          id: heightParam,
          anchor: top,
          control: { x: top.x, y: top.y - 18 },
          paramName: heightParam,
          deltaFromDrag: (_, dy) => -dy,
        },
        {
          id: "width",
          anchor: rightMid,
          control: { x: rightMid.x + 18, y: rightMid.y },
          paramName: "width",
          deltaFromDrag: (dx) => dx / Math.max(0.2, maxU),
        },
        {
          id: "strokeWeight",
          anchor: weightAnchor,
          control: {
            x: weightAnchor.x + p.strokeWeight / 2 + 6,
            y: weightAnchor.y,
          },
          paramName: "strokeWeight",
          deltaFromDrag: (dx) => 2 * dx,
        },
        {
          id: "slant",
          anchor: slantAnchor,
          control: { x: slantAnchor.x + 18, y: slantAnchor.y },
          paramName: "slant",
          deltaFromDrag: (dx) => dx / Math.max(1, p[heightParam]),
        },
        // CHANGE: the curvature tangent — the new headline-fixing handle.
        {
          id: "curvature",
          anchor: c.mid,
          control: {
            x: c.mid.x + c.perp.x * c.armLen,
            y: c.mid.y + c.perp.y * c.armLen,
          },
          paramName: "curvature",
          // arm = 14 + curvature * 28 → d(controlPos)/d(curvature) = 28 along perp.
          deltaFromDrag: (dx, dy) => (dx * c.perp.x + dy * c.perp.y) / 28,
          isTangent: true,
        },
      ];
    }

    function bounds(p) {
      // Includes descenders for g/j/p/q/y (maxV > 1).
      const pad = p.strokeWeight / 2;
      const hgt = p[heightParam];
      const xs = allPoints.map(
        (pt) =>
          p.strokeWeight / 2 + pt[0] * p.width + (1 - pt[1]) * hgt * p.slant
      );
      const ys = allPoints.map((pt) => -hgt + pt[1] * hgt);
      // Curvature can push paths slightly past the vertex bbox; pad generously.
      const curvPad = p.curvature * Math.min(p.width, hgt) * 0.15;
      return {
        minX: Math.min.apply(null, xs) - pad - curvPad,
        maxX: Math.max.apply(null, xs) + pad + curvPad,
        minY: Math.min.apply(null, ys) - pad - curvPad,
        maxY: Math.max.apply(null, ys) + pad + curvPad,
      };
    }

    function advance(p) {
      return (
        p.strokeWeight + p.width + Math.max(0, p.slant * p[heightParam] * 0.6)
      );
    }

    return {
      character,
      defaultParams,
      paramRanges,
      tangentParams: ["curvature"],
      construct,
      handles,
      advance,
      bounds,
    };
  }

  const uppercaseGlyphs = {};
  for (const ch of Object.keys(UPPERCASE_DEFS))
    uppercaseGlyphs[ch] = createMonolineGlyph(ch, UPPERCASE_DEFS[ch]);
  const extraLowercaseGlyphs = {};
  for (const ch of Object.keys(EXTRA_LOWERCASE_DEFS))
    extraLowercaseGlyphs[ch] = createMonolineGlyph(
      ch,
      EXTRA_LOWERCASE_DEFS[ch]
    );

  // ════════════════════════════════════════════════════════════════════
  // PRESETS  (Sprint 2 fix #3 — defaults block applies to any glyph
  // without a specific override.)
  // ════════════════════════════════════════════════════════════════════
  // Shared curated-glyph overrides — each preset tunes these for its mood.
  const CURATED_KEYS = [
    "a",
    "n",
    "o",
    "s",
    "h",
    "i",
    "e",
    "t",
    "r",
    "l",
    "w",
    "d",
    "b",
    "c",
    "m",
    "g",
    " ",
  ];

  function curatedGlyphParams(overrides) {
    const out = {};
    for (const ch of CURATED_KEYS) {
      if (overrides[ch]) out[ch] = overrides[ch];
    }
    return out;
  }

  // ─── Prototype / licensing (outline mode) ───────────────────────────
  const OUTLINE_DISCLAIMER = [
    "PROTOTYPE / EXPERIMENTATION ONLY.",
    "Reference font outlines are shown for visual comparison and learning — not for",
    "redistribution as a font, commercial typesetting, or trademark use.",
    "See docs/THIRD_PARTY_FONTS.md for license texts and attributions.",
  ].join(" ");

  const OUTLINE_DISCLAIMER_SHORT =
    "Prototype only — reference outlines for experimentation, not a licensed font product.";

  let _opentypeParser = null;
  const _fontCache = Object.create(null);
  const _glyphPathCache = Object.create(null);

  function setOpentypeParser(parser) {
    _opentypeParser = parser;
  }

  function getOpentypeParser() {
    if (_opentypeParser) return _opentypeParser;
    if (typeof window !== "undefined" && window.opentype)
      return window.opentype;
    throw new Error(
      "Outline mode requires opentype.js — call Putty.setOpentypeParser(opentype) first."
    );
  }

  function outlineAttributionBlock(presetKey) {
    const p = presets[presetKey];
    if (!p || !p.attribution) return "";
    return [
      "<!-- " + OUTLINE_DISCLAIMER + " -->",
      "<!-- Font: " +
        p.fontRef +
        " | " +
        p.license +
        " | " +
        p.copyright +
        " -->",
    ].join("\n");
  }

  function outlineAttributionHtml(presetKey) {
    const p = presets[presetKey];
    if (!p || !p.attribution) return "";
    return (
      '<aside class="putty-outline-disclaimer" role="note">' +
      "<p><strong>Prototype / experimentation.</strong> " +
      OUTLINE_DISCLAIMER_SHORT +
      "</p>" +
      '<p class="putty-outline-attribution">' +
      p.attribution +
      " (" +
      p.license +
      ")</p>" +
      "</aside>"
    );
  }

  async function loadFontForPreset(presetKey) {
    const preset = presets[presetKey];
    if (!preset || !preset.fontUrl) {
      throw new Error(
        "Preset '" + presetKey + "' has no fontUrl for outline mode."
      );
    }
    if (_fontCache[presetKey]) return _fontCache[presetKey];
    const ot = getOpentypeParser();
    const resp = await fetch(preset.fontUrl);
    if (!resp.ok)
      throw new Error(
        "Failed to load font for " + presetKey + ": HTTP " + resp.status
      );
    const font = ot.parse(await resp.arrayBuffer());
    _fontCache[presetKey] = font;
    return font;
  }

  function clonePathCommands(path) {
    if (!path || !path.commands || !path.commands.length) return null;
    return path.commands.map(function (cmd) {
      const c = { type: cmd.type };
      if (cmd.x != null) c.x = cmd.x;
      if (cmd.y != null) c.y = cmd.y;
      if (cmd.x1 != null) {
        c.x1 = cmd.x1;
        c.y1 = cmd.y1;
      }
      if (cmd.x2 != null) {
        c.x2 = cmd.x2;
        c.y2 = cmd.y2;
      }
      return c;
    });
  }

  function cloneCommandsDeep(commands) {
    if (!commands) return null;
    return commands.map(function (cmd) {
      const c = { type: cmd.type };
      if (cmd.x != null) c.x = cmd.x;
      if (cmd.y != null) c.y = cmd.y;
      if (cmd.x1 != null) {
        c.x1 = cmd.x1;
        c.y1 = cmd.y1;
      }
      if (cmd.x2 != null) {
        c.x2 = cmd.x2;
        c.y2 = cmd.y2;
      }
      return c;
    });
  }

  function transformCommandPoints(commands, fn) {
    return commands.map(function (cmd) {
      const c = { type: cmd.type };
      if (cmd.x != null) {
        const p = fn(cmd.x, cmd.y);
        c.x = p.x;
        c.y = p.y;
      }
      if (cmd.x1 != null) {
        const p1 = fn(cmd.x1, cmd.y1);
        c.x1 = p1.x;
        c.y1 = p1.y;
      }
      if (cmd.x2 != null) {
        const p2 = fn(cmd.x2, cmd.y2);
        c.x2 = p2.x;
        c.y2 = p2.y;
      }
      return c;
    });
  }

  function commandsToPathData(commands) {
    let d = "";
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (cmd.type === "M") d += "M " + cmd.x + " " + cmd.y;
      else if (cmd.type === "L") d += " L " + cmd.x + " " + cmd.y;
      else if (cmd.type === "C")
        d +=
          " C " +
          cmd.x1 +
          " " +
          cmd.y1 +
          " " +
          cmd.x2 +
          " " +
          cmd.y2 +
          " " +
          cmd.x +
          " " +
          cmd.y;
      else if (cmd.type === "Q")
        d += " Q " + cmd.x1 + " " + cmd.y1 + " " + cmd.x + " " + cmd.y;
      else if (cmd.type === "Z") d += " Z";
    }
    return d.trim();
  }

  function collectCommandPoints(commands) {
    const pts = [];
    for (const cmd of commands) {
      if (cmd.type === "M" || cmd.type === "L")
        pts.push({ x: cmd.x, y: cmd.y });
      else if (cmd.type === "C") {
        pts.push({ x: cmd.x1, y: cmd.y1 });
        pts.push({ x: cmd.x2, y: cmd.y2 });
        pts.push({ x: cmd.x, y: cmd.y });
      } else if (cmd.type === "Q") {
        pts.push({ x: cmd.x1, y: cmd.y1 });
        pts.push({ x: cmd.x, y: cmd.y });
      }
    }
    return pts;
  }

  function boundsFromCommands(commands) {
    const pts = collectCommandPoints(commands);
    if (!pts.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  }

  function splitSubpaths(commands) {
    const subs = [];
    let cur = null;
    for (const cmd of commands) {
      if (cmd.type === "M") {
        if (cur) subs.push(cur);
        cur = { commands: [cmd] };
      } else if (cur) {
        cur.commands.push(cmd);
      }
    }
    if (cur) subs.push(cur);
    return subs;
  }

  /**
   * Sample a closed subpath into a dense, evenly-distributed polyline.
   * Beziers are subdivided to `samplesPerCurve` segments; lines get a few
   * samples each so phase is roughly arc-length parameterised. Returns
   * `{ points, cumDist, totalLen }` where `totalLen` includes the closing edge.
   */
  function sampleSubpathDense(commands, samplesPerCurve) {
    const points = [];
    let prev = null;
    for (const cmd of commands) {
      if (cmd.type === "M") {
        prev = { x: cmd.x, y: cmd.y };
        points.push(prev);
      } else if (cmd.type === "L") {
        const N = Math.max(2, Math.ceil(samplesPerCurve / 4));
        for (let i = 1; i <= N; i++) {
          const tt = i / N;
          points.push({
            x: prev.x + (cmd.x - prev.x) * tt,
            y: prev.y + (cmd.y - prev.y) * tt,
          });
        }
        prev = { x: cmd.x, y: cmd.y };
      } else if (cmd.type === "Q") {
        const N = samplesPerCurve;
        for (let i = 1; i <= N; i++) {
          const tt = i / N;
          const mt = 1 - tt;
          points.push({
            x: mt * mt * prev.x + 2 * mt * tt * cmd.x1 + tt * tt * cmd.x,
            y: mt * mt * prev.y + 2 * mt * tt * cmd.y1 + tt * tt * cmd.y,
          });
        }
        prev = { x: cmd.x, y: cmd.y };
      } else if (cmd.type === "C") {
        const N = samplesPerCurve;
        for (let i = 1; i <= N; i++) {
          const tt = i / N;
          const mt = 1 - tt;
          points.push({
            x:
              mt * mt * mt * prev.x +
              3 * mt * mt * tt * cmd.x1 +
              3 * mt * tt * tt * cmd.x2 +
              tt * tt * tt * cmd.x,
            y:
              mt * mt * mt * prev.y +
              3 * mt * mt * tt * cmd.y1 +
              3 * mt * tt * tt * cmd.y2 +
              tt * tt * tt * cmd.y,
          });
        }
        prev = { x: cmd.x, y: cmd.y };
      }
    }
    // Drop a duplicate closing point so the contour is treated as a loop.
    const M0 = points.length;
    if (M0 > 1) {
      const first = points[0];
      const last = points[M0 - 1];
      if (
        Math.abs(first.x - last.x) < 0.01 &&
        Math.abs(first.y - last.y) < 0.01
      ) {
        points.pop();
      }
    }
    const M = points.length;
    const cum = new Array(M);
    cum[0] = 0;
    for (let i = 1; i < M; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      cum[i] = cum[i - 1] + Math.hypot(dx, dy);
    }
    let totalLen = cum[M - 1] || 0;
    if (M > 1) {
      const dx = points[0].x - points[M - 1].x;
      const dy = points[0].y - points[M - 1].y;
      totalLen += Math.hypot(dx, dy);
    }
    return { points: points, cumDist: cum, totalLen: totalLen };
  }

  /**
   * Low-pass a CLOSED polyline with a windowed moving average (box filter).
   * Each point becomes the mean of the `2·radius+1` samples around it on the
   * loop. A window sized to the bump wavelength nulls that frequency in a
   * single pass — far cheaper than the O(wavelength²) iterations a Laplacian
   * smoother would need to flatten the same feature — while preserving the
   * contour's low-frequency shape (the letterform). `passes>1` sharpens the
   * cutoff. Computed with a sliding running sum, so O(N) per pass. Returns a
   * fresh point array; the input is untouched.
   */
  function smoothClosedPolyline(points, radius, passes) {
    const N = points.length;
    let cur = points.map((p) => ({ x: p.x, y: p.y }));
    if (radius < 1 || N < 3) return cur;
    const r = Math.min(radius, Math.floor((N - 1) / 2));
    const win = 2 * r + 1;
    for (let pass = 0; pass < passes; pass++) {
      let sx = 0;
      let sy = 0;
      for (let k = -r; k <= r; k++) {
        const q = cur[((k % N) + N) % N];
        sx += q.x;
        sy += q.y;
      }
      const out = new Array(N);
      for (let i = 0; i < N; i++) {
        out[i] = { x: sx / win, y: sy / win };
        const rem = cur[(((i - r) % N) + N) % N];
        const add = cur[(((i + r + 1) % N) + N) % N];
        sx += add.x - rem.x;
        sy += add.y - rem.y;
      }
      cur = out;
    }
    return cur;
  }

  /**
   * Bubbliness + Amplitude — a unified "bubble" deformer for an already-bubbly
   * reference font (Rubik Bubbles). Rather than only piling synthetic bumps on
   * top of the native outline (which can never make it *less* bubbly), each
   * contour is split into a smoothed, de-bubbled BASELINE (Taubin) plus the
   * per-point DETAIL vector that is the font's own bubbles. The two axes then
   * reshape that decomposition:
   *
   *   • bubbliness `b` ∈ [0,1], default 0.5 = font as-is.
   *       left half  (b<0.5): `nativeKeep` ramps 1→0, melting the native
   *                  bubbles back toward the smooth baseline (FEWER bubbles).
   *       right half (b>0.5): native bubbles kept, plus `synthAmount` worth of
   *                  synthetic sine bumps added along the normal (MORE bubbles).
   *   • amplitude `a` ∈ [0,1], default 0.5 = native height. `ampFactor` = 2a
   *       scales the HEIGHT of *both* the native detail and the synthetic
   *       bumps, so 0 flattens everything to the baseline, 1 doubles it —
   *       visible at every bubbliness setting, including the default.
   *
   * At b=0.5, a=0.5 the original commands are returned untouched (exact native).
   */
  function applyBubbliness(commands, bNorm, _bounds, opts) {
    if (!commands) return commands;
    const ampNorm =
      opts && opts.amplitude != null
        ? Math.max(0, Math.min(1, opts.amplitude))
        : 0.5;
    const b = Math.max(0, Math.min(1, bNorm));
    // Identity: centered bubbliness + native amplitude = font as-is. Returning
    // the original commands keeps the native Bézier outline (not a polyline).
    if (Math.abs(b - 0.5) < 0.001 && Math.abs(ampNorm - 0.5) < 0.001)
      return commands;

    const subs = splitSubpaths(commands);
    if (!subs.length) return commands;

    const BUMPS_MAX = 14;
    // De-bubble window as a fraction of each contour's sample count: ~6% of
    // the loop on each side (~12% wide) is about one native-bump wavelength,
    // enough to melt the font's bumps into a clean blob while keeping the
    // gross letterform. Two passes sharpen the cutoff.
    const SMOOTH_FRAC = 0.06;
    const SMOOTH_PASSES = 2;
    const gb = boundsFromCommands(commands);
    const glyphSize = Math.max(gb.maxX - gb.minX, gb.maxY - gb.minY) || 100;

    // Axis → model parameters (see JSDoc above).
    const nativeKeep = b <= 0.5 ? b / 0.5 : 1; // 1 on the right, ramps to 0 left
    const ampFactor = ampNorm * 2; // 0..2; 0.5→1 = native height
    const synthAmount = b <= 0.5 ? 0 : (b - 0.5) / 0.5; // right half only
    const bumpCount =
      synthAmount > 0 ? Math.max(1, Math.round(synthAmount * BUMPS_MAX)) : 0;
    // Synthetic bumps are sharp sine ripples poked along the normal, so at
    // high count + height they self-intersect into a spiky starburst rather
    // than reading as bubbles. Scale them by amplitude DIRECTLY (not the
    // doubled ampFactor that the rounder native detail uses) with a gentle
    // coefficient, so the busy end stays bubbly and the letters survive.
    const synthAmp = glyphSize * 0.1 * ampNorm * Math.sqrt(synthAmount);

    const result = [];
    for (const sp of subs) {
      const sampled = sampleSubpathDense(sp.commands, 16);
      const points = sampled.points;
      const cum = sampled.cumDist;
      const totalLen = sampled.totalLen;
      const N = points.length;
      if (totalLen < 1 || N < 4) {
        for (const cmd of sp.commands) result.push(cmd);
        continue;
      }

      // De-bubbled baseline; `detail` = native bump vector at each sample.
      const smoothR = Math.max(2, Math.round(N * SMOOTH_FRAC));
      const baseline = smoothClosedPolyline(points, smoothR, SMOOTH_PASSES);

      const sb = boundsFromCommands(sp.commands);
      const cx = (sb.minX + sb.maxX) / 2;
      const cy = (sb.minY + sb.maxY) / 2;
      const newPoints = new Array(N);
      for (let i = 0; i < N; i++) {
        const base = baseline[i];
        const p = points[i];
        // Native bubbles: scaled by how many we keep × their height.
        let x = base.x + (p.x - base.x) * nativeKeep * ampFactor;
        let y = base.y + (p.y - base.y) * nativeKeep * ampFactor;
        // Synthetic bumps (right half only), displaced along the outward
        // normal of the smoothed baseline.
        if (bumpCount > 0 && synthAmp > 0.0001) {
          const next = points[(i + 1) % N];
          const prev = points[(i - 1 + N) % N];
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const tLen = Math.hypot(tx, ty) || 1;
          let nx = -ty / tLen;
          let ny = tx / tLen;
          // Flip the normal so it points away from the subpath's bbox centroid.
          const rx = base.x - cx;
          const ry = base.y - cy;
          if (rx * nx + ry * ny < 0) {
            nx = -nx;
            ny = -ny;
          }
          const phase = (cum[i] / totalLen) * bumpCount * 2 * Math.PI;
          const offset = synthAmp * Math.sin(phase);
          x += nx * offset;
          y += ny * offset;
        }
        newPoints[i] = { x, y };
      }

      result.push({ type: "M", x: newPoints[0].x, y: newPoints[0].y });
      for (let i = 1; i < N; i++) {
        result.push({ type: "L", x: newPoints[i].x, y: newPoints[i].y });
      }
      result.push({ type: "Z" });
    }
    return result;
  }

  /**
   * Real outline dilation — true weight via a polyline-sampled
   * offset path.
   *
   * NOTE: currently UNUSED. The `weight` handle was switched back to a
   * round-joined stroke overlay because this offset-path dilation self-
   * intersects on curved contours past ~weight 40 (the glyph shatters), which
   * capped how bold weight could go. Kept as a utility for a future handle
   * that wants genuine geometry dilation within a safe (small-delta) range.
   *
   * Samples every contour densely, displaces each sample along the outward
   * normal of the *filled region* by `delta` user units, and re-emits the
   * contour as a polyline. The silhouette grows as if the stroke contrast
   * thickened from the inside-out, not as if a halo were drawn over the fill.
   *
   * Outward direction is the key: a glyph's holes (counters) are wound
   * opposite to its outer contour, so a single consistent normal rule
   * (rotate the tangent the same way for every contour) automatically
   * points outward on the outer contour and inward on the counters. The
   * global rotation sense is keyed off the outer (largest-area) contour so
   * that positive `delta` always grows the glyph. Counters therefore shrink
   * as `delta` grows — correct dilation behaviour.
   *
   * Throws (or returns null) on degenerate input so the caller can fall back
   * to the stroke-overlay implementation for that glyph.
   */
  function dilateOutline(commands, delta) {
    if (!commands || Math.abs(delta) < 0.01) return commands;
    const subs = splitSubpaths(commands);
    if (!subs.length) return null;

    // Dense polyline + signed area (shoelace) for each subpath.
    const sampled = subs.map((sp) => {
      const s = sampleSubpathDense(sp.commands, 12);
      const pts = s.points;
      let area2 = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area2 += a.x * b.y - b.x * a.y;
      }
      return { sp, points: pts, area2 };
    });

    // Global rotation sense: keyed off the contour with the largest |area|,
    // which is the outer silhouette. We want the outer contour to move
    // outward, so the normal rule is (G*ty, -G*tx) with G = sign(outerArea).
    // The (ty,-tx) rotation is outward for a CCW (area>0) contour; flip for
    // CW. Holes invert automatically via their opposite winding.
    let outer = sampled[0];
    for (const s of sampled) {
      if (Math.abs(s.area2) > Math.abs(outer.area2)) outer = s;
    }
    const G = outer.area2 >= 0 ? 1 : -1;

    const result = [];
    for (const s of sampled) {
      const points = s.points;
      const N = points.length;
      if (N < 4) {
        // Too small to offset meaningfully — keep the original commands.
        for (const cmd of s.sp.commands) result.push(cmd);
        continue;
      }
      const out = new Array(N);
      for (let i = 0; i < N; i++) {
        const p = points[i];
        const next = points[(i + 1) % N];
        const prev = points[(i - 1 + N) % N];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const tLen = Math.hypot(tx, ty) || 1;
        const nx = (G * ty) / tLen;
        const ny = (-G * tx) / tLen;
        const x = p.x + nx * delta;
        const y = p.y + ny * delta;
        if (!isFinite(x) || !isFinite(y)) return null; // degenerate → fall back
        out[i] = { x, y };
      }
      result.push({ type: "M", x: out[0].x, y: out[0].y });
      for (let i = 1; i < N; i++) {
        result.push({ type: "L", x: out[i].x, y: out[i].y });
      }
      result.push({ type: "Z" });
    }
    return result;
  }

  /**
   * Region-clipped vertical scale — the `height` handle.
   *
   * Scales only the band between the baseline (y=0) and `bandTopY` (a
   * negative number, since up is −y in glyph space) by factor `f`, pinned at
   * the baseline. Outline above the band (y < bandTopY — e.g. an ascender
   * stem or the bar of a `b`) keeps its absolute y; outline below the
   * baseline (y > 0 — a descender) is untouched and stays under the
   * descenderDepth handle's control.
   *
   * Consequences that match the definition-of-done:
   *  - Short lowercase (`o`, `a`): the whole glyph lives in the x-height
   *    band, so it scales uniformly — same as the old whole-glyph scale.
   *  - Ascender lowercase (`b`, `h`, `l`): only the x-height portion scales;
   *    the part of the stem above x-height stays at the same y (it keeps a
   *    continuous fill, just a density kink at the x-height line).
   *  - Uppercase: bandTopY = −capHeight spans the whole cap, so it scales
   *    uniformly like before; the baseline stays put.
   *
   * Curves that straddle the x-height line get a small distortion (their
   * endpoints scale, an off-band control point pins) — acceptable for a
   * pedagogy toy; documented rather than corrected.
   */
  function bandScaleY(commands, f, bandTopY) {
    if (!commands || Math.abs(f - 1) < 0.001) return commands;
    return transformCommandPoints(commands, function (x, y) {
      if (y <= 0 && y >= bandTopY) return { x, y: y * f }; // in band → scale
      return { x, y }; // above x-height or below baseline → pinned
    });
  }

  /**
   * Serif-foot translation — the `serifLength` handle.
   *
   * Stretches/shrinks only the baseline serif stubs of a glyph, leaving the
   * stem and the rest of the body put. Visually distinct from the old
   * prototype, which scaled the whole glyph horizontally.
   *
   * Heuristic for "serif foot endpoint":
   *  - A vertex sits in the baseline band when `|y| < tol`. The serif feet of
   *    a Latin serif glyph rest on the baseline, so they live in this band.
   *  - The "stem edge" reference is the x-extent of the contour measured in a
   *    thin slice JUST ABOVE the band (`tol ≤ |y| < refTop`) — i.e. the stem
   *    cross-section right where the foot meets it. A serif foot is a
   *    baseline-band vertex whose x lies BEYOND that reference range on the
   *    left or right — the overhang. Measuring against the slice just above
   *    (rather than the whole body) matters: on `a`/`b` the bowl is the widest
   *    part of the glyph, so a whole-body reference would swallow the foot;
   *    the local slice keeps the comparison at the stem.
   *  - Each overhang vertex is pivoted at the nearest reference edge and
   *    scaled by `mult`: `x' = edge + (x - edge) * mult`. The inner outline
   *    (everything within the reference range) is untouched, so only the foot
   *    stretches. `mult = 1` is identity.
   *
   * Per subpath. A contour with no out-of-band overhang relative to its local
   * slice (`o`, and the bowl-dominated baseline of `a` on this face) yields no
   * feet and degrades to a no-op for that contour. Round-bottom letters never
   * reach here (the handle is suppressed upstream), but the heuristic is a
   * graceful no-op for them regardless.
   *
   * `tol` is the baseline band half-height; the caller passes ~0.10·xHeight.
   */
  function serifFootTranslate(commands, mult, tol) {
    if (!commands || Math.abs(mult - 1) < 0.001) return commands;
    const band = Math.max(1, tol);
    // Reference slice runs from the band top up by ~2·band — the stem
    // cross-section immediately above the foot. A small epsilon keeps a foot's
    // own overhang from leaking into the reference at curvy joins.
    const refTop = band * 3;
    const eps = band * 0.05;
    const subs = splitSubpaths(commands);
    if (!subs.length) return commands;

    let moved = false;
    const out = [];
    for (const sp of subs) {
      const pts = collectCommandPoints(sp.commands);
      // Stem edge reference = x-extent of vertices in the slice just above the
      // baseline band (both above the baseline, |y| in [band, refTop)).
      let edgeMinX = Infinity;
      let edgeMaxX = -Infinity;
      for (const p of pts) {
        const ay = Math.abs(p.y);
        if (ay >= band && ay < refTop) {
          if (p.x < edgeMinX) edgeMinX = p.x;
          if (p.x > edgeMaxX) edgeMaxX = p.x;
        }
      }
      // No reference slice (a flat stub-only contour, or a bowl that never
      // crosses the slice) → can't separate foot from stem; leave untouched.
      if (!isFinite(edgeMinX) || edgeMaxX <= edgeMinX) {
        for (const c of sp.commands) out.push(c);
        continue;
      }
      const translated = transformCommandPoints(sp.commands, function (x, y) {
        if (Math.abs(y) >= band) return { x, y }; // outside baseline band
        if (x < edgeMinX - eps) {
          moved = true;
          return { x: edgeMinX + (x - edgeMinX) * mult, y };
        }
        if (x > edgeMaxX + eps) {
          moved = true;
          return { x: edgeMaxX + (x - edgeMaxX) * mult, y };
        }
        return { x, y }; // within the stem cross-section → inner outline, pinned
      });
      for (const c of translated) out.push(c);
    }
    // Nothing qualified as a serif foot on any subpath → no-op (degrade
    // gracefully rather than scaling the whole glyph).
    return moved ? out : commands;
  }

  function applyWidthScale(commands, scaleX, bounds) {
    if (!commands || Math.abs(scaleX - 1) < 0.001) return commands;
    const ox = bounds.minX;
    return transformCommandPoints(commands, function (x, y) {
      return { x: ox + (x - ox) * scaleX, y };
    });
  }

  /** Signed area (shoelace) of one subpath's command points. Sign encodes
   *  winding; magnitude is approximate (uses control points) but only the
   *  sign and relative size matter to the callers below. */
  function signedAreaOfCommands(commands) {
    const pts = collectCommandPoints(commands);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  /**
   * Anatomy-aware horizontal width — the `width` handle.
   *
   * The prototype scaled the whole glyph horizontally about its left edge,
   * which fattened the stems along with the bowl. This widens the
   * bowl/counter while keeping stem thickness constant.
   *
   * Mechanism — a left-pinned, saturating horizontal displacement field:
   *   - Map each x to p = (x − minX) / glyphWidth ∈ [0, 1].
   *   - Displace by d(p) = D · r(p), where D = (w − 1)·glyphWidth (so the
   *     glyph's right edge moves exactly as far as the old scale moved it —
   *     same overall footprint and advance, same handle feel) and r(p) is a
   *     smoothstep ramp: 0 across the left flat zone (p ≤ a), 1 across the
   *     right flat zone (p ≥ 1−a), smooth in between.
   * Because r is flat (slope 0) over the outer `a` fraction on each side, any
   * vertical stem living there is translated rigidly — its two edges shift by
   * the same d, so its thickness is preserved exactly. The counter between the
   * stems falls in the sloped middle and stretches; that is the widening.
   *
   * Counter gate: the stem-preserving ramp only makes sense when there's a
   * counter to widen. Glyphs with no hole (no opposite-wound subpath) — `i`,
   * `l`, `j`'s stem, etc. — would just get their single stem stretched by the
   * ramp's middle slope, so they fall back to the prototype's uniform
   * left-anchored scale (no regression, no grotesque fattening of a lone stem).
   *
   * `a` is a fixed bbox fraction (0.3). On faces whose stem/counter split sits
   * outside that fraction the stem can distort slightly; acceptable + documented
   * (this is a quality refinement, not a foundational fix).
   */
  function anatomyWidth(commands, w) {
    if (!commands || Math.abs(w - 1) < 0.001) return commands;
    const b = boundsFromCommands(commands);
    const minX = b.minX;
    const glyphW = b.maxX - b.minX;
    if (glyphW < 1) return commands;

    // Detect a counter (shared detector, the gate the JSDoc
    // promises): a subpath wound opposite the outer contour with non-trivial
    // area. No counter → uniform left-anchored scale.
    const subs = splitSubpaths(commands);
    const hasCounter = detectCounters(subs).counterIndices.length > 0;

    if (!hasCounter) {
      return transformCommandPoints(commands, function (x, y) {
        return { x: minX + (x - minX) * w, y };
      });
    }

    const D = (w - 1) * glyphW;
    const a = 0.3;
    return transformCommandPoints(commands, function (x, y) {
      const p = (x - minX) / glyphW;
      let r;
      if (p <= a) r = 0;
      else if (p >= 1 - a) r = 1;
      else {
        const u = (p - a) / (1 - 2 * a);
        r = u * u * (3 - 2 * u); // smoothstep
      }
      return { x: x + D * r, y };
    });
  }

  /**
   * Single counter detector. Walks every subpath once,
   * computing its signed area (shoelace; sign encodes winding), and returns:
   *   - `outerIndex`   — index of the largest-|area| subpath (the outer contour)
   *   - `counterIndices` — subpaths wound opposite the outer with non-trivial
   *     area (the enclosed counters; `B`/`g` have two)
   *   - `centroid`     — bbox center of the *largest* counter, or null when the
   *     glyph has no counter (i, l, stems, …)
   *   - `areas`        — the per-subpath signed areas (reused by callers)
   * This is the shared gate every counter consumer agrees on (anatomyWidth's
   * `hasCounter`, counterCentroid, counterScale) — same winding + 2%-area rule.
   */
  function detectCounters(subs) {
    const areas = new Array(subs.length);
    let outerIndex = -1;
    let outerArea = 0;
    for (let i = 0; i < subs.length; i++) {
      const a = signedAreaOfCommands(subs[i].commands);
      areas[i] = a;
      if (Math.abs(a) > Math.abs(outerArea)) {
        outerArea = a;
        outerIndex = i;
      }
    }
    if (Math.abs(outerArea) < 1) {
      return { outerIndex: -1, counterIndices: [], centroid: null, areas };
    }
    const outerSign = outerArea >= 0 ? 1 : -1;
    const counterIndices = [];
    for (let i = 0; i < subs.length; i++) {
      const a = areas[i];
      if (
        (a >= 0 ? 1 : -1) === -outerSign &&
        Math.abs(a) > 0.02 * Math.abs(outerArea)
      ) {
        counterIndices.push(i);
      }
    }
    let centroid = null;
    if (counterIndices.length) {
      let best = counterIndices[0];
      let bestA = 0;
      for (const i of counterIndices) {
        const aa = Math.abs(areas[i]);
        if (aa > bestA) {
          bestA = aa;
          best = i;
        }
      }
      const b = boundsFromCommands(subs[best].commands);
      centroid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    return { outerIndex, counterIndices, centroid, areas };
  }

  /** Indices (into splitSubpaths order) of a glyph's enclosed counter
   *  subpath(s). Thin wrapper over detectCounters. */
  function counterSubpathIndices(subs) {
    return detectCounters(subs).counterIndices;
  }

  /** Centroid (bbox center) of a glyph's largest enclosed counter, or null
   *  when the glyph has no counter (i, l, stems, …). This is the anchor for
   *  the `counterContour` handle. Derived from the base outline, so a
   *  letter without a counter never shows the handle. */
  function counterCentroid(commands) {
    if (!commands) return null;
    return detectCounters(splitSubpaths(commands)).centroid;
  }

  // Minimum stroke kept between a grown counter and the outer contour, as a
  // fraction of the glyph's smaller outer dimension. Stops a round letter's
  // counter (already ~70% of the glyph) from bursting through the outline at
  // the top of the range — the stroke thins but the ring never breaks.
  const COUNTER_STROKE_FLOOR_FRAC = 0.06;

  /**
   * Scale a glyph's inner counter about its centroid by factor `s`,
   * leaving the outer contour untouched. Reuses the same counter-detection
   * gate as anatomyWidth (so width and counterContour agree on what a counter
   * is). All counter subpaths scale about the *largest* counter's centroid so
   * a two-counter letter (`g`, `B`) stays coherent. Glyphs with no counter are
   * returned unchanged (defensive — the handle is only wired onto letters that
   * have one, but mouse-follow / state restore could still call this).
   *
   * Growth (s > 1) is capped per glyph so the scaled counter stays a minimum
   * stroke inside the outer contour: on a big-counter round letter the grow
   * saturates gracefully instead of the counter poking out past the outline.
   * Shrink (s < 1) is never capped.
   *
   * `center` — the pivot. The caller passes the same centroid it
   * anchors the `counterContour` handle to, so the scale pivot and the visible
   * dot can never diverge. Falls back to recomputing from `commands` when not
   * supplied (mouse-follow / state-restore paths that don't carry a pivot).
   * `weight` — the half-width the weight stroke overlay will eat
   * inward from the counter; reserved in the growth floor so the ring holds
   * with weight on.
   */
  function counterScale(commands, s, center, weight) {
    if (!commands || Math.abs(s - 1) < 0.001) return commands;
    const subs = splitSubpaths(commands);
    // One detector pass yields the counter indices, the outer
    // contour index, and the fallback centroid (no separate scans).
    const det = detectCounters(subs);
    const cidx = det.counterIndices;
    if (!cidx.length) return commands;
    const c = center || det.centroid;
    if (!c) return commands;
    const w = weight || 0;

    let sEff = s;
    if (s > 1) {
      // Outer contour = largest-|area| subpath (from the detector pass).
      const outerI = det.outerIndex;
      const ob = boundsFromCommands(subs[outerI].commands);
      // Cap against the *real* minimum gap between the counter
      // contour and the outer contour, sampled densely, not the four
      // axis-aligned bbox extents: a bowl widest on a diagonal (a/e) pokes
      // through between the axes under the old bbox cap. The floor also
      // reserves `weight/2` — the half-width the weight stroke eats inward —
      // so the ring never breaks across the full 0.6–1.4 range with weight on.
      const outerPts = sampleSubpathDense(subs[outerI].commands, 12).points;
      const floor =
        COUNTER_STROKE_FLOOR_FRAC *
          Math.min(ob.maxX - ob.minX, ob.maxY - ob.minY) +
        w / 2;
      // Scaling a counter sample by s about the pivot moves it outward by
      // (s−1)·r along its radius (r = distance from pivot). By the triangle
      // inequality the post-scale gap to the nearest outer point is ≥
      // gap−(s−1)·r, so capping s ≤ 1+(gap−floor)/r per sample guarantees the
      // tightest point keeps `floor` clearance (conservative, never breaches).
      for (const ci of cidx) {
        const cpts = sampleSubpathDense(subs[ci].commands, 12).points;
        for (const cp of cpts) {
          let gap = Infinity;
          for (const op of outerPts) {
            const d = Math.hypot(cp.x - op.x, cp.y - op.y);
            if (d < gap) gap = d;
          }
          if (gap === Infinity) continue;
          const r = Math.hypot(cp.x - c.x, cp.y - c.y);
          if (r <= 0.001) continue;
          const cap = 1 + (gap - floor) / r;
          if (cap < sEff) sEff = Math.max(1, cap);
        }
      }
    }

    const idx = new Set(cidx);
    const out = [];
    for (let i = 0; i < subs.length; i++) {
      if (idx.has(i)) {
        const scaled = transformCommandPoints(
          subs[i].commands,
          function (x, y) {
            return { x: c.x + (x - c.x) * sEff, y: c.y + (y - c.y) * sEff };
          }
        );
        for (const cmd of scaled) out.push(cmd);
      } else {
        for (const cmd of subs[i].commands) out.push(cmd);
      }
    }
    return out;
  }

  function buildSerifExtras(commands, t, bounds) {
    if (!commands || t <= 0.001) return "";
    const pts = collectCommandPoints(commands);
    const h = bounds.maxY - bounds.minY;
    const threshold = Math.max(10, h * 0.025);
    const len = Math.max(6, (bounds.maxX - bounds.minX) * 0.035 * t + 10 * t);
    const seen = new Set();
    const parts = [];
    for (const pt of pts) {
      if (Math.abs(pt.y) > threshold) continue;
      const key = Math.round(pt.x / 4) + "|" + Math.round(pt.y);
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push("M " + (pt.x - len) + " 0 L " + pt.x + " 0");
      parts.push("M " + pt.x + " 0 L " + (pt.x + len) + " 0");
    }
    return parts.join(" ");
  }

  function defaultAxisValuesForPreset(preset) {
    const out = Object.create(null);
    if (!preset || !preset.axes) return out;
    for (const ax of preset.axes) {
      out[ax.id] = ax.default != null ? ax.default : (ax.min + ax.max) / 2;
    }
    return out;
  }

  function applyPresetAxesToCommands(commands, axisValues, preset) {
    if (!commands || !preset || !preset.axes)
      return { commands, serifExtra: "" };
    let cmds = cloneCommandsDeep(commands);
    let bounds = boundsFromCommands(cmds);
    let serifExtra = "";
    // Resolve `amplitude` once up-front — bubbliness consumes it, but
    // amplitude itself is not a standalone deformer (no visual effect
    // unless bubbliness > 0). Default matches applyBubbliness's
    // built-in default of 0.5 (reproduces the earlier visual).
    let amplitudeNorm = 0.5;
    for (const ax of preset.axes) {
      if (ax.id !== "amplitude") continue;
      const v = axisValues[ax.id] != null ? axisValues[ax.id] : ax.default;
      amplitudeNorm = (v - ax.min) / Math.max(0.0001, ax.max - ax.min);
      break;
    }
    for (const ax of preset.axes) {
      const v = axisValues[ax.id] != null ? axisValues[ax.id] : ax.default;
      const norm = (v - ax.min) / Math.max(0.0001, ax.max - ax.min);
      if (ax.id === "bubbliness") {
        // Bidirectional around 0.5 = font as-is: left smooths the native
        // bubbles away, right adds synthetic ones. `amplitude` scales the
        // height of both (threaded in; resolved above).
        cmds = applyBubbliness(cmds, norm, bounds, {
          amplitude: amplitudeNorm,
        });
        bounds = boundsFromCommands(cmds);
      } else if (ax.id === "amplitude") {
        // No-op here — read above and threaded into applyBubbliness.
      } else if (ax.id === "width") {
        const scaleX = 0.88 + norm * 0.24;
        cmds = applyWidthScale(cmds, scaleX, bounds);
        bounds = boundsFromCommands(cmds);
      } else if (ax.id === "serifLength") {
        serifExtra = buildSerifExtras(cmds, norm, bounds);
      }
    }
    return { commands: cmds, serifExtra };
  }

  function buildDeformedPathData(baseGlyph, axisValues, preset) {
    if (!baseGlyph.baseCommands) return baseGlyph.pathData;
    const applied = applyPresetAxesToCommands(
      baseGlyph.baseCommands,
      axisValues,
      preset
    );
    let d = commandsToPathData(applied.commands);
    if (applied.serifExtra) d += " " + applied.serifExtra;
    return d;
  }

  function extractOutlineGlyph(font, character, fontSize) {
    const glyph = font.charToGlyph(character);
    const advance =
      (glyph.advanceWidth || font.unitsPerEm * 0.5) *
      (fontSize / font.unitsPerEm);
    const path = glyph.getPath(0, 0, fontSize);
    const baseCommands = clonePathCommands(path);
    const d = path.toPathData(3);
    const bb = path.getBoundingBox();
    return {
      character,
      pathData: d,
      baseCommands,
      advance,
      bounds: {
        minX: bb.x1,
        maxX: bb.x2,
        minY: bb.y1,
        maxY: bb.y2,
      },
    };
  }

  function cacheKey(presetKey, char, fontSize) {
    return presetKey + "|" + char + "|" + fontSize;
  }

  // Band metrics for the `height` handle's region-clipped scale.
  // Derived empirically from reference-glyph bounding boxes rather than the
  // OS/2 table so it works for any loaded WOFF: the top of `x` is the
  // x-height line, the top of `H` is the cap-height line (both expressed as
  // positive distances above the baseline). Cached per preset+fontSize.
  const _bandMetricsCache = {};
  async function getAnatomyBandMetrics(presetKey, fontSize) {
    const key = presetKey + "|" + fontSize;
    if (_bandMetricsCache[key]) return _bandMetricsCache[key];
    // Sensible fallbacks if a reference glyph is missing from the face.
    let xHeight = fontSize * 0.5;
    let capHeight = fontSize * 0.7;
    try {
      const x = await getOutlineGlyphData(presetKey, "x", fontSize);
      if (x && x.bounds && x.bounds.minY < 0) xHeight = -x.bounds.minY;
    } catch (_e) {
      /* keep fallback */
    }
    try {
      const H = await getOutlineGlyphData(presetKey, "H", fontSize);
      if (H && H.bounds && H.bounds.minY < 0) capHeight = -H.bounds.minY;
    } catch (_e) {
      /* keep fallback */
    }
    // Overshoot allowance: round letters (o, e, c, O…) optically overshoot
    // the x-height/cap-height line by ~1–2.5% so they don't read short. The
    // band top must sit just ABOVE that overshoot, otherwise the overshoot
    // sliver falls outside the scaled band and pins while the rest of the
    // glyph scales — leaving a stuck nub at the top. 3% safely clears typical
    // overshoot without reaching into ascender territory (~45% taller).
    const OVERSHOOT = 1.03;
    const metrics = {
      xHeight: xHeight * OVERSHOOT,
      capHeight: capHeight * OVERSHOOT,
    };
    _bandMetricsCache[key] = metrics;
    return metrics;
  }

  async function getOutlineGlyphData(presetKey, character, fontSize) {
    const key = cacheKey(presetKey, character, fontSize);
    if (_glyphPathCache[key]) return _glyphPathCache[key];
    const font = await loadFontForPreset(presetKey);
    const data = extractOutlineGlyph(font, character, fontSize);
    _glyphPathCache[key] = data;
    return data;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Anatomy-deform constants (lib-level rules — see ADR 0001).
  // ──────────────────────────────────────────────────────────────────────

  // Round-bottom letters: serifLength is suppressed on these even when the
  // preset declares it. (Round terminals don't have baseline serifs to extend.)
  const ANATOMY_NO_BASELINE_SERIF = new Set([
    "o",
    "c",
    "e",
    "s",
    "g",
    "O",
    "C",
    "S",
    "Q",
    "G",
  ]);

  // Letters whose height-handle label is "ascender" rather than "x-height".
  const ANATOMY_ASCENDER_LETTERS = new Set(["b", "d", "f", "h", "k", "l", "t"]);

  // Lowercase descender letters. These get an extra `descenderDepth` handle
  // (bottom-center, below the bbox) on every anatomy-deform preset.
  // Uppercase Q has a tail but is intentionally excluded.
  const ANATOMY_DESCENDER_LETTERS = new Set(["g", "j", "p", "q", "y"]);

  // Per-glyph anchor overrides for letters where the WOFF bbox doesn't
  // match anatomy. Override shape (all optional, all per-handle):
  //   yFrac  — vertical offset of the anchor, expressed as a fraction of
  //            bbox height from the TOP of the bbox (0 = bbox top,
  //            1 = bbox bottom). Default for `height` is 0 (top).
  //   xFrac  — horizontal offset for `width`, as a fraction of bbox
  //            width from the LEFT (0 = left, 1 = right). Default for
  //            `width` is 1 (right edge).
  // Keep this list short: only letters that clearly look wrong with the
  // default bbox-derived anchor. The default (no override entry) wins
  // for everything else.
  const ANATOMY_ANCHOR_OVERRIDES = {
    // Lowercase f: the bbox top is at the top of the hook; for many serif
    // faces the hook extends well above the visual "ascender" of the f
    // body, so the height handle floats too high. Drop it a quarter of
    // the bbox toward the body.
    f: {
      height: { yFrac: 0.22 },
      // The crossbar pushes the bbox right; pull the width handle in so
      // it sits closer to the stem's visual right edge.
      width: { xFrac: 0.62 },
    },
    // Lowercase t: bbox top sits at the ascender; the crossbar is what
    // reads as the visual "top" of t's stem. Anchor at the crossbar.
    t: {
      height: { yFrac: 0.3 },
    },
    // Uppercase J: head terminal extends above the cap; drop the height
    // anchor onto the cap proper.
    J: {
      height: { yFrac: 0.18 },
    },
  };

  // Return the height-handle label for a single character:
  //   "cap-height" for A–Z, "ascender" for b/d/f/h/k/l/t, "x-height" otherwise.
  function anatomyHeightLabel(character) {
    if (character >= "A" && character <= "Z") return "cap-height";
    if (ANATOMY_ASCENDER_LETTERS.has(character)) return "ascender";
    return "x-height";
  }

  // Return the list of anatomy handle ids for one character on a given preset:
  //   - intersects preset.handles with letter-level skip rules (round-bottom
  //     serif suppresses serifLength)
  //   - appends `counterContour` when `addCounter` is set (the
  //     caller decides via the runtime counter detector, gated to the
  //     contrast/serif/sans presets; see presetHasCounterContour)
  //   - appends `descenderDepth` for the five lowercase descender letters on
  //     every anatomy-deform preset.
  function anatomyHandleIdsFor(character, presetHandles, addCounter) {
    if (!presetHandles || !presetHandles.length) return [];
    const out = [];
    const seen = new Set();
    const push = (id) => {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    };
    for (const id of presetHandles) {
      if (id === "serifLength" && ANATOMY_NO_BASELINE_SERIF.has(character))
        continue;
      push(id);
    }
    // Counter handle for any glyph the detector says has a
    // counter (the caller passes `addCounter`). Dedup via `seen`.
    if (addCounter) push("counterContour");
    if (ANATOMY_DESCENDER_LETTERS.has(character)) {
      push("descenderDepth");
    }
    return out;
  }

  const bubbly = {
    name: "bubbly",
    fontRef: "Rubik Bubbles",
    fontUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/rubik-bubbles@5.2.5/files/rubik-bubbles-latin-400-normal.woff",
    license: "OFL-1.1",
    copyright:
      "Copyright 2022 The Rubik Bubbles Project Authors (https://github.com/googlefonts/rubik-bubbles)",
    attribution: "Rubik Bubbles by NaN, Rubik Bubbles Project Authors",
    pipeline: "outline-deform",
    axes: [
      // Bidirectional bubble COUNT around 0.5 = font as-is. Left half melts
      // the native bubbles toward a smoothed baseline (fewer → clean blob at
      // 0); right half adds synthetic bumps (more, up to BUMPS_MAX). See
      // applyBubbliness for the baseline+detail decomposition.
      { id: "bubbliness", label: "Bubbliness", min: 0, max: 1, default: 0.5 },
      // bubble HEIGHT. 0.5 = native height; 0 flattens every bubble (native
      // and synthetic) to the smoothed baseline, 1 doubles them. Visible at
      // any bubbliness. Also driven by mouse-follow Y (DeformableOutlineWordmark).
      { id: "amplitude", label: "Amplitude", min: 0, max: 1, default: 0.5 },
    ],
    defaults: {
      strokeWeight: 28,
      xHeight: 140,
      capHeight: 168,
      curvature: 0.7,
      slant: 0,
    },
    glyphParams: curatedGlyphParams({
      a: {
        xHeight: 140,
        bowlWidth: 60,
        bowlHeight: 62,
        strokeWeight: 28,
        aperture: 14,
        terminalLength: 22,
        bowlTopTension: 0.62,
        terminalArm: 14,
      },
      n: {
        xHeight: 140,
        archWidth: 92,
        strokeWeight: 28,
        shoulder: 38,
        archTension: 0.62,
      },
      o: {
        bowlWidth: 64,
        bowlHeight: 64,
        strokeWeight: 28,
        bowlTopTension: 0.62,
        bowlSideTension: 0.62,
      },
      s: {
        xHeight: 140,
        sWidth: 78,
        strokeWeight: 28,
        curlTop: 28,
        curlBottom: 28,
        waistTension: 0.62,
      },
      h: {
        xHeight: 140,
        ascenderRise: 50,
        archWidth: 92,
        strokeWeight: 28,
        shoulder: 38,
        archTension: 0.62,
      },
      i: { xHeight: 140, strokeWeight: 28, dotGap: 18 },
      e: {
        bowlWidth: 62,
        bowlHeight: 62,
        strokeWeight: 28,
        aperture: 32,
        crossbarOffset: 10,
        bowlTopTension: 0.62,
      },
      t: {
        totalHeight: 168,
        xHeight: 140,
        strokeWeight: 28,
        crossbarLeft: 20,
        crossbarRight: 24,
        footCurl: 12,
        footArm: 10,
      },
      r: {
        xHeight: 140,
        strokeWeight: 28,
        armLength: 36,
        armRise: 22,
        armArm: 20,
      },
      l: {
        xHeight: 140,
        ascenderRise: 50,
        strokeWeight: 28,
        footCurl: 18,
        footArm: 12,
      },
      w: {
        xHeight: 140,
        width: 140,
        dip: 22,
        strokeWeight: 28,
        joinTension: 0.5,
        exitCurl: 18,
        exitArm: 12,
      },
      d: {
        xHeight: 140,
        ascenderRise: 50,
        bowlWidth: 62,
        bowlHeight: 62,
        strokeWeight: 28,
        bowlTopTension: 0.62,
        bowlSideTension: 0.62,
      },
      b: {
        xHeight: 140,
        bowlWidth: 54,
        bowlHeight: 56,
        strokeWeight: 28,
        shoulder: 36,
        bowlTopTension: 0.62,
        bowlSideTension: 0.62,
      },
      c: {
        bowlWidth: 56,
        bowlHeight: 58,
        strokeWeight: 28,
        opening: 22,
        bowlTopTension: 0.62,
        bowlSideTension: 0.62,
      },
      m: {
        xHeight: 140,
        archWidth: 44,
        strokeWeight: 28,
        shoulder: 34,
        archTension: 0.62,
      },
      g: {
        xHeight: 140,
        bowlWidth: 52,
        bowlHeight: 50,
        strokeWeight: 28,
        descenderDrop: 48,
        bowlTopTension: 0.62,
        bowlSideTension: 0.62,
      },
      " ": { width: 56, strokeWeight: 28 },
    }),
  };

  // Instrument Serif — soft curves, refined contrast, gentle italic lean.
  const instrumentSerif = {
    name: "instrumentSerif",
    fontRef: "Instrument Serif",
    fontUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/instrument-serif@5.2.5/files/instrument-serif-latin-400-normal.woff",
    license: "OFL-1.1",
    copyright:
      "Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)",
    attribution: "Instrument Serif by Instrument",
    pipeline: "anatomy-deform",
    handles: ["height", "width", "serifLength", "weight"],
    counterContour: true, // Counter handle on any countered glyph (runtime detector)
    defaults: {
      strokeWeight: 22,
      xHeight: 138,
      capHeight: 166,
      curvature: 0.45,
      slant: 0.04,
      serifLength: 8,
    },
    glyphParams: curatedGlyphParams({
      a: {
        xHeight: 138,
        bowlWidth: 58,
        bowlHeight: 64,
        strokeWeight: 22,
        aperture: 12,
        terminalLength: 22,
        bowlTopTension: 0.74,
        bowlBottomTension: 0.74,
        terminalArm: 14,
        serifLength: 10,
      },
      n: {
        xHeight: 138,
        archWidth: 90,
        strokeWeight: 22,
        shoulder: 36,
        archTension: 0.72,
      },
      o: {
        bowlWidth: 64,
        bowlHeight: 66,
        strokeWeight: 22,
        bowlTopTension: 0.74,
        bowlSideTension: 0.74,
      },
      s: {
        xHeight: 138,
        sWidth: 76,
        strokeWeight: 22,
        curlTop: 26,
        curlBottom: 26,
        waistTension: 0.68,
      },
      h: {
        xHeight: 138,
        ascenderRise: 54,
        archWidth: 90,
        strokeWeight: 22,
        shoulder: 36,
        archTension: 0.72,
      },
      i: { xHeight: 138, strokeWeight: 22, dotGap: 18 },
      e: {
        bowlWidth: 60,
        bowlHeight: 62,
        strokeWeight: 22,
        aperture: 30,
        crossbarOffset: 10,
        bowlTopTension: 0.72,
        bowlSideTension: 0.72,
        serifLength: 8,
      },
      t: {
        totalHeight: 166,
        xHeight: 138,
        strokeWeight: 22,
        crossbarLeft: 18,
        crossbarRight: 22,
        footCurl: 10,
        footArm: 10,
      },
      r: {
        xHeight: 138,
        strokeWeight: 22,
        armLength: 34,
        armRise: 20,
        armArm: 18,
      },
      l: {
        xHeight: 138,
        ascenderRise: 54,
        strokeWeight: 22,
        footCurl: 16,
        footArm: 12,
        serifLength: 8,
      },
      w: {
        xHeight: 138,
        width: 136,
        dip: 20,
        strokeWeight: 22,
        joinTension: 0.58,
        exitCurl: 16,
        exitArm: 12,
      },
      d: {
        xHeight: 138,
        ascenderRise: 54,
        bowlWidth: 60,
        bowlHeight: 62,
        strokeWeight: 22,
        bowlTopTension: 0.72,
        bowlSideTension: 0.72,
      },
      b: {
        xHeight: 138,
        bowlWidth: 54,
        bowlHeight: 56,
        strokeWeight: 22,
        shoulder: 34,
        bowlTopTension: 0.74,
        bowlSideTension: 0.74,
        serifLength: 10,
      },
      c: {
        bowlWidth: 56,
        bowlHeight: 58,
        strokeWeight: 22,
        opening: 20,
        bowlTopTension: 0.74,
        bowlSideTension: 0.74,
        serifLength: 8,
      },
      m: {
        xHeight: 138,
        archWidth: 42,
        strokeWeight: 22,
        shoulder: 32,
        archTension: 0.7,
        serifLength: 9,
      },
      g: {
        xHeight: 138,
        bowlWidth: 50,
        bowlHeight: 48,
        strokeWeight: 22,
        descenderDrop: 46,
        bowlTopTension: 0.74,
        bowlSideTension: 0.74,
        serifLength: 8,
      },
      " ": { width: 52, strokeWeight: 22 },
    }),
  };

  // Source Sans 3 — neutral utilitarian sans; straight strokes, balanced proportions.
  const sourceSans = {
    name: "sourceSans",
    fontRef: "Source Sans 3",
    fontUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/source-sans-3@5.2.5/files/source-sans-3-latin-400-normal.woff",
    license: "OFL-1.1",
    copyright:
      "Copyright 2023 The Source Sans 3 Project Authors (https://github.com/adobe-fonts/source-sans)",
    attribution: "Source Sans 3 by Paul D. Hunt, Adobe",
    strokeJoin: "miter",
    pipeline: "anatomy-deform",
    handles: ["height", "width", "weight"],
    counterContour: true, // Counter handle on any countered glyph (runtime detector)
    defaults: {
      strokeWeight: 24,
      xHeight: 140,
      capHeight: 170,
      curvature: 0,
      slant: 0,
    },
    glyphParams: curatedGlyphParams({
      a: {
        xHeight: 140,
        bowlWidth: 60,
        bowlHeight: 60,
        strokeWeight: 24,
        aperture: 14,
        terminalLength: 20,
        bowlTopTension: 0.55,
        terminalArm: 14,
      },
      n: {
        xHeight: 140,
        archWidth: 92,
        strokeWeight: 24,
        shoulder: 38,
        archTension: 0.55,
      },
      o: {
        bowlWidth: 62,
        bowlHeight: 62,
        strokeWeight: 24,
        bowlTopTension: 0.55,
        bowlSideTension: 0.55,
      },
      s: {
        xHeight: 140,
        sWidth: 72,
        strokeWeight: 24,
        curlTop: 24,
        curlBottom: 24,
        waistTension: 0.55,
      },
      h: {
        xHeight: 140,
        ascenderRise: 50,
        archWidth: 92,
        strokeWeight: 24,
        shoulder: 38,
        archTension: 0.55,
      },
      i: { xHeight: 140, strokeWeight: 24, dotGap: 16 },
      e: {
        bowlWidth: 58,
        bowlHeight: 58,
        strokeWeight: 24,
        aperture: 28,
        crossbarOffset: 10,
        bowlTopTension: 0.55,
      },
      t: {
        totalHeight: 160,
        xHeight: 140,
        strokeWeight: 24,
        crossbarLeft: 18,
        crossbarRight: 22,
        footCurl: 10,
        footArm: 8,
      },
      r: {
        xHeight: 140,
        strokeWeight: 24,
        armLength: 32,
        armRise: 18,
        armArm: 18,
      },
      l: {
        xHeight: 140,
        ascenderRise: 50,
        strokeWeight: 24,
        footCurl: 16,
        footArm: 10,
      },
      w: {
        xHeight: 140,
        width: 132,
        dip: 20,
        strokeWeight: 24,
        joinTension: 0.46,
        exitCurl: 18,
        exitArm: 12,
      },
      d: {
        xHeight: 140,
        ascenderRise: 50,
        bowlWidth: 56,
        bowlHeight: 58,
        strokeWeight: 24,
        bowlTopTension: 0.55,
        bowlSideTension: 0.55,
      },
      b: {
        xHeight: 140,
        bowlWidth: 54,
        bowlHeight: 56,
        strokeWeight: 24,
        shoulder: 36,
        bowlTopTension: 0.55,
        bowlSideTension: 0.55,
      },
      c: {
        bowlWidth: 56,
        bowlHeight: 56,
        strokeWeight: 24,
        opening: 22,
        bowlTopTension: 0.55,
        bowlSideTension: 0.55,
      },
      m: {
        xHeight: 140,
        archWidth: 44,
        strokeWeight: 24,
        shoulder: 34,
        archTension: 0.55,
      },
      g: {
        xHeight: 140,
        bowlWidth: 52,
        bowlHeight: 50,
        strokeWeight: 24,
        descenderDrop: 48,
        bowlTopTension: 0.55,
        bowlSideTension: 0.55,
      },
      " ": { width: 56, strokeWeight: 24 },
    }),
  };

  // Bitter — rectangular slab serif; heavy stroke, low tension, blocky bowls.
  const bitter = {
    name: "bitter",
    fontRef: "Bitter",
    fontUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/bitter@5.2.5/files/bitter-latin-400-normal.woff",
    license: "OFL-1.1",
    copyright:
      "Copyright 2011 The Bitter Project Authors (https://github.com/solmatas/Bitter-Pro)",
    attribution: "Bitter by Huerta Tipográfica",
    strokeJoin: "miter",
    pipeline: "anatomy-deform",
    handles: ["height", "width", "serifLength", "weight"],
    counterContour: true, // Counter handle on any countered glyph (runtime detector)
    defaults: {
      strokeWeight: 28,
      xHeight: 132,
      capHeight: 160,
      curvature: 0.02,
      slant: 0,
      serifLength: 10,
    },
    glyphParams: curatedGlyphParams({
      a: {
        xHeight: 132,
        bowlWidth: 62,
        bowlHeight: 58,
        strokeWeight: 28,
        aperture: 10,
        terminalLength: 18,
        bowlTopTension: 0.38,
        bowlBottomTension: 0.38,
        terminalArm: 10,
        serifLength: 12,
      },
      n: {
        xHeight: 132,
        archWidth: 96,
        strokeWeight: 28,
        shoulder: 42,
        archTension: 0.38,
      },
      o: {
        bowlWidth: 66,
        bowlHeight: 60,
        strokeWeight: 28,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
      },
      s: {
        xHeight: 132,
        sWidth: 80,
        strokeWeight: 28,
        curlTop: 22,
        curlBottom: 22,
        waistTension: 0.4,
      },
      h: {
        xHeight: 132,
        ascenderRise: 48,
        archWidth: 96,
        strokeWeight: 28,
        shoulder: 42,
        archTension: 0.38,
      },
      i: { xHeight: 132, strokeWeight: 28, dotGap: 16 },
      e: {
        bowlWidth: 62,
        bowlHeight: 58,
        strokeWeight: 28,
        aperture: 24,
        crossbarOffset: 10,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
        serifLength: 10,
      },
      t: {
        totalHeight: 160,
        xHeight: 132,
        strokeWeight: 28,
        crossbarLeft: 22,
        crossbarRight: 26,
        footCurl: 8,
        footArm: 6,
      },
      r: {
        xHeight: 132,
        strokeWeight: 28,
        armLength: 34,
        armRise: 16,
        armArm: 14,
      },
      l: {
        xHeight: 132,
        ascenderRise: 48,
        strokeWeight: 28,
        footCurl: 14,
        footArm: 8,
        serifLength: 10,
      },
      w: {
        xHeight: 132,
        width: 144,
        dip: 16,
        strokeWeight: 28,
        joinTension: 0.35,
        exitCurl: 12,
        exitArm: 8,
      },
      d: {
        xHeight: 132,
        ascenderRise: 48,
        bowlWidth: 60,
        bowlHeight: 58,
        strokeWeight: 28,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
      },
      b: {
        xHeight: 132,
        bowlWidth: 56,
        bowlHeight: 54,
        strokeWeight: 28,
        shoulder: 38,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
        serifLength: 12,
      },
      c: {
        bowlWidth: 58,
        bowlHeight: 56,
        strokeWeight: 28,
        opening: 20,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
        serifLength: 10,
      },
      m: {
        xHeight: 132,
        archWidth: 44,
        strokeWeight: 28,
        shoulder: 36,
        archTension: 0.38,
        serifLength: 11,
      },
      g: {
        xHeight: 132,
        bowlWidth: 52,
        bowlHeight: 48,
        strokeWeight: 28,
        descenderDrop: 46,
        bowlTopTension: 0.38,
        bowlSideTension: 0.38,
        serifLength: 10,
      },
      " ": { width: 60, strokeWeight: 28 },
    }),
  };

  // IBM Plex Mono — engineered monospaced; uniform cell width, neutral stroke.
  const ibmPlexMono = {
    name: "ibmPlexMono",
    fontRef: "IBM Plex Mono",
    fontUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.2.5/files/ibm-plex-mono-latin-400-normal.woff",
    license: "OFL-1.1",
    copyright: "Copyright 2017 IBM Corp. All rights reserved.",
    attribution: "IBM Plex Mono by IBM",
    monoCell: 92,
    pipeline: "anatomy-deform",
    handles: ["height", "width", "weight"],
    defaults: {
      strokeWeight: 22,
      xHeight: 128,
      capHeight: 154,
      curvature: 0,
      slant: 0,
      width: 92,
    },
    glyphParams: curatedGlyphParams({
      a: {
        xHeight: 128,
        bowlWidth: 52,
        bowlHeight: 54,
        strokeWeight: 22,
        aperture: 12,
        terminalLength: 18,
        bowlTopTension: 0.5,
        terminalArm: 10,
      },
      n: {
        xHeight: 128,
        archWidth: 78,
        strokeWeight: 22,
        shoulder: 34,
        archTension: 0.5,
      },
      o: {
        bowlWidth: 54,
        bowlHeight: 54,
        strokeWeight: 22,
        bowlTopTension: 0.5,
        bowlSideTension: 0.5,
      },
      s: {
        xHeight: 128,
        sWidth: 68,
        strokeWeight: 22,
        curlTop: 20,
        curlBottom: 20,
        waistTension: 0.5,
      },
      h: {
        xHeight: 128,
        ascenderRise: 44,
        archWidth: 78,
        strokeWeight: 22,
        shoulder: 34,
        archTension: 0.5,
      },
      i: { xHeight: 128, strokeWeight: 22, dotGap: 14 },
      e: {
        bowlWidth: 52,
        bowlHeight: 52,
        strokeWeight: 22,
        aperture: 24,
        crossbarOffset: 8,
        bowlTopTension: 0.5,
      },
      t: {
        totalHeight: 154,
        xHeight: 128,
        strokeWeight: 22,
        crossbarLeft: 20,
        crossbarRight: 20,
        footCurl: 8,
        footArm: 6,
      },
      r: {
        xHeight: 128,
        strokeWeight: 22,
        armLength: 28,
        armRise: 16,
        armArm: 14,
      },
      l: {
        xHeight: 128,
        ascenderRise: 44,
        strokeWeight: 22,
        footCurl: 12,
        footArm: 8,
      },
      w: {
        xHeight: 128,
        width: 92,
        dip: 14,
        strokeWeight: 22,
        joinTension: 0.42,
        exitCurl: 10,
        exitArm: 8,
      },
      d: {
        xHeight: 128,
        ascenderRise: 44,
        bowlWidth: 52,
        bowlHeight: 54,
        strokeWeight: 22,
        bowlTopTension: 0.5,
        bowlSideTension: 0.5,
        rightBearing: 4,
      },
      b: {
        xHeight: 128,
        bowlWidth: 48,
        bowlHeight: 50,
        strokeWeight: 22,
        shoulder: 32,
        bowlTopTension: 0.5,
        bowlSideTension: 0.5,
        rightBearing: 6,
      },
      c: {
        bowlWidth: 50,
        bowlHeight: 50,
        strokeWeight: 22,
        opening: 20,
        bowlTopTension: 0.5,
        bowlSideTension: 0.5,
        rightBearing: 8,
      },
      m: {
        xHeight: 128,
        archWidth: 40,
        strokeWeight: 22,
        shoulder: 30,
        archTension: 0.5,
        rightBearing: 4,
      },
      g: {
        xHeight: 128,
        bowlWidth: 48,
        bowlHeight: 46,
        strokeWeight: 22,
        descenderDrop: 44,
        bowlTopTension: 0.5,
        bowlSideTension: 0.5,
        rightBearing: 6,
      },
      " ": { width: 92, strokeWeight: 22 },
    }),
  };

  const presets = { bubbly, instrumentSerif, sourceSans, bitter, ibmPlexMono };

  // Resolve preset params for a character: start from filtered defaults, then
  // overlay glyphParams[ch] per key. Only keys that exist on the glyph module's
  // defaultParams are applied.
  function resolvePresetParams(preset, character, module) {
    if (!preset) return null;
    const filtered = {};
    const defaults = preset.defaults;
    if (defaults) {
      for (const k of Object.keys(defaults)) {
        if (k in module.defaultParams) filtered[k] = defaults[k];
      }
    }
    const direct = preset.glyphParams && preset.glyphParams[character];
    if (direct) {
      for (const k of Object.keys(direct)) {
        if (k in module.defaultParams) filtered[k] = direct[k];
      }
    }
    return Object.keys(filtered).length ? filtered : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // SANDBOX WORDMARK
  // (renamed from Wordmark — now serves the `none` preset only.
  //  The four named-font presets route to AnatomyDeformWordmark and
  //  `bubbly` routes to DeformableOutlineWordmark. A `Wordmark` alias
  //  is kept in the public exports for back-compat with previously
  //  generated toInteractiveBundle() HTML files.)
  // ════════════════════════════════════════════════════════════════════
  class SandboxWordmark {
    constructor(text, options) {
      options = options || {};
      this.text = text;
      this.tracking = options.tracking != null ? options.tracking : 8;
      this.color = options.color || "#2a2ae5";
      this.padding = options.padding != null ? options.padding : 40;
      this._preset = options.preset || null;
      this._monoCell = (this._preset && this._preset.monoCell) || 0;

      this.glyphs = Array.from(text).map((ch) => {
        const module = registry[ch];
        if (!module)
          throw new Error("No glyph registered for character '" + ch + "'");
        const presetParams = resolvePresetParams(this._preset, ch, module);
        return new Glyph(module, presetParams);
      });

      this.svgEl = null;
      this.glyphLayer = null;
      this.handleLayer = null;
      this.tooltipLayer = null;
      this.interactive = true;
      this.tooltipState = null;
      this.dragState = null;
      this._layoutCache = null; // CHANGE [Sprint 1, fix #4]: cached across drag frames
      this._dragMoveBound = (e) => this._onDragMove(e);
      this._dragEndBound = () => this._onDragEnd();

      // CHANGE [feature]: mouse-follow mode. When enabled, page mouse
      // position drives every handle's drag delta, so the whole wordmark
      // morphs as the cursor moves across the page. Off by default.
      this._mouseFollow = null; // null | { restParams: [...], onMove, onLeave, opts }
      this._mouseMoveBound = (e) => this._onMouseFollowMove(e);
      this._mouseLeaveBound = () => this._onMouseFollowLeave();
    }

    mount(target) {
      let host;
      if (typeof target === "string") {
        host = document.querySelector(target);
        if (!host) throw new Error("mount target not found: " + target);
      } else {
        host = target;
      }
      if (host instanceof SVGSVGElement) {
        this.svgEl = host;
      } else {
        this.svgEl = document.createElementNS(SVG_NS, "svg");
        host.appendChild(this.svgEl);
      }
      this.glyphLayer = document.createElementNS(SVG_NS, "g");
      this.handleLayer = document.createElementNS(SVG_NS, "g");
      this.tooltipLayer = document.createElementNS(SVG_NS, "g");
      this.svgEl.appendChild(this.glyphLayer);
      this.svgEl.appendChild(this.handleLayer);
      this.svgEl.appendChild(this.tooltipLayer);
      describeWordmarkSvg(this.svgEl, this.text, this.interactive);

      // CHANGE [tooltip]: SVG-level fallbacks so the tooltip never gets
      // stranded. pointerleave on a handle can be missed if the handle
      // DOM is replaced mid-hover, or if the pointer exits the SVG
      // without crossing the small handle hit-area. Two backstops:
      //   1. pointermove on the SVG — if the pointer isn't over a handle
      //      circle, clear the (non-pinned) tooltip.
      //   2. pointerleave on the SVG — same, for fast exits.
      this.svgEl.addEventListener("pointermove", (ev) => {
        if (this.dragState) return;
        if (!this.tooltipState || this.tooltipState.pinned) return;
        const t = ev.target;
        const onHandle =
          t &&
          t.nodeType === 1 &&
          t.getAttribute &&
          t.getAttribute("data-handle-id");
        if (onHandle) return;
        this.tooltipState = null;
        this._refreshTooltip();
      });
      this.svgEl.addEventListener("pointerleave", () => {
        if (this.dragState) return;
        if (this.tooltipState && this.tooltipState.pinned) return;
        this.tooltipState = null;
        this._refreshTooltip();
      });

      this._render();
      return this.svgEl;
    }

    makeInteractive() {
      this.interactive = true;
      this._render();
    }
    freezeInteraction() {
      this.interactive = false;
      this.tooltipState = null;
      this._render();
    }

    // CHANGE [Sprint 2, fix #4]: incremental setText — preserves tuned glyphs
    // at matching positions instead of throwing.
    setText(newText) {
      const oldChars = Array.from(this.text);
      const newChars = Array.from(newText);
      const newGlyphs = newChars.map((ch, i) => {
        if (oldChars[i] === ch && this.glyphs[i]) return this.glyphs[i];
        const module = registry[ch];
        if (!module)
          throw new Error("No glyph registered for character '" + ch + "'");
        const presetParams = resolvePresetParams(this._preset, ch, module);
        return new Glyph(module, presetParams);
      });
      this.text = newText;
      this.glyphs = newGlyphs;
      this._render();
    }

    _resetGlyphParams(glyph) {
      const presetParams =
        resolvePresetParams(this._preset, glyph.character, glyph.module) || {};
      glyph.params = Object.assign(
        {},
        glyph.module.defaultParams,
        presetParams
      );
      glyph._clampAll();
    }

    resetAll() {
      for (const g of this.glyphs) this._resetGlyphParams(g);
      this._render();
    }
    resetGlyph(i) {
      if (this.glyphs[i]) {
        this._resetGlyphParams(this.glyphs[i]);
        this._render();
      }
    }

    /** Swap mood preset and re-apply params to every glyph (keeps text + edits discarded). */
    setPreset(preset) {
      this._preset = preset || null;
      this._monoCell = (this._preset && this._preset.monoCell) || 0;
      this._layoutCache = null;
      for (const g of this.glyphs) this._resetGlyphParams(g);
      if (this._mouseFollow) {
        this._mouseFollow.restParams = this.glyphs.map((g) =>
          Object.assign({}, g.params)
        );
      }
      this._render();
    }

    // ─── Layout ────────────────────────────────────────────────────────
    _layout() {
      let cursor = this.padding;
      let maxAscent = 0;
      let maxDescent = 0;
      const placed = this.glyphs.map((glyph) => {
        const x = cursor;
        const adv = monoAdjustedAdvance(glyph.advance(), this._monoCell);
        cursor += adv + this.tracking;
        const b = glyph.bounds();
        // ascent = how far the glyph rises above its baseline (positive number)
        const ascent = Math.max(0, -b.minY);
        const descent = Math.max(0, b.maxY);
        if (ascent > maxAscent) maxAscent = ascent;
        if (descent > maxDescent) maxDescent = descent;
        return { glyph, x, bounds: b };
      });
      return {
        placed,
        totalWidth: cursor + this.padding - this.tracking,
        maxAscent,
        maxDescent,
      };
    }

    // ─── Render ────────────────────────────────────────────────────────
    _render() {
      if (!this.svgEl) return;
      const layout = this._layout();
      this._layoutCache = layout;
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      // CHANGE [Sprint 2, fix #1]: descender area is real (was a hard-coded 50px slot for 'i' only).
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      this.svgEl.setAttribute("viewBox", `0 0 ${totalWidth} ${height}`);
      this.svgEl.setAttribute("width", String(totalWidth));
      this.svgEl.setAttribute("height", String(height));

      // Glyph layer
      const glyphSvg = [];
      for (const pg of placed) {
        const ds = pg.glyph.construct();
        const sw =
          pg.glyph.params.strokeWeight != null
            ? pg.glyph.params.strokeWeight
            : 16;
        const lineJoin = (this._preset && this._preset.strokeJoin) || "round";
        let paths = "";
        for (const d of ds) {
          paths += `<path d="${d}" stroke="${this.color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="${lineJoin}"/>`;
        }
        glyphSvg.push(
          `<g transform="translate(${pg.x},${baselineY})">${paths}</g>`
        );
      }
      this.glyphLayer.innerHTML = glyphSvg.join("");

      // Handle layer
      if (this.interactive) {
        const targetRadius = 22;
        const controlRadius = 7;
        const html = [];
        placed.forEach((pg, idx) => {
          const hs = pg.glyph.handles();
          for (const h of hs) {
            const anchorX = h.anchor.x + pg.x;
            const anchorY = h.anchor.y + baselineY;
            const controlX = h.control.x + pg.x;
            const controlY = h.control.y + baselineY;
            const showArm =
              !!h.isTangent &&
              Math.abs(h.anchor.x - h.control.x) +
                Math.abs(h.anchor.y - h.control.y) >
                0.5;
            const displayX = showArm ? controlX : anchorX;
            const displayY = showArm ? controlY : anchorY;
            if (showArm) {
              html.push(
                `<line x1="${anchorX}" y1="${anchorY}" x2="${controlX}" y2="${controlY}" stroke="#1a2f6e" stroke-width="1" opacity="0.55" pointer-events="none"/>`
              );
              html.push(
                `<rect x="${anchorX - 2.5}" y="${anchorY - 2.5}" width="5" height="5" fill="#1a2f6e" pointer-events="none"/>`
              );
            }
            // Tangent-handle fill darkened (#e6eaf2 → #d4e4f5) so the
            // curve-control dots read against the white stage (a11y).
            const fill = h.isTangent ? "#d4e4f5" : "#ffffff";
            html.push(
              `<circle data-glyph-idx="${idx}" data-handle-id="${h.id}" cx="${displayX}" cy="${displayY}" r="${targetRadius}" fill="#000" fill-opacity="0.001" stroke="none" style="cursor:grab;touch-action:none"/>`
            );
            html.push(
              `<circle cx="${displayX}" cy="${displayY}" r="${controlRadius}" fill="${fill}" stroke="#1a2f6e" stroke-width="1.5" pointer-events="none"/>`
            );
          }
        });
        this.handleLayer.innerHTML = html.join("");
        this.handleLayer
          .querySelectorAll("circle[data-handle-id]")
          .forEach((c) => {
            c.addEventListener("pointerdown", (ev) => this._onDragStart(ev));
            c.addEventListener("pointerenter", (ev) => this._onHandleEnter(ev));
            c.addEventListener("pointerleave", () => this._onHandleLeave());
            const glyphIdx = Number(c.dataset.glyphIdx);
            const handleId = c.dataset.handleId;
            const glyph = this.glyphs[glyphIdx];
            const handle =
              glyph && glyph.handles().find((h) => h.id === handleId);
            if (!handle) return;
            const label =
              humanizeHandleId(handle.paramName) +
              ' handle on letter "' +
              glyph.character +
              '"';
            makeHandleKeyboardOperable(c, label, (dir, mult) => {
              const r = glyph.paramRanges[handle.paramName];
              const step = (r ? (r.max - r.min) / 100 : 1) * mult;
              glyph.set(
                handle.paramName,
                glyph.params[handle.paramName] + dir * step
              );
              this._render();
              const next = this.handleLayer.querySelector(
                'circle[data-handle-id="' +
                  handleId +
                  '"][data-glyph-idx="' +
                  glyphIdx +
                  '"]'
              );
              if (next) next.focus();
            });
          });
      } else {
        this.handleLayer.innerHTML = "";
        this.tooltipState = null;
      }
      this._renderTooltip(totalWidth, height);
    }

    // ─── Tooltip (CHANGE [Sprint 1, fix #1] — restyled, kept) ──────────
    // Old: dark heavy pill, sans-serif. New: light chip with thin accent
    // border, monospace value, anchored to the param's anchor point (the
    // visible filled-square or hollow-circle on the glyph), positioned
    // with collision avoidance against the viewBox edge.
    _humanize(name) {
      const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
      return spaced === "x height"
        ? "x-height"
        : spaced === "cap height"
          ? "cap-height"
          : spaced;
    }
    _fmt(v) {
      const r = Math.round(v * 100) / 100;
      return Number.isInteger(r) ? String(r) : r.toFixed(2);
    }
    _renderTooltip(totalWidth, height) {
      if (!this.tooltipLayer) return;
      if (!this.interactive || !this.tooltipState) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const layout = this._layoutCache || this._layout();
      const placement = layout.placed[this.tooltipState.glyphIdx];
      if (!placement) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const baselineY = this.padding + layout.maxAscent;
      const handle = placement.glyph
        .handles()
        .find((h) => h.id === this.tooltipState.handleId);
      if (!handle) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const anchorX = handle.anchor.x + placement.x;
      const anchorY = handle.anchor.y + baselineY;
      const controlX = handle.control.x + placement.x;
      const controlY = handle.control.y + baselineY;
      const value = placement.glyph.params[handle.paramName];
      const labelText = this._humanize(handle.paramName);
      const valueText = this._fmt(value);
      // Sizing from real rendered metrics so long labels don't overflow.
      const MONO_FF = "ui-monospace, SFMono-Regular, Menlo, monospace";
      const labelW = measureSvgText(this.tooltipLayer, labelText, 11.5, {
        fontFamily: MONO_FF,
        letterSpacing: "0.02em",
      });
      const valueW = measureSvgText(this.tooltipLayer, valueText, 11.5, {
        fontFamily: MONO_FF,
        fontWeight: "600",
      });
      const pad = 8;
      const gap = 6;
      const bubbleW = pad + labelW + gap + valueW + pad;
      const bubbleH = 22;
      // Position: above-right of the visible point (control if tangent, else anchor),
      // with safety flip if off-canvas.
      const refX = handle.isTangent ? controlX : anchorX;
      const refY = handle.isTangent ? controlY : anchorY;
      const margin = 8;
      let bx = refX + 14;
      let by = refY - bubbleH - 12;
      if (bx + bubbleW > totalWidth - margin) bx = refX - bubbleW - 14;
      if (by < margin) by = refY + 14;
      bx = Math.max(margin, Math.min(totalWidth - bubbleW - margin, bx));
      by = Math.max(margin, Math.min(height - bubbleH - margin, by));

      // Connector dot at ref point (small filled square mirroring anchor style)
      const parts = [];
      parts.push('<g data-handle-tooltip="true" pointer-events="none">');
      // Bubble: white fill, ultramarine border, no shadow.
      parts.push(
        `<rect x="${bx}" y="${by}" width="${bubbleW}" height="${bubbleH}" rx="3" ry="3" fill="#ffffff" stroke="#1a2f6e" stroke-width="1"/>`
      );
      // Label (param name) in muted grey
      parts.push(
        `<text x="${bx + pad}" y="${by + 15}" fill="#525860" font-size="11.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" letter-spacing="0.02em">${this._esc(labelText)}</text>`
      );
      // Value in ultramarine accent
      parts.push(
        `<text x="${bx + pad + labelW + gap}" y="${by + 15}" fill="#1a2f6e" font-size="11.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="600">${this._esc(valueText)}</text>`
      );
      parts.push("</g>");
      this.tooltipLayer.innerHTML = parts.join("");
    }
    _esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    _onHandleEnter(e) {
      if (this.dragState) return;
      const t = e.currentTarget;
      this.tooltipState = {
        glyphIdx: Number(t.dataset.glyphIdx),
        handleId: t.dataset.handleId,
        pinned: false,
      };
      this._refreshTooltip();
    }
    _onHandleLeave() {
      if (this.dragState || (this.tooltipState && this.tooltipState.pinned))
        return;
      this.tooltipState = null;
      this._refreshTooltip();
    }
    _refreshTooltip() {
      const layout = this._layoutCache || this._layout();
      const baselineY = this.padding + layout.maxAscent;
      const height =
        this.padding +
        layout.maxAscent +
        Math.max(layout.maxDescent, 8) +
        this.padding;
      void baselineY;
      this._renderTooltip(layout.totalWidth, height);
    }

    // ─── Drag ──────────────────────────────────────────────────────────
    _toGlyphLocal(client, glyphX, baselineY) {
      const pt = this.svgEl.createSVGPoint();
      pt.x = client.x;
      pt.y = client.y;
      const screen = pt.matrixTransform(this.svgEl.getScreenCTM().inverse());
      return { x: screen.x - glyphX, y: screen.y - baselineY };
    }
    _onDragStart(e) {
      const t = e.currentTarget;
      if (typeof t.setPointerCapture === "function") {
        try {
          t.setPointerCapture(e.pointerId);
        } catch {}
      }
      const glyphIdx = Number(t.dataset.glyphIdx);
      const handleId = t.dataset.handleId;
      const glyph = this.glyphs[glyphIdx];
      const handle = glyph.handles().find((h) => h.id === handleId);
      if (!handle) return;
      this.tooltipState = { glyphIdx, handleId, pinned: true };
      const layout = this._layout();
      this._layoutCache = layout; // CHANGE: cache layout for the drag duration
      const placement = layout.placed[glyphIdx];
      const baselineY = this.padding + layout.maxAscent;
      const local = this._toGlyphLocal(
        { x: e.clientX, y: e.clientY },
        placement.x,
        baselineY
      );
      this.dragState = {
        glyphIdx,
        paramName: handle.paramName,
        startValue: glyph.params[handle.paramName],
        startX: local.x,
        startY: local.y,
        glyphX: placement.x,
        baselineY,
        deltaFromDrag: handle.deltaFromDrag,
      };
      this._refreshTooltip();
      window.addEventListener("pointermove", this._dragMoveBound);
      window.addEventListener("pointerup", this._dragEndBound);
      window.addEventListener("pointercancel", this._dragEndBound);
      e.preventDefault();
    }
    _onDragMove(e) {
      if (!this.dragState) return;
      const { glyphIdx, glyphX, baselineY } = this.dragState;
      const local = this._toGlyphLocal(
        { x: e.clientX, y: e.clientY },
        glyphX,
        baselineY
      );
      const dx = local.x - this.dragState.startX;
      const dy = local.y - this.dragState.startY;
      const next =
        this.dragState.startValue + this.dragState.deltaFromDrag(dx, dy);
      this.glyphs[glyphIdx].set(this.dragState.paramName, next);
      this._render();
    }
    _onDragEnd() {
      this.dragState = null;
      this.tooltipState = null;
      this._refreshTooltip();
      window.removeEventListener("pointermove", this._dragMoveBound);
      window.removeEventListener("pointerup", this._dragEndBound);
      window.removeEventListener("pointercancel", this._dragEndBound);
    }

    // ─── Mouse-follow mode ─────────────────────────────────────────────
    // CHANGE [feature]: every handle's `deltaFromDrag` accepts (dx,dy) and
    // returns the param delta for that drag offset. We can reuse that
    // exact contract for cursor-driven shape morphing: snapshot params on
    // enable, listen for mousemove on the page, compute (dx,dy) from a
    // reference origin scaled to the viewport, and apply
    //     param = restValue + deltaFromDrag(dx, dy)
    // to every handle on every glyph each frame. Tangent handles morph
    // naturally; positional handles (xHeight, width, etc.) stretch in
    // sync. On disable we restore the snapshot.
    enableMouseFollow(opts) {
      if (this._mouseFollow) this.disableMouseFollow();
      const o = Object.assign(
        {
          // origin: 'center' | 'topleft' — anchor for (dx,dy)=(0,0)
          origin: "center",
          // strength: scalar multiplier on the (dx,dy) pixel offsets.
          // 1 = pixel-for-pixel with a real drag; 0.4 is gentler.
          strength: 0.4,
          // max absolute offset in pixels so a mouse parked in a corner
          // doesn't slam params to their clamps the moment you toggle on.
          clamp: 220,
          // include positional (non-tangent) handles? Tangent-only is
          // calmer because monoline curvature etc. is the headline.
          tangentOnly: true,
        },
        opts || {}
      );

      const restParams = this.glyphs.map((g) => Object.assign({}, g.params));
      this._mouseFollow = { opts: o, restParams };

      // Suppress tooltip + drag handles' hover noise while morphing.
      this.tooltipState = null;
      this._refreshTooltip();

      window.addEventListener("mousemove", this._mouseMoveBound, {
        passive: true,
      });
      document.addEventListener("mouseleave", this._mouseLeaveBound);

      // Seed with current pointer position if known, else identity.
      this._applyMouseFollow(0, 0);
    }

    disableMouseFollow() {
      if (!this._mouseFollow) return;
      window.removeEventListener("mousemove", this._mouseMoveBound);
      document.removeEventListener("mouseleave", this._mouseLeaveBound);
      // Restore the snapshot so the wordmark returns to where it was.
      const rest = this._mouseFollow.restParams;
      this.glyphs.forEach((g, i) => {
        if (rest[i]) g.params = Object.assign({}, rest[i]);
      });
      this._mouseFollow = null;
      this._render();
    }

    _onMouseFollowMove(e) {
      if (!this._mouseFollow) return;
      const o = this._mouseFollow.opts;
      let dx, dy;
      if (o.origin === "topleft") {
        dx = e.clientX;
        dy = e.clientY;
      } else {
        dx = e.clientX - window.innerWidth / 2;
        dy = e.clientY - window.innerHeight / 2;
      }
      dx *= o.strength;
      dy *= o.strength;
      const c = o.clamp;
      if (c > 0) {
        if (dx > c) dx = c;
        else if (dx < -c) dx = -c;
        if (dy > c) dy = c;
        else if (dy < -c) dy = -c;
      }
      this._applyMouseFollow(dx, dy);
    }

    _onMouseFollowLeave() {
      // Glide back to rest when the cursor leaves the page.
      if (this._mouseFollow) this._applyMouseFollow(0, 0);
    }

    _applyMouseFollow(dx, dy) {
      if (!this._mouseFollow) return;
      const rest = this._mouseFollow.restParams;
      const tangentOnly = !!this._mouseFollow.opts.tangentOnly;
      this.glyphs.forEach((glyph, i) => {
        const baseline = rest[i];
        if (!baseline) return;
        // Reset to rest, then re-apply every handle's delta on top.
        glyph.params = Object.assign({}, baseline);
        const hs = glyph.handles();
        for (const h of hs) {
          if (tangentOnly && !h.isTangent) continue;
          if (!(h.paramName in glyph.params)) continue;
          const base = baseline[h.paramName];
          if (typeof base !== "number") continue;
          const delta = h.deltaFromDrag(dx, dy);
          if (!Number.isFinite(delta)) continue;
          glyph.set(h.paramName, base + delta);
        }
      });
      this._render();
    }

    // ─── Export ────────────────────────────────────────────────────────
    toSVG() {
      const layout = this._layout();
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      const body = placed
        .map((pg) => {
          const ds = pg.glyph.construct();
          const sw =
            pg.glyph.params.strokeWeight != null
              ? pg.glyph.params.strokeWeight
              : 16;
          const paths = ds
            .map(
              (d) =>
                `<path d="${d}" stroke="${this.color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="${(this._preset && this._preset.strokeJoin) || "round"}"/>`
            )
            .join("");
          return `<g transform="translate(${pg.x},${baselineY})">${paths}</g>`;
        })
        .join("");
      const presetKey = this._preset && this._preset.name;
      const header =
        "<!-- Parametric putty export — prototype learning toy. -->\n";
      return (
        header +
        '<svg xmlns="' +
        SVG_NS +
        '" viewBox="0 0 ' +
        totalWidth +
        " " +
        height +
        '" width="' +
        totalWidth +
        '" height="' +
        height +
        '">' +
        body +
        "</svg>"
      );
    }

    /**
     * Serializable snapshot. Round-trippable with SandboxWordmark.fromState().
     *
     * If mouse-follow is active, the glyph params being mutated each frame
     * are the morphed values, not the rest values. We serialize the rest
     * snapshot so the embed boots into the same starting state the user
     * saw before they toggled mouse-follow on. The `modes` block carries
     * the mouse-follow flag (with its opts) so the embed can re-enable it.
     */
    toState() {
      const restSrc = this._mouseFollow ? this._mouseFollow.restParams : null;
      return {
        text: this.text,
        tracking: this.tracking,
        color: this.color,
        padding: this.padding,
        preset: this._preset && this._preset.name ? this._preset.name : null,
        glyphs: this.glyphs.map((g, i) => ({
          character: g.character,
          params: Object.assign({}, (restSrc && restSrc[i]) || g.params),
        })),
        modes: {
          mouseFollow: this._mouseFollow
            ? { opts: Object.assign({}, this._mouseFollow.opts) }
            : null,
        },
      };
    }

    /**
     * CHANGE [Sprint 1, fix #2]: the interactive bundle.
     *
     * Returns a FULL self-contained HTML document string. No external fetches,
     * no CDN URL, no extra files needed — paste it into any browser tab and
     * the wordmark renders with working handles.
     *
     * Implementation: we asynchronously fetch this library's source from the
     * <script src> that loaded it, then inline that source into the output.
     * If the library was inlined rather than loaded by URL, set
     * `SandboxWordmark.LIBRARY_SOURCE` to the source string before calling this.
     */
    async toInteractiveBundle() {
      const src = await SandboxWordmark._fetchLibrarySource();
      const state = this.toState();
      // The embedded boot script reconstructs the wordmark from its serialized state.
      const boot = `
(function () {
  var root = document.getElementById('putty-wordmark');
  if (!root) return;
  var state = ${JSON.stringify(state)};
  var preset = state.preset ? Putty.presets[state.preset] : undefined;
  var wm = new Putty.Wordmark(state.text, {
    preset: preset,
    tracking: state.tracking, color: state.color, padding: state.padding
  });
  state.glyphs.forEach(function (g, i) {
    if (wm.glyphs[i]) wm.glyphs[i].setMany(g.params);
  });
  wm.mount(root);
  // Restore active modes so the embed behaves like the source demo.
  if (state.modes && state.modes.mouseFollow) {
    wm.enableMouseFollow(state.modes.mouseFollow.opts);
  }
})();`.trim();

      return [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>putty — interactive embed</title>",
        "<style>",
        "  html, body { margin: 0; height: 100%; background: #f6f7f9; display: flex; align-items: center; justify-content: center; }",
        "  #putty-wordmark { max-width: 100%; }",
        "  #putty-wordmark svg { display: block; max-width: 100%; height: auto; }",
        "  .putty-parametric-note { max-width: 640px; margin: 0 auto 16px; padding: 10px 12px; font: 13px/1.5 system-ui,sans-serif; color: #525860; background: #eceef2; border: 1px solid #d4d8e0; border-radius: 4px; }",
        "</style>",
        "</head>",
        "<body>",
        '<div id="putty-wordmark">',
        '<p class="putty-parametric-note" role="note"><strong>Prototype.</strong> Parametric letterform toy for learning — not a font product. See docs/THIRD_PARTY_FONTS.md if your embed references licensed fonts.</p>',
        "</div>",
        "<!-- Parametric putty export — prototype learning toy. -->",
        "<script>" + src + "<\/script>",
        "<script>" + boot + "<\/script>",
        "</body>",
        "</html>",
      ].join("\n");
    }

    static async _fetchLibrarySource() {
      if (SandboxWordmark.LIBRARY_SOURCE) return SandboxWordmark.LIBRARY_SOURCE;
      if (!_SELF_SRC) {
        throw new Error(
          "Library was inlined; set SandboxWordmark.LIBRARY_SOURCE before calling toInteractiveBundle()."
        );
      }
      const r = await fetch(_SELF_SRC);
      if (!r.ok) throw new Error("Failed to fetch library source: " + r.status);
      const text = await r.text();
      SandboxWordmark.LIBRARY_SOURCE = text; // cache
      return text;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // DEFORMABLE OUTLINE WORDMARK  (primary — real font paths + preset axes)
  // Requires opentype.js via setOpentypeParser().
  // ════════════════════════════════════════════════════════════════════
  class DeformableOutlineWordmark {
    constructor(text, options) {
      options = options || {};
      this.text = text;
      this.presetKey = options.presetKey || options.preset || "bubbly";
      this.renderMode = "outline";
      this.tracking = options.tracking != null ? options.tracking : 8;
      this.color = options.color || "#2a2ae5";
      this.padding = options.padding != null ? options.padding : 40;
      this.fontSize = options.fontSize != null ? options.fontSize : 1000;
      this.glyphs = [];
      this.axisValues = Object.assign(
        defaultAxisValuesForPreset(presets[this.presetKey]),
        options.axisValues || {}
      );
      this.svgEl = null;
      this.glyphLayer = null;
      this.handleLayer = null;
      this.tooltipLayer = null;
      this.interactive = true;
      this.tooltipState = null;
      this.dragState = null;
      // Index of the glyph currently driven by the keyboard, so focus survives
      // the full re-render that follows each axis nudge (A3).
      this._focusedGlyphIndex = null;
      this._layoutCache = null;
      this._dragMoveBound = (e) => this._onDragMove(e);
      this._dragEndBound = () => this._onDragEnd();
      this._glyphDragMoveBound = (e) => this._onGlyphDragMove(e);
      this._glyphDragEndBound = () => this._onGlyphDragEnd();
      this._mouseFollow = null;
      this._mouseMoveBound = (e) => this._onMouseFollowMove(e);
      this._mouseLeaveBound = () => this._onMouseFollowLeave();
    }

    static async create(text, options) {
      const wm = new DeformableOutlineWordmark(text, options);
      await wm._loadGlyphs(text);
      return wm;
    }

    get presetMeta() {
      return presets[this.presetKey] || null;
    }

    get presetAxes() {
      const p = this.presetMeta;
      return p && p.axes ? p.axes : [];
    }

    async _loadGlyphs(text) {
      const preset = presets[this.presetKey];
      const chars = Array.from(text || " ");
      const loaded = [];
      for (const ch of chars) {
        try {
          const base = await getOutlineGlyphData(
            this.presetKey,
            ch,
            this.fontSize
          );
          const _baseGlyph = {
            character: ch,
            pathData: base.pathData,
            baseCommands: cloneCommandsDeep(base.baseCommands),
            bounds: Object.assign({}, base.bounds),
          };
          const pathData = buildDeformedPathData(
            _baseGlyph,
            this.axisValues,
            preset
          );
          const applied = base.baseCommands
            ? applyPresetAxesToCommands(
                base.baseCommands,
                this.axisValues,
                preset
              )
            : null;
          const bounds = applied
            ? boundsFromCommands(applied.commands)
            : Object.assign({}, base.bounds);
          loaded.push({
            character: ch,
            pathData,
            baseCommands: base.baseCommands,
            _baseGlyph,
            advance: base.advance,
            bounds,
            fallback: null,
            // Per-letter axis state (drag-on-glyph). Starts at the wordmark's
            // current values; the toolbar sliders set every glyph (master),
            // dragging a single glyph overrides just that one.
            axisValues: Object.assign({}, this.axisValues),
          });
        } catch (err) {
          const mod = registry[ch];
          if (!mod) throw err;
          const presetParams = resolvePresetParams(preset, ch, mod);
          const glyph = new Glyph(mod, presetParams);
          loaded.push({
            character: ch,
            pathData: "",
            advance: glyph.advance(),
            bounds: glyph.bounds(),
            fallback: "parametric",
            fallbackPaths: glyph.construct(),
            axisValues: Object.assign({}, this.axisValues),
          });
        }
      }
      this.glyphs = loaded;
      this.text = text;
    }

    _applyDeformToGlyphs() {
      const preset = presets[this.presetKey];
      for (const g of this.glyphs) {
        if (g.fallback === "parametric" || !g._baseGlyph) continue;
        const av = g.axisValues || this.axisValues;
        g.pathData = buildDeformedPathData(g._baseGlyph, av, preset);
        const applied = g._baseGlyph.baseCommands
          ? applyPresetAxesToCommands(g._baseGlyph.baseCommands, av, preset)
          : null;
        g.bounds = applied
          ? boundsFromCommands(applied.commands)
          : Object.assign({}, g._baseGlyph.bounds);
      }
    }

    // Master control (toolbar sliders): set every glyph to the same value.
    // Per-letter overrides from drag-on-glyph are replaced when the master moves.
    setAxis(id, value) {
      const ax = this.presetAxes.find((a) => a.id === id);
      if (!ax) return;
      const v = Math.max(ax.min, Math.min(ax.max, value));
      this.axisValues[id] = v;
      for (const g of this.glyphs) {
        if (!g.axisValues) g.axisValues = Object.assign({}, this.axisValues);
        g.axisValues[id] = v;
      }
      this._applyDeformToGlyphs();
      this._render();
    }

    // Per-letter axis control — the drag-on-glyph interaction sets one glyph.
    setGlyphAxis(index, id, value) {
      const g = this.glyphs[index];
      const ax = this.presetAxes.find((a) => a.id === id);
      if (!g || !ax) return;
      if (!g.axisValues) g.axisValues = Object.assign({}, this.axisValues);
      g.axisValues[id] = Math.max(ax.min, Math.min(ax.max, value));
      this._applyDeformToGlyphs();
      this._render();
    }

    resetAxes() {
      this.axisValues = defaultAxisValuesForPreset(presets[this.presetKey]);
      for (const g of this.glyphs) {
        g.axisValues = Object.assign({}, this.axisValues);
      }
      this._applyDeformToGlyphs();
      this._render();
    }

    async setPresetKey(presetKey) {
      this.presetKey = presetKey;
      this.axisValues = defaultAxisValuesForPreset(presets[presetKey]);
      await this._loadGlyphs(this.text);
      this._render();
    }

    async setText(newText) {
      await this._loadGlyphs(newText);
      this._render();
    }

    mount(target) {
      let host;
      if (typeof target === "string") {
        host = document.querySelector(target);
        if (!host) throw new Error("mount target not found: " + target);
      } else {
        host = target;
      }
      if (host instanceof SVGSVGElement) {
        this.svgEl = host;
      } else {
        this.svgEl = document.createElementNS(SVG_NS, "svg");
        host.appendChild(this.svgEl);
      }
      this.glyphLayer = document.createElementNS(SVG_NS, "g");
      this.handleLayer = document.createElementNS(SVG_NS, "g");
      this.tooltipLayer = document.createElementNS(SVG_NS, "g");
      this.svgEl.appendChild(this.glyphLayer);
      this.svgEl.appendChild(this.handleLayer);
      this.svgEl.appendChild(this.tooltipLayer);
      describeWordmarkSvg(this.svgEl, this.text, this.interactive);
      this._render();
      return this.svgEl;
    }

    makeInteractive() {
      this.interactive = true;
      this._render();
    }
    freezeInteraction() {
      this.interactive = false;
      this.tooltipState = null;
      this._render();
    }

    _layout() {
      let cursor = this.padding;
      let maxAscent = 0;
      let maxDescent = 0;
      const placed = this.glyphs.map((glyph) => {
        const x = cursor;
        cursor += glyph.advance + this.tracking;
        const b = glyph.bounds;
        const ascent = Math.max(0, -b.minY);
        const descent = Math.max(0, b.maxY);
        if (ascent > maxAscent) maxAscent = ascent;
        if (descent > maxDescent) maxDescent = descent;
        return { glyph, x, bounds: b };
      });
      return {
        placed,
        totalWidth: cursor + this.padding - this.tracking,
        maxAscent,
        maxDescent,
      };
    }

    _axisHandleDefs(layout) {
      const axes = this.presetAxes;
      const totalWidth = layout.totalWidth;
      const handles = [];
      axes.forEach((ax, i) => {
        const v =
          this.axisValues[ax.id] != null ? this.axisValues[ax.id] : ax.default;
        const t = (v - ax.min) / Math.max(0.0001, ax.max - ax.min);
        const anchorY = this.padding + 28 + i * 52;
        const anchorX = totalWidth - this.padding - 24;
        const controlY = anchorY - t * 80;
        handles.push({
          id: ax.id,
          paramName: ax.id,
          label: ax.label,
          min: ax.min,
          max: ax.max,
          anchor: { x: anchorX, y: anchorY },
          control: { x: anchorX, y: controlY },
          deltaFromDrag: (_, dy) => (-dy / 80) * (ax.max - ax.min),
        });
      });
      return handles;
    }

    _render() {
      if (!this.svgEl || !this.glyphLayer) return;
      const layout = this._layout();
      this._layoutCache = layout;
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      this.svgEl.setAttribute("viewBox", "0 0 " + totalWidth + " " + height);
      this.svgEl.setAttribute("width", String(totalWidth));
      this.svgEl.setAttribute("height", String(height));
      this.svgEl.setAttribute("data-render-mode", "outline");
      this.svgEl.setAttribute("data-preset", this.presetKey);

      // When interactive, each DEFORMABLE glyph group is itself the control —
      // press a letter and drag to set its own bubbliness (x) and amplitude
      // (y), or focus it and use arrow keys. Parametric-fallback glyphs aren't
      // deformable, so they render as plain, non-interactive paths (no
      // move-cursor, no drag affordance, no keyboard handle).
      const parts = [];
      placed.forEach((pg, gi) => {
        const isFallback = pg.glyph.fallback === "parametric";
        const interactiveGlyph = this.interactive && !isFallback;
        let attrs = "";
        if (interactiveGlyph) {
          attrs =
            ' data-glyph-index="' +
            gi +
            '" style="cursor:move;touch-action:none" tabindex="0" role="button" aria-label="' +
            this._esc(this._glyphAriaLabel(pg.glyph)) +
            '"';
        }
        const open =
          "<g" +
          attrs +
          ' transform="translate(' +
          pg.x +
          "," +
          baselineY +
          ')">';
        if (isFallback && pg.glyph.fallbackPaths) {
          const paths = pg.glyph.fallbackPaths
            .map(
              (d) =>
                '<path d="' +
                d +
                '" stroke="' +
                this.color +
                '" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            )
            .join("");
          parts.push(open + paths + "</g>");
        } else {
          parts.push(
            open +
              '<path d="' +
              pg.glyph.pathData +
              '" fill="' +
              this.color +
              '" fill-rule="evenodd" stroke="none"/>' +
              "</g>"
          );
        }
      });
      // Capture before innerHTML wipes the old nodes — destroying the focused
      // node fires blur, which nulls _focusedGlyphIndex, so read it first.
      const focusIndex = this._focusedGlyphIndex;
      this.glyphLayer.innerHTML = parts.join("");
      if (this.interactive) {
        this.glyphLayer
          .querySelectorAll("[data-glyph-index]")
          .forEach((g) => {
            g.addEventListener("pointerdown", (ev) =>
              this._onGlyphDragStart(ev)
            );
            g.addEventListener("keydown", (ev) => this._onGlyphKeyDown(ev));
            g.addEventListener("focus", (ev) => {
              this._focusedGlyphIndex = parseInt(
                ev.currentTarget.dataset.glyphIndex,
                10
              );
            });
            g.addEventListener("blur", () => {
              this._focusedGlyphIndex = null;
            });
          });
        // Re-render rebuilds the glyph nodes and drops focus; restore it to the
        // glyph the user was driving with the keyboard.
        if (focusIndex != null) {
          const sel = '[data-glyph-index="' + focusIndex + '"]';
          const el = this.glyphLayer.querySelector(sel);
          if (el && typeof el.focus === "function") {
            this._focusedGlyphIndex = focusIndex;
            el.focus();
          }
        }
      }

      // Per-letter mode: the glyphs are the controls, so there are no separate
      // axis handles. Keep the handle layer clear; the tooltip layer shows the
      // dragged glyph's values mid-drag.
      if (this.handleLayer) this.handleLayer.innerHTML = "";
      if (this.dragState && this.dragState.kind === "glyph") {
        this._renderGlyphTooltip(this.dragState.index, layout);
      } else if (this.tooltipLayer) {
        this.tooltipLayer.innerHTML = "";
        this.tooltipState = null;
      }
    }

    // Compact mono tooltip shown above a glyph while it is being dragged,
    // listing its per-letter axis values (e.g. "bubbliness 0.8  amplitude 0.3").
    _renderGlyphTooltip(index, layout) {
      if (!this.tooltipLayer) return;
      const pg = layout.placed[index];
      const g = this.glyphs[index];
      if (!pg || !g) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const av = g.axisValues || this.axisValues;
      const text = this.presetAxes
        .map((ax) => ax.label + " " + this._fmt(av[ax.id]))
        .join("   ");
      const PAPER = "#f6f7f9";
      const ULTRAMARINE = "#1a2f6e";
      const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
      const fontSizePx = 22;
      const cw = fontSizePx * 0.6;
      const bubbleW = text.length * cw + 16;
      const bubbleH = fontSizePx + 12;
      const cx = pg.x + (pg.bounds.minX + pg.bounds.maxX) / 2;
      const top = layout.maxAscent ? this.padding + layout.maxAscent : 40;
      const glyphTopY = top + pg.bounds.minY;
      let bx = cx - bubbleW / 2;
      bx = Math.max(4, Math.min(bx, layout.totalWidth - bubbleW - 4));
      const by = Math.max(4, glyphTopY - bubbleH - 10);
      this.tooltipLayer.innerHTML =
        '<g pointer-events="none"><rect x="' +
        bx +
        '" y="' +
        by +
        '" width="' +
        bubbleW +
        '" height="' +
        bubbleH +
        '" rx="6" fill="' +
        PAPER +
        '" fill-opacity="0.9" stroke="none"/><text x="' +
        (bx + 8) +
        '" y="' +
        (by + bubbleH - 9) +
        '" fill="' +
        ULTRAMARINE +
        '" font-size="' +
        fontSizePx +
        '" font-family="' +
        MONO +
        '">' +
        this._esc(text) +
        "</text></g>";
    }

    _humanize(name) {
      const ax = this.presetAxes.find((a) => a.id === name);
      if (ax) return ax.label;
      const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
      return spaced;
    }
    _fmt(v) {
      const r = Math.round(v * 1000) / 1000;
      return Number.isInteger(r) ? String(r) : r.toFixed(2);
    }
    _esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    _renderTooltip(totalWidth, height, layout) {
      if (!this.tooltipLayer) return;
      if (!this.interactive || !this.tooltipState) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const h = this._axisHandleDefs(layout).find(
        (x) => x.id === this.tooltipState.handleId
      );
      if (!h) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const v = this.axisValues[h.paramName];
      const labelText = h.label;
      const valueText = this._fmt(v);
      // Minimal, no-box tooltip matching AnatomyDeform:
      // ultramarine (--ultramarine) mono text on a faint --paper underlay,
      // no border. The outline viewBox is ~200-300u tall, so unscaled
      // metrics read fine here.
      const PAPER = "#f6f7f9"; // --paper
      const ULTRAMARINE = "#1a2f6e"; // --ultramarine
      const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"; // --mono
      const fontSizePx = 12;
      // Real rendered metrics so long axis labels don't overflow the bubble.
      const labelW = measureSvgText(this.tooltipLayer, labelText, fontSizePx, {
        fontFamily: MONO,
        letterSpacing: "0.02em",
      });
      const valueW = measureSvgText(this.tooltipLayer, valueText, fontSizePx, {
        fontFamily: MONO,
        fontWeight: "700",
      });
      const gap = 6;
      const padX = 4;
      const padY = 3;
      const textW = labelW + gap + valueW;
      const bubbleW = textW + padX * 2;
      const bubbleH = 18;
      const refX = h.control.x;
      const refY = h.control.y;
      const margin = 8;
      let bx = refX + 14;
      let by = refY - bubbleH - 12;
      if (bx + bubbleW > totalWidth - margin) bx = refX - bubbleW - 14;
      if (by < margin) by = refY + 14;
      const textX = bx + padX;
      const baselineDy = bubbleH - padY * 1.2;
      this.tooltipLayer.innerHTML =
        '<g pointer-events="none"><rect x="' +
        bx +
        '" y="' +
        by +
        '" width="' +
        bubbleW +
        '" height="' +
        bubbleH +
        '" rx="4" fill="' +
        PAPER +
        '" fill-opacity="0.82" stroke="none"/>' +
        '<text x="' +
        textX +
        '" y="' +
        (by + baselineDy) +
        '" fill="' +
        ULTRAMARINE +
        '" font-size="' +
        fontSizePx +
        '" font-family="' +
        MONO +
        '" letter-spacing="0.02em">' +
        this._esc(labelText) +
        "</text>" +
        '<text x="' +
        (textX + labelW + gap) +
        '" y="' +
        (by + baselineDy) +
        '" fill="' +
        ULTRAMARINE +
        '" font-size="' +
        fontSizePx +
        '" font-family="' +
        MONO +
        '" font-weight="700">' +
        this._esc(valueText) +
        "</text></g>";
    }

    _onHandleEnter(e) {
      if (this.dragState) return;
      this.tooltipState = {
        handleId: e.currentTarget.dataset.handleId,
        pinned: false,
      };
      const layout = this._layoutCache || this._layout();
      this._renderTooltip(
        layout.totalWidth,
        this.padding + layout.maxAscent + layout.maxDescent + this.padding,
        layout
      );
    }
    _onHandleLeave() {
      if (this.dragState || (this.tooltipState && this.tooltipState.pinned))
        return;
      this.tooltipState = null;
      const layout = this._layoutCache || this._layout();
      this._renderTooltip(
        layout.totalWidth,
        this.padding + layout.maxAscent + layout.maxDescent + this.padding,
        layout
      );
    }

    _toSvgLocal(client) {
      const pt = this.svgEl.createSVGPoint();
      pt.x = client.x;
      pt.y = client.y;
      const screen = pt.matrixTransform(this.svgEl.getScreenCTM().inverse());
      return { x: screen.x, y: screen.y };
    }

    _onDragStart(e) {
      const t = e.currentTarget;
      if (typeof t.setPointerCapture === "function") {
        try {
          t.setPointerCapture(e.pointerId);
        } catch {}
      }
      const handleId = t.dataset.handleId;
      const ax = this.presetAxes.find((a) => a.id === handleId);
      if (!ax) return;
      this.tooltipState = { handleId, pinned: true };
      const local = this._toSvgLocal({ x: e.clientX, y: e.clientY });
      this.dragState = {
        paramName: handleId,
        startValue: this.axisValues[handleId],
        startY: local.y,
        deltaPerPx: (ax.max - ax.min) / 80,
      };
      window.addEventListener("pointermove", this._dragMoveBound);
      window.addEventListener("pointerup", this._dragEndBound);
      window.addEventListener("pointercancel", this._dragEndBound);
      e.preventDefault();
    }

    _onDragMove(e) {
      if (!this.dragState) return;
      const local = this._toSvgLocal({ x: e.clientX, y: e.clientY });
      const dy = local.y - this.dragState.startY;
      const next = this.dragState.startValue - dy * this.dragState.deltaPerPx;
      this.setAxis(this.dragState.paramName, next);
      const layout = this._layoutCache || this._layout();
      this._renderTooltip(
        layout.totalWidth,
        this.padding + layout.maxAscent + layout.maxDescent + this.padding,
        layout
      );
    }

    _onDragEnd() {
      this.dragState = null;
      this.tooltipState = null;
      const layout = this._layoutCache || this._layout();
      this._renderTooltip(
        layout.totalWidth,
        this.padding + layout.maxAscent + layout.maxDescent + this.padding,
        layout
      );
      window.removeEventListener("pointermove", this._dragMoveBound);
      window.removeEventListener("pointerup", this._dragEndBound);
      window.removeEventListener("pointercancel", this._dragEndBound);
    }

    // ─── Per-letter drag-on-glyph (x → bubbliness, y → amplitude) ────────
    _onGlyphDragStart(e) {
      if (!this.interactive) return;
      const index = parseInt(e.currentTarget.dataset.glyphIndex, 10);
      const g = this.glyphs[index];
      if (!g) return;
      if (!g.axisValues) g.axisValues = Object.assign({}, this.axisValues);
      const bubbleAxis =
        this.presetAxes.find((a) => a.id === "bubbliness") ||
        this.presetAxes[0];
      const ampAxis =
        this.presetAxes.find((a) => a.id === "amplitude") ||
        this.presetAxes[1] ||
        null;
      if (!bubbleAxis) return;
      const local = this._toSvgLocal({ x: e.clientX, y: e.clientY });
      this.dragState = {
        kind: "glyph",
        index,
        startX: local.x,
        startY: local.y,
        bubbleAxis,
        ampAxis,
        startBubble: g.axisValues[bubbleAxis.id],
        startAmp: ampAxis ? g.axisValues[ampAxis.id] : 0,
        // A drag of roughly half an em sweeps the full range, so a gesture
        // about the size of the letter covers min..max.
        span: this.fontSize * 0.5,
        // Pointer id so the matching capture can be released on drag end.
        pointerId: e.pointerId,
      };
      // Capture on the persistent svgEl (not the pressed <g>, which _render
      // destroys on the next move) so touch/pen pointermove/up keep flowing to
      // a node that survives re-renders — otherwise a fast touch-drag can stick
      // mid-gesture (C6). Mouse already tracks via the window listeners below.
      if (this.svgEl && typeof this.svgEl.setPointerCapture === "function") {
        try {
          this.svgEl.setPointerCapture(e.pointerId);
        } catch {}
      }
      window.addEventListener("pointermove", this._glyphDragMoveBound);
      window.addEventListener("pointerup", this._glyphDragEndBound);
      window.addEventListener("pointercancel", this._glyphDragEndBound);
      e.preventDefault();
    }

    _onGlyphDragMove(e) {
      const ds = this.dragState;
      if (!ds || ds.kind !== "glyph") return;
      const g = this.glyphs[ds.index];
      if (!g) return;
      const local = this._toSvgLocal({ x: e.clientX, y: e.clientY });
      const dx = local.x - ds.startX;
      const dy = local.y - ds.startY;
      g.axisValues[ds.bubbleAxis.id] = clampNum(
        ds.startBubble + dx / ds.span,
        ds.bubbleAxis.min,
        ds.bubbleAxis.max
      );
      if (ds.ampAxis) {
        g.axisValues[ds.ampAxis.id] = clampNum(
          ds.startAmp - dy / ds.span,
          ds.ampAxis.min,
          ds.ampAxis.max
        );
      }
      this._applyDeformToGlyphs();
      this._render();
    }

    _onGlyphDragEnd() {
      const ds = this.dragState;
      if (
        ds &&
        ds.pointerId != null &&
        this.svgEl &&
        typeof this.svgEl.releasePointerCapture === "function"
      ) {
        try {
          this.svgEl.releasePointerCapture(ds.pointerId);
        } catch {}
      }
      this.dragState = null;
      window.removeEventListener("pointermove", this._glyphDragMoveBound);
      window.removeEventListener("pointerup", this._glyphDragEndBound);
      window.removeEventListener("pointercancel", this._glyphDragEndBound);
      this._render();
    }

    // Accessible name for a deformable glyph button (A3). Describes the letter
    // and which arrow keys adjust which axis.
    _glyphAriaLabel(g) {
      const bubble =
        this.presetAxes.find((a) => a.id === "bubbliness") ||
        this.presetAxes[0];
      const amp =
        this.presetAxes.find((a) => a.id === "amplitude") ||
        this.presetAxes[1] ||
        null;
      let label = 'Letter "' + (g ? g.character : "") + '" — arrow keys adjust';
      if (bubble) label += " " + bubble.label + " (left/right)";
      if (amp) label += " and " + amp.label + " (up/down)";
      return label;
    }

    // Keyboard operability for the glyph model (A3, WCAG 2.1.1): Left/Right
    // nudge the primary axis (bubbliness), Up/Down the secondary (amplitude),
    // clamped to each axis range. Focus is preserved across the re-render via
    // _focusedGlyphIndex (restored in _render).
    _onGlyphKeyDown(e) {
      if (!this.interactive) return;
      const index = parseInt(e.currentTarget.dataset.glyphIndex, 10);
      const g = this.glyphs[index];
      if (!g) return;
      const bubbleAxis =
        this.presetAxes.find((a) => a.id === "bubbliness") ||
        this.presetAxes[0];
      const ampAxis =
        this.presetAxes.find((a) => a.id === "amplitude") ||
        this.presetAxes[1] ||
        null;
      let axis = null;
      let dir = 0;
      if (e.key === "ArrowRight") {
        axis = bubbleAxis;
        dir = 1;
      } else if (e.key === "ArrowLeft") {
        axis = bubbleAxis;
        dir = -1;
      } else if (e.key === "ArrowUp") {
        axis = ampAxis;
        dir = 1;
      } else if (e.key === "ArrowDown") {
        axis = ampAxis;
        dir = -1;
      } else {
        return;
      }
      if (!axis) return;
      e.preventDefault();
      this._focusedGlyphIndex = index;
      const step = (axis.max - axis.min) * 0.05 * (e.shiftKey ? 2 : 1);
      const cur =
        g.axisValues && g.axisValues[axis.id] != null
          ? g.axisValues[axis.id]
          : this.axisValues[axis.id];
      this.setGlyphAxis(index, axis.id, cur + dir * step);
    }

    enableMouseFollow(opts) {
      if (this._mouseFollow) this.disableMouseFollow();
      const o = Object.assign(
        {
          origin: "center",
          // Strength raised 0.4→0.7 and clamp lowered 220→200
          // so a normal cursor sweep across the viewport reaches each
          // axis's full min..max (paired with dropping the range*0.5
          // halving in _applyMouseFollow).
          strength: 0.7,
          clamp: 200,
          mapAxis: this.presetAxes[0] ? this.presetAxes[0].id : null,
        },
        opts || {}
      );
      const restAxes = Object.assign({}, this.axisValues);
      this._mouseFollow = { opts: o, restAxes };
      this.tooltipState = null;
      window.addEventListener("mousemove", this._mouseMoveBound, {
        passive: true,
      });
      document.addEventListener("mouseleave", this._mouseLeaveBound);
      this._applyMouseFollow(0, 0);
    }

    disableMouseFollow() {
      if (!this._mouseFollow) return;
      window.removeEventListener("mousemove", this._mouseMoveBound);
      document.removeEventListener("mouseleave", this._mouseLeaveBound);
      this.axisValues = Object.assign({}, this._mouseFollow.restAxes);
      this._mouseFollow = null;
      this._applyDeformToGlyphs();
      this._render();
    }

    _onMouseFollowMove(e) {
      if (!this._mouseFollow) return;
      const o = this._mouseFollow.opts;
      let dx =
        o.origin === "topleft" ? e.clientX : e.clientX - window.innerWidth / 2;
      let dy =
        o.origin === "topleft" ? e.clientY : e.clientY - window.innerHeight / 2;
      dx *= o.strength;
      dy *= o.strength;
      const c = o.clamp;
      if (c > 0) {
        if (dx > c) dx = c;
        else if (dx < -c) dx = -c;
        if (dy > c) dy = c;
        else if (dy < -c) dy = -c;
      }
      this._applyMouseFollow(dx, dy);
    }

    _onMouseFollowLeave() {
      if (this._mouseFollow) this._applyMouseFollow(0, 0);
    }

    // Map cursor X → first preset axis, cursor Y → second preset axis (if
    // any). Bubbly now declares `amplitude` as a second
    // axis, so Y produces "bigger bubbles" while X still produces
    // "more bubbles". Both restore from the rest snapshot on disable.
    _applyMouseFollow(dx, dy) {
      if (!this._mouseFollow) return;
      const o = this._mouseFollow.opts;
      const axes = this.presetAxes;
      if (!axes.length) return;
      const span = Math.max(1, o.clamp);
      const apply = (ax, delta) => {
        if (!ax) return;
        const rest = this._mouseFollow.restAxes[ax.id];
        const range = ax.max - ax.min;
        // Dropped the *0.5 halving so a full viewport sweep
        // reaches each axis's full min..max. delta/span ∈ [-1, 1] at the
        // clamp, mapped across the whole range from the rest value.
        const t = Math.max(
          ax.min,
          Math.min(ax.max, rest + (delta / span) * range)
        );
        // Mouse-follow is a master gesture (affects every letter), so it must
        // broadcast like setAxis does — write the global value AND mirror it
        // onto each non-fallback glyph's own axisValues, which is what
        // _applyDeformToGlyphs actually reads. This intentionally overrides
        // per-letter drags while the cursor drives the wordmark.
        this.axisValues[ax.id] = t;
        for (const g of this.glyphs) {
          if (g.fallback === "parametric") continue;
          if (!g.axisValues) g.axisValues = Object.assign({}, this.axisValues);
          g.axisValues[ax.id] = t;
        }
      };
      const primaryId = o.mapAxis || axes[0].id;
      const primary = axes.find((a) => a.id === primaryId) || axes[0];
      // Secondary axis: whichever axis isn't the primary. With bubbly
      // (bubbliness + amplitude) this means Y → amplitude.
      const secondary = axes.find((a) => a.id !== primary.id) || null;
      apply(primary, dx);
      apply(secondary, dy);
      this._applyDeformToGlyphs();
      this._render();
    }

    toSVG() {
      const layout = this._layout();
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      const body = placed
        .map(
          (pg) =>
            '<g transform="translate(' +
            pg.x +
            "," +
            baselineY +
            ')">' +
            '<path d="' +
            pg.glyph.pathData +
            '" fill="' +
            this.color +
            '" fill-rule="evenodd" stroke="none"/>' +
            "</g>"
        )
        .join("");
      return (
        outlineAttributionBlock(this.presetKey) +
        "\n" +
        '<svg xmlns="' +
        SVG_NS +
        '" viewBox="0 0 ' +
        totalWidth +
        " " +
        height +
        '" width="' +
        totalWidth +
        '" height="' +
        height +
        '" data-render-mode="outline">' +
        body +
        "</svg>"
      );
    }

    toState() {
      return {
        renderMode: "outline",
        text: this.text,
        tracking: this.tracking,
        color: this.color,
        padding: this.padding,
        fontSize: this.fontSize,
        preset: this.presetKey,
        axisValues: Object.assign({}, this.axisValues),
        modes: {
          mouseFollow: this._mouseFollow
            ? { enabled: true, opts: Object.assign({}, this._mouseFollow.opts) }
            : { enabled: false },
        },
        glyphs: this.glyphs.map((g) => ({
          character: g.character,
          pathData: g.pathData,
          advance: g.advance,
          bounds: Object.assign({}, g.bounds),
          // Per-letter overrides (drag-on-glyph). To keep bundles small, only
          // serialize the keys that DIFFER from the global axisValues; a null
          // entry means "same as global". fromState restores these onto the
          // matching glyph by index.
          axisDiff: this._glyphAxisDiff(g),
        })),
      };
    }

    // Keys of g.axisValues that differ from the global axisValues, or null
    // when the glyph matches the global state (the common case). Used to keep
    // exported per-letter state compact while round-tripping faithfully.
    _glyphAxisDiff(g) {
      if (!g || !g.axisValues) return null;
      const diff = {};
      let any = false;
      for (const ax of this.presetAxes) {
        const gv = g.axisValues[ax.id];
        if (gv != null && gv !== this.axisValues[ax.id]) {
          diff[ax.id] = gv;
          any = true;
        }
      }
      return any ? diff : null;
    }

    static async fromState(state) {
      const wm = new DeformableOutlineWordmark(state.text, {
        presetKey: state.preset,
        tracking: state.tracking,
        color: state.color,
        padding: state.padding,
        fontSize: state.fontSize,
        axisValues: state.axisValues || {},
      });
      await wm._loadGlyphs(state.text);
      if (state.axisValues)
        wm.axisValues = Object.assign(wm.axisValues, state.axisValues);
      // _loadGlyphs reseeds every glyph from the global axisValues, so restore
      // any per-letter overrides (drag-on-glyph) by index before re-deforming.
      // Older/global-only states have no axisDiff and simply fall back to the
      // global values seeded above.
      if (Array.isArray(state.glyphs)) {
        state.glyphs.forEach((sg, i) => {
          const g = wm.glyphs[i];
          if (g && g.axisValues && sg && sg.axisDiff) {
            Object.assign(g.axisValues, sg.axisDiff);
          }
        });
      }
      wm._applyDeformToGlyphs();
      return wm;
    }

    async toInteractiveBundle() {
      const src = await SandboxWordmark._fetchLibrarySource();
      const state = this.toState();
      const attr = outlineAttributionHtml(this.presetKey);
      const boot = `
(function () {
  var root = document.getElementById('putty-wordmark');
  if (!root) return;
  var state = ${JSON.stringify(state)};
  Putty.setOpentypeParser(typeof opentype !== 'undefined' ? opentype : null);
  Putty.DeformableOutlineWordmark.fromState(state).then(function (wm) {
    wm.mount(document.getElementById('putty-outline-stage'));
    if (state.modes && state.modes.mouseFollow && state.modes.mouseFollow.enabled) {
      wm.enableMouseFollow(state.modes.mouseFollow.opts || {});
    }
  });
})();`.trim();

      return [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>putty — outline embed</title>",
        '<script src="https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js"><\/script>',
        "<style>",
        "  html, body { margin: 0; min-height: 100%; background: #f6f7f9; font-family: system-ui, sans-serif; }",
        "  .putty-wrap { max-width: 960px; margin: 0 auto; padding: 24px; }",
        "  .putty-outline-disclaimer { font-size: 13px; line-height: 1.5; color: #525860; background: #eceef2; border: 1px solid #d4d8e0; border-radius: 4px; padding: 12px 14px; margin-bottom: 20px; }",
        "  #putty-outline-stage svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }",
        "</style>",
        "</head>",
        "<body>",
        '<div class="putty-wrap" id="putty-wordmark">',
        attr,
        '<div id="putty-outline-stage"></div>',
        "</div>",
        outlineAttributionBlock(state.preset),
        "<script>" + src + "<\/script>",
        "<script>" + boot + "<\/script>",
        "</body>",
        "</html>",
      ].join("\n");
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ANATOMY DEFORM WORDMARK  (path α — WOFF + per-letter anatomy handles)
  //
  // Sibling of DeformableOutlineWordmark; shares the WOFF-loading helpers
  // (extractOutlineGlyph, getOutlineGlyphData, font cache).
  // Routes through createWordmark() when the preset declares
  // pipeline: 'anatomy-deform' (the four readable-text presets).
  //
  // Per-glyph handle math is production-grade — all of it baked
  // into the glyph commands by _resolveGlyphPath: `weight` is a real polyline
  // offset-path dilation, `height` a region-clipped vertical scale,
  // `serifLength` a serif-foot translation, and `width` an anatomy-aware
  // counter widening that preserves stem thickness. The old SVG stroke
  // overlay is kept only as a per-glyph `weight` fallback.
  //
  // Handle vocabulary, anchor positions, transform primitives, and the
  // round-bottom skip rules originate from the path-α prototype's
  // attachPathAlphaHandles() (since retired).
  // ════════════════════════════════════════════════════════════════════
  class AnatomyDeformWordmark {
    constructor(text, options) {
      options = options || {};
      this.text = text;
      this.presetKey = options.presetKey || options.preset || "instrumentSerif";
      this.pipeline = "anatomy-deform";
      this.tracking = options.tracking != null ? options.tracking : 8;
      this.color = options.color || "#2a2ae5";
      this.padding = options.padding != null ? options.padding : 40;
      this.fontSize = options.fontSize != null ? options.fontSize : 1000;

      // Mono-cell layout toggle. Only takes effect on presets
      // that declare `monoCell` (today: ibmPlexMono). When true (default),
      // every glyph lays out at the preset's mono cell (the WOFF mono
      // advance). When false, each glyph reflows to its visual bbox
      // width so narrow letters like `i` get less horizontal space.
      this.monoCellEnabled =
        options.monoCellEnabled != null ? options.monoCellEnabled : true;

      // Per-glyph anatomy state: one map per glyph, keyed by handle id.
      // height/width/serifLength/descenderDepth are multiplicative scales
      // (default 1); weight is an additive stroke width in user units
      // (default 0).
      this.glyphs = []; // each: { character, pathData, advance, bounds, handleState }

      this.svgEl = null;
      this.glyphLayer = null;
      this.handleLayer = null;
      this.tooltipLayer = null;
      this.interactive = true;

      // Tooltip state — ported from SandboxWordmark /
      // DeformableOutlineWordmark. `{ glyphIdx, handleId, pinned }`.
      // Hover sets pinned=false; drag-start sets pinned=true so the chip
      // stays visible while the pointer leaves the hit area mid-drag.
      this.tooltipState = null;

      // Layout cache, refreshed on every render.
      this._layoutCache = null;

      // Mouse-follow mapping for anatomy-deform: cursor X → every glyph's
      // weight; cursor Y → every glyph's height. Per-letter dragging is
      // unaffected. We snapshot the per-glyph rest state on enable and
      // restore it on disable.
      this._mouseFollow = null;
      this._mouseMoveBound = (e) => this._onMouseFollowMove(e);
      this._mouseLeaveBound = () => this._onMouseFollowLeave();

      if (options.glyphHandleState) {
        // Restore from state — applied after _loadGlyphs.
        this._pendingHandleState = options.glyphHandleState;
      }
    }

    static async create(text, options) {
      const wm = new AnatomyDeformWordmark(text, options);
      await wm._loadGlyphs(text);
      return wm;
    }

    get presetMeta() {
      return presets[this.presetKey] || null;
    }

    get presetHandles() {
      const p = this.presetMeta;
      return (p && p.handles) || [];
    }

    // Whether this preset shows the counterContour handle at all
    // (preset-level gate; the per-glyph decision is the runtime counter
    // detector). Contrast/serif/sans opt in; mono/bubble opt out.
    get presetHasCounterContour() {
      const p = this.presetMeta;
      return !!(p && p.counterContour);
    }

    // Whether a glyph (by its base outline) earns a counterContour handle:
    // the preset opts in AND the detector finds an enclosed counter. Replaces
    // the old hand-curated ANATOMY_COUNTER_LETTERS whitelist.
    _glyphHasCounterHandle(baseCommands) {
      return (
        this.presetHasCounterContour && counterCentroid(baseCommands) != null
      );
    }

    // Default per-glyph handle state — every handle starts at its identity.
    // weight starts at 0 (additive stroke); height/width/serifLength/
    // descenderDepth start at 1 (multiplicative scale).
    _defaultHandleStateFor(character, baseCommands) {
      const ids = anatomyHandleIdsFor(
        character,
        this.presetHandles,
        this._glyphHasCounterHandle(baseCommands)
      );
      const out = {};
      for (const id of ids) {
        out[id] = id === "weight" ? 0 : 1;
      }
      return out;
    }

    async _loadGlyphs(text) {
      const chars = Array.from(text || " ");
      const loaded = [];
      // Band metrics for the height handle's region-clipped scale.
      // Cached per preset+fontSize, so this is cheap on re-layout.
      try {
        this._bandMetrics = await getAnatomyBandMetrics(
          this.presetKey,
          this.fontSize
        );
      } catch (_e) {
        this._bandMetrics = {
          xHeight: this.fontSize * 0.5,
          capHeight: this.fontSize * 0.7,
        };
      }
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        let pathData = "";
        let advance = 0;
        let bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        let baseCommands = null;
        try {
          const base = await getOutlineGlyphData(
            this.presetKey,
            ch,
            this.fontSize
          );
          pathData = base.pathData;
          advance = base.advance;
          bounds = Object.assign({}, base.bounds);
          // Keep the raw outline commands so the `weight` handle can compute
          // a real offset-path dilation rather than a stroke halo.
          baseCommands = base.baseCommands
            ? cloneCommandsDeep(base.baseCommands)
            : null;
        } catch (err) {
          // Fall back to a blank advance — anatomy-deform requires the WOFF;
          // surfacing the error in console keeps the demo bootable.
          if (ch !== " ") console.warn("Outline load failed for", ch, err);
          advance = ch === " " ? this.fontSize * 0.25 : this.fontSize * 0.5;
        }

        // Preserve handle state if the existing glyph at this index matches.
        const existing = this.glyphs[i];
        const handleState =
          existing && existing.character === ch && existing.handleState
            ? Object.assign({}, existing.handleState)
            : this._defaultHandleStateFor(ch, baseCommands);

        loaded.push({
          character: ch,
          pathData,
          baseCommands,
          advance,
          bounds,
          handleState,
        });
      }
      this.glyphs = loaded;
      this.text = text;

      // Apply any pending restored handle state (from fromState()).
      if (this._pendingHandleState) {
        const list = this._pendingHandleState;
        for (let i = 0; i < this.glyphs.length && i < list.length; i++) {
          if (list[i] && list[i].character === this.glyphs[i].character) {
            this.glyphs[i].handleState = Object.assign(
              this._defaultHandleStateFor(
                this.glyphs[i].character,
                this.glyphs[i].baseCommands
              ),
              list[i].handles || {}
            );
          }
        }
        this._pendingHandleState = null;
      }
    }

    mount(target) {
      let host;
      if (typeof target === "string") {
        host = document.querySelector(target);
        if (!host) throw new Error("mount target not found: " + target);
      } else {
        host = target;
      }
      if (host instanceof SVGSVGElement) {
        this.svgEl = host;
      } else {
        this.svgEl = document.createElementNS(SVG_NS, "svg");
        host.appendChild(this.svgEl);
      }
      this.glyphLayer = document.createElementNS(SVG_NS, "g");
      this.handleLayer = document.createElementNS(SVG_NS, "g");
      // Tooltip layer sits on top of handle layer so the chip is never
      // occluded by the visible handle circles.
      this.tooltipLayer = document.createElementNS(SVG_NS, "g");
      this.svgEl.appendChild(this.glyphLayer);
      this.svgEl.appendChild(this.handleLayer);
      this.svgEl.appendChild(this.tooltipLayer);
      describeWordmarkSvg(this.svgEl, this.text, this.interactive);
      this._render();
      return this.svgEl;
    }

    makeInteractive() {
      this.interactive = true;
      this._render();
    }

    freezeInteraction() {
      this.interactive = false;
      this.tooltipState = null;
      this._render();
    }

    async setText(newText) {
      await this._loadGlyphs(newText);
      this._render();
    }

    async setPresetKey(presetKey) {
      this.presetKey = presetKey;
      // Reset all handle state — handle vocabulary may have changed.
      for (const g of this.glyphs) {
        g.handleState = this._defaultHandleStateFor(
          g.character,
          g.baseCommands
        );
      }
      await this._loadGlyphs(this.text);
      this._render();
    }

    resetAll() {
      for (const g of this.glyphs) {
        g.handleState = this._defaultHandleStateFor(
          g.character,
          g.baseCommands
        );
      }
      // Clear mouse-follow rest snapshot too, so toggling off restores
      // defaults (not the pre-reset state).
      if (this._mouseFollow) {
        this._mouseFollow.restGlyphState = this.glyphs.map((g) =>
          Object.assign({}, g.handleState)
        );
      }
      this._render();
    }

    resetGlyph(index) {
      const g = this.glyphs[index];
      if (!g) return;
      g.handleState = this._defaultHandleStateFor(g.character, g.baseCommands);
      this._render();
    }

    // ─── Global weight ─────────────────────────────────────────────────
    // The dramatic "heavy weight" was previously only reachable by dragging
    // each letter's weight handle individually. These let a single control
    // drive the stroke weight across every glyph at once. Range matches the
    // per-handle drag clamp (0..160).
    setGlobalWeight(value) {
      const v = clampNum(value, 0, 160);
      for (const g of this.glyphs) {
        g.handleState.weight = v;
      }
      if (this._mouseFollow) {
        for (const rest of this._mouseFollow.restGlyphState) rest.weight = v;
      }
      this._render();
    }

    getGlobalWeight() {
      let max = 0;
      for (const g of this.glyphs) {
        const w = g.handleState && g.handleState.weight;
        if (typeof w === "number" && w > max) max = w;
      }
      return max;
    }

    // ─── Layout ────────────────────────────────────────────────────────
    // Per-glyph effective advance: the WOFF advance unless the preset
    // declares `monoCell` AND the user has toggled the mono cell off,
    // in which case each glyph reflows to its visual bbox width plus a
    // small sidebearing pulled from the WOFF advance.
    _effectiveAdvanceFor(glyph) {
      const pm = this.presetMeta;
      const hasMonoCell = pm && pm.monoCell;
      if (!hasMonoCell || this.monoCellEnabled) return glyph.advance;
      // Mono off: collapse the mono cell to the visual bbox width plus
      // ~25% of the mono sidebearing as breathing room. For empty bboxes
      // (e.g. ' '), keep the WOFF advance.
      const b = glyph.bounds;
      if (b.maxX <= b.minX) return glyph.advance;
      const bboxW = Math.max(0, b.maxX);
      const sideBearing = Math.max(0, glyph.advance - bboxW);
      return bboxW + sideBearing * 0.25;
    }

    _layout() {
      let cursor = this.padding;
      let maxAscent = 0;
      let maxDescent = 0;
      const placed = this.glyphs.map((glyph) => {
        const x = cursor;
        const eff = this._effectiveAdvanceFor(glyph);
        cursor += eff + this.tracking;
        const b = glyph.bounds;
        const ascent = Math.max(0, -b.minY);
        const descent = Math.max(0, b.maxY);
        if (ascent > maxAscent) maxAscent = ascent;
        if (descent > maxDescent) maxDescent = descent;
        return { glyph, x, bounds: b };
      });
      return {
        placed,
        totalWidth: cursor + this.padding - this.tracking,
        maxAscent,
        maxDescent,
      };
    }

    // Set the mono-cell toggle. No-op on presets without a
    // monoCell setting. Live re-layout — no re-mount needed.
    setMonoCellEnabled(enabled) {
      const pm = this.presetMeta;
      if (!pm || !pm.monoCell) {
        this.monoCellEnabled = !!enabled;
        return;
      }
      const next = !!enabled;
      if (next === this.monoCellEnabled) return;
      this.monoCellEnabled = next;
      this._render();
    }

    // ─── Render ────────────────────────────────────────────────────────
    // Stable per-instance id used to namespace clipPath ids in the
    // descender split. Avoids collisions when multiple anatomy-deform
    // wordmarks live on the same page.
    _instanceId() {
      if (!this.__id) this.__id = "adw" + ((Math.random() * 1e9) | 0);
      return this.__id;
    }

    // Resolve the fill path + stroke attributes for one glyph by applying the
    // path-level handle math in order: `height` as a region-clipped vertical
    // scale, `width`, `counter`, `serifLength`
    // as a serif-foot translation. `weight` is then layered on as a
    // round-joined stroke overlay (paint-order: stroke fill) rather than a path
    // deform — the old offset-path dilation shattered curved glyphs past
    // ~weight 40 and could never go boldly heavy.
    //
    // Order matters for the path-level steps: height-scale first so the rest
    // run on the already re-proportioned outline; width then re-proportions
    // horizontally; counter scales the bowl; serifLength's feet pin at y≈0
    // (which height already fixed) and ride along with their widened stem. The
    // weight stroke sits on the fully re-proportioned outline.
    // every anatomy handle is path-level or a stroke — nothing remains on the
    // wrap-group affine.
    //
    // Result is memoised on the glyph keyed by (height, width, serifLength, weight)
    // so dragging an unrelated handle doesn't recompute the offset every
    // frame. Falls back to the SVG stroke overlay (paint-order: stroke fill)
    // for `weight` when the glyph has no source outline commands or the offset
    // math degenerates.
    _resolveGlyphPath(g) {
      const weight = g.handleState.weight || 0;
      const height = g.handleState.height != null ? g.handleState.height : 1;
      const serif =
        g.handleState.serifLength != null ? g.handleState.serifLength : 1;
      const width = g.handleState.width != null ? g.handleState.width : 1;
      const counter =
        g.handleState.counterContour != null ? g.handleState.counterContour : 1;
      const heightActive = Math.abs(height - 1) > 0.001;
      const serifActive = Math.abs(serif - 1) > 0.001;
      const widthActive = Math.abs(width - 1) > 0.001;
      const counterActive = Math.abs(counter - 1) > 0.001;

      // Base-outline counter centroid, computed once and cached on the glyph
      // (baseCommands never change). Used as the counterContour pivot/anchor
      // whenever the outline isn't re-proportioned by height/width — see the
      // single-source-of-truth note in counterScale.
      const baseCentroid = () =>
        g._counterCentroid !== undefined
          ? g._counterCentroid
          : (g._counterCentroid = counterCentroid(g.baseCommands));

      // No path-level math needed → return the raw outline untouched.
      // Expose baseCommands as `cmds` so _deformedEdgePoints
      // can read the live outline even when no handle is engaged.
      if (
        weight <= 0 &&
        !heightActive &&
        !serifActive &&
        !widthActive &&
        !counterActive
      ) {
        return {
          d: g.pathData,
          strokeAttrs: "",
          cmds: g.baseCommands || null,
          counterPivot: baseCentroid(),
        };
      }

      // Memo: reuse if every path-level scalar matches.
      if (
        g._pathCache &&
        g._pathCache.weight === weight &&
        g._pathCache.height === height &&
        g._pathCache.serif === serif &&
        g._pathCache.width === width &&
        g._pathCache.counter === counter
      ) {
        return g._pathCache.result;
      }

      // Without source commands we can only honour `weight`, via the stroke
      // overlay; `height` silently no-ops (anatomy glyphs always have commands
      // when they have pathData, so this is a load-failure edge case only).
      const strokeFallback = {
        d: g.pathData,
        strokeAttrs:
          weight > 0
            ? ` stroke="${this.color}" stroke-width="${weight}" paint-order="stroke fill" stroke-linejoin="round" stroke-linecap="round"`
            : "",
        cmds: g.baseCommands || null,
        counterPivot: baseCentroid(),
      };
      if (!g.baseCommands) {
        g._pathCache = {
          weight,
          height,
          serif,
          width,
          counter,
          result: strokeFallback,
        };
        return strokeFallback;
      }

      let result = strokeFallback;
      // Counter pivot: the single point the counter scales about
      // AND the counterContour handle anchors to. Computed from the live
      // height/width-deformed outline so the pivot and the dot track together
      // under width/height; falls back to the cached base centroid when the
      // outline isn't re-proportioned. Threaded onto every result below.
      let counterPivot = baseCentroid();
      try {
        let cmds = g.baseCommands;
        if (heightActive) {
          cmds = bandScaleY(cmds, height, this._bandTopYFor(g.character));
        }
        if (widthActive) {
          // Anatomy-aware horizontal width: widen the counter, keep stems
          // Runs before serif/weight so the feet sit at their
          // widened x and the dilation thickens the re-proportioned outline.
          cmds = anatomyWidth(cmds, width);
        }
        if (heightActive || widthActive) {
          // Outline re-proportioned → the base centroid is stale; recompute
          // the pivot from the deformed outline (cheap, once per cache-miss).
          counterPivot = counterCentroid(cmds);
        }
        if (counterActive) {
          // Scale only the enclosed counter about its centroid, so
          // the bowl's inner shape changes while the outer stroke holds. Runs
          // after width (which has already re-proportioned the outline) and
          // before serif/weight, so the feet sit on the final outline and the
          // dilation thickens the re-shaped counter uniformly.
          // pivot about `counterPivot` (== the handle anchor) and reserve the
          // `weight` half-width in the growth cap so the ring holds.
          cmds = counterScale(cmds, counter, counterPivot, weight);
        }
        if (serifActive) {
          // Baseline band ≈ ±0.10·xHeight. The serif feet rest on
          // y=0; this tolerance catches them without reaching the body. The
          // round-bottom skip set never declares serifLength, so o/c/e/… are
          // a no-op even before serifFootTranslate's own degrade-to-no-op.
          const m = this._bandMetrics || {};
          const xH = m.xHeight || this.fontSize * 0.5;
          const tol = 0.1 * xH;
          cmds = serifFootTranslate(cmds, serif, tol);
        }
        // Weight renders as a round-joined stroke overlay (paint-order:
        // stroke fill), NOT an offset-path dilation. The dilation self-
        // intersects on curved contours past ~weight 40 — the glyph shatters
        // into a mess of white gashes — so it could never go boldly heavy. A
        // centered stroke of width W grows the silhouette by W/2 cleanly and
        // keeps growing all the way into the bleed-into-neighbors range the
        // toy wants. The path `d` carries the height/width/counter/serif
        // outline; weight is the stroke on top. The weight/left handle node
        // tracks the thickened edge via the weight/2 expansion in
        // _deformedEdgePoints (cmds stays the un-stroked outline here).
        const strokeAttrs =
          weight > 0
            ? ` stroke="${this.color}" stroke-width="${weight}" paint-order="stroke fill" stroke-linejoin="round" stroke-linecap="round"`
            : "";
        result = {
          d: commandsToPathData(cmds),
          strokeAttrs,
          cmds,
          counterPivot,
        };
      } catch (err) {
        // Keep the stroke-overlay fallback for this glyph.
        result = strokeFallback;
      }
      g._pathCache = { weight, height, serif, width, counter, result };
      return result;
    }

    // Build the per-glyph markup for one placed glyph. Shared by
    // _render() and toSVG(). For descender letters we split into two
    // clipped layers — above baseline (unaffected) and below baseline
    // (scaled by descenderDepth, pivoted at y=0). Other glyphs render
    // as a single <path>.
    _glyphMarkup(pg, i, opts) {
      const o = opts || {};
      const g = pg.glyph;
      const tr = this._transformFor(g);
      const rendered = this._resolveGlyphPath(g);
      const pathData = rendered.d;
      const strokeAttrs = rendered.strokeAttrs;
      if (!g.pathData) {
        return (
          `<g transform="translate(${pg.x},${o.baselineY})" data-glyph-idx="${i}">` +
          `<g class="alpha-wrap"${tr ? ` transform="${tr}"` : ""}></g>` +
          `</g>`
        );
      }

      const isDescender = ANATOMY_DESCENDER_LETTERS.has(g.character);
      const dd = g.handleState.descenderDepth;
      if (!isDescender || dd == null) {
        const pathMarkup = `<path d="${pathData}" fill="${this.color}" fill-rule="evenodd"${strokeAttrs}/>`;
        return (
          `<g transform="translate(${pg.x},${o.baselineY})" data-glyph-idx="${i}">` +
          `<g class="alpha-wrap"${tr ? ` transform="${tr}"` : ""}>${pathMarkup}</g>` +
          `</g>`
        );
      }

      // Descender split — two clipped copies of the same <path>, one
      // above baseline (y <= 0) and one below (y >= 0). The below-baseline
      // layer carries `scale(1 descenderDepth)` pivoted at y=0, so the
      // descender stretches/shortens without disturbing the body.
      const idAbove = `${o.clipPrefix}-abv-${i}`;
      const idBelow = `${o.clipPrefix}-bel-${i}`;
      const bb = g.bounds;
      // Pad so the descender split's clip rects never cut the glyph: a base
      // margin, the heavy weight stroke's half-width (it grows the silhouette
      // by weight/2 in every direction), plus the extra rightward reach of
      // path-level `width`, which pins the left edge and pushes the
      // right edge out by (width − 1)·glyphWidth.
      const wv = g.handleState.width;
      const widthGrow =
        wv && wv > 1 ? (wv - 1) * Math.max(0, bb.maxX - bb.minX) : 0;
      const weightPad = (g.handleState.weight || 0) / 2;
      const padX = 80 + widthGrow + weightPad;
      const padY = 80 + weightPad;
      const clipLeft = bb.minX - padX;
      const clipRight = bb.maxX + padX;
      const clipW = Math.max(1, clipRight - clipLeft);
      // Overlap the two clip rects by 1 unit at the baseline. Without
      // overlap, anti-aliasing leaves a faint hairline seam where the
      // two clipped halves meet.
      const seamOverlap = 1;
      const aboveTop = bb.minY - padY;
      const aboveH = Math.max(1, -aboveTop + seamOverlap);
      const belowH = Math.max(1, bb.maxY + padY);
      const defs =
        `<defs>` +
        `<clipPath id="${idAbove}" clipPathUnits="userSpaceOnUse">` +
        `<rect x="${clipLeft}" y="${aboveTop}" width="${clipW}" height="${aboveH}"/>` +
        `</clipPath>` +
        `<clipPath id="${idBelow}" clipPathUnits="userSpaceOnUse">` +
        `<rect x="${clipLeft}" y="${-seamOverlap}" width="${clipW}" height="${belowH + seamOverlap}"/>` +
        `</clipPath>` +
        `</defs>`;
      const pathTag = `<path d="${pathData}" fill="${this.color}" fill-rule="evenodd"${strokeAttrs}/>`;
      const ddTransform = dd === 1 ? "" : ` transform="scale(1 ${dd})"`;
      return (
        `<g transform="translate(${pg.x},${o.baselineY})" data-glyph-idx="${i}">` +
        `<g class="alpha-wrap"${tr ? ` transform="${tr}"` : ""}>` +
        defs +
        `<g clip-path="url(#${idAbove})">${pathTag}</g>` +
        `<g${ddTransform} clip-path="url(#${idBelow})">${pathTag}</g>` +
        `</g>` +
        `</g>`
      );
    }

    _render() {
      if (!this.svgEl || !this.glyphLayer) return;
      const layout = this._layout();
      this._layoutCache = layout;
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      // Pad the viewBox by the heaviest glyph's stroke half-width so a bold
      // weight halo isn't clipped at the SVG edges (the stroke grows the
      // silhouette by weight/2 in every direction). Negative origin keeps glyph
      // coordinates — and handle positions — unchanged.
      const wpad = this._maxWeightPad();
      this.svgEl.setAttribute(
        "viewBox",
        `${-wpad} ${-wpad} ${totalWidth + 2 * wpad} ${height + 2 * wpad}`
      );
      this.svgEl.setAttribute("width", String(totalWidth + 2 * wpad));
      this.svgEl.setAttribute("height", String(height + 2 * wpad));
      this.svgEl.setAttribute("data-render-mode", "anatomy-deform");
      this.svgEl.setAttribute("data-preset", this.presetKey);

      // Glyph layer: each glyph is an outer translate-positioned <g> with an
      // inner alpha-wrap <g> that carries the per-letter affine transform.
      // Weight is a round-joined stroke overlay (paint-order: stroke fill) and
      // height is a region-clipped vertical scale — see
      // _resolveGlyphPath. Descender letters split into two clipped layers —
      // see _glyphMarkup.
      const parts = [];
      const clipPrefix = this._instanceId();
      for (let i = 0; i < placed.length; i++) {
        parts.push(this._glyphMarkup(placed[i], i, { baselineY, clipPrefix }));
      }
      this.glyphLayer.innerHTML = parts.join("");

      // Handle overlay layer.
      if (this.interactive && this.handleLayer) {
        this._renderHandles(layout, baselineY);
      } else if (this.handleLayer) {
        this.handleLayer.innerHTML = "";
        this.tooltipState = null;
      }
      // Tooltip chip — must run after handles so the chip is positioned
      // against the live handle positions.
      this._renderTooltip(totalWidth, height);
    }

    // The per-glyph wrap-group affine. Every anatomy handle is path-level
    // (height → bandScaleY, width → anatomyWidth, counter → counterScale,
    // serifLength → serifFootTranslate) or a stroke overlay (weight); all in
    // _resolveGlyphPath, so there's no longer any CSS transform to emit. Kept
    // as a seam in case a future handle wants a cheap wrap-group transform.
    // descenderDepth still applies its own `scale(1 dd)` directly in
    // _glyphMarkup.
    _transformFor(_glyph) {
      return "";
    }

    // x-height band top for the height handle's region-clipped scale
    // Uppercase clips to cap-height (whole cap, baseline pinned);
    // everything else clips to x-height so ascenders/descenders above the
    // x-height line stay put while the x-height band scales. Returned as a
    // negative y (glyph space has up = −y). Falls back to a generous band if
    // metrics never loaded.
    _bandTopYFor(character) {
      const m = this._bandMetrics || {};
      const xH = m.xHeight || this.fontSize * 0.5;
      const capH = m.capHeight || this.fontSize * 0.7;
      const isUpper =
        character >= "A" &&
        character <= "Z" &&
        character === character.toUpperCase();
      return isUpper ? -capH : -xH;
    }

    // Sample edge points from the LIVE deformed outline so the
    // control nodes sit on the moving letterform edge instead of floating
    // beside the undeformed bbox. Reads the deformed command array out of
    // _resolveGlyphPath (which memoises per handle-state), samples every
    // subpath densely into a point cloud, and picks the extremal points
    // per handle. Cached on the glyph keyed by the same
    // path-state scalars as _resolveGlyphPath's memo, so repeated calls in a
    // single _render (one per handle) don't re-sample.
    //   right  → rightmost point near vertical mid (right stroke edge)
    //   left   → leftmost  point near vertical mid (left  stroke edge)
    //   top    → topmost    point near horizontal mid (top edge)
    //   bottom → bottom-most point (descender terminal)
    //   footRight → outline point near the baseline (y≈0) on the right
    // All in glyph-local space (origin at the glyph's baseline-left, y-up
    // negative as in the outline commands); callers add pg.x / baselineY.
    _deformedEdgePoints(g) {
      const resolved = this._resolveGlyphPath(g);
      const cmds = resolved && resolved.cmds;
      // descenderDepth is applied as a wrap-group `scale(1 dd)`,
      // not a path-level deform, so it never reaches `cmds`; fold it into the
      // bottom edge below AND into the cache key here so dragging it busts the
      // cache (the old key omitted it, freezing the descender node).
      const isDescender = ANATOMY_DESCENDER_LETTERS.has(g.character);
      const dd =
        isDescender && g.handleState.descenderDepth != null
          ? g.handleState.descenderDepth
          : 1;
      const stateKey =
        (g.handleState.weight || 0) +
        "|" +
        (g.handleState.height != null ? g.handleState.height : 1) +
        "|" +
        (g.handleState.width != null ? g.handleState.width : 1) +
        "|" +
        (g.handleState.serifLength != null ? g.handleState.serifLength : 1) +
        "|" +
        (g.handleState.counterContour != null
          ? g.handleState.counterContour
          : 1) +
        "|" +
        dd;
      if (g._edgeCache && g._edgeCache.key === stateKey) {
        return g._edgeCache.edges;
      }
      if (!cmds || !cmds.length) return null;

      // Dense point cloud over all subpaths (outer + counters).
      // accumulate the bounds in this same pass instead of a second loop over
      // the cloud (the dragged glyph misses the cache every frame of its drag).
      const subs = splitSubpaths(cmds);
      const pts = [];
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const sp of subs) {
        const s = sampleSubpathDense(sp.commands, 12);
        for (const p of s.points) {
          pts.push(p);
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!pts.length) return null;

      const midY = (minY + maxY) / 2;
      const midX = (minX + maxX) / 2;
      const spanY = Math.max(1, maxY - minY);
      const spanX = Math.max(1, maxX - minX);
      // Bands: "near vertical mid" = central third of the height; "near
      // horizontal mid" = central third of the width.
      const vBand = spanY * 0.34;
      const hBand = spanX * 0.34;

      // right: rightmost point whose y is near vertical mid.
      // left:  leftmost  point whose y is near vertical mid.
      // top:   topmost   point whose x is near horizontal mid.
      // bottom: globally bottom-most point.
      // footRight: rightmost point near the baseline (y≈0).
      let right = null,
        left = null,
        top = null,
        bottom = null,
        foot = null;
      // Serif-foot band. Reuse the single baseline
      // tolerance (0.10·xHeight) instead of a second independent 0.12·spanY
      // fraction, and widen it downward by `weight/2` defensively (the weight
      // stroke grows the silhouette below the baseline by half its width).
      // Feet sit at/just-below the baseline (y ≥ 0 in the y-down outline
      // space), so the band is [−tol, tol + weight/2].
      const xH =
        (this._bandMetrics && this._bandMetrics.xHeight) || this.fontSize * 0.5;
      const footTol = Math.max(0.1 * xH, 1);
      const footLo = -footTol;
      const footHi = footTol + (g.handleState.weight || 0) / 2;
      for (const p of pts) {
        const nearVMid = Math.abs(p.y - midY) <= vBand;
        const nearHMid = Math.abs(p.x - midX) <= hBand;
        if (nearVMid && (right === null || p.x > right.x)) right = p;
        if (nearVMid && (left === null || p.x < left.x)) left = p;
        if (nearHMid && (top === null || p.y < top.y)) top = p;
        if (bottom === null || p.y > bottom.y) bottom = p;
        // Baseline foot: y in the (dilation-aware) baseline band, rightmost.
        if (p.y >= footLo && p.y <= footHi && (foot === null || p.x > foot.x)) {
          foot = p;
        }
      }
      // Fallbacks if a band caught nothing (degenerate glyph). `bottom` needs
      // none — it's the global bottom-most, set for every point, and the cloud
      // is guaranteed non-empty above (dropped the dead guard).
      if (!right) right = { x: maxX, y: midY };
      if (!left) left = { x: minX, y: midY };
      if (!top) top = { x: midX, y: minY };
      if (!foot) foot = { x: maxX, y: Math.min(0, maxY) };

      // Weight is rendered as a stroke overlay, so `cmds` here is the un-
      // stroked outline; the visible silhouette is weight/2 larger in every
      // direction. Push each edge node out by weight/2 so it keeps riding the
      // thickened edge (the weight/left node most of all).
      const wHalf = (g.handleState.weight || 0) / 2;
      if (wHalf > 0) {
        right = { x: right.x + wHalf, y: right.y };
        left = { x: left.x - wHalf, y: left.y };
        top = { x: top.x, y: top.y - wHalf };
        bottom = { x: bottom.x, y: bottom.y + wHalf };
        foot = { x: foot.x + wHalf, y: foot.y + wHalf };
      }

      // Fold descenderDepth into the bottom edge. The below-
      // baseline layer renders under `scale(1 dd)` pivoted at y=0, so the
      // descender terminal (y > 0) actually sits at y·dd. Scale only the
      // below-baseline portion; above-baseline bottoms (non-descenders) are
      // untouched (dd === 1 for them anyway).
      if (dd !== 1 && bottom.y > 0) {
        bottom = { x: bottom.x, y: bottom.y * dd };
      }

      // Single source of truth for the counter centroid: the
      // exact pivot counterScale used (carried on `resolved.counterPivot`), so
      // the counterContour dot and the scale pivot can never diverge and the
      // dot tracks width/height. null when the glyph has no counter.
      const counter = resolved ? resolved.counterPivot || null : null;

      const edges = {
        right,
        left,
        top,
        bottom,
        foot,
        counter,
        minX,
        maxX,
        minY,
        maxY,
      };
      g._edgeCache = { key: stateKey, edges };
      return edges;
    }

    // Compute the on-screen position + cursor style for every handle
    // we'd render in the current layout. Kept separate from rendering so
    // the tooltip can re-look-up positions without re-parsing DOM.
    // Returns a flat array of `{ glyphIdx, handleId, spec, hx, hy, cursor }`.
    _computeHandlePositions(layout, baselineY) {
      const presetHandles = this.presetHandles;
      const out = [];
      for (let i = 0; i < layout.placed.length; i++) {
        const pg = layout.placed[i];
        const g = pg.glyph;
        if (g.character === " " || !g.pathData) continue;
        const ids = anatomyHandleIdsFor(
          g.character,
          presetHandles,
          this._glyphHasCounterHandle(g.baseCommands)
        );
        if (!ids.length) continue;
        const bb = g.bounds;
        const overrides = ANATOMY_ANCHOR_OVERRIDES[g.character] || null;
        // Edge points sampled from the LIVE deformed outline.
        // _deformedEdgePoints returns null only for a degenerate
        // glyph (pathData but no usable command cloud — a load-failure edge
        // case; real glyphs always sample). Synthesize bbox-derived edge points
        // there so every anchor branch below is unconditional (collapses the
        // five per-branch `else { …bbox… }` fallbacks into this one block).
        let edges = this._deformedEdgePoints(g);
        if (!edges) {
          const cx = (bb.minX + bb.maxX) / 2;
          const cy = (bb.minY + bb.maxY) / 2;
          edges = {
            right: { x: bb.maxX, y: cy },
            left: { x: bb.minX, y: cy },
            top: { x: cx, y: bb.minY },
            bottom: { x: cx, y: bb.maxY },
            foot: { x: bb.maxX, y: Math.min(0, bb.maxY) },
            counter:
              g._counterCentroid !== undefined
                ? g._counterCentroid
                : (g._counterCentroid = counterCentroid(g.baseCommands)),
          };
        }
        // Small outward nudge (≈1 handle radius) so the visible dot reads as
        // sitting on the rim rather than buried under the fill.
        const NUDGE = 8;
        for (const id of ids) {
          const spec = this._handleSpecFor(g.character, id);
          if (!spec) continue;
          const ov = (overrides && overrides[id]) || null;
          let hx, hy, cursor;
          if (spec.anchor === "top") {
            // Topmost outline point near horizontal mid → the top edge
            // (ascender / cap / x-height as appropriate). The
            // `f`/`t`/`J` height `yFrac` overrides DO still matter — the
            // topmost edge point is the hook/cap-overshoot, not the visual top
            // of the body — so apply them as a downward offset from the live
            // edge (edge.top.y + yFrac·bboxH ≈ the old bbox anchor, but now it
            // tracks the height deform). An xFrac override slides it along x.
            const xFrac = ov && ov.xFrac != null ? ov.xFrac : null;
            const yFrac = ov && ov.yFrac != null ? ov.yFrac : null;
            hx =
              pg.x +
              (xFrac != null
                ? bb.minX + (bb.maxX - bb.minX) * xFrac
                : edges.top.x);
            hy =
              baselineY +
              edges.top.y -
              NUDGE +
              (yFrac != null ? yFrac * (bb.maxY - bb.minY) : 0);
            cursor = "ns-resize";
          } else if (spec.anchor === "right") {
            // Rightmost outline point near vertical mid → right stroke edge.
            // `f`'s width `xFrac` override pulls the node in off
            // the crossbar-extended bbox to the stem's visual right edge;
            // honour it against the bbox (interior target, no outward nudge).
            const xFrac = ov && ov.xFrac != null ? ov.xFrac : null;
            hx =
              pg.x +
              (xFrac != null
                ? bb.minX + (bb.maxX - bb.minX) * xFrac
                : edges.right.x + NUDGE);
            hy = baselineY + edges.right.y;
            cursor = "ew-resize";
          } else if (spec.anchor === "left") {
            // Leftmost outline point near vertical mid → left stroke edge
            // (replaces the old left-floating bbox anchor).
            hx = pg.x + edges.left.x - NUDGE;
            hy = baselineY + edges.left.y;
            cursor = "ew-resize";
          } else if (spec.anchor === "bottomRight") {
            // Serif-foot terminal: an outline point near the baseline (y≈0)
            // on the right.
            hx = pg.x + edges.foot.x + NUDGE;
            hy = baselineY + edges.foot.y;
            cursor = "ew-resize";
          } else if (spec.anchor === "bottomCenter") {
            // Bottom-most outline point → descender terminal.
            hx = pg.x + edges.bottom.x;
            hy = baselineY + edges.bottom.y + NUDGE;
            cursor = "ns-resize";
          } else if (spec.anchor === "counter") {
            // Anchor on the counter centroid carried by
            // _deformedEdgePoints (edges.counter): the *same* point counterScale
            // pivots about, computed from the live deformed outline, so the dot
            // tracks width/height and the grow stays symmetric about it. A
            // letter whose counter the detector can't find drops the handle.
            const c = edges && edges.counter;
            if (!c) continue;
            hx = pg.x + c.x;
            hy = baselineY + c.y;
            cursor = "nwse-resize";
          } else {
            hx = pg.x + (bb.minX + bb.maxX) / 2;
            hy = baselineY + bb.minY - 18;
            cursor = "ns-resize";
          }
          out.push({ glyphIdx: i, handleId: id, spec, hx, hy, cursor });
        }
      }
      return out;
    }

    _renderHandles(layout, baselineY) {
      const HANDLE_R = 7;
      // Invisible hit-area radius: the visible 7-unit circle is roughly
      // 5px at display scale (SVG viewBox is huge, page-scales down via
      // max-height: 60vh). Bumped 18 → 22 (matching the sandbox/outline
      // engines) for a more touch-friendly target (WCAG 2.5.8) without
      // changing the visual.
      const HIT_R = 22;
      const STEM = "#1a2f6e";
      const positions = this._computeHandlePositions(layout, baselineY);
      this._handlePositions = positions;
      const html = [];
      for (const p of positions) {
        // Two-circle pattern:
        //   - Invisible hit-area on the bottom, catches all pointer
        //     events (transparent fill in SVG doesn't capture by
        //     default — `pointer-events="all"` is explicit).
        //   - Visible 7-unit circle on top, purely decorative
        //     (`pointer-events="none"`), so it never intercepts the
        //     events bound to the hit-area beneath.
        html.push(
          `<circle data-glyph-idx="${p.glyphIdx}" data-handle-id="${p.handleId}" data-hit-area="true" cx="${p.hx}" cy="${p.hy}" r="${HIT_R}" fill="transparent" stroke="none" pointer-events="all" style="cursor:${p.cursor};touch-action:none"/>` +
            `<circle cx="${p.hx}" cy="${p.hy}" r="${HANDLE_R}" fill="#ffffff" stroke="${STEM}" stroke-width="1.5" pointer-events="none"/>`
        );
      }
      this.handleLayer.innerHTML = html.join("");
      // Clamp ranges + rest defaults mirror _onHandleMove / _onHandleDown so
      // keyboard nudges stay inside the same bounds as pointer drags.
      const HANDLE_RANGES = {
        height: [0.4, 2.4],
        width: [0.4, 2.4],
        serifLength: [0.4, 2.4],
        weight: [0, 160],
        descenderDepth: [0.1, 2.4],
        counterContour: [0.6, 1.4],
      };
      this.handleLayer
        .querySelectorAll("circle[data-hit-area]")
        .forEach((c) => {
          c.addEventListener("pointerdown", (ev) => this._onHandleDown(ev));
          c.addEventListener("pointerenter", (ev) => this._onHandleEnter(ev));
          c.addEventListener("pointerleave", () => this._onHandleLeave());
          const glyphIdx = Number(c.dataset.glyphIdx);
          const handleId = c.dataset.handleId;
          const glyph = this.glyphs[glyphIdx];
          const range = HANDLE_RANGES[handleId];
          if (!glyph || !range) return;
          const labelBase =
            handleId === "height"
              ? anatomyHeightLabel(glyph.character)
              : humanizeHandleId(handleId);
          const label =
            labelBase + ' handle on letter "' + glyph.character + '"';
          makeHandleKeyboardOperable(c, label, (dir, mult) => {
            const [lo, hi] = range;
            const step = ((hi - lo) / 100) * mult;
            const rest = handleId === "weight" ? 0 : 1;
            const current =
              glyph.handleState[handleId] != null
                ? glyph.handleState[handleId]
                : rest;
            glyph.handleState[handleId] = clampNum(
              current + dir * step,
              lo,
              hi
            );
            this._render();
            const next = this.handleLayer.querySelector(
              'circle[data-hit-area][data-handle-id="' +
                handleId +
                '"][data-glyph-idx="' +
                glyphIdx +
                '"]'
            );
            if (next) next.focus();
          });
        });
    }

    // Per-handle spec: anchor position keyword + tooltip text + transform
    // kind. Height adapts its tooltip per letter category.
    _handleSpecFor(character, id) {
      if (id === "height") {
        const label = anatomyHeightLabel(character);
        return {
          anchor: "top",
          transform: "scaleY-base",
          title: `${label} on '${character}'`,
        };
      }
      if (id === "width") {
        return {
          anchor: "right",
          transform: "scaleX-left",
          title: `width on '${character}'`,
        };
      }
      if (id === "serifLength") {
        return {
          anchor: "bottomRight",
          transform: "scaleX-left",
          title: `serif on '${character}'`,
        };
      }
      if (id === "weight") {
        return {
          anchor: "left",
          transform: "weight-stroke",
          title: `weight on '${character}'`,
        };
      }
      if (id === "descenderDepth") {
        return {
          anchor: "bottomCenter",
          transform: "scaleY-below-baseline",
          title: `descender on '${character}'`,
        };
      }
      if (id === "counterContour") {
        return {
          anchor: "counter",
          transform: "counter-scale",
          title: `counter on '${character}'`,
        };
      }
      return null;
    }

    _esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // ─── Tooltip ──────────────────────────────────────
    // Ported from SandboxWordmark / DeformableOutlineWordmark: a cream-
    // chip-with-accent-border that shows the handle's anatomy label and
    // current value. Hover → unpinned; drag → pinned (stays put even if
    // the pointer leaves the hit area mid-drag).
    _fmt(v) {
      if (v == null || !isFinite(v)) return "";
      const r = Math.round(v * 100) / 100;
      return Number.isInteger(r) ? String(r) : r.toFixed(2);
    }

    // A handle is "at default" when its scalar matches the identity:
    // weight=0 (additive), all others=1 (multiplicative). Used to decide
    // whether the tooltip shows just the label or label+value.
    _isHandleAtDefault(handleId, value) {
      if (value == null) return true;
      const def = handleId === "weight" ? 0 : 1;
      return Math.abs(value - def) < 0.001;
    }

    _renderTooltip(totalWidth, height) {
      if (!this.tooltipLayer) return;
      if (!this.interactive || !this.tooltipState) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const positions = this._handlePositions || [];
      const target = positions.find(
        (p) =>
          p.glyphIdx === this.tooltipState.glyphIdx &&
          p.handleId === this.tooltipState.handleId
      );
      if (!target) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      const glyph = this.glyphs[target.glyphIdx];
      if (!glyph) {
        this.tooltipLayer.innerHTML = "";
        return;
      }
      // Label uses _handleSpecFor's `title` (e.g. "ascender on 'l'",
      // "weight on 'a'") — matches the spec.
      const labelText = target.spec.title;
      const value = glyph.handleState[target.handleId];
      const showValue = !this._isHandleAtDefault(target.handleId, value);
      const valueText = showValue ? this._fmt(value) : "";

      // Minimal, no-box tooltip. Ultramarine (--ultramarine)
      // mono text on a faint --paper underlay (low-opacity rounded rect,
      // just for legibility over the glyph) — no border, no chip outline.
      // Metrics still scale from fontSize: AnatomyDeform's viewBox is
      // ~fontSize tall (default 1000), so text must scale up to read after
      // the CSS down-scale (max-height shrinks the SVG dramatically).
      const PAPER = "#f6f7f9"; // --paper
      const ULTRAMARINE = "#1a2f6e"; // --ultramarine
      const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"; // --mono
      const scale = Math.max(1.5, this.fontSize / 167);
      const gap = 6 * scale;
      const fontSizePx = 12 * scale;
      // Real rendered metrics (in user units) so long per-letter labels
      // like "cap-height on 'A'" don't overflow the halo.
      const labelW = measureSvgText(this.tooltipLayer, labelText, fontSizePx, {
        fontFamily: MONO,
        letterSpacing: "0.02em",
      });
      const valueW = showValue
        ? measureSvgText(this.tooltipLayer, valueText, fontSizePx, {
            fontFamily: MONO,
            fontWeight: "700",
          })
        : 0;
      // The underlay is a soft halo hugging the text — minimal footprint,
      // a little horizontal/vertical breathing room, no chip border.
      const padX = 4 * scale;
      const padY = 3 * scale;
      const textW = labelW + (showValue ? gap + valueW : 0);
      const bubbleW = textW + padX * 2;
      const bubbleH = 18 * scale;
      const refX = target.hx;
      const refY = target.hy;
      const margin = 8 * scale;
      const off = 14 * scale;
      let bx = refX + off;
      let by = refY - bubbleH - off * 0.85;
      if (bx + bubbleW > totalWidth - margin) bx = refX - bubbleW - off;
      if (by < margin) by = refY + off;
      bx = Math.max(margin, Math.min(totalWidth - bubbleW - margin, bx));
      by = Math.max(margin, Math.min(height - bubbleH - margin, by));

      const textX = bx + padX;
      const baselineDy = bubbleH - padY * 1.2;
      const parts = [];
      parts.push('<g data-handle-tooltip="true" pointer-events="none">');
      // Faint paper underlay — no stroke, low opacity, rounded.
      parts.push(
        `<rect x="${bx}" y="${by}" width="${bubbleW}" height="${bubbleH}" rx="${4 * scale}" ry="${4 * scale}" fill="${PAPER}" fill-opacity="0.82" stroke="none"/>`
      );
      // Label: ultramarine mono.
      parts.push(
        `<text x="${textX}" y="${by + baselineDy}" fill="${ULTRAMARINE}" font-size="${fontSizePx}" font-family="${MONO}" letter-spacing="0.02em">${this._esc(labelText)}</text>`
      );
      if (showValue) {
        // Value: ultramarine mono bold.
        parts.push(
          `<text x="${textX + labelW + gap}" y="${by + baselineDy}" fill="${ULTRAMARINE}" font-size="${fontSizePx}" font-family="${MONO}" font-weight="700">${this._esc(valueText)}</text>`
        );
      }
      parts.push("</g>");
      this.tooltipLayer.innerHTML = parts.join("");
    }

    _refreshTooltip() {
      const layout = this._layoutCache || this._layout();
      const height =
        this.padding +
        layout.maxAscent +
        Math.max(layout.maxDescent, 8) +
        this.padding;
      this._renderTooltip(layout.totalWidth, height);
    }

    _onHandleEnter(ev) {
      // While dragging a different handle, pinned tooltip wins — don't
      // flip it to follow the cursor.
      if (this._dragState) return;
      const t = ev.currentTarget;
      this.tooltipState = {
        glyphIdx: Number(t.dataset.glyphIdx),
        handleId: t.dataset.handleId,
        pinned: false,
      };
      this._refreshTooltip();
    }

    _onHandleLeave() {
      // Pinned (drag in progress) → ignore leave; the drag end clears it.
      if (this._dragState || (this.tooltipState && this.tooltipState.pinned))
        return;
      this.tooltipState = null;
      this._refreshTooltip();
    }

    // ─── Drag ──────────────────────────────────────────────────────────
    _onHandleDown(ev) {
      const t = ev.currentTarget;
      const glyphIdx = Number(t.dataset.glyphIdx);
      const handleId = t.dataset.handleId;
      const glyph = this.glyphs[glyphIdx];
      if (!glyph) return;
      const def = handleId === "weight" ? 0 : 1;
      const startV =
        glyph.handleState[handleId] != null ? glyph.handleState[handleId] : def;
      const drag = {
        glyphIdx,
        handleId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startV,
      };
      this._dragState = drag;
      // Pin the tooltip to this handle for the duration of the drag.
      // Hover-leave events won't dismiss it while pinned (see
      // _onHandleLeave); the drag-up handler clears it.
      this.tooltipState = { glyphIdx, handleId, pinned: true };
      this._refreshTooltip();
      // Listen on window, not the circle. _onHandleMove calls _render(),
      // which wipes and rebuilds the handle layer — that detaches the
      // original circle, dropping any element-bound move/up listeners
      // mid-drag (and orphaning setPointerCapture). Window listeners
      // survive the re-render so the drag end always fires.
      const onMove = (e) => this._onHandleMove(e, drag);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        this._dragState = null;
        this.tooltipState = null;
        this._refreshTooltip();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      ev.preventDefault();
    }

    _onHandleMove(ev, drag) {
      const glyph = this.glyphs[drag.glyphIdx];
      if (!glyph) return;
      // Sensitivity: bump scalar handles from dy/80 → dy/40 so
      // a 40px drag = +1.0 unit (was 80px and felt unresponsive given
      // how small the visible handle is at display scale). `weight`
      // stays at dx/6 — it already feels right at that conversion.
      let v;
      if (drag.handleId === "height") {
        const dy = drag.startClientY - ev.clientY; // drag up = grow
        v = clampNum(drag.startV + dy / 40, 0.4, 2.4);
      } else if (drag.handleId === "width" || drag.handleId === "serifLength") {
        const dx = ev.clientX - drag.startClientX; // drag right = grow
        v = clampNum(drag.startV + dx / 40, 0.4, 2.4);
      } else if (drag.handleId === "weight") {
        // Range 0..160 (was 0..40) now that weight is a clean stroke overlay:
        // the top of the range is meant to be dramatic — letters thicken until
        // they overlap and bleed into their neighbors. dx/1.5 so a deliberate
        // drag of ~240px sweeps the whole range.
        const dx = ev.clientX - drag.startClientX; // drag right = heavier
        v = clampNum(drag.startV + dx / 1.5, 0, 160);
      } else if (drag.handleId === "descenderDepth") {
        const dy = ev.clientY - drag.startClientY; // drag down = grow
        v = clampNum(drag.startV + dy / 40, 0.1, 2.4);
      } else if (drag.handleId === "counterContour") {
        // Counter scale, range 0.6..1.4 (tighter than width: a
        // counter change reads strongly). Less sensitive than width (dx/100
        // vs dx/40) so the full range takes a deliberate ~80px drag.
        const dx = ev.clientX - drag.startClientX; // drag right = grow counter
        v = clampNum(drag.startV + dx / 100, 0.6, 1.4);
      } else {
        return;
      }
      glyph.handleState[drag.handleId] = v;
      // Cheap path: only the affected glyph needs updating, but a full
      // re-render is fine for prototype-grade math + small text.
      this._render();
    }

    // ─── Mouse-follow ──────────────────────────────────────────────────
    enableMouseFollow(opts) {
      if (this._mouseFollow) this.disableMouseFollow();
      const o = Object.assign({}, opts || {});
      // Snapshot per-glyph rest state so disable restores it.
      const restGlyphState = this.glyphs.map((g) =>
        Object.assign({}, g.handleState)
      );
      this._mouseFollow = {
        opts: o,
        restGlyphState,
        // Ranges for weight (0..160) and height (0.4..2.4) — match drag clamps.
        weightMin: 0,
        weightMax: 160,
        heightMin: 0.4,
        heightMax: 2.4,
      };
      // Dismiss any lingering tooltip — mouse-follow drives the same
      // handles, but the chip would float around stale positions.
      this.tooltipState = null;
      window.addEventListener("mousemove", this._mouseMoveBound, {
        passive: true,
      });
      document.addEventListener("mouseleave", this._mouseLeaveBound);
    }

    disableMouseFollow() {
      if (!this._mouseFollow) return;
      window.removeEventListener("mousemove", this._mouseMoveBound);
      document.removeEventListener("mouseleave", this._mouseLeaveBound);
      const rest = this._mouseFollow.restGlyphState;
      this._mouseFollow = null;
      if (rest && rest.length === this.glyphs.length) {
        for (let i = 0; i < this.glyphs.length; i++) {
          this.glyphs[i].handleState = Object.assign({}, rest[i]);
        }
        this._render();
      }
    }

    _onMouseFollowMove(e) {
      if (!this._mouseFollow || !this.svgEl) return;
      const rect = this.svgEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const tx = (e.clientX - rect.left) / rect.width;
      const ty = (e.clientY - rect.top) / rect.height;
      const tClampX = Math.max(0, Math.min(1, tx));
      const tClampY = Math.max(0, Math.min(1, ty));
      const mf = this._mouseFollow;
      const weight = mf.weightMin + tClampX * (mf.weightMax - mf.weightMin);
      // Y goes top → bottom on screen; we want top = tall, bottom = short.
      const heightVal = mf.heightMax - tClampY * (mf.heightMax - mf.heightMin);
      for (const g of this.glyphs) {
        if (g.handleState.weight != null) g.handleState.weight = weight;
        if (g.handleState.height != null) g.handleState.height = heightVal;
      }
      this._render();
    }

    _onMouseFollowLeave() {
      // While mouse-follow is active, leaving the window doesn't restore —
      // only toggling the feature off does. (Matches the other engines.)
    }

    // Half the heaviest glyph's stroke weight — the amount a bold weight halo
    // overshoots the layout bbox in every direction. Used to pad the viewBox
    // (render + export) so the halo isn't clipped at the SVG edges.
    _maxWeightPad() {
      let maxW = 0;
      for (const g of this.glyphs) {
        const w = g.handleState && g.handleState.weight;
        if (w > maxW) maxW = w;
      }
      return Math.ceil(maxW / 2);
    }

    // ─── Export / state ────────────────────────────────────────────────
    toSVG() {
      const layout = this._layout();
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      const wpad = this._maxWeightPad();
      const vbW = totalWidth + 2 * wpad;
      const vbH = height + 2 * wpad;
      const clipPrefix = this._instanceId();
      const body = placed
        .map((pg, i) => this._glyphMarkup(pg, i, { baselineY, clipPrefix }))
        .join("");
      return (
        outlineAttributionBlock(this.presetKey) +
        "\n" +
        '<svg xmlns="' +
        SVG_NS +
        '" viewBox="' +
        -wpad +
        " " +
        -wpad +
        " " +
        vbW +
        " " +
        vbH +
        '" width="' +
        vbW +
        '" height="' +
        vbH +
        '" data-render-mode="anatomy-deform">' +
        body +
        "</svg>"
      );
    }

    toState() {
      return {
        pipeline: "anatomy-deform",
        text: this.text,
        color: this.color,
        padding: this.padding,
        tracking: this.tracking,
        fontSize: this.fontSize,
        preset: this.presetKey,
        monoCellEnabled: this.monoCellEnabled,
        glyphs: this.glyphs.map((g) => ({
          character: g.character,
          handles: Object.assign({}, g.handleState),
        })),
        modes: {
          mouseFollow: this._mouseFollow
            ? { enabled: true, opts: Object.assign({}, this._mouseFollow.opts) }
            : { enabled: false },
        },
      };
    }

    static async fromState(state) {
      const wm = new AnatomyDeformWordmark(state.text, {
        presetKey: state.preset,
        tracking: state.tracking,
        color: state.color,
        padding: state.padding,
        fontSize: state.fontSize,
        glyphHandleState: state.glyphs || null,
        monoCellEnabled:
          state.monoCellEnabled != null ? state.monoCellEnabled : true,
      });
      await wm._loadGlyphs(state.text);
      return wm;
    }

    async toInteractiveBundle() {
      const src = await SandboxWordmark._fetchLibrarySource();
      const state = this.toState();
      const attr = outlineAttributionHtml(this.presetKey);
      const boot = `
(function () {
  var root = document.getElementById('putty-wordmark');
  if (!root) return;
  var state = ${JSON.stringify(state)};
  Putty.setOpentypeParser(typeof opentype !== 'undefined' ? opentype : null);
  Putty.AnatomyDeformWordmark.fromState(state).then(function (wm) {
    wm.mount(document.getElementById('putty-outline-stage'));
    if (state.modes && state.modes.mouseFollow && state.modes.mouseFollow.enabled) {
      wm.enableMouseFollow(state.modes.mouseFollow.opts || {});
    }
  });
})();`.trim();

      return [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>putty — anatomy-deform embed</title>",
        '<script src="https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js"><\/script>',
        "<style>",
        "  html, body { margin: 0; min-height: 100%; background: #f6f7f9; font-family: system-ui, sans-serif; }",
        "  .putty-wrap { max-width: 960px; margin: 0 auto; padding: 24px; }",
        "  .putty-outline-disclaimer { font-size: 13px; line-height: 1.5; color: #525860; background: #eceef2; border: 1px solid #d4d8e0; border-radius: 4px; padding: 12px 14px; margin-bottom: 20px; }",
        "  #putty-outline-stage svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }",
        "</style>",
        "</head>",
        "<body>",
        '<div class="putty-wrap" id="putty-wordmark">',
        attr,
        '<div id="putty-outline-stage"></div>',
        "</div>",
        outlineAttributionBlock(state.preset),
        "<script>" + src + "<\/script>",
        "<script>" + boot + "<\/script>",
        "</body>",
        "</html>",
      ].join("\n");
    }
  }

  function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ════════════════════════════════════════════════════════════════════
  // OUTLINE WORDMARK  (static reference — comparison / learning only)
  // Requires opentype.js via setOpentypeParser(). No handles.
  // ════════════════════════════════════════════════════════════════════
  class OutlineWordmark {
    constructor(text, options) {
      options = options || {};
      this.text = text;
      this.presetKey = options.presetKey || options.preset || "bubbly";
      this.renderMode = "outline";
      this.tracking = options.tracking != null ? options.tracking : 8;
      this.color = options.color || "#2a2ae5";
      this.padding = options.padding != null ? options.padding : 40;
      this.fontSize = options.fontSize != null ? options.fontSize : 1000;
      this.glyphs = [];
      this.svgEl = null;
      this.glyphLayer = null;
    }

    static async create(text, options) {
      const wm = new OutlineWordmark(text, options);
      await wm._loadGlyphs(text);
      return wm;
    }

    get presetMeta() {
      return presets[this.presetKey] || null;
    }

    async _loadGlyphs(text) {
      const chars = Array.from(text || " ");
      const loaded = [];
      for (const ch of chars) {
        loaded.push(
          await getOutlineGlyphData(this.presetKey, ch, this.fontSize)
        );
      }
      this.glyphs = loaded;
      this.text = text;
    }

    async setPresetKey(presetKey) {
      this.presetKey = presetKey;
      await this._loadGlyphs(this.text);
      this._render();
    }

    async setText(newText) {
      await this._loadGlyphs(newText);
      this._render();
    }

    mount(target) {
      let host;
      if (typeof target === "string") {
        host = document.querySelector(target);
        if (!host) throw new Error("mount target not found: " + target);
      } else {
        host = target;
      }
      if (host instanceof SVGSVGElement) {
        this.svgEl = host;
      } else {
        this.svgEl = document.createElementNS(SVG_NS, "svg");
        host.appendChild(this.svgEl);
      }
      this.glyphLayer = document.createElementNS(SVG_NS, "g");
      this.svgEl.appendChild(this.glyphLayer);
      describeWordmarkSvg(this.svgEl, this.text, false);
      this._render();
      return this.svgEl;
    }

    _layout() {
      let cursor = this.padding;
      let maxAscent = 0;
      let maxDescent = 0;
      const placed = this.glyphs.map((glyph) => {
        const x = cursor;
        cursor += glyph.advance + this.tracking;
        const b = glyph.bounds;
        const ascent = Math.max(0, -b.minY);
        const descent = Math.max(0, b.maxY);
        if (ascent > maxAscent) maxAscent = ascent;
        if (descent > maxDescent) maxDescent = descent;
        return { glyph, x, bounds: b };
      });
      return {
        placed,
        totalWidth: cursor + this.padding - this.tracking,
        maxAscent,
        maxDescent,
      };
    }

    _render() {
      if (!this.svgEl || !this.glyphLayer) return;
      const layout = this._layout();
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      this.svgEl.setAttribute("viewBox", "0 0 " + totalWidth + " " + height);
      this.svgEl.setAttribute("width", String(totalWidth));
      this.svgEl.setAttribute("height", String(height));
      this.svgEl.setAttribute("data-render-mode", "outline");
      this.svgEl.setAttribute("data-preset", this.presetKey);

      const parts = [];
      for (const pg of placed) {
        parts.push(
          '<g transform="translate(' +
            pg.x +
            "," +
            baselineY +
            ')">' +
            '<path d="' +
            pg.glyph.pathData +
            '" fill="' +
            this.color +
            '" fill-rule="evenodd" stroke="none"/>' +
            "</g>"
        );
      }
      this.glyphLayer.innerHTML = parts.join("");
    }

    toSVG() {
      const layout = this._layout();
      const { placed, totalWidth, maxAscent, maxDescent } = layout;
      const baselineY = this.padding + maxAscent;
      const height =
        this.padding + maxAscent + Math.max(maxDescent, 8) + this.padding;
      const body = placed
        .map(
          (pg) =>
            '<g transform="translate(' +
            pg.x +
            "," +
            baselineY +
            ')">' +
            '<path d="' +
            pg.glyph.pathData +
            '" fill="' +
            this.color +
            '" fill-rule="evenodd" stroke="none"/>' +
            "</g>"
        )
        .join("");
      return (
        outlineAttributionBlock(this.presetKey) +
        "\n" +
        '<svg xmlns="' +
        SVG_NS +
        '" viewBox="0 0 ' +
        totalWidth +
        " " +
        height +
        '" width="' +
        totalWidth +
        '" height="' +
        height +
        '" data-render-mode="outline">' +
        body +
        "</svg>"
      );
    }

    toState() {
      return {
        renderMode: "outline",
        text: this.text,
        tracking: this.tracking,
        color: this.color,
        padding: this.padding,
        fontSize: this.fontSize,
        preset: this.presetKey,
        glyphs: this.glyphs.map((g) => ({
          character: g.character,
          pathData: g.pathData,
          advance: g.advance,
          bounds: Object.assign({}, g.bounds),
        })),
      };
    }

    static fromState(state) {
      const wm = new OutlineWordmark(state.text, {
        presetKey: state.preset,
        tracking: state.tracking,
        color: state.color,
        padding: state.padding,
        fontSize: state.fontSize,
      });
      wm.glyphs = state.glyphs.map((g) => Object.assign({}, g));
      wm.text = state.text;
      return wm;
    }

    async toInteractiveBundle() {
      const src = await SandboxWordmark._fetchLibrarySource();
      const state = this.toState();
      const attr = outlineAttributionHtml(this.presetKey);
      const boot = `
(function () {
  var root = document.getElementById('putty-wordmark');
  if (!root) return;
  var state = ${JSON.stringify(state)};
  var wm = Putty.OutlineWordmark.fromState(state);
  wm.mount(document.getElementById('putty-outline-stage'));
})();`.trim();

      return [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>putty — outline embed (prototype)</title>",
        "<style>",
        "  html, body { margin: 0; min-height: 100%; background: #f6f7f9; font-family: system-ui, sans-serif; }",
        "  .putty-wrap { max-width: 960px; margin: 0 auto; padding: 24px; }",
        "  .putty-outline-disclaimer { font-size: 13px; line-height: 1.5; color: #525860; background: #eceef2; border: 1px solid #d4d8e0; border-radius: 4px; padding: 12px 14px; margin-bottom: 20px; }",
        "  .putty-outline-disclaimer p { margin: 0 0 8px; }",
        "  .putty-outline-disclaimer p:last-child { margin: 0; }",
        "  .putty-outline-attribution { font-size: 12px; color: #8b929e; }",
        "  #putty-outline-stage svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }",
        "</style>",
        "</head>",
        "<body>",
        '<div class="putty-wrap" id="putty-wordmark">',
        attr,
        '<div id="putty-outline-stage"></div>',
        "</div>",
        outlineAttributionBlock(state.preset),
        "<script>" + src + "<\/script>",
        "<script>" + boot + "<\/script>",
        "</body>",
        "</html>",
      ].join("\n");
    }
  }

  // Router. Dispatches to one of four engines:
  //   - mode === 'outline-static' (and a real preset)   → OutlineWordmark
  //   - preset.pipeline === 'outline-deform'            → DeformableOutlineWordmark
  //   - preset.pipeline === 'anatomy-deform'            → AnatomyDeformWordmark
  //   - everything else (no pipeline, 'none' preset)    → SandboxWordmark
  //
  // The static-compare short-circuit (mode === 'outline-static') is preserved
  // for the demo's "Reference outlines" toggle and is independent of pipeline.
  async function createWordmark(text, options) {
    options = options || {};
    const mode = options.renderMode != null ? options.renderMode : "outline";
    const presetKey =
      options.presetKey ||
      (options.preset && options.preset.name) ||
      (typeof options.preset === "string" ? options.preset : null);

    // Static reference outline — independent of pipeline.
    if (mode === "outline-static" && presetKey && presetKey !== "none") {
      return OutlineWordmark.create(
        text,
        Object.assign({}, options, { presetKey: presetKey })
      );
    }

    // Look up the preset to read its declared pipeline.
    const presetMeta =
      presetKey && presets[presetKey]
        ? presets[presetKey]
        : typeof options.preset === "object" && options.preset
          ? options.preset
          : null;

    const pipeline = presetMeta && presetMeta.pipeline;

    if (pipeline === "outline-deform" && presetKey && presetKey !== "none") {
      return DeformableOutlineWordmark.create(
        text,
        Object.assign({}, options, { presetKey: presetKey })
      );
    }
    if (pipeline === "anatomy-deform" && presetKey && presetKey !== "none") {
      return AnatomyDeformWordmark.create(
        text,
        Object.assign({}, options, { presetKey: presetKey })
      );
    }

    // Fallback: SandboxWordmark for the `none` preset, or any preset that
    // doesn't declare a pipeline. (Legacy / hand-authored Bézier sandbox.)
    const presetObj =
      typeof options.preset === "string"
        ? presets[options.preset]
        : options.preset;
    return new SandboxWordmark(
      text,
      Object.assign({}, options, { preset: presetObj })
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // Register everything
  // ════════════════════════════════════════════════════════════════════
  registerGlyph(a);
  registerGlyph(n);
  registerGlyph(o);
  registerGlyph(s);
  registerGlyph(h);
  registerGlyph(i_);
  registerGlyph(e);
  registerGlyph(t);
  registerGlyph(r_);
  registerGlyph(l);
  registerGlyph(w);
  registerGlyph(d);
  registerGlyph(b);
  registerGlyph(c);
  registerGlyph(m);
  registerGlyph(g);
  for (const k of Object.keys(extraLowercaseGlyphs))
    registerGlyph(extraLowercaseGlyphs[k]);
  for (const k of Object.keys(uppercaseGlyphs))
    registerGlyph(uppercaseGlyphs[k]);
  registerGlyph(space);

  const glyphs = Object.assign(
    {
      a,
      n,
      o,
      s,
      h,
      i: i_,
      e,
      t,
      r: r_,
      l,
      w,
      d,
      b,
      c,
      m,
      g,
      space,
    },
    extraLowercaseGlyphs,
    uppercaseGlyphs
  );

  return {
    SandboxWordmark,
    Wordmark: SandboxWordmark, // back-compat alias for previously generated bundles
    OutlineWordmark,
    DeformableOutlineWordmark,
    AnatomyDeformWordmark,
    Glyph,
    registerGlyph,
    getRegisteredGlyphs,
    createWordmark,
    setOpentypeParser,
    OUTLINE_DISCLAIMER,
    OUTLINE_DISCLAIMER_SHORT,
    outlineAttributionHtml,
    outlineAttributionBlock,
    buildDeformedPathData,
    defaultAxisValuesForPreset,
    glyphs,
    presets: presets,
  };
});
