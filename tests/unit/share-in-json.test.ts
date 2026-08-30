import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sharedPostJson } from '../../src/core/share-in';

const listing = readFileSync(new URL('../fixtures/reddit/post-video.json', import.meta.url), 'utf8');

// The assisted step without the clipboard: from the post-data tab, select all and
// SHARE the selection to regift. Android delivers the selection as `text`.
describe('sharedPostJson: post data arriving through the share target', () => {
  it('parses a listing shared as text', () => {
    expect(sharedPostJson({ text: listing })).toEqual(JSON.parse(listing));
  });

  it('tolerates whitespace around the selection', () => {
    expect(sharedPostJson({ text: `\n  ${listing}\n` })).toEqual(JSON.parse(listing));
  });

  it('is null for a link, words, or partial JSON', () => {
    expect(sharedPostJson({ url: 'https://www.reddit.com/r/x/s/AbC' })).toBeNull();
    expect(sharedPostJson({ text: 'look at this' })).toBeNull();
    expect(sharedPostJson({ text: listing.slice(0, 200) })).toBeNull();
    expect(sharedPostJson({})).toBeNull();
  });

  it('only accepts an array or object, never a bare JSON scalar', () => {
    expect(sharedPostJson({ text: '"hello"' })).toBeNull();
    expect(sharedPostJson({ text: '42' })).toBeNull();
  });
});
