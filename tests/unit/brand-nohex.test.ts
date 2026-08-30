import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// tokens.css is the ONLY file allowed to hold raw hex. styles.css (components)
// and app code must reference semantic tokens via var(), never a literal colour.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function read(rel: string): string {
  return readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
}

describe('brand: hex is confined to tokens.css', () => {
  it('styles.css contains no raw hex', () => {
    const matches = read('styles.css').match(HEX) ?? [];
    expect(matches).toEqual([]);
  });

  it('tokens.css is where the palette actually lives (sanity)', () => {
    const matches = read('tokens.css').match(HEX) ?? [];
    expect(matches.length).toBeGreaterThan(10);
  });
});
