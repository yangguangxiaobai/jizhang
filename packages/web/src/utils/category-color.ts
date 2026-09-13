/**
 * The stored category colour → the CSS colour to render it with.
 *
 * ## Why the answer is usually a token
 *
 * `categories.color` is an ARGB integer, and for the twelve palette colours that integer is
 * the *light* value. Rendering it verbatim in the dark theme would put a colour tuned for
 * white on `#1e2127`, where several of the twelve drop under 3:1. So a palette colour comes
 * back as `var(--cat-N)`, and `styles/main.css` supplies the value for the theme in effect.
 * The reference app's old integers map to the same slots (see `@jizhang/shared`'s
 * `palette.ts`), which is how an existing database gets the new palette with no migration.
 *
 * A colour outside the palette is returned as its hex, unchanged — the behaviour every row
 * had before, and the sanctioned exception to "no literal colours in a component".
 *
 * ## Use it in `style`, never in an SVG attribute
 *
 * `fill="var(--cat-1)"` does nothing: an SVG *presentation attribute* is parsed as an
 * attribute value, not as CSS, so `var()` is invalid there and the shape falls back to
 * black. `:style="{ fill: … }"` goes through the CSS parser and works. `DonutChart.vue`
 * had the attribute form; it now has the style form for that reason.
 */
import { argbToHex, categoryPaletteSlot } from '@jizhang/shared';

export function categoryCssColor(argb: number): string {
  const slot = categoryPaletteSlot(argb);
  return slot === null ? argbToHex(argb) : `var(--cat-${slot})`;
}
