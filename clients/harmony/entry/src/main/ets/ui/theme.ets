// Theme tokens (H2). Mirrors Android JizhangTheme titanium/forest/mono presets
// (values copied from web main.css): page bg, hero card, accent, surfaces.

export interface ThemeTokens {
  bg: string;
  surface: string;
  hero: string;
  heroMuted: string;
  onHero: string;
  accent: string;
  border: string;
  muted: string;
  danger: string;
}

const TITANIUM: ThemeTokens = {
  bg: '#f7f5f0',
  surface: '#ffffff',
  hero: '#244d60',
  heroMuted: '#8fa8b5',
  onHero: '#ffffff',
  accent: '#2f6f8f',
  border: '#e3e6ea',
  muted: '#5f6b7a',
  danger: '#c92a2a',
};

const FOREST: ThemeTokens = {
  bg: '#f2f5ef',
  surface: '#ffffff',
  hero: '#294d3e',
  heroMuted: '#9db8a8',
  onHero: '#ffffff',
  accent: '#2d6a4f',
  border: '#dfe6dd',
  muted: '#5a6b5f',
  danger: '#c92a2a',
};

const MONO: ThemeTokens = {
  bg: '#f4f3f1',
  surface: '#ffffff',
  hero: '#30343a',
  heroMuted: '#a8adb5',
  onHero: '#ffffff',
  accent: '#1c1f23',
  border: '#e0dfdd',
  muted: '#606469',
  danger: '#b3261e',
};

export function themeTokens(preset: string): ThemeTokens {
  if (preset === 'forest') {
    return FOREST;
  }
  if (preset === 'mono') {
    return MONO;
  }
  return TITANIUM;
}

// 12-slot category palette, same slot order as web --cat-1..12.
export const CHART_PALETTE: string[] = [
  '#2f6f8f', '#2d6a4f', '#b7791f', '#6d4aa0', '#c2517a', '#3a86ff',
  '#8338ec', '#ff6b35', '#06a77d', '#ef476f', '#118ab2', '#073b4c',
];
