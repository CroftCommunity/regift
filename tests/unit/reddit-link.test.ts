import { describe, it, expect } from 'vitest';
import { classifyRedditLink, postJsonUrl } from '../../src/core/reddit/link';

describe('classifyRedditLink', () => {
  it('a /s/ share link needs the browser to resolve it (a cross-origin redirect is opaque to a page)', () => {
    expect(classifyRedditLink('https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S')).toEqual({
      kind: 'share',
      url: 'https://www.reddit.com/r/GuysBeingDudes/s/NqVUzmSB0S',
    });
  });

  it('a redd.it short link is also a redirect', () => {
    expect(classifyRedditLink('https://redd.it/1vys36f')).toEqual({ kind: 'share', url: 'https://redd.it/1vys36f' });
  });

  it('a post URL is canonicalised: www host, no query, trailing slash', () => {
    const shared =
      'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/?share_id=uqzUZ5M&utm_source=share';
    expect(classifyRedditLink(shared)).toEqual({
      kind: 'post',
      canonical: 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/',
    });
  });

  it.each(['old.reddit.com', 'reddit.com', 'm.reddit.com', 'new.reddit.com'])('normalises the %s host', (host) => {
    expect(classifyRedditLink(`https://${host}/r/a/comments/1abc/slug`)).toEqual({
      kind: 'post',
      canonical: 'https://www.reddit.com/r/a/comments/1abc/slug/',
    });
  });

  it('accepts a post URL with no subreddit segment', () => {
    expect(classifyRedditLink('https://www.reddit.com/comments/1abc')).toEqual({
      kind: 'post',
      canonical: 'https://www.reddit.com/comments/1abc/',
    });
  });

  it('a v.redd.it URL names the video directly', () => {
    expect(classifyRedditLink('https://v.redd.it/blke7z3ttolh1/CMAF_720.mp4?x=1')).toEqual({
      kind: 'video',
      videoId: 'blke7z3ttolh1',
    });
    expect(classifyRedditLink('https://v.redd.it/blke7z3ttolh1')).toEqual({ kind: 'video', videoId: 'blke7z3ttolh1' });
  });

  it('anything else is unknown, not a guess', () => {
    expect(classifyRedditLink('https://www.reddit.com/r/pics/')).toEqual({
      kind: 'unknown',
      url: 'https://www.reddit.com/r/pics/',
    });
    expect(classifyRedditLink('https://example.com/watch')).toEqual({ kind: 'unknown', url: 'https://example.com/watch' });
  });
});

describe('postJsonUrl', () => {
  it('asks for the listing only: no comment tree, raw (unescaped) JSON', () => {
    expect(postJsonUrl('https://www.reddit.com/r/a/comments/1abc/slug/')).toBe(
      'https://www.reddit.com/r/a/comments/1abc/slug/.json?limit=0&raw_json=1',
    );
  });
});
