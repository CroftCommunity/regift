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
      images: [],
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

// Images: a single-image post carries its i.redd.it URL in `url`; a gallery lists
// media ids in `gallery_data.items` (the display order) with mime types in
// `media_metadata`, and the original file lives at i.redd.it/<id>.<ext>.
describe('parsePostListing: images', () => {
  it('a single-image post yields one image', () => {
    const post = parsePostListing(fixture('post-image'));
    expect(post.video).toBeNull();
    expect(post.images).toEqual([{ url: 'https://i.redd.it/abc123.jpg', mime: 'image/jpeg' }]);
  });

  it('a gallery yields every image in gallery order, originals from i.redd.it', () => {
    const post = parsePostListing(fixture('post-gallery'));
    expect(post.images).toEqual([
      { url: 'https://i.redd.it/aaa111.jpg', mime: 'image/jpeg' },
      { url: 'https://i.redd.it/bbb222.png', mime: 'image/png' },
      { url: 'https://i.redd.it/ccc333.gif', mime: 'image/gif' },
    ]);
  });

  it('a text post has neither video nor images', () => {
    const post = parsePostListing(fixture('post-text'));
    expect(post.video).toBeNull();
    expect(post.images).toEqual([]);
  });

  it('a video post has no images', () => {
    expect(parsePostListing(fixture('post-video')).images).toEqual([]);
  });
});
