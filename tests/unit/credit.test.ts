import { describe, it, expect } from 'vitest';
import { creditLine } from '../../src/core/credit';

// The line you paste into the post you make next. Cross-posting with attribution
// is the product's whole framing, so the credit is a first-class output.
describe('creditLine', () => {
  it('names the author, the community and the source link', () => {
    expect(
      creditLine({
        title: 'Dad jokes',
        author: 'someredditor',
        subreddit: 'GuysBeingDudes',
        permalink: 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/',
        video: null,
      }),
    ).toBe('via u/someredditor on r/GuysBeingDudes — https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/');
  });

  it('drops the parts it does not know rather than printing "null"', () => {
    expect(creditLine({ title: null, author: null, subreddit: null, permalink: null, video: null })).toBe('via Reddit');
    expect(creditLine({ title: null, author: 'a', subreddit: null, permalink: null, video: null })).toBe('via u/a on Reddit');
    expect(creditLine({ title: null, author: null, subreddit: 'b', permalink: 'https://x/', video: null })).toBe('via r/b — https://x/');
  });
});
