import { describe, it, expect } from 'vitest';
import { swStrategy, type SwRequestInfo } from '../../src/sw-nav';

const req = (over: Partial<SwRequestInfo>): SwRequestInfo => ({
  method: 'GET',
  mode: 'no-cors',
  accept: '',
  sameOrigin: true,
  ...over,
});

describe('swStrategy', () => {
  it('never intercepts non-GET requests', () => {
    expect(swStrategy(req({ method: 'POST' }))).toBe('skip');
  });

  it('serves navigations network-first (shipped updates win, cache is fallback)', () => {
    expect(swStrategy(req({ mode: 'navigate' }))).toBe('network-first');
  });

  it('serves HTML accept network-first even when mode is not navigate', () => {
    expect(swStrategy(req({ accept: 'text/html,application/xhtml+xml' }))).toBe('network-first');
  });

  it('serves same-origin assets cache-first (hashed names cannot go stale)', () => {
    expect(swStrategy(req({ sameOrigin: true, accept: '*/*' }))).toBe('cache-first');
  });

  it('never intercepts cross-origin requests', () => {
    expect(swStrategy(req({ sameOrigin: false, accept: '*/*' }))).toBe('skip');
  });
});
