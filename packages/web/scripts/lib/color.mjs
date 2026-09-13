/**
 * Colour mathematics shared by the static audit and the browser suites.
 *
 * Hand-rolled for the same reason as the charts and the PNG encoder: the whole file is
 * shorter than the licence of the package that would replace it, and every number below is
 * traceable to a published formula.
 *
 *   * WCAG 2.1 relative luminance and contrast ratio — what the accessibility floors are
 *     stated in, and what `render-theme.mjs` already computed inside the page;
 *   * OKLab / OKLCH (Ottosson 2020) — the space in which a lightness band and a chroma floor
 *     mean what they say; sRGB lightness does not;
 *   * Machado, Oliveira & Fernandes (2009) dichromacy simulation at severity 1.0 — the
 *     model the categorical thresholds in `check-color.mjs` are calibrated against, so it is
 *     part of the standard rather than an implementation detail.
 *
 * Every function takes `#rrggbb` (a leading `#` optional, three-digit forms accepted) and
 * throws on anything else: a typo in a token must fail the audit, not pass it as black.
 */

/** `#rgb` / `#rrggbb` → `[r, g, b]` in 0..1 sRGB. */
export function hexToRgb(hex) {
  const value = String(hex).trim().replace(/^#/, '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

/** `rgb(r, g, b)` / `rgba(...)` as a browser reports it → `[r, g, b]` in 0..1. */
export function cssRgbToRgb(css) {
  const parts = String(css).match(/\d+(?:\.\d+)?/g);
  if (parts === null || parts.length < 3) throw new Error(`not an rgb() colour: ${JSON.stringify(css)}`);
  return parts.slice(0, 3).map((part) => Number(part) / 255);
}

/** Accepts either notation, so the browser suites can compare a token to a computed style. */
export function toRgb(colour) {
  return /^\s*rgba?\(/.test(String(colour)) ? cssRgbToRgb(colour) : hexToRgb(colour);
}

/** `[r, g, b]` in 0..1 → `#rrggbb`. */
export function rgbToHex([r, g, b]) {
  return `#${[r, g, b]
    .map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.1 relative luminance. */
export function luminance(colour) {
  const [r, g, b] = toRgb(colour).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. Order of the arguments does not matter. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** OKLab from linear sRGB (Ottosson 2020). */
function oklabFromLinear([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklab(colour) {
  return oklabFromLinear(toRgb(colour).map(toLinear));
}

/** `{ L, C, h }` — lightness 0..1, chroma, hue in degrees 0..360. */
export function oklch(colour) {
  const [L, a, b] = oklab(colour);
  return {
    L,
    C: Math.hypot(a, b),
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
 *
 * `tritan` is reported but never gated: it is rare, and the categorical thresholds are
 * calibrated on the two common forms.
 */
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulateLinear(colour, kind) {
  const matrix = MACHADO[kind];
  if (matrix === undefined) throw new Error(`unknown deficiency: ${kind}`);
  const [r, g, b] = toRgb(colour).map(toLinear);
  const clamp = (c) => Math.max(0, Math.min(1, c));
  return matrix.map(([mr, mg, mb]) => clamp(mr * r + mg * g + mb * b));
}

/**
 * Perceptual distance: Euclidean distance in OKLab, ×100.
 *
 * With `kind` the two colours are first passed through the dichromacy simulation, so the
 * result is how far apart they look to that reader.
 */
export function deltaE(a, b, kind) {
  const labA = kind ? oklabFromLinear(simulateLinear(a, kind)) : oklab(a);
  const labB = kind ? oklabFromLinear(simulateLinear(b, kind)) : oklab(b);
  return 100 * Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
}

/** Rounded for reports; the comparisons use the raw value. */
export const round2 = (value) => Math.round(value * 100) / 100;
