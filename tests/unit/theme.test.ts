import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../../src/theme';

describe('resolveTheme', () => {
  it('honours an explicit stored choice over the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when there is no stored choice', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('ignores a garbage stored value and falls back to the OS', () => {
    expect(resolveTheme('purple', true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
  });
});
