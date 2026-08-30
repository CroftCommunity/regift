import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePostListing, PostParseError } from '../../src/core/reddit/post';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/reddit/${name}.json`, import.meta.url), 'utf8'));

describe('parsePostListing', () => {
  it('reads a video post: attribution plus the v.redd.it id and whether it has sound', () => {
    const post = parsePostListing(fixture('post-video'));
    expect(post).toEqual({
      title: 'Dad jokes',
      author: 'someredditor',
      subreddit: 'GuysBeingDudes',
      permalink: 'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/',
      video: { id: 'blke7z3ttolh1', hasAudio: true, duration: 12, width: 480, height: 854 },
    });
  });

  it('follows a crosspost to its parent for the media, keeping the original author', () => {
    const post = parsePostListing(fixture('post-crosspost'));
    expect(post.video).toEqual({ id: 'orig1234abcd', hasAudio: false, duration: 7, width: 720, height: 1280 });
    expect(post.author).toBe('originalposter');
    expect(post.permalink).toBe('https://www.reddit.com/r/rarepuppers/comments/1zzzzzz/original_title/');
  });

  it('an image post has no video (v1 is video-only, and says so rather than guessing)', () => {
    const post = parsePostListing(fixture('post-image'));
    expect(post.video).toBeNull();
    expect(post.title).toBe('A photo');
  });

  it('accepts a bare listing as well as the [listing, comments] pair', () => {
    const pair = fixture('post-video') as unknown[];
    expect(parsePostListing(pair[0])).toEqual(parsePostListing(pair));
  });

  it('fails loud on something that is not a post listing', () => {
    expect(() => parsePostListing({ hello: 'world' })).toThrow(PostParseError);
    expect(() => parsePostListing('<!doctype html>')).toThrow(PostParseError);
    expect(() => parsePostListing([{ kind: 'Listing', data: { children: [] } }])).toThrow(PostParseError);
  });
});
