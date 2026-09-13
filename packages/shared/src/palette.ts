/**
 * The category colour palette: twelve fixed slots, shared by the seed data, the picker and
 * the charts.
 *
 * ## Why slots, not colours
 *
 * A category's colour is stored as an ARGB integer (`categories.color`) — that is the
 * reference app's model and it stays. But a single integer cannot be right in both themes:
 * a mid-tone that sits at 4:1 on white sits at 2:1 on the dark surface, and the reference
 * palette (twelve low-chroma browns and mauves) was hard to tell apart on *either*. So the
 * integer stored is the **light** value, and it is treated as the identity of a slot: the web
 * app maps it back to `--cat-N`, and the stylesheet supplies the light and dark variants. A
 * colour that is not in the palette (an import, a future custom picker) falls through as the
 * raw hex, which is the behaviour every existing row had.
 *
 * ## Legacy integers are recognised, never migrated
 *
 * Seeding is `ON CONFLICT DO NOTHING`, so an existing database keeps the reference app's
 * integers forever. Rather than a migration that would also overwrite a user's deliberate
 * choice, the old twelve are listed here by slot: an old "餐饮" (`#b8786f`, slot 1) renders
 * as the new slot 1 without a write. A user who picked the old slot 7 gets the new slot 7.
 *
 * ## The order is load-bearing
 *
 * Slots are assigned in this order (the seed uses 1–6 for expenses, 7–8 for income) and the
 * order was chosen so that neighbouring slots stay distinct under simulated
 * red–green colour-vision deficiency and for full-colour readers alike. That is measured, not
 * eyeballed: `packages/web/scripts/check-color.mjs` runs the palette through the checks on
 * every build. Reordering the slots therefore changes which categories can be confused, so do
 * not reorder without re-running the audit.
 *
 * Pure data — no IO — so the server (seeding, stats fallback) and the browser share it.
 */

export interface CategoryPaletteSlot {
  /** 1-based; `--cat-<slot>` in `styles/main.css`. */
  readonly slot: number;
  /** Short Chinese name, used as the picker's accessible label. */
  readonly name: string;
  /** The light-theme colour as `#rrggbb`; also what is stored, as ARGB. */
  readonly hex: string;
  /** `0xffrrggbb`, what `categories.color` holds. Always the unsigned form. */
  readonly argb: number;
}

const OPAQUE = 0xff000000;

/** `#rrggbb` → unsigned ARGB integer, the storage form. */
export function hexToArgb(hex: string): number {
  const value = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return (OPAQUE | parseInt(value, 16)) >>> 0;
}

/** ARGB integer → `#rrggbb`; the alpha byte is dropped, the sign bit is tolerated. */
export function argbToHex(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
}

function slot(index: number, name: string, hex: string): CategoryPaletteSlot {
  return { slot: index, name, hex, argb: hexToArgb(hex) };
}

/**
 * The twelve slots, in assignment order.
 *
 * The dark-theme variants live in `styles/main.css` beside these, one `--cat-N` per slot;
 * the two lists are kept in step by `check-color.mjs`.
 */
export const CATEGORY_PALETTE: readonly CategoryPaletteSlot[] = [
  slot(1, '蓝', '#2a78d6'),
  slot(2, '橙', '#d95d1e'),
  slot(3, '青', '#0f8f77'),
  slot(4, '黄', '#b8860b'),
  slot(5, '粉', '#d2497e'),
  slot(6, '绿', '#178a17'),
  slot(7, '紫', '#6b4fd0'),
  slot(8, '红', '#d63a3a'),
  slot(9, '天蓝', '#1a8bab'),
  slot(10, '棕', '#a85c1e'),
  slot(11, '梅红', '#9a3f8f'),
  slot(12, '橄榄', '#6f8a10'),
];

/**
 * The reference app's palette (`seed_service.dart` and the original picker), by slot.
 *
 * Kept only so an existing database maps onto the new slots without a migration. Nothing
 * writes these any more.
 */
export const LEGACY_CATEGORY_PALETTE: readonly number[] = [
  0xffb8786f, 0xff8a7764, 0xffb0835e, 0xffaa7e82, 0xff8d7890, 0xff847d74, 0xff60806e,
  0xff66888a, 0xff7a6f9b, 0xff9b7a5f, 0xff5f7a9b, 0xff9b5f6f,
].map((value) => value >>> 0);

const slotByArgb: ReadonlyMap<number, number> = new Map([
  ...CATEGORY_PALETTE.map((entry) => [entry.argb, entry.slot] as const),
  ...LEGACY_CATEGORY_PALETTE.map((argb, index) => [argb, index + 1] as const),
]);

/**
 * The palette slot a stored colour belongs to, or `null` for a colour outside the palette.
 *
 * Accepts the signed form too: `0xffb8786f | 0` is negative in JavaScript, and the API has
 * historically been lenient about which one it receives.
 */
export function categoryPaletteSlot(argb: number): number | null {
  return slotByArgb.get(argb >>> 0) ?? null;
}

/** A slot by number; throws on a number outside 1..12 so a typo cannot become a colour. */
export function paletteSlot(slot: number): CategoryPaletteSlot {
  const entry = CATEGORY_PALETTE[slot - 1];
  if (entry === undefined) throw new RangeError(`no category palette slot ${slot}`);
  return entry;
}

/** The colour a category renders in when its row is gone: the "other" slot. */
export const FALLBACK_CATEGORY_COLOR: number = paletteSlot(6).argb;
