import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The palette's contrast ratios are load-bearing, not decoration: every
// text/UI token pair must clear WCAG AA. This test parses tokens.css and
// recomputes the ratios so a future colour tweak that breaks a floor fails the
// gate rather than shipping an illegible surface.

function relLuminance(hex: string): number {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8');

function scope(name: 'light' | 'dark'): Record<string, string> {
  const block =
    name === 'light'
      ? css.slice(css.indexOf(':root'), css.indexOf("[data-theme='dark']"))
      : css.slice(css.indexOf("[data-theme='dark']"));
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map[m[1] as string] = m[2] as string;
  }
  return map;
}

// [foreground token, background token, floor]
const TEXT_PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['ink', 'bg', 4.5],
  ['ink-muted', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['link', 'bg', 4.5],
  ['accent-ink', 'accent', 4.5],
  ['active-ink', 'active', 4.5],
  ['danger-ink', 'danger', 4.5],
  ['focus', 'bg', 3], // focus ring is a UI indicator, 3:1 floor
];

describe.each(['light', 'dark'] as const)('brand tokens: %s theme clears WCAG AA', (name) => {
  const map = scope(name);
  it.each(TEXT_PAIRS)('%s on %s ≥ %s:1', (fg, bg, floor) => {
    const a = map[fg];
    const b = map[bg];
    expect(a, `missing --${fg} in ${name}`).toBeTruthy();
    expect(b, `missing --${bg} in ${name}`).toBeTruthy();
    expect(ratio(a as string, b as string)).toBeGreaterThanOrEqual(floor);
  });
});
