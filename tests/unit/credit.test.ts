import { describe, it, expect } from 'vitest';
import { creditLine } from '../../src/core/credit';
import type { Post } from '../../src/core/post';

const post = (over: Partial<Post>): Post => ({ source: 'reddit', title: null, author: null, where: null, permalink: null, items: [], ...over });

// The line you paste into the post you make next. Cross-posting with credit is
// the product's whole framing, so the credit is a first-class output.
describe('creditLine', () => {
  it('names the author, where it was posted, and the source link', () => {
    expect(
      creditLine(post({ author: 'someredditor', where: 'r/GuysBeingDudes', permalink: 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/' })),
    ).toBe('via u/someredditor on r/GuysBeingDudes — https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/');
  });

  it('uses each source’s own way of naming people', () => {
    expect(creditLine(post({ source: 'bluesky', author: 'rainmaker1973-m.bsky.social', permalink: 'https://bsky.app/x' }))).toBe('via @rainmaker1973-m.bsky.social on Bluesky — https://bsky.app/x');
    expect(creditLine(post({ source: 'mastodon', author: 'Mastodon@mastodon.social', where: 'mastodon.social' }))).toBe('via @Mastodon@mastodon.social on mastodon.social');
    expect(creditLine(post({ source: 'tumblr', author: 'ariaiscursed' }))).toBe('via ariaiscursed on Tumblr');
  });

  it('drops the parts it does not know rather than printing "null"', () => {
    expect(creditLine(post({}))).toBe('via Reddit');
    expect(creditLine(post({ author: 'a' }))).toBe('via u/a on Reddit');
    expect(creditLine(post({ where: 'r/b', permalink: 'https://x/' }))).toBe('via r/b — https://x/');
  });
});
