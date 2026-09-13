/**
 * Category palette specs.
 *
 * The palette is data, so most of what can go wrong is bookkeeping: a slot number that does
 * not match its position, a legacy integer that no longer maps, a seed row that stores a
 * colour the picker cannot recognise. Each of those would show up as a category quietly
 * losing its theme-aware colour, which nothing at runtime reports.
 */

import { describe, expect, it } from 'vitest';

import {
  argbToHex,
  CATEGORY_PALETTE,
  categoryPaletteSlot,
  FALLBACK_CATEGORY_COLOR,
  hexToArgb,
  LEGACY_CATEGORY_PALETTE,
  paletteSlot,
} from '../src/palette.js';
import { SEED_CATEGORIES, SEED_EXPENSE_CATEGORIES, SEED_INCOME_CATEGORIES } from '../src/seed-data.js';

describe('hexToArgb / argbToHex', () => {
  it('round-trips and always yields the unsigned form', () => {
    expect(hexToArgb('#b8786f')).toBe(4290279535);
    expect(hexToArgb('b8786f')).toBe(4290279535);
    expect(argbToHex(4290279535)).toBe('#b8786f');
    // The signed form a `| 0` would produce is tolerated on the way out.
    expect(argbToHex(4290279535 | 0)).toBe('#b8786f');
    expect(argbToHex(0xff000a0b)).toBe('#000a0b');
  });

  it('rejects anything that is not six hex digits', () => {
    expect(() => hexToArgb('#fff')).toThrow();
    expect(() => hexToArgb('#12345g')).toThrow();
    expect(() => hexToArgb('')).toThrow();
  });
});

describe('CATEGORY_PALETTE', () => {
  it('has twelve slots numbered by position, each with a distinct colour and name', () => {
    expect(CATEGORY_PALETTE).toHaveLength(12);
    CATEGORY_PALETTE.forEach((entry, index) => {
      expect(entry.slot).toBe(index + 1);
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.argb).toBe(hexToArgb(entry.hex));
      expect(entry.argb).toBeGreaterThan(0);
    });
    expect(new Set(CATEGORY_PALETTE.map((entry) => entry.hex)).size).toBe(12);
    expect(new Set(CATEGORY_PALETTE.map((entry) => entry.name)).size).toBe(12);
  });

  it('paletteSlot returns the entry and refuses a slot that does not exist', () => {
    expect(paletteSlot(1)).toBe(CATEGORY_PALETTE[0]);
    expect(paletteSlot(12)).toBe(CATEGORY_PALETTE[11]);
    expect(() => paletteSlot(0)).toThrow(RangeError);
    expect(() => paletteSlot(13)).toThrow(RangeError);
  });

  it('does not share a colour with the legacy palette, so a slot lookup is never ambiguous', () => {
    const current = new Set(CATEGORY_PALETTE.map((entry) => entry.argb));
    for (const legacy of LEGACY_CATEGORY_PALETTE) expect(current.has(legacy)).toBe(false);
    expect(LEGACY_CATEGORY_PALETTE).toHaveLength(12);
  });
});

describe('categoryPaletteSlot', () => {
  it('maps a current colour to its slot', () => {
    for (const entry of CATEGORY_PALETTE) {
      expect(categoryPaletteSlot(entry.argb)).toBe(entry.slot);
      // The signed form must resolve too.
      expect(categoryPaletteSlot(entry.argb | 0)).toBe(entry.slot);
    }
  });

  it('maps the reference app’s integers to the same slot positions, without a migration', () => {
    // The reference seed: 餐饮 #b8786f … 其他收入 #66888a were slots 1–8 of its picker.
    expect(categoryPaletteSlot(4290279535)).toBe(1); // 餐饮
    expect(categoryPaletteSlot(4287264612)).toBe(2); // 交通
    expect(categoryPaletteSlot(4289758046)).toBe(3); // 住房
    expect(categoryPaletteSlot(4289363586)).toBe(4); // 购物
    expect(categoryPaletteSlot(4287461520)).toBe(5); // 娱乐
    expect(categoryPaletteSlot(4286872948)).toBe(6); // 其他
    expect(categoryPaletteSlot(4284514414)).toBe(7); // 工资
    expect(categoryPaletteSlot(4284909706)).toBe(8); // 其他收入
    LEGACY_CATEGORY_PALETTE.forEach((argb, index) => {
      expect(categoryPaletteSlot(argb)).toBe(index + 1);
    });
  });

  it('returns null for a colour outside both palettes', () => {
    expect(categoryPaletteSlot(hexToArgb('#123456'))).toBeNull();
    expect(categoryPaletteSlot(0)).toBeNull();
    expect(categoryPaletteSlot(4_000_000_000)).toBeNull();
  });
});

describe('seed data colours', () => {
  it('expense categories take slots 1–6 and income 7–8, in order', () => {
    SEED_EXPENSE_CATEGORIES.forEach((category, index) => {
      expect(categoryPaletteSlot(category.color)).toBe(index + 1);
    });
    SEED_INCOME_CATEGORIES.forEach((category, index) => {
      expect(categoryPaletteSlot(category.color)).toBe(index + 7);
    });
    expect(new Set(SEED_CATEGORIES.map((category) => category.color)).size).toBe(8);
  });

  it('the fallback for a missing category is a palette colour', () => {
    expect(categoryPaletteSlot(FALLBACK_CATEGORY_COLOR)).toBe(6);
  });
});
